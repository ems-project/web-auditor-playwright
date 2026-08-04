import type { Page, Request } from "playwright";

import { BasePlugin } from "../engine/BasePlugin.js";
import type {
    EngineState,
    IPlugin,
    PluginPhase,
    Report,
    ResourceContext,
} from "../engine/types.js";

const RESOURCE_TYPE_TO_DIRECTIVE: Record<string, string> = {
    document: "default-src",
    script: "script-src",
    stylesheet: "style-src",
    image: "img-src",
    font: "font-src",
    xhr: "connect-src",
    fetch: "connect-src",
    websocket: "connect-src",
    eventsource: "connect-src",
    ping: "connect-src",
    media: "media-src",
    object: "object-src",
    embed: "object-src",
    frame: "frame-src",
    iframe: "frame-src",
    worker: "worker-src",
    sharedworker: "worker-src",
    manifest: "manifest-src",
    other: "default-src",
};

const DIRECTIVE_ORDER = [
    "default-src",
    "script-src",
    "style-src",
    "img-src",
    "font-src",
    "connect-src",
    "media-src",
    "object-src",
    "frame-src",
    "worker-src",
    "manifest-src",
];

type CspEntry = {
    origin: string;
    resourceType: string;
    directive: string;
    count: number;
    exampleUrls: string[];
};

type CspBlockedResource = {
    url: string;
    directive: string;
    resourceType?: string;
    violationType: "blocked" | "report-only";
    message: string;
};

type CspInventoryState = {
    entries: Record<string, CspEntry>;
    blockedResources: CspBlockedResource[];
};

type PageCspState = {
    attached: boolean;
    requests: Array<{ 
        origin: string; 
        resourceType: string; 
        url: string; 
        isFromIframe: boolean;
        iframeUrl?: string;
    }>;
    blockedResources: CspBlockedResource[];
    requestListener: ((request: Request) => void) | null;
    consoleListener: ((message: any) => void) | null;
    mainFrame: any;
};

export type CspInventoryPluginOptions = {
    /**
     * Maximum number of example URLs to store per origin+resourceType combination.
     * Defaults to 3.
     */
    maxExampleUrls?: number;
};

export class CspInventoryPlugin extends BasePlugin implements IPlugin {
    name = "csp-inventory";
    phases: PluginPhase[] = ["beforeGoto", "afterGoto", "finally"];

    private readonly maxExampleUrls: number;
    private readonly pageStates = new WeakMap<Page, PageCspState>();

    constructor(options: CspInventoryPluginOptions = {}) {
        super();
        this.maxExampleUrls = options.maxExampleUrls ?? 3;
    }

