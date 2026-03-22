import { createRequire } from "node:module";

import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";
import { TextUtils } from "../utils/TextUtils.js";

const require = createRequire(import.meta.url);

type TextractDownloadedExtractorPluginOptions = {
    maxExtractedChars?: number;
    maxLinks?: number;
    maxFileSizeBytes?: number;
};

type TextractModule = {
    fromFileWithPath(
        filePath: string,
        options: Record<string, unknown>,
        callback: (error: Error | null, text: string) => void,
    ): void;
};

export class TextractDownloadedExtractorPlugin extends BasePlugin implements IPlugin {
    name = "textract-downloaded-extractor";
    phases: PluginPhase[] = ["download"];

    private readonly maxExtractedChars: number;
    private readonly maxLinks: number;
    private readonly maxFileSizeBytes: number;

    constructor(options: TextractDownloadedExtractorPluginOptions = {}) {
        super();
        this.maxExtractedChars = options.maxExtractedChars ?? 200_000;
        this.maxLinks = options.maxLinks ?? 500;
        this.maxFileSizeBytes = options.maxFileSizeBytes ?? 20 * 1024 * 1024;
    }

    applies(ctx: ResourceContext): boolean {
        return ctx.downloaded?.savedPath !== undefined;
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const savedPath = ctx.downloaded?.savedPath;
        const size = ctx.downloaded?.size;
        const mime = ctx.downloaded?.mime;

        if (!savedPath) {
            return;
        }

        if (ctx.report.content != null) {
            return;
        }

        if (typeof size === "number" && size > this.maxFileSizeBytes) {
            this.registerWarning(
                ctx,
                "TEXTRACT_EXTRACTION_SKIPPED_TOO_LARGE",
                `Textract extraction skipped because the file is larger than ${this.maxFileSizeBytes} bytes.`,
            );
            this.register(ctx);
            return;
        }

        let textract: TextractModule;
        try {
            textract = require("textract") as TextractModule;
        } catch (error) {
            this.registerWarning(
                ctx,
                "TEXTRACT_DEPENDENCY_MISSING",
                ErrorUtils.errorMessage('Missing optional dependency "textract"', error),
            );
            this.register(ctx);
            return;
        }

        try {
            const rawText = await new Promise<string>((resolve, reject) => {
                textract.fromFileWithPath(savedPath, {}, (error: Error | null, text: string) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(text ?? "");
                });
            });

            const text = TextUtils.normalizeText(rawText, this.maxExtractedChars);

            if (!text) {
                this.registerInfo(
                    ctx,
                    "TEXTRACT_NO_CONTENT",
                    `Textract did not extract any usable text${mime ? ` from ${mime}` : ""}.`,
                );
                this.register(ctx);
                return;
            }

            const links = TextUtils.extractLinks(text, this.maxLinks, "textract");
            for (const link of links) {
                ctx.crawler.enqueueUrl({
                    url: link.url,
                    source: this.name,
                });
            }

            ctx.report.content = text;
            ctx.report.message = mime
                ? `Text extracted from downloaded resource with textract (${mime}).`
                : "Text extracted from downloaded resource with textract.";
            ctx.report.links = this.mergeLinks(ctx.report.links ?? [], links);
        } catch (error) {
            this.registerWarning(
                ctx,
                "TEXT_EXTRACTION_FAILED",
                ErrorUtils.errorMessage("Textract extraction failed", error),
            );
        }

        this.register(ctx);
    }
}
