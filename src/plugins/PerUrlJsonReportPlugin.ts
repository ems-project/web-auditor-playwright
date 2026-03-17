import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type PerUrlJsonReportPluginOptions = {
    outputDir: string;
};

export class PerUrlJsonReportPlugin implements IPlugin {
    name = "per-url-json-report";
    phases: PluginPhase[] = ["periodic"];

    constructor(private readonly options: PerUrlJsonReportPluginOptions) {}

    applies(): boolean {
        return true;
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        await fs.mkdir(this.options.outputDir, { recursive: true });

        const targetUrl = ctx.report.url ?? ctx.finalUrl ?? ctx.url;
        const filePath = path.join(this.options.outputDir, this.buildFileName(targetUrl));

        await fs.writeFile(filePath, JSON.stringify(ctx.report, null, 4), "utf-8");
    }

    private buildFileName(url: string): string {
        const parsed = new URL(url);
        const slugBase =
            `${parsed.hostname}${parsed.pathname}`
                .replace(/[^a-zA-Z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "")
                .slice(0, 120) || "root";

        const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);

        return `${slugBase}_${hash}.json`;
    }
}
