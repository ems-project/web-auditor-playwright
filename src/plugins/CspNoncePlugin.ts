import type { Page } from "playwright";

import { BasePlugin } from "../engine/BasePlugin.js";
import type {
    EngineState,
    IPlugin,
    PluginPhase,
    Report,
    ResourceContext,
} from "../engine/types.js";

type NonceInfo = {
    nonce: string;
    directive: "script-src" | "style-src";
    source: "csp-header" | "inline-element";
    elementType?: "script" | "style";
    content?: string;
    location?: string;
};

type CspNonceState = {
    nonces: Record<string, NonceInfo[]>; // URL -> nonce info array
};

type PageNonceState = {
    inlineElements: Array<{
        type: "script" | "style";
        nonce?: string;
        content: string;
        location: string;
    }>;
};

export type CspNoncePluginOptions = {
    /**
     * Whether to check for nonce reuse across pages.
     * Defaults to true.
     */
    checkNonceReuse?: boolean;
};

export class CspNoncePlugin extends BasePlugin implements IPlugin {
    name = "csp-nonce";
    phases: PluginPhase[] = ["afterGoto"];

    private readonly checkNonceReuse: boolean;
    private readonly pageStates = new WeakMap<Page, PageNonceState>();

    constructor(options: CspNoncePluginOptions = {}) {
        super();
        this.checkNonceReuse = options.checkNonceReuse ?? true;
    }

    applies(ctx: ResourceContext): boolean {
        // Apply to all non-download contexts - we'll check for HTML in the run method
        return !ctx.download;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (ctx.download || phase !== "afterGoto") return;

        // Only analyze HTML pages, but be more flexible about detection
        const isHtmlPage =
            ctx.mime?.includes("text/html") ||
            ctx.url.endsWith(".html") ||
            (!ctx.mime && ctx.response?.headers()["content-type"]?.includes("text/html"));

        if (!isHtmlPage) {
            this.register(ctx);
            return;
        }

        const pageState = this.getPageState(ctx.page);
        await this.performNonceAnalysis(ctx, pageState);
        this.register(ctx);
    }

    getReport(engineState: EngineState): Report {
        const state = this.getNonceState(engineState);
        const nonceStats = this.getNonceStatistics(state);

        const reportItems: Array<{ key: string; label: string; value: string | number }> = [];

        if (nonceStats.totalPages > 0) {
            reportItems.push({
                key: "nonceAnalyzedPages",
                label: "Pages with nonce analysis",
                value: nonceStats.totalPages,
            });

            if (nonceStats.pagesWithNonces > 0) {
                reportItems.push({
                    key: "pagesWithNonces",
                    label: "Pages using CSP nonces",
                    value: nonceStats.pagesWithNonces,
                });
            }

            if (nonceStats.totalNonceIssues > 0) {
                reportItems.push({
                    key: "nonceIssues",
                    label: "Nonce validation issues",
                    value: nonceStats.totalNonceIssues,
                });
            }

            if (nonceStats.uniqueNonces > 0) {
                reportItems.push({
                    key: "uniqueNonces",
                    label: "Unique nonces found",
                    value: nonceStats.uniqueNonces,
                });
            }

            if (nonceStats.reusedNonces > 0) {
                reportItems.push({
                    key: "reusedNonces",
                    label: "Reused nonces detected",
                    value: nonceStats.reusedNonces,
                });
            }
        }

        return {
            plugin: this.name,
            label: "CSP Nonce Analysis",
            items: reportItems,
        };
    }

    private getPageState(page: Page): PageNonceState {
        let existing = this.pageStates.get(page);
        if (!existing) {
            existing = {
                inlineElements: [],
            };
            this.pageStates.set(page, existing);
        }
        return existing;
    }

    private getNonceState(engineState: EngineState): CspNonceState {
        const key = "cspNonceState";
        const existing = engineState.any[key];
        if (existing && typeof existing === "object" && "nonces" in (existing as object)) {
            return existing as CspNonceState;
        }
        const created: CspNonceState = { nonces: {} };
        engineState.any[key] = created;
        return created;
    }

