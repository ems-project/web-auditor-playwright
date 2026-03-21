import { createRequire } from "node:module";

import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext, ResourceReportLink } from "../engine/types.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";
import { TextUtils } from "../utils/TextUtils.js";

const require = createRequire(import.meta.url);

type DocxExtractorPluginOptions = {
    maxExtractedChars?: number;
    maxLinks?: number;
    maxFileSizeBytes?: number;
};

type MammothModule = {
    extractRawText(input: { path: string }): Promise<{ value: string }>;
};

export class DocxDownloadedExtractorPlugin extends BasePlugin implements IPlugin {
    name = "docx-extractor";
    phases: PluginPhase[] = ["download"];

    private readonly maxExtractedChars: number;
    private readonly maxLinks: number;
    private readonly maxFileSizeBytes: number;

    constructor(options: DocxExtractorPluginOptions = {}) {
        super();
        this.maxExtractedChars = options.maxExtractedChars ?? 200_000;
        this.maxLinks = options.maxLinks ?? 500;
        this.maxFileSizeBytes = options.maxFileSizeBytes ?? 20 * 1024 * 1024;
    }

    applies(ctx: ResourceContext): boolean {
        return (
            !!ctx.downloaded?.savedPath &&
            ctx.downloaded?.mime ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const savedPath = ctx.downloaded?.savedPath;
        const size = ctx.downloaded?.size;

        if (!savedPath || typeof size !== "number") {
            return;
        }

        if (ctx.report.content) {
            return;
        }

        if (size > this.maxFileSizeBytes) {
            this.registerWarning(
                ctx,
                "DOCX_EXTRACTION_SKIPPED_TOO_LARGE",
                `DOCX extraction skipped because the file is larger than ${this.maxFileSizeBytes} bytes.`,
            );
            this.register(ctx);
            return;
        }

        try {
            const mammoth = require("mammoth") as MammothModule;
            const result = await mammoth.extractRawText({ path: savedPath });
            const text = TextUtils.normalizeText(result.value ?? "", this.maxExtractedChars);
            const links = this.extractLinks(text, this.maxLinks);
            for (const link of links) {
                ctx.crawler.enqueueUrl({
                    url: link.url,
                    source: this.name,
                });
            }

            ctx.report.content = text;
            ctx.report.message = "Text extracted from DOCX.";
            ctx.report.links = this.mergeLinks(ctx.report.links ?? [], links);
        } catch (error) {
            this.registerWarning(
                ctx,
                "TEXT_EXTRACTION_FAILED",
                ErrorUtils.errorMessage("DOCX extraction failed", error),
            );
        }

        this.register(ctx);
    }

    private extractLinks(text: string, limit: number): ResourceReportLink[] {
        const found = text.match(/\bhttps?:\/\/[^\s<>"')\]]+/gi) ?? [];
        return [...new Set(found)].slice(0, limit).map((url) => ({
            type: "docx-text",
            url,
            text: url,
        }));
    }

    private mergeLinks(
        existing: ResourceReportLink[],
        incoming: ResourceReportLink[],
    ): ResourceReportLink[] {
        const map = new Map<string, ResourceReportLink>();

        for (const link of existing) {
            map.set(`${link.type}|${link.url}`, link);
        }
        for (const link of incoming) {
            map.set(`${link.type}|${link.url}`, link);
        }

        return [...map.values()];
    }
}
