import fs from "node:fs/promises";
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api.js";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type PdfAccessibilityPluginOptions = {
    minExtractedChars?: number;
    maxPages?: number;
    lowTextThreshold?: number;
    warnOnMissingBookmarksMinPages?: number;
};

export class PdfAccessibilityPlugin extends BasePlugin implements IPlugin {
    name = "pdf-accessibility";
    phases: PluginPhase[] = ["download"];

    private readonly minExtractedChars: number;
    private readonly maxPages: number;
    private readonly lowTextThreshold: number;
    private readonly warnOnMissingBookmarksMinPages: number;

    constructor(options: PdfAccessibilityPluginOptions = {}) {
        super();
        this.minExtractedChars = options.minExtractedChars ?? 30;
        this.maxPages = options.maxPages ?? 200;
        this.lowTextThreshold = options.lowTextThreshold ?? 20;
        this.warnOnMissingBookmarksMinPages = options.warnOnMissingBookmarksMinPages ?? 5;
    }

    applies(ctx: ResourceContext): boolean {
        return ctx.downloaded?.savedPath !== undefined && ctx.downloaded.mime === "application/pdf";
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const savedPath = ctx.downloaded?.savedPath;
        if (!savedPath) {
            return;
        }

        const loadingTask = getDocument({ url: savedPath, verbosity: VerbosityLevel.ERRORS });

        try {
            const pdf = await loadingTask.promise;

            try {
                const metadata = await pdf.getMetadata();
                const info = this.asRecord(metadata.info);
                const xmp = this.getXmpMetadata(metadata.metadata);

                const title = this.firstNonEmptyString(
                    this.asString(info["Title"]),
                    this.asString(xmp["dc:title"]),
                    this.asString(xmp["pdf:title"]),
                    this.asString(xmp["title"]),
                    ctx.report.title,
                );

                const language = this.firstNonEmptyString(
                    this.asString(info["Lang"]),
                    this.asString(info["Language"]),
                    this.asString(xmp["dc:language"]),
                    this.asString(xmp["language"]),
                    ctx.report.locale,
                );

                const outline = await pdf.getOutline();
                const hasBookmarks = Array.isArray(outline) && outline.length > 0;

                const textStats = await this.extractTextStats(pdf);
                const rawPdf = await fs.readFile(savedPath);
                const tagging = this.detectTagging(rawPdf);

                if (!title) {
                    this.registerWarning(
                        ctx,
                        "a11y",
                        "PDF_ACCESSIBILITY_TITLE_MISSING",
                        "PDF title metadata is missing.",
                    );
                }

                if (!language) {
                    this.registerWarning(
                        ctx,
                        "a11y",
                        "PDF_ACCESSIBILITY_LANGUAGE_MISSING",
                        "PDF language metadata is missing.",
                    );
                }

                if (textStats.totalCharacters < this.minExtractedChars) {
                    this.registerError(
                        ctx,
                        "a11y",
                        "PDF_ACCESSIBILITY_NO_EXTRACTABLE_TEXT",
                        "PDF does not appear to contain enough extractable text.",
                        {
                            totalCharacters: textStats.totalCharacters,
                            pagesWithText: textStats.pagesWithText,
                            pageCount: textStats.pageCount,
                        },
                    );
                }

                if (
                    textStats.pageCount > 0 &&
                    textStats.averageCharactersPerPage < this.lowTextThreshold
                ) {
                    this.registerWarning(
                        ctx,
                        "a11y",
                        "PDF_ACCESSIBILITY_PROBABLY_SCANNED",
                        "PDF appears to be image-based or scanned because very little text could be extracted.",
                        {
                            averageCharactersPerPage: textStats.averageCharactersPerPage,
                            totalCharacters: textStats.totalCharacters,
                            pageCount: textStats.pageCount,
                        },
                    );
                }

                if (!hasBookmarks && textStats.pageCount >= this.warnOnMissingBookmarksMinPages) {
                    this.registerWarning(
                        ctx,
                        "a11y",
                        "PDF_ACCESSIBILITY_BOOKMARKS_MISSING",
                        "PDF has no bookmarks / outline.",
                        { pageCount: textStats.pageCount },
                    );
                }

                if (ctx.report.links.length === 0) {
                    this.registerInfo(
                        ctx,
                        "a11y",
                        "PDF_ACCESSIBILITY_LINKS_NOT_DETECTED",
                        "No links were detected in the PDF.",
                    );
                }

                if (!tagging.isTagged) {
                    this.registerWarning(
                        ctx,
                        "a11y",
                        "PDF_ACCESSIBILITY_NOT_TAGGED",
                        "PDF does not appear to be tagged.",
                        tagging,
                    );
                }
            } finally {
                await pdf.destroy();
            }
        } catch (error) {
            this.registerWarning(
                ctx,
                "a11y",
                "PDF_ACCESSIBILITY_AUDIT_FAILED",
                this.errorMessage("Failed to audit PDF accessibility", error),
            );
        } finally {
            await loadingTask.destroy();
        }

        this.register(ctx);
    }

