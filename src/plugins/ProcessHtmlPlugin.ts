import { IPlugin, PluginPhase, ResourceContext, ResourceReportLink } from "../engine/types.js";
import { BasePlugin } from "../engine/BasePlugin.js";
import { TitleAnalyzer } from "../utils/TitleAnalyzer.js";

type ProcessHtmlPluginOptions = {
    maxLinksPerPage?: number;
};

export class ProcessHtmlPlugin extends BasePlugin implements IPlugin {
    name = "process-html";
    phases: PluginPhase[] = ["process", "error"];

    private readonly maxLinksPerPage: number | null;

    constructor(options: ProcessHtmlPluginOptions = {}) {
        super();
        this.maxLinksPerPage = options.maxLinksPerPage ?? null;
    }

    applies(ctx: ResourceContext): boolean {
        return undefined !== ctx.mime && ctx.mime.includes("text/html");
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const extracted = await this.extractFromDom(ctx);
        const titleAnalyzer = new TitleAnalyzer();
        const titleAnalysis = titleAnalyzer.analyze(extracted.title);

        const mailOrTelLinkCount = extracted.links.filter(
            (l) => l.url.startsWith("mailto:") || l.url.startsWith("tel:"),
        ).length;
        if (mailOrTelLinkCount > 0) {
            this.registerInfo(
                ctx,
                "MAIL_OR_TEL_LINK",
                `Contains ${mailOrTelLinkCount} mailto or tel links.`,
            );
        }

        for (const issue of titleAnalysis.issues) {
            this.registerFinding(issue.severity, ctx, issue.code, issue.message, {
                title: titleAnalysis.normalized,
                length: titleAnalysis.length,
                brand: titleAnalysis.brand,
                mainTitle: titleAnalysis.mainTitle,
            });
        }

        const wordCount = extracted.content.split(/\s+/).length;
        if (wordCount < 100) {
            this.registerWarning(ctx, "LOW_CONTENT", `Low content page (${wordCount} words).`);
        }

        ctx.report.is_web = true;
        ctx.report.meta_title = extracted.title;
        ctx.report.locale = extracted.lang;
        ctx.report.description = extracted.description;
        ctx.report.content = extracted.content;
        ctx.report.title = extracted.h1s.length > 0 ? extracted.h1s[0] : null;
        ctx.report.links = this.maxLinksPerPage
            ? extracted.links.slice(0, this.maxLinksPerPage)
            : extracted.links;

        for (const link of extracted.links) {
            ctx.crawler.enqueueUrl({
                url: link.url,
                source: this.name,
            });
        }
        this.register();
    }

    private async extractFromDom(ctx: ResourceContext) {
        return ctx.page.evaluate(() => {
            const title = document.querySelector("title")?.textContent ?? null;
            const lang =
                document.querySelector("html")?.attributes.getNamedItem("lang")?.value ?? null;

            const h1s = Array.from(document.querySelectorAll("h1"))
                .map((el) => el.textContent?.trim() ?? "")
                .filter((t) => t.length > 0);

            const getMeta = (selector: string) =>
                document.querySelector(selector)?.getAttribute("content") ?? null;
            const description =
                getMeta('meta[name="description"]') ||
                getMeta('meta[property="og:description"]') ||
                getMeta('meta[name="twitter:description"]');

            const elements = Array.from(document.querySelectorAll("[href], [src]"));
            const links: ResourceReportLink[] = [];

            for (const el of elements) {
                let url: string | null = null;

                if (el.hasAttribute("href")) {
                    url = (el as HTMLAnchorElement).href;
                } else if (el.hasAttribute("src")) {
                    // @ts-expect-error: the src attribute exist
                    url = el.src;
                }

                if (typeof url !== "string") {
                    this.registerWarning(
                        ctx,
                        "WRONG_URL",
                        `Tag ${el.tagName.toLowerCase()} with unexpected link attribute (href or src).`,
                    );
                    continue;
                } else if (url === "") {
                    this.registerWarning(
                        ctx,
                        "EMPTY_URL",
                        `Tag ${el.tagName.toLowerCase()} with an empty link attribute (href or src).`,
                    );
                    continue;
                }

                links.push({
                    type: el.tagName.toLowerCase(),
                    url,
                    text: el.textContent?.trim() ?? null,
                });
            }

            const clone = document.body.cloneNode(true) as HTMLElement;
            const selectors = ["script", "style", "noscript", "header", "footer", "nav", "aside"];
            selectors.forEach((selector) => {
                clone.querySelectorAll(selector).forEach((el) => el.remove());
            });
            const content = (clone.innerText || "").replace(/\s+/g, " ").trim();

            return {
                title,
                h1s,
                description,
                links,
                lang,
                content,
            };
        });
    }
}
