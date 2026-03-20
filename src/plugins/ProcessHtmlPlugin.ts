import type { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

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

            const links = Array.from(document.querySelectorAll("[href], [src]"))
                .map((a) => (a as HTMLAnchorElement).href)
                .filter(Boolean);

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
        ctx.links = extracted.links;

        for (const href of extracted.links) {
            ctx.crawler.enqueueUrl({
                url: href,
                source: this.name,
            });
        }
    }
}
