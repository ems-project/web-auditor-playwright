import { IPlugin, PluginPhase, ResourceContext, ResourceReportLink } from "../engine/types.js";

type ProcessHtmlPluginOptions = {
    maxLinksPerPage?: number;
};

export class ProcessHtmlPlugin implements IPlugin {
    name = "process-html";
    phases: PluginPhase[] = ["process", "error"];

    private readonly maxLinksPerPage: number | null;

    constructor(options: ProcessHtmlPluginOptions = {}) {
        this.maxLinksPerPage = options.maxLinksPerPage ?? null;
    }

    applies(ctx: ResourceContext): boolean {
        return undefined !== ctx.mime && ctx.mime.includes("text/html");
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const extracted = await ctx.page.evaluate(() => {
            const title = document.querySelector("title")?.textContent ?? null;
            const lang =
                document.querySelector("html")?.attributes.getNamedItem("lang")?.value ?? null;

            const h1s = Array.from(document.querySelectorAll("h1"))
                .map((el) => el.textContent?.trim() ?? "")
                .filter((t) => t.length > 0);

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

                if (!url) continue;

                links.push({
                    type: el.tagName.toLowerCase(),
                    url,
                    text: el.textContent?.trim() ?? null,
                });
            }

            return {
                title,
                h1s,
                links,
                lang,
            };
        });

        ctx.report.is_web = true;
        ctx.report.meta_title = extracted.title;
        ctx.report.locale = extracted.lang;
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
    }
}
