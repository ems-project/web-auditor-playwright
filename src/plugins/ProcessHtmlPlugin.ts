import type { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type ProcessHtmlPluginOptions = {
    maxLinksPerPage?: number;
};

export class ProcessHtmlPlugin implements IPlugin {
    name = "process-html";
    phases: PluginPhase[] = ["afterExtract"];

    private readonly maxLinksPerPage: number | null;

    constructor(options: ProcessHtmlPluginOptions = {}) {
        this.maxLinksPerPage = options.maxLinksPerPage ?? null;
    }

    applies(ctx: ResourceContext): boolean {
        return ctx.kind === "html";
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const hrefs: string[] = await ctx.page.$$eval("a[href]", (as) =>
            as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
        );
        ctx.links = hrefs;

        for (const href of hrefs) {
            ctx.crawler.enqueueUrl({
                url: href,
                source: this.name,
            });
        }
    }
}
