import fsp from "node:fs/promises";
import { createRequire } from "node:module";

import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext, ResourceReportLink } from "../engine/types.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";
import { TextUtils } from "../utils/TextUtils.js";

const require = createRequire(import.meta.url);

type PdfExtractorPluginOptions = {
    maxExtractedChars?: number;
    maxLinks?: number;
    maxFileSizeBytes?: number;
};

type PdfParseModule = {
    PDFParse: new (options: { data: Buffer | Uint8Array }) => {
        getText: () => Promise<{ text?: string } | string>;
        destroy?: () => Promise<void> | void;
    };
};

export class PdfDownloadedExtractorPlugin extends BasePlugin implements IPlugin {
    name = "pdf-extractor";
    phases: PluginPhase[] = ["after-download"];

    private readonly maxExtractedChars: number;
    private readonly maxLinks: number;
    private readonly maxFileSizeBytes: number;

    constructor(options: PdfExtractorPluginOptions = {}) {
        super();
        this.maxExtractedChars = options.maxExtractedChars ?? 200_000;
        this.maxLinks = options.maxLinks ?? 500;
        this.maxFileSizeBytes = options.maxFileSizeBytes ?? 20 * 1024 * 1024;
    }

    applies(ctx: ResourceContext): boolean {
        console.log(!!ctx.downloaded?.savedPath);
        console.log(ctx.downloaded?.mime === "application/pdf");
        return !!ctx.downloaded?.savedPath && ctx.downloaded?.mime === "application/pdf";
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        console.log("yes");
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
                "PDF_EXTRACTION_SKIPPED_TOO_LARGE",
                `PDF extraction skipped because the file is larger than ${this.maxFileSizeBytes} bytes.`,
            );
            this.register(ctx);
            return;
        }

        try {
            const { PDFParse } = require("pdf-parse") as PdfParseModule;
            const buffer = await fsp.readFile(savedPath);
            const parser = new PDFParse({ data: buffer });

            try {
                const result = await parser.getText();
                const text = TextUtils.normalizeText(
                    typeof result === "string" ? result : (result.text ?? ""),
                    this.maxExtractedChars,
                );
                const links = this.extractLinks(text, this.maxLinks);
                for (const link of links) {
                    ctx.crawler.enqueueUrl({
                        url: link.url,
                        source: this.name,
                    });
                }

                ctx.report.content = text;
                ctx.report.message = "Text extracted from PDF.";
                ctx.report.links = this.mergeLinks(ctx.report.links ?? [], links);
            } finally {
                await parser.destroy?.();
            }
        } catch (error) {
            this.registerWarning(
                ctx,
                "TEXT_EXTRACTION_FAILED",
                ErrorUtils.errorMessage("PDF extraction failed", error),
            );
        }

        this.register(ctx);
    }

    private extractLinks(text: string, limit: number): ResourceReportLink[] {
        const found = text.match(/\bhttps?:\/\/[^\s<>"')\]]+/gi) ?? [];
        return [...new Set(found)].slice(0, limit).map((url) => ({
            type: "pdf-text",
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
