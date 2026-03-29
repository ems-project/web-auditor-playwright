import fsp from "node:fs/promises";

import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";
import { TextUtils } from "../utils/TextUtils.js";

type TextExtractorPluginOptions = {
    maxExtractedChars?: number;
    maxLinks?: number;
    maxFileSizeBytes?: number;
};

export class TextExtractorPlugin extends BasePlugin implements IPlugin {
    name = "text-extractor";
    phases: PluginPhase[] = ["download"];

    private readonly maxExtractedChars: number;
    private readonly maxLinks: number;
    private readonly maxFileSizeBytes: number;

    constructor(options: TextExtractorPluginOptions = {}) {
        super();
        this.maxExtractedChars = options.maxExtractedChars ?? 200_000;
        this.maxLinks = options.maxLinks ?? 500;
        this.maxFileSizeBytes = options.maxFileSizeBytes ?? 5 * 1024 * 1024;
    }

    applies(ctx: ResourceContext): boolean {
        const mime = ctx.downloaded?.mime;
        return !!ctx.downloaded?.savedPath && !!mime && this.isSupportedMime(mime);
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const savedPath = ctx.downloaded?.savedPath;
        const mime = ctx.downloaded?.mime;
        const size = ctx.downloaded?.size;

        if (!savedPath || !mime || typeof size !== "number") {
            return;
        }

        if (ctx.report.content) {
            return;
        }

        if (size > this.maxFileSizeBytes) {
            this.registerWarning(
                ctx,
                "resources",
                "TEXT_EXTRACTION_SKIPPED_TOO_LARGE",
                `Text extraction skipped because the file is larger than ${this.maxFileSizeBytes} bytes.`,
            );
            return;
        }

        try {
            const raw = await fsp.readFile(savedPath, "utf8");
            const text = TextUtils.normalizeText(
                mime === "text/html" || mime === "image/svg+xml" ? this.htmlToText(raw) : raw,
                this.maxExtractedChars,
            );

            const links = TextUtils.extractLinks(text, this.maxLinks, "extracted");
            for (const link of links) {
                const enqueueResult = ctx.crawler.enqueueUrl({
                    url: link.url,
                    source: this.name,
                });
                link.enqueueResult = enqueueResult.reason;
            }

            ctx.report.content = text;
            ctx.report.message = `Text extracted from ${mime}.`;
            ctx.report.links = this.mergeLinks(ctx.report.links ?? [], links);
            this.register(ctx);
        } catch (error) {
            this.registerWarning(
                ctx,
                "plugins",
                "TEXT_EXTRACTION_FAILED",
                ErrorUtils.errorMessage("Failed to read textual downloaded resource", error),
            );
        }
    }

    private isSupportedMime(mime: string): boolean {
        return [
            "text/plain",
            "text/csv",
            "text/html",
            "application/json",
            "application/xml",
            "text/xml",
            "image/svg+xml",
            "text/markdown",
        ].includes(mime);
    }

    private htmlToText(html: string): string {
        return html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
            .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
            .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
            .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">");
    }
}