    private async extractTextStats(pdf: PDFDocumentProxy): Promise<{
        pageCount: number;
        pagesWithText: number;
        totalCharacters: number;
        averageCharactersPerPage: number;
    }> {
        const pageCount = Math.min(pdf.numPages, this.maxPages);
        let pagesWithText = 0;
        let totalCharacters = 0;

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);

            try {
                const textContent = await page.getTextContent();
                const pageText = textContent.items
                    .map((item) => this.textItemToString(item))
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();

                if (pageText.length > 0) {
                    pagesWithText += 1;
                    totalCharacters += pageText.length;
                }
            } finally {
                page.cleanup();
            }
        }

        return {
            pageCount,
            pagesWithText,
            totalCharacters,
            averageCharactersPerPage: pageCount > 0 ? totalCharacters / pageCount : 0,
        };
    }

    private textItemToString(item: unknown): string {
        if (!item || typeof item !== "object") {
            return "";
        }

        const maybeTextItem = item as Partial<TextItem>;
        return typeof maybeTextItem.str === "string" ? maybeTextItem.str : "";
    }

    private detectTagging(buffer: Buffer): {
        isTagged: boolean;
        hasStructTreeRoot: boolean;
        hasMarkedFlag: boolean;
    } {
        const raw = buffer.toString("latin1");

        const hasStructTreeRoot = /\/StructTreeRoot\b/.test(raw);
        const hasMarkedFlag = /\/MarkInfo\s*<<[\s\S]*?\/Marked\s+true[\s\S]*?>>/i.test(raw);

        return {
            isTagged: hasStructTreeRoot || hasMarkedFlag,
            hasStructTreeRoot,
            hasMarkedFlag,
        };
    }

    private getXmpMetadata(metadata: unknown): Record<string, unknown> {
        if (!metadata || typeof metadata !== "object") {
            return {};
        }

        const candidate = metadata as { getAll?: () => unknown };
        if (typeof candidate.getAll === "function") {
            const result = candidate.getAll();
            if (result && typeof result === "object") {
                return result as Record<string, unknown>;
            }
        }

        return {};
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (value && typeof value === "object") {
            return value as Record<string, unknown>;
        }
        return {};
    }

    private asString(value: unknown): string | null {
        if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }

        if (Array.isArray(value)) {
            const parts = value
                .map((item) => (typeof item === "string" ? item.trim() : ""))
                .filter((item) => item.length > 0);

            return parts.length > 0 ? parts.join(" ") : null;
        }

        return null;
    }

    private firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
        for (const value of values) {
            if (typeof value === "string" && value.trim().length > 0) {
                return value.trim();
            }
        }
        return null;
    }

    private errorMessage(prefix: string, error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return `${prefix}: ${message}`;
    }
}
