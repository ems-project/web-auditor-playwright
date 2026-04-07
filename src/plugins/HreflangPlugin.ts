import { BasePlugin } from "../engine/BasePlugin.js";
import type { FindingData, IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type HreflangPluginOptions = {
    requireOnHtmlPages?: boolean;
};

type HreflangAlternate = {
    hreflang: string;
    normalized: string;
    url: string;
};

type HreflangPageRecord = {
    url: string;
    locale: string | null;
    alternates: HreflangAlternate[];
};

type HreflangState = {
    pages: Record<string, HreflangPageRecord>;
    globalChecksDone: boolean;
};

export class HreflangPlugin extends BasePlugin implements IPlugin {
    name = "hreflang";
    phases: PluginPhase[] = ["beforeFinally", "finally"];

    private readonly requireOnHtmlPages: boolean;

    constructor(options: HreflangPluginOptions = {}) {
        super();
        this.requireOnHtmlPages = options.requireOnHtmlPages ?? true;
    }

    applies(ctx: ResourceContext): boolean {
        return Boolean(ctx.mime?.includes("text/html")) || ctx.report.is_web === true;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (phase === "beforeFinally") {
            if (!this.applies(ctx)) {
                return;
            }

            const currentUrl = ctx.finalUrl ?? ctx.report.url ?? ctx.url;
            const alternates = await this.extractAlternates(ctx);

            if (this.requireOnHtmlPages && alternates.length === 0) {
                this.registerWarning(
                    ctx,
                    "seo",
                    "HREFLANG_MISSING",
                    "No hreflang alternate links found on this HTML page.",
                );
            }

            const invalidAlternates = alternates.filter(
                (alternate) => !this.isValidHreflangCode(alternate.hreflang),
            );
            for (const alternate of invalidAlternates) {
                this.registerWarning(
                    ctx,
                    "seo",
                    "HREFLANG_INVALID_CODE",
                    `Invalid hreflang code: ${alternate.hreflang}. Use values like fr-be and avoid underscores.`,
                    {
                        hreflang: alternate.hreflang,
                        targetUrl: alternate.url,
                    },
                );
            }

            const selfAlternate = alternates.find((alternate) =>
                this.sameUrl(alternate.url, currentUrl),
            );
            if (selfAlternate && !this.matchesLocale(selfAlternate.hreflang, ctx.report.locale)) {
                this.registerWarning(
                    ctx,
                    "seo",
                    "HREFLANG_LANGUAGE_MISMATCH",
                    "The self-referencing hreflang does not match the page language.",
                    {
                        hreflang: selfAlternate.hreflang,
                        pageLocale: ctx.report.locale ?? null,
                        pageUrl: currentUrl,
                    },
                );
            }

            const state = this.getState(ctx);
            state.pages[currentUrl] = {
                url: currentUrl,
                locale: ctx.report.locale ?? null,
                alternates,
            };
            this.register(ctx);
            return;
        }

        if (phase === "finally") {
            const state = this.getState(ctx);
            if (state.globalChecksDone || !this.isLastProcessedPage(ctx)) {
                return;
            }

            const missingCrossLinks = this.findMissingCrossLinks(state.pages);
            if (missingCrossLinks.length > 0) {
                this.registerWarning(
                    ctx,
                    "seo",
                    "HREFLANG_CROSS_LINK_MISSING",
                    `Detected ${missingCrossLinks.length} hreflang alternate link(s) without reciprocal links.`,
                    {
                        pairs: missingCrossLinks,
                    },
                );
            }

            state.globalChecksDone = true;
            this.register(ctx);
        }
    }

    private async extractAlternates(ctx: ResourceContext): Promise<HreflangAlternate[]> {
        return ctx.page.evaluate(() => {
            const nodes = Array.from(
                document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang][href]'),
            );

            return nodes.map((node) => {
                const hreflang = node.getAttribute("hreflang")?.trim() ?? "";
                const href = node.getAttribute("href")?.trim() ?? "";
                let absoluteUrl = href;

                try {
                    absoluteUrl = new URL(href, document.baseURI).href;
                } catch {
                    absoluteUrl = href;
                }

                return {
                    hreflang,
                    normalized: hreflang.toLowerCase(),
                    url: absoluteUrl,
                };
            });
        });
    }

    private isValidHreflangCode(value: string): boolean {
        if (value === "x-default") {
            return true;
        }

        if (value.includes("_")) {
            return false;
        }

        return /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(value);
    }

    private matchesLocale(hreflang: string, locale: string | null | undefined): boolean {
        if (!locale || hreflang === "x-default") {
            return true;
        }

        const hreflangPrimary = hreflang.split("-")[0]?.toLowerCase() ?? "";
        const localePrimary = locale.split(/[-_]/)[0]?.toLowerCase() ?? "";
        return hreflangPrimary.length > 0 && hreflangPrimary === localePrimary;
    }

    private findMissingCrossLinks(pages: Record<string, HreflangPageRecord>): FindingData[] {
        const missing: FindingData[] = [];

        for (const page of Object.values(pages)) {
            for (const alternate of page.alternates) {
                const target = pages[alternate.url];
                if (!target) {
                    continue;
                }

                const hasReturnLink = target.alternates.some((candidate) =>
                    this.sameUrl(candidate.url, page.url),
                );
                if (hasReturnLink) {
                    continue;
                }

                missing.push({
                    sourceUrl: page.url,
                    targetUrl: alternate.url,
                    hreflang: alternate.hreflang,
                });
            }
        }

        return missing;
    }

    private getState(ctx: ResourceContext): HreflangState {
        const key = "hreflangPlugin";
        const existing = ctx.engineState.any[key];

        if (this.isState(existing)) {
            return existing;
        }

        const created: HreflangState = {
            pages: {},
            globalChecksDone: false,
        };
        ctx.engineState.any[key] = created;
        return created;
    }

    private isState(value: unknown): value is HreflangState {
        if (!value || typeof value !== "object") {
            return false;
        }

        const record = value as Record<string, unknown>;
        return typeof record.pages === "object" && typeof record.globalChecksDone === "boolean";
    }

    private isLastProcessedPage(ctx: ResourceContext): boolean {
        return ctx.engineState.activeWorkers === 0 && ctx.engineState.queueSize === 0;
    }

    private sameUrl(left: string, right: string): boolean {
        try {
            return new URL(left).href === new URL(right).href;
        } catch {
            return left === right;
        }
    }
}
