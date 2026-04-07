import type { Page, Request, Response } from "playwright";

import { BasePlugin } from "../engine/BasePlugin.js";
import type {
    FindingCategory,
    FindingCode,
    FindingData,
    FindingSeverity,
    IPlugin,
    PluginPhase,
    ResourceContext,
} from "../engine/types.js";

type CssAuditPluginOptions = {
    maxInlineStyleAttributes?: number;
    maxStyleTags?: number;
};

type StylesheetResponse = {
    url: string;
    status: number | null;
};

type StylesheetFailure = {
    url: string;
    errorText: string | null;
};

type StylesheetRef = {
    href: string | null;
    media: string | null;
    disabled: boolean;
};

type CssDomMetrics = {
    stylesheets: StylesheetRef[];
    inlineStyleAttributeCount: number;
    styleTagCount: number;
};

type CssIssue = {
    severity: FindingSeverity;
    category: FindingCategory;
    code: FindingCode;
    message: string;
    data?: FindingData;
};

type PageCssState = {
    attached: boolean;
    responseListener: ((response: Response) => void) | null;
    requestFailedListener: ((request: Request) => void) | null;
    stylesheetResponses: Map<string, StylesheetResponse>;
    stylesheetFailures: Map<string, StylesheetFailure>;
};

export class CssAuditPlugin extends BasePlugin implements IPlugin {
    name = "css-audit";
    phases: PluginPhase[] = ["beforeGoto", "process", "finally"];

    private readonly maxInlineStyleAttributes: number;
    private readonly maxStyleTags: number;
    private readonly pageStates = new WeakMap<Page, PageCssState>();

    constructor(options: CssAuditPluginOptions = {}) {
        super();
        this.maxInlineStyleAttributes = options.maxInlineStyleAttributes ?? 25;
        this.maxStyleTags = options.maxStyleTags ?? 5;
    }

    applies(): boolean {
        return true;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const pageState = this.getPageState(ctx.page);

        if (phase === "beforeGoto") {
            this.resetPageState(pageState);
            this.attachListeners(ctx.page, pageState);
            return;
        }

        if (phase === "process") {
            if (!ctx.mime?.includes("text/html")) {
                return;
            }

            const metrics = await this.collectDomMetrics(ctx);
            const issues = [
                ...this.buildStylesheetNetworkIssues(metrics.stylesheets, pageState),
                ...this.buildInlineCssIssues(metrics),
            ];

            for (const issue of issues) {
                this.registerFinding(
                    issue.severity,
                    issue.category,
                    ctx,
                    issue.code,
                    issue.message,
                    issue.data,
                );
            }

            this.register(ctx);
            return;
        }

        if (phase === "finally") {
            this.detachListeners(ctx.page, pageState);
        }
    }

    private async collectDomMetrics(ctx: ResourceContext): Promise<CssDomMetrics> {
        return ctx.page.evaluate(() => {
            const stylesheetNodes = Array.from(
                document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
            );

            const stylesheets = stylesheetNodes.map((node) => {
                const href = node.getAttribute("href")?.trim() ?? null;
                let absoluteHref = href;

                if (href) {
                    try {
                        absoluteHref = new URL(href, document.baseURI).href;
                    } catch {
                        absoluteHref = href;
                    }
                }

                return {
                    href: absoluteHref,
                    media: node.getAttribute("media"),
                    disabled: Boolean(node.disabled),
                };
            });

            return {
                stylesheets,
                inlineStyleAttributeCount: document.querySelectorAll("[style]").length,
                styleTagCount: document.querySelectorAll("style").length,
            };
        });
    }