    applies(ctx: ResourceContext): boolean {
        return !ctx.download;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (ctx.download) return;

        const pageState = this.getPageState(ctx.page);

        if (phase === "beforeGoto") {
            pageState.requests = [];
            pageState.blockedResources = [];
            pageState.mainFrame = ctx.page.mainFrame();
            this.attachListeners(ctx.page, pageState, ctx.engineState.origin);
            this.register(ctx);
            return;
        }

        if (phase === "afterGoto") {
            // Wait a bit for iframe resources to load
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const globalState = this.getInventoryState(ctx.engineState);
            const perPageOrigins: Record<
                string,
                { 
                    directive: string; 
                    resourceTypes: string[]; 
                    exampleUrls: string[];
                    sourceContext: 'main_document' | 'iframe' | 'mixed';
                    iframeInfo?: {
                        iframeSources: string[];
                        iframeResourceCount: number;
                        mainDocumentResourceCount: number;
                    };
                }
            > = {};


            for (const { origin, resourceType, url, isFromIframe, iframeUrl } of pageState.requests) {
                const directive = RESOURCE_TYPE_TO_DIRECTIVE[resourceType] ?? "default-src";
                const globalKey = `${origin}|${resourceType}`;

                // Merge into global crawl state
                if (!globalState.entries[globalKey]) {
                    globalState.entries[globalKey] = {
                        origin,
                        resourceType,
                        directive,
                        count: 0,
                        exampleUrls: [],
                    };
                }
                const entry = globalState.entries[globalKey];
                entry.count += 1;
                if (
                    entry.exampleUrls.length < this.maxExampleUrls &&
                    !entry.exampleUrls.includes(url)
                ) {
                    entry.exampleUrls.push(url);
                }

                // Build per-page summary (grouped by origin) with source context
                if (!perPageOrigins[origin]) {
                    perPageOrigins[origin] = { 
                        directive, 
                        resourceTypes: [], 
                        exampleUrls: [],
                        sourceContext: isFromIframe ? 'iframe' : 'main_document'
                    };
                }
                const pageOrigin = perPageOrigins[origin];
                
                // Update source context if we have mixed sources
                if (pageOrigin.sourceContext !== (isFromIframe ? 'iframe' : 'main_document')) {
                    pageOrigin.sourceContext = 'mixed';
                }
                
                // Handle iframe information
                if (isFromIframe && iframeUrl) {
                    if (!pageOrigin.iframeInfo) {
                        pageOrigin.iframeInfo = {
                            iframeSources: [],
                            iframeResourceCount: 0,
                            mainDocumentResourceCount: 0
                        };
                    }
                    if (!pageOrigin.iframeInfo.iframeSources.includes(iframeUrl)) {
                        pageOrigin.iframeInfo.iframeSources.push(iframeUrl);
                    }
                    pageOrigin.iframeInfo.iframeResourceCount++;
                } else if (!isFromIframe) {
                    if (!pageOrigin.iframeInfo) {
                        pageOrigin.iframeInfo = {
                            iframeSources: [],
                            iframeResourceCount: 0,
                            mainDocumentResourceCount: 0
                        };
                    }
                    pageOrigin.iframeInfo.mainDocumentResourceCount++;
                }

                if (!pageOrigin.resourceTypes.includes(resourceType)) {
                    pageOrigin.resourceTypes.push(resourceType);
                }
                if (
                    pageOrigin.exampleUrls.length < this.maxExampleUrls &&
                    !pageOrigin.exampleUrls.includes(url)
                ) {
                    pageOrigin.exampleUrls.push(url);
                }
            }

            // Process blocked resources
            if (pageState.blockedResources.length > 0) {
                // Add blocked resources to global state
                globalState.blockedResources.push(...pageState.blockedResources);

                // Group blocked resources by violation type
                const blockedCount = pageState.blockedResources.filter(r => r.violationType === "blocked").length;
                const reportOnlyCount = pageState.blockedResources.filter(r => r.violationType === "report-only").length;

                // Extract blocked URLs similar to how externalOrigins works
                const blockedUrls: Record<string, { directive: string; violationType: string; count: number; message: string }> = {};
                for (const resource of pageState.blockedResources) {
                    if (resource.url) {
                        const key = resource.url;
                        if (!blockedUrls[key]) {
                            blockedUrls[key] = {
                                directive: resource.directive,
                                violationType: resource.violationType,
                                count: 0,
                                message: resource.message
                            };
                        }
                        blockedUrls[key].count += 1;
                    }
                }

                let message = "";
                if (blockedCount > 0 && reportOnlyCount > 0) {
                    message = `CSP blocked ${blockedCount} resource(s) and reported ${reportOnlyCount} violation(s).`;
                } else if (blockedCount > 0) {
                    message = `CSP blocked ${blockedCount} resource(s).`;
                } else if (reportOnlyCount > 0) {
                    message = `CSP reported ${reportOnlyCount} violation(s) in report-only mode.`;
                }

                this.registerWarning(
                    ctx,
                    "security",
                    "CSP_BLOCKED_RESOURCE",
                    message,
                    {
                        blockedResources: blockedUrls,
                        blockedCount,
                        reportOnlyCount
                    }
                );
            }

            const originCount = Object.keys(perPageOrigins).length;
            if (originCount > 0) {
                this.registerInfo(
                    ctx,
                    "security",
                    "CSP_EXTERNAL_RESOURCE",
                    `Loads resources from ${originCount} external origin(s).`,
                    { externalOrigins: perPageOrigins },
                );
            } else if (pageState.blockedResources.length === 0) {
                this.register(ctx);
            }
            return;
        }

        if (phase === "finally") {
            this.detachListeners(ctx.page, pageState);
            this.register(ctx);
        }
    }