    /**
     * Parse CSP header to extract nonce values
     */
    private parseCspNonces(cspHeader: string): { scriptNonces: string[]; styleNonces: string[] } {
        const scriptNonces: string[] = [];
        const styleNonces: string[] = [];

        // Parse CSP directives
        const directives = cspHeader.split(";").map((d) => d.trim());

        for (const directive of directives) {
            const parts = directive.split(/\s+/);
            if (parts.length < 2) continue;

            const directiveName = parts[0].toLowerCase();
            const values = parts.slice(1);

            if (directiveName === "script-src" || directiveName === "default-src") {
                for (const value of values) {
                    const nonceMatch = value.match(/^'nonce-([^']+)'$/);
                    if (nonceMatch && directiveName === "script-src") {
                        scriptNonces.push(nonceMatch[1]);
                    } else if (nonceMatch && directiveName === "default-src") {
                        // default-src nonces apply to both script and style if specific directives aren't present
                        scriptNonces.push(nonceMatch[1]);
                        styleNonces.push(nonceMatch[1]);
                    }
                }
            }

            if (directiveName === "style-src" || directiveName === "default-src") {
                for (const value of values) {
                    const nonceMatch = value.match(/^'nonce-([^']+)'$/);
                    if (nonceMatch && directiveName === "style-src") {
                        styleNonces.push(nonceMatch[1]);
                    }
                }
            }
        }

        return { scriptNonces, styleNonces };
    }

    /**
     * Extract inline scripts and styles from page content
     */
    private async extractInlineElements(
        page: Page,
    ): Promise<
        Array<{ type: "script" | "style"; nonce?: string; content: string; location: string }>
    > {
        try {
            return await page.evaluate(() => {
                const elements: Array<{
                    type: "script" | "style";
                    nonce?: string;
                    content: string;
                    location: string;
                }> = [];

                // Find inline script tags
                const scripts = document.querySelectorAll("script:not([src])");
                scripts.forEach((script, index) => {
                    const nonce = script.getAttribute("nonce") || undefined;
                    const content = script.textContent || script.innerHTML || "";
                    elements.push({
                        type: "script",
                        nonce,
                        content: content.trim(),
                        location: `inline-script-${index + 1}`,
                    });
                });

                // Find inline style tags
                const styles = document.querySelectorAll("style");
                styles.forEach((style, index) => {
                    const nonce = style.getAttribute("nonce") || undefined;
                    const content = style.textContent || style.innerHTML || "";
                    elements.push({
                        type: "style",
                        nonce,
                        content: content.trim(),
                        location: `inline-style-${index + 1}`,
                    });
                });

                return elements;
            });
        } catch {
            // If page evaluation fails, return empty array
            return [];
        }
    }

    /**
     * Validate nonces and report issues
     */
    private validateNonces(
        ctx: ResourceContext,
        pageState: PageNonceState,
        cspNonces: { scriptNonces: string[]; styleNonces: string[] },
    ): void {
        const url = ctx.url;
        const globalState = this.getNonceState(ctx.engineState);

        // Store nonce information
        if (!globalState.nonces[url]) {
            globalState.nonces[url] = [];
        }

        // Track all nonces found in CSP headers
        const allCspNonces = new Set([...cspNonces.scriptNonces, ...cspNonces.styleNonces]);

        // Check each inline element
        const inlineScripts = pageState.inlineElements.filter((el) => el.type === "script");
        const inlineStyles = pageState.inlineElements.filter((el) => el.type === "style");

        // Validate script nonces
        for (const script of inlineScripts) {
            if (!script.nonce) {
                // Inline script without nonce
                if (cspNonces.scriptNonces.length > 0) {
                    this.registerWarning(
                        ctx,
                        "security",
                        "CSP_INLINE_WITHOUT_NONCE",
                        `Inline script found without nonce attribute while CSP defines script nonces.`,
                        {
                            location: script.location,
                            availableNonces: cspNonces.scriptNonces,
                            contentPreview: script.content.substring(0, 100),
                        },
                    );
                }
            } else {
                // Script has nonce - validate it
                if (!cspNonces.scriptNonces.includes(script.nonce)) {
                    this.registerError(
                        ctx,
                        "security",
                        "CSP_NONCE_MISMATCH",
                        `Inline script nonce '${script.nonce}' does not match any nonce in CSP script-src directive.`,
                        {
                            location: script.location,
                            elementNonce: script.nonce,
                            expectedNonces: cspNonces.scriptNonces,
                            contentPreview: script.content.substring(0, 100),
                        },
                    );
                }

                // Store nonce info
                globalState.nonces[url].push({
                    nonce: script.nonce,
                    directive: "script-src",
                    source: "inline-element",
                    elementType: "script",
                    content: script.content.substring(0, 200),
                    location: script.location,
                });
            }
        }

        // Validate style nonces
        for (const style of inlineStyles) {
            if (!style.nonce) {
                // Inline style without nonce
                if (cspNonces.styleNonces.length > 0) {
                    this.registerWarning(
                        ctx,
                        "security",
                        "CSP_INLINE_WITHOUT_NONCE",
                        `Inline style found without nonce attribute while CSP defines style nonces.`,
                        {
                            location: style.location,
                            availableNonces: cspNonces.styleNonces,
                            contentPreview: style.content.substring(0, 100),
                        },
                    );
                }
            } else {
                // Style has nonce - validate it
                if (!cspNonces.styleNonces.includes(style.nonce)) {
                    this.registerError(
                        ctx,
                        "security",
                        "CSP_NONCE_MISMATCH",
                        `Inline style nonce '${style.nonce}' does not match any nonce in CSP style-src directive.`,
                        {
                            location: style.location,
                            elementNonce: style.nonce,
                            expectedNonces: cspNonces.styleNonces,
                            contentPreview: style.content.substring(0, 100),
                        },
                    );
                }

                // Store nonce info
                globalState.nonces[url].push({
                    nonce: style.nonce,
                    directive: "style-src",
                    source: "inline-element",
                    elementType: "style",
                    content: style.content.substring(0, 200),
                    location: style.location,
                });
            }
        }

        // Store CSP header nonces
        for (const nonce of cspNonces.scriptNonces) {
            globalState.nonces[url].push({
                nonce,
                directive: "script-src",
                source: "csp-header",
            });
        }

        for (const nonce of cspNonces.styleNonces) {
            globalState.nonces[url].push({
                nonce,
                directive: "style-src",
                source: "csp-header",
            });
        }

        // Check for nonce reuse across different pages
        if (this.checkNonceReuse) {
            this.checkForNonceReuse(ctx, globalState, allCspNonces);
        }
    }

    /**
     * Check for nonce reuse across different pages
     */
    private checkForNonceReuse(
        ctx: ResourceContext,
        globalState: CspNonceState,
        currentNonces: Set<string>,
    ): void {
        const currentUrl = ctx.url;

        for (const [url, nonceInfos] of Object.entries(globalState.nonces)) {
            if (url === currentUrl) continue; // Skip current page

            const urlNonces = new Set(
                nonceInfos.filter((info) => info.source === "csp-header").map((info) => info.nonce),
            );

            // Check for intersection
            const reusedNonces = [...currentNonces].filter((nonce) => urlNonces.has(nonce));

            if (reusedNonces.length > 0) {
                this.registerError(
                    ctx,
                    "security",
                    "CSP_NONCE_REUSED",
                    `CSP nonces are being reused across different pages, which defeats their security purpose.`,
                    {
                        reusedNonces,
                        currentUrl,
                        otherUrl: url,
                        recommendation: "Generate unique nonces for each page load",
                    },
                );
            }
        }
    }

    /**
     * Perform comprehensive nonce analysis for the current page
     */
    private async performNonceAnalysis(
        ctx: ResourceContext,
        pageState: PageNonceState,
    ): Promise<void> {
        try {
            // Extract CSP headers from response
            const cspNonces = { scriptNonces: [] as string[], styleNonces: [] as string[] };

            if (ctx.response) {
                const headers = ctx.response.headers();
                const cspHeader = headers["content-security-policy"];
                const cspReportOnlyHeader = headers["content-security-policy-report-only"];

                if (cspHeader) {
                    const parsed = this.parseCspNonces(cspHeader);
                    cspNonces.scriptNonces.push(...parsed.scriptNonces);
                    cspNonces.styleNonces.push(...parsed.styleNonces);
                }

                if (cspReportOnlyHeader) {
                    const parsed = this.parseCspNonces(cspReportOnlyHeader);
                    cspNonces.scriptNonces.push(...parsed.scriptNonces);
                    cspNonces.styleNonces.push(...parsed.styleNonces);
                }
            }

            // Extract inline elements from page
            pageState.inlineElements = await this.extractInlineElements(ctx.page);

            // Validate nonces if any were found
            if (
                cspNonces.scriptNonces.length > 0 ||
                cspNonces.styleNonces.length > 0 ||
                pageState.inlineElements.length > 0
            ) {
                this.validateNonces(ctx, pageState, cspNonces);
            }

            // Report missing nonces if inline elements exist but no CSP nonces are defined
            if (
                pageState.inlineElements.length > 0 &&
                cspNonces.scriptNonces.length === 0 &&
                cspNonces.styleNonces.length === 0
            ) {
                const scriptCount = pageState.inlineElements.filter(
                    (el) => el.type === "script",
                ).length;
                const styleCount = pageState.inlineElements.filter(
                    (el) => el.type === "style",
                ).length;

                if (scriptCount > 0 || styleCount > 0) {
                    this.registerInfo(
                        ctx,
                        "security",
                        "CSP_NONCE_MISSING",
                        `Page contains ${scriptCount} inline script(s) and ${styleCount} inline style(s) but no CSP nonces are defined.`,
                        {
                            inlineScripts: scriptCount,
                            inlineStyles: styleCount,
                            recommendation: "Consider implementing CSP nonces for better security",
                        },
                    );
                }
            }
        } catch (error) {
            // Log error but don't fail the entire plugin
            console.warn(`CSP nonce analysis failed for ${ctx.url}:`, error);
        }
    }

    /**
     * Calculate nonce statistics for reporting
     */
    private getNonceStatistics(state: CspNonceState): {
        totalPages: number;
        pagesWithNonces: number;
        uniqueNonces: number;
        totalNonceIssues: number;
        reusedNonces: number;
    } {
        const totalPages = Object.keys(state.nonces).length;
        let pagesWithNonces = 0;
        const allNonces = new Set<string>();
        let totalNonceIssues = 0;
        const nonceUsage = new Map<string, number>();

        for (const [url, nonceInfos] of Object.entries(state.nonces)) {
            const hasHeaderNonces = nonceInfos.some((info) => info.source === "csp-header");
            if (hasHeaderNonces) {
                pagesWithNonces++;
            }

            // Collect all unique nonces and track usage
            for (const info of nonceInfos) {
                allNonces.add(info.nonce);
                if (info.source === "csp-header") {
                    nonceUsage.set(info.nonce, (nonceUsage.get(info.nonce) || 0) + 1);
                }
            }

            // Count potential issues (this is a simplified count - actual issues are tracked via findings)
            const headerNonces = nonceInfos
                .filter((info) => info.source === "csp-header")
                .map((info) => info.nonce);
            const elementNonces = nonceInfos
                .filter((info) => info.source === "inline-element")
                .map((info) => info.nonce);

            // Count mismatched nonces as potential issues
            for (const elementNonce of elementNonces) {
                if (elementNonce && !headerNonces.includes(elementNonce)) {
                    totalNonceIssues++;
                }
            }
        }

        // Count reused nonces
        const reusedNonces = Array.from(nonceUsage.values()).filter((count) => count > 1).length;

        return {
            totalPages,
            pagesWithNonces,
            uniqueNonces: allNonces.size,
            totalNonceIssues,
            reusedNonces,
        };
    }
}