    private buildStylesheetNetworkIssues(
        stylesheets: StylesheetRef[],
        pageState: PageCssState,
    ): CssIssue[] {
        const issues: CssIssue[] = [];

        for (const stylesheet of stylesheets) {
            if (stylesheet.disabled) {
                continue;
            }

            if (!stylesheet.href) {
                issues.push({
                    severity: "warning",
                    category: "html",
                    code: "STYLESHEET_MISSING_HREF",
                    message: "Stylesheet link is missing an href attribute.",
                    data: {
                        media: stylesheet.media,
                    },
                });
                continue;
            }

            const failure = pageState.stylesheetFailures.get(stylesheet.href);
            if (failure) {
                issues.push({
                    severity: "error",
                    category: "resources",
                    code: "STYLESHEET_REQUEST_FAILED",
                    message: `Stylesheet request failed: ${stylesheet.href}.`,
                    data: {
                        href: stylesheet.href,
                        media: stylesheet.media,
                        errorText: failure.errorText,
                    },
                });
                continue;
            }

            const response = pageState.stylesheetResponses.get(stylesheet.href);
            if (response && response.status !== null && response.status >= 400) {
                issues.push({
                    severity: "error",
                    category: "resources",
                    code: "STYLESHEET_HTTP_ERROR",
                    message: `Stylesheet returned HTTP ${response.status}: ${stylesheet.href}.`,
                    data: {
                        href: stylesheet.href,
                        media: stylesheet.media,
                        status: response.status,
                    },
                });
            }
        }

        return issues;
    }

    private buildInlineCssIssues(metrics: CssDomMetrics): CssIssue[] {
        const issues: CssIssue[] = [];

        if (metrics.inlineStyleAttributeCount > this.maxInlineStyleAttributes) {
            issues.push({
                severity: "warning",
                category: "html",
                code: "INLINE_STYLE_ATTRIBUTES_EXCESSIVE",
                message: `Page contains ${metrics.inlineStyleAttributeCount} inline style attributes, above the configured threshold of ${this.maxInlineStyleAttributes}.`,
                data: {
                    count: metrics.inlineStyleAttributeCount,
                    threshold: this.maxInlineStyleAttributes,
                },
            });
        }

        if (metrics.styleTagCount > this.maxStyleTags) {
            issues.push({
                severity: "warning",
                category: "html",
                code: "STYLE_TAGS_EXCESSIVE",
                message: `Page contains ${metrics.styleTagCount} style tags, above the configured threshold of ${this.maxStyleTags}.`,
                data: {
                    count: metrics.styleTagCount,
                    threshold: this.maxStyleTags,
                },
            });
        }

        return issues;
    }

    private getPageState(page: Page): PageCssState {
        const existing = this.pageStates.get(page);
        if (existing) {
            return existing;
        }

        const created: PageCssState = {
            attached: false,
            responseListener: null,
            requestFailedListener: null,
            stylesheetResponses: new Map(),
            stylesheetFailures: new Map(),
        };
        this.pageStates.set(page, created);
        return created;
    }

    private resetPageState(pageState: PageCssState): void {
        pageState.stylesheetResponses.clear();
        pageState.stylesheetFailures.clear();
    }

    private attachListeners(page: Page, pageState: PageCssState): void {
        if (pageState.attached) {
            return;
        }

        pageState.responseListener = (response: Response) => {
            const request = response.request();
            if (request.resourceType() !== "stylesheet") {
                return;
            }

            pageState.stylesheetResponses.set(request.url(), {
                url: request.url(),
                status: response.status(),
            });
        };

        pageState.requestFailedListener = (request: Request) => {
            if (request.resourceType() !== "stylesheet") {
                return;
            }

            pageState.stylesheetFailures.set(request.url(), {
                url: request.url(),
                errorText: request.failure()?.errorText ?? null,
            });
        };

        page.on("response", pageState.responseListener);
        page.on("requestfailed", pageState.requestFailedListener);
        pageState.attached = true;
    }

    private detachListeners(page: Page, pageState: PageCssState): void {
        if (!pageState.attached) {
            return;
        }

        if (pageState.responseListener) {
            page.off("response", pageState.responseListener);
        }
        if (pageState.requestFailedListener) {
            page.off("requestfailed", pageState.requestFailedListener);
        }

        pageState.responseListener = null;
        pageState.requestFailedListener = null;
        pageState.attached = false;
    }
}