    getReport(engineState: EngineState): Report {
        const state = this.getInventoryState(engineState);
        const entries = Object.values(state.entries);

        // Collect unique origins and total request counts per directive
        const byDirective: Record<string, { origins: Set<string>; count: number }> = {};
        for (const entry of entries) {
            if (!byDirective[entry.directive]) {
                byDirective[entry.directive] = { origins: new Set(), count: 0 };
            }
            byDirective[entry.directive].origins.add(entry.origin);
            byDirective[entry.directive].count += entry.count;
        }

        const uniqueOrigins = new Set(entries.map((e) => e.origin)).size;

        const reportItems: Array<{ key: string; label: string; value: string | number }> = [
            {
                key: "uniqueExternalOrigins",
                label: "Unique external origins",
                value: uniqueOrigins,
            },
        ];

        const allDirectives = [
            ...DIRECTIVE_ORDER,
            ...Object.keys(byDirective).filter((d) => !DIRECTIVE_ORDER.includes(d)),
        ];

        for (const directive of allDirectives) {
            const group = byDirective[directive];
            if (!group) continue;
            reportItems.push({
                key: directive,
                label: directive,
                value: [...group.origins].sort().join(", "),
            });
        }

        return {
            plugin: this.name,
            label: "CSP Inventory",
            items: reportItems,
        };
    }

    private attachListeners(page: Page, state: PageCspState, origin: string): void {
        if (state.attached) return;

        let startHostname: string;
        try {
            startHostname = new URL(origin).hostname;
        } catch {
            return;
        }

        state.requestListener = (request: Request) => {
            const url = request.url();
            try {
                const parsed = new URL(url);
                
                // Skip same-origin and non-http(s) requests (data:, blob:, etc.)
                if (parsed.hostname === startHostname) return;
                if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

                // Determine if request is from main page or iframe
                const requestFrame = request.frame();
                const resourceType = request.resourceType();
                
                // The iframe document itself should be considered as loaded by the main document
                // Only resources loaded BY the iframe (not the iframe itself) are iframe-initiated
                const isFromIframe = requestFrame !== state.mainFrame && resourceType !== 'document';
                const iframeUrl = isFromIframe ? requestFrame.url() : undefined;

                state.requests.push({
                    origin: parsed.origin,
                    resourceType: request.resourceType(),
                    url,
                    isFromIframe,
                    iframeUrl,
                });
            } catch {
                // Ignore unparseable URLs
            }
        };

        // Listen for CSP violations in console messages
        state.consoleListener = (message: any) => {
            const text = message.text();
            const type = message.type();

            // Check for CSP violation messages
            if (type === "error" || type === "warning" || type === "info") {
                if (this.isCspViolationMessage(text)) {
                    const blockedResource = this.parseCspViolation(text);
                    if (blockedResource) {
                        state.blockedResources.push(blockedResource);
                    }
                }
            }
        };

        page.on("request", state.requestListener);
        page.on("console", state.consoleListener);
        state.attached = true;
    }

    private detachListeners(page: Page, state: PageCspState): void {
        if (!state.attached) return;

        if (state.requestListener) {
            page.off("request", state.requestListener);
            state.requestListener = null;
        }

        if (state.consoleListener) {
            page.off("console", state.consoleListener);
            state.consoleListener = null;
        }

        state.attached = false;
    }

    private isCspViolationMessage(text: string): boolean {
        // Common CSP violation message patterns
        const cspPatterns = [
            /Content.?Security.?Policy/i,
            /CSP/i,
            /refused to (load|execute|apply|connect)/i,
            /violates the following (Content Security Policy )?directive/i,
            /blocked by Content Security Policy/i,
            /blocked the loading of a resource/i,
            /\[Report Only\]/i
        ];

        return cspPatterns.some(pattern => pattern.test(text));
    }

