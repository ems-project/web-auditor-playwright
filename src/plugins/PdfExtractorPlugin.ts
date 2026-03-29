import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext, ResourceReportLink } from "../engine/types.js";

import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ErrorUtils } from "../utils/ErrorUtils.js";
import { TextUtils } from "../utils/TextUtils.js";
import { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api.js";

type PdfExtractorPluginOptions = {
    maxExtractedChars?: number;
    maxLinks?: number;
    maxPages?: number;
    maxFileSizeBytes?: number;
};

type PdfLinkAnnotation = {
    url?: string;
    unsafeUrl?: string;
    title?: string | null;
    contents?: string | null;
};

type TextToken = {
    str: string;
    x: number;
    y: number;
    width: number;
};

export class PdfExtractorPlugin extends BasePlugin implements IPlugin {
    name = "pdf-extractor";
    phases: PluginPhase[] = ["download"];

    private readonly maxExtractedChars: number;
    private readonly maxLinks: number;
    private readonly maxPages: number;
    private readonly maxFileSizeBytes: number;

    constructor(options: PdfExtractorPluginOptions = {}) {
        super();
        this.maxExtractedChars = options.maxExtractedChars ?? 200_000;
        this.maxLinks = options.maxLinks ?? 500;
        this.maxPages = options.maxPages ?? 200;
        this.maxFileSizeBytes = options.maxFileSizeBytes ?? 20 * 1024 * 1024;
    }

    applies(ctx: ResourceContext): boolean {
        return ctx.downloaded?.savedPath !== undefined && ctx.downloaded.mime === "application/pdf";
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const savedPath = ctx.downloaded?.savedPath;
        const size = ctx.downloaded?.size;
        if (!savedPath || typeof size !== "number") {
            return;
        }
        if (size > this.maxFileSizeBytes) {
            this.registerWarning(
                ctx,
                "resources",
                "PDF_EXTRACTION_SKIPPED_TOO_LARGE",
                `PDF extraction skipped because the file is larger than ${this.maxFileSizeBytes} bytes.`,
            );
            return;
        }

        let loadingTask: ReturnType<typeof getDocument> | undefined;

        try {
            loadingTask = getDocument({ url: savedPath, verbosity: VerbosityLevel.ERRORS });
            const pdf = await loadingTask.promise;

            try {
                const text = await this.extractText(pdf);
                if (!text) {
                    this.registerWarning(
                        ctx,
                        "a11y",
                        "PDF_NO_TEXT",
                        "No usable text was extracted from PDF.",
                    );
                }
                if (text === "") {
                    this.registerWarning(
                        ctx,
                        "a11y",
                        "PDF_EMPTY_TEXT",
                        "Empty text was extracted from PDF.",
                    );
                }
                ctx.report.content = text;

                await this.extractMetadata(pdf, ctx);
                await this.extractLinks(pdf, ctx);
            } finally {
                await pdf.destroy();
            }
        } catch (error) {
            this.registerWarning(
                ctx,
                "plugins",
                "PDF_EXTRACTION_FAILED",
                ErrorUtils.errorMessage("Failed to extract PDF metadata and links", error),
            );
        } finally {
            await loadingTask?.destroy();
        }

        this.register(ctx);
    }

    private async extractMetadata(pdf: PDFDocumentProxy, ctx: ResourceContext): Promise<void> {
        const metadata = await pdf.getMetadata();

        const info = this.asRecord(metadata.info);
        const xmp = this.getXmpMetadata(metadata.metadata);
        ctx.report.metas ??= [];

        const contentDispositionFilename = this.getOptionalStringProperty(
            metadata,
            "contentDispositionFilename",
        );
        if (contentDispositionFilename) {
            ctx.report.metas.push({
                key: "content_disposition_filename",
                value: contentDispositionFilename,
            });
        }

        const contentLength = this.getOptionalNumberProperty(metadata, "contentLength");
        if (contentLength) {
            ctx.report.metas.push({
                key: "content_length",
                value: `${contentLength}`,
            });
        }

        const title = TextUtils.firstNonEmptyString(
            TextUtils.asString(info["Title"]),
            TextUtils.asString(xmp["dc:title"]),
            TextUtils.asString(xmp["pdf:title"]),
            TextUtils.asString(xmp["title"]),
            ctx.report.title,
            ctx.downloaded?.suggestedFilename,
        );

        const description = TextUtils.firstNonEmptyString(
            TextUtils.asString(info["Subject"]),
            TextUtils.asString(xmp["dc:description"]),
            TextUtils.asString(xmp["description"]),
            ctx.report.description,
        );

        const author = TextUtils.firstNonEmptyString(
            TextUtils.asString(info["Author"]),
            TextUtils.asString(xmp["dc:creator"]),
            TextUtils.asString(xmp["creator"]),
        );
        if (author) {
            ctx.report.metas.push({
                key: "author",
                value: author,
            });
        }

        const keywords = TextUtils.firstNonEmptyString(
            TextUtils.asString(info["Keywords"]),
            TextUtils.asString(xmp["pdf:keywords"]),
            TextUtils.asString(xmp["keywords"]),
        );
        if (keywords) {
            ctx.report.metas.push({
                key: "keywords",
                value: keywords,
            });
        }

        const creator = TextUtils.firstNonEmptyString(
            TextUtils.asString(info["Creator"]),
            TextUtils.asString(xmp["xmp:creatortool"]),
            TextUtils.asString(xmp["creatorTool"]),
        );
        if (creator) {
            ctx.report.metas.push({
                key: "creator",
                value: creator,
            });
        }

        const producer = TextUtils.firstNonEmptyString(
            TextUtils.asString(info["Producer"]),
            TextUtils.asString(xmp["pdf:producer"]),
            TextUtils.asString(xmp["producer"]),
        );
        if (producer) {
            ctx.report.metas.push({
                key: "producer",
                value: producer,
            });
        }

        ctx.report.title = title ?? ctx.report.title ?? null;
        ctx.report.meta_title = title ?? ctx.report.meta_title ?? null;
        ctx.report.description = description ?? ctx.report.description ?? null;
        ctx.report.message = "Text, and metas, extracted from PDF.";
    }

    private async extractText(pdf: PDFDocumentProxy): Promise<string> {
        const pageCount = Math.min(pdf.numPages, this.maxPages);
        const parts: string[] = [];

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);

            try {
                const textContent = await page.getTextContent();
                const pageText = this.rebuildPageText(textContent.items);

                if (pageText) {
                    parts.push(pageText);
                }

                const current = parts.join("\n");
                if (current.length >= this.maxExtractedChars) {
                    return this.postProcessExtractedText(current.slice(0, this.maxExtractedChars));
                }
            } finally {
                page.cleanup();
            }
        }

        return TextUtils.normalizeText(this.postProcessExtractedText(parts.join(" ")));
    }

    private rebuildPageText(items: readonly unknown[]): string {
        const tokens = items
            .map((item) => this.toTextToken(item))
            .filter((token): token is TextToken => token !== null)
            .filter((token) => token.str.length > 0);

        if (tokens.length === 0) {
            return "";
        }

        const lines: TextToken[][] = [];
        const yTolerance = 2;

        for (const token of tokens) {
            const lastLine = lines.at(-1);
            if (!lastLine) {
                lines.push([token]);
                continue;
            }

            const lastY = lastLine[0].y;
            if (Math.abs(token.y - lastY) <= yTolerance) {
                lastLine.push(token);
            } else {
                lines.push([token]);
            }
        }

        const renderedLines = lines.map((line) => {
            line.sort((a, b) => a.x - b.x);

            let out = "";
            let prev: TextToken | null = null;

            for (const token of line) {
                if (!prev) {
                    out += token.str;
                    prev = token;
                    continue;
                }

                const gap = token.x - (prev.x + prev.width);

                if (gap > 2) {
                    out += " ";
                }

                out += token.str;
                prev = token;
            }

            return out;
        });

        return renderedLines.join("\n");
    }

    private toTextToken(item: unknown): TextToken | null {
        if (!item || typeof item !== "object") {
            return null;
        }

        const record = item as Record<string, unknown>;
        const str = typeof record.str === "string" ? record.str : "";
        const width = typeof record.width === "number" ? record.width : 0;

        const transform = Array.isArray(record.transform) ? record.transform : null;
        const x = transform && typeof transform[4] === "number" ? transform[4] : 0;
        const y = transform && typeof transform[5] === "number" ? transform[5] : 0;

        return { str, x, y, width };
    }
    private postProcessExtractedText(text: string): string {
        return text
            .replace(/\r/g, "")
            .replace(/[ \t]+/g, " ")
            .replace(/(?:\b[A-Za-zÀ-ÖØ-öø-ÿ]\s){3,}[A-Za-zÀ-ÖØ-öø-ÿ]\b/g, (match) =>
                match.replace(/\s+/g, ""),
            )
            .replace(/\s+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }
    private async extractLinks(pdf: PDFDocumentProxy, ctx: ResourceContext): Promise<void> {
        const collected: ResourceReportLink[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);

            try {
                const annotations = await page.getAnnotations({
                    intent: "display",
                });

                for (const raw of annotations) {
                    if (!this.isPdfLinkAnnotation(raw)) {
                        continue;
                    }

                    const url = this.normalizeHttpUrl(raw.url ?? raw.unsafeUrl ?? null);

                    if (!url) {
                        continue;
                    }

                    collected.push({
                        type: "pdf-annotation",
                        url,
                        text:
                            TextUtils.firstNonEmptyString(
                                raw.title ?? null,
                                raw.contents ?? null,
                                `Page ${pageNumber}`,
                            ) ?? "",
                    });

                    if (collected.length >= this.maxLinks) {
                        break;
                    }
                }
            } finally {
                page.cleanup();
            }

            if (collected.length >= this.maxLinks) {
                break;
            }
        }
        for (const link of collected) {
            ctx.crawler.enqueueUrl({
                url: link.url,
                source: this.name,
            });
        }

        ctx.report.links = this.mergeLinks(ctx.report.links ?? [], collected);
    }

    private normalizeHttpUrl(value: string | null): string | null {
        if (!value) {
            return null;
        }

        const trimmed = value.trim();
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }

        return null;
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (value && typeof value === "object") {
            return value as Record<string, unknown>;
        }
        return {};
    }

    private isPdfLinkAnnotation(value: unknown): value is PdfLinkAnnotation {
        if (!value || typeof value !== "object") {
            return false;
        }

        const v = value as Record<string, unknown>;

        return "url" in v || "unsafeUrl" in v;
    }

    private getXmpMetadata(metadata: unknown): Record<string, unknown> {
        if (!metadata || typeof metadata !== "object") {
            return {};
        }

        const candidate = metadata as {
            getAll?: () => unknown;
        };

        if (typeof candidate.getAll === "function") {
            const result = candidate.getAll();
            if (result && typeof result === "object") {
                return result as Record<string, unknown>;
            }
        }

        return {};
    }
    private getOptionalStringProperty(value: unknown, propertyName: string): string | null {
        if (!value || typeof value !== "object") {
            return null;
        }

        const record = value as Record<string, unknown>;
        const property = record[propertyName];

        return typeof property === "string" && property.trim().length > 0 ? property.trim() : null;
    }

    private getOptionalNumberProperty(value: unknown, propertyName: string): number | null {
        if (!value || typeof value !== "object") {
            return null;
        }

        const record = value as Record<string, unknown>;
        const property = record[propertyName];

        return typeof property === "number" ? property : null;
    }
}