    private parseCspViolation(message: string): CspBlockedResource | null {
        try {
            let url = '';
            let directive = '';
            let resourceType: string | undefined;

            // Pattern 1: "blocked the loading of a resource (frame-src) at https://example.com"
            const pattern1 = message.match(/blocked the loading of a resource \(([^)]+)\) at ([^\s?]+)/i);
            if (pattern1) {
                resourceType = pattern1[1];
                url = pattern1[2];
                directive = resourceType; // The resource type in parentheses is often the directive
            }

            // Pattern 2: "Loading the script 'https://example.com/script.js' violates..."
            if (!url) {
                const urlMatch = message.match(/Loading the (?:script|stylesheet|image|font|frame|media|object|worker|manifest)\s+['"]([^'"]+)['"]/i);
                if (urlMatch) {
                    url = urlMatch[1];
                }
            }

            // Pattern 3: Traditional format "refused to load ... because it violates ... directive: 'script-src'"
            if (!url) {
                const urlMatch = message.match(/(?:from|at|load|execute|apply)\s+['"]?([^'"'\s?]+)['"]?/i);
                url = urlMatch ? urlMatch[1] : '';
            }

            // Extract directive from various formats
            if (!directive) {
                const directiveMatch = message.match(/violates the following (?:Content Security Policy )?directive:\s*['"]\s*([^'"]+?)\s*['"]/i);
                if (directiveMatch) {
                    // Extract the first directive name from the policy string
                    const policyString = directiveMatch[1];
                    const firstDirective = policyString.split(/\s+/)[0];
                    directive = firstDirective;
                }
            }

            // Extract directive from "because it violates the following directive:" format
            if (!directive) {
                const directiveMatch2 = message.match(/because it violates the following directive:\s*['"]?([^'"'\s]+)['"]?/i);
                directive = directiveMatch2 ? directiveMatch2[1] : '';
            }

            // Determine if it's report-only or blocking
            const isReportOnly = /\[Report Only\]/i.test(message);
            const violationType: "blocked" | "report-only" = isReportOnly ? "report-only" : "blocked";

            // Try to determine resource type from URL if not already determined
            if (!resourceType && url) {
                if (url.match(/\.(js|mjs)$/i)) resourceType = "script";
                else if (url.match(/\.(css)$/i)) resourceType = "stylesheet";
                else if (url.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) resourceType = "image";
                else if (url.match(/\.(woff|woff2|ttf|otf)$/i)) resourceType = "font";
            }

            // Determine resource type from message content
            if (!resourceType) {
                if (message.includes('Loading the script')) resourceType = "script";
                else if (message.includes('Loading the stylesheet')) resourceType = "stylesheet";
                else if (message.includes('Loading the image')) resourceType = "image";
                else if (message.includes('Loading the font')) resourceType = "font";
                else if (message.includes('Loading the frame')) resourceType = "frame";
            }

            // Map common resource types to proper directive names
            if (resourceType) {
                const typeMapping: Record<string, string> = {
                    'frame-src': 'frame-src',
                    'script-src': 'script-src',
                    'style-src': 'style-src',
                    'img-src': 'img-src',
                    'font-src': 'font-src',
                    'connect-src': 'connect-src',
                    'media-src': 'media-src',
                    'object-src': 'object-src',
                    'worker-src': 'worker-src',
                    'manifest-src': 'manifest-src'
                };

                if (typeMapping[resourceType]) {
                    directive = directive || typeMapping[resourceType];
                }
            }

            if (url && directive) {
                return {
                    url,
                    directive,
                    resourceType,
                    violationType,
                    message: message.trim()
                };
            }
        } catch (error) {
            // Ignore parsing errors
        }

        return null;
    }

    private getPageState(page: Page): PageCspState {
        const existing = this.pageStates.get(page);
        if (existing) {
            return existing;
        }
        
        const newState: PageCspState = {
            attached: false,
            requests: [],
            blockedResources: [],
            requestListener: null,
            consoleListener: null,
            mainFrame: null,
        };
        this.pageStates.set(page, newState);
        return newState;
    }

    private getInventoryState(engineState: EngineState): CspInventoryState {
        const key = "cspInventoryState";
        const existing = engineState.any[key];
        if (existing && typeof existing === "object" && "entries" in (existing as object)) {
            return existing as CspInventoryState;
        }
        const created: CspInventoryState = { entries: {}, blockedResources: [] };
        engineState.any[key] = created;
        return created;
    }
}
