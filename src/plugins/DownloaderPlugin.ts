import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { BasePlugin } from "../engine/BasePlugin.js";
import { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";

type DownloaderPluginOptions = {
    outputDir?: string;
    keepFiles?: boolean;
};

type MimeDetection = {
    mime: string | null;
    source: "response-header" | "signature" | "extension" | "unknown";
};

export class DownloaderPlugin extends BasePlugin implements IPlugin {
    name = "downloader";
    phases: PluginPhase[] = ["download"];

    private readonly outputDir: string;
    private readonly keepFiles: boolean;

    constructor(options: DownloaderPluginOptions = {}) {
        super();
        this.outputDir = options.outputDir ?? "./reports/downloads";
        this.keepFiles = options.keepFiles ?? false;
    }

    applies(ctx: ResourceContext): boolean {
        return !!ctx.downloadTrigger;
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (!ctx.downloadTrigger) {
            return;
        }

        if (ctx.downloaded?.savedPath) {
            return;
        }

        await fsp.mkdir(this.outputDir, { recursive: true });

        const sourceUrl = ctx.download?.url() || ctx.finalUrl || ctx.url;
        const suggestedFilename = this.sanitizeFilename(
            ctx.download?.suggestedFilename() || this.filenameFromUrl(sourceUrl) || "download.bin",
        );

        const savedFilename = `${this.shortHash(`${sourceUrl}|${Date.now()}`)}-${suggestedFilename}`;
        const savedPath = path.join(this.outputDir, savedFilename);

        try {
            if (ctx.download) {
                await ctx.download.saveAs(savedPath);
            } else {
                const requestContext = ctx.context.request;
                const response = await requestContext.get(ctx.finalUrl ?? ctx.url);

                if (response.ok()) {
                    const buffer = await response.body();
                    await fsp.writeFile(savedPath, buffer);
                } else {
                    this.registerError(
                        ctx,
                        "network",
                        "DOWNLOAD_FAILED",
                        ErrorUtils.errorMessage(
                            "Failed to fetch inline resource",
                            response.statusText(),
                        ),
                    );
                }
            }
        } catch (error) {
            ctx.status = ctx.report.status_code = ctx.status ?? 400;
            ctx.report.message = "Unable to download file";
            this.registerError(
                ctx,
                "network",
                "DOWNLOAD_FAILED",
                ErrorUtils.errorMessage(ctx.report.message, error),
            );
            return;
        }

        const stat = await fsp.stat(savedPath);
        const detection = this.detectMimeType(
            savedPath,
            suggestedFilename,
            ctx.response?.headers(),
        );
        const sha256 = await this.sha256(savedPath);

        ctx.downloaded = {
            sourceUrl,
            suggestedFilename,
            savedPath,
            size: stat.size,
            sha256,
            mime: detection.mime,
            mimeSource: detection.source,
            cleanup: !this.keepFiles,
        };

        const finalTargetUrl = ctx.finalUrl ?? ctx.url;
        const parsed = new URL(finalTargetUrl);

        ctx.status = ctx.report.status_code = ctx.status ?? 200;
        ctx.mime = detection.mime ?? undefined;
        ctx.report.mimetype = detection.mime;
        ctx.report.url = sourceUrl;
        ctx.report.redirected = ctx.url !== finalTargetUrl;
        ctx.report.host = parsed.host;
        ctx.report.base_url = parsed.pathname;
        ctx.report.timestamp = new Date().toISOString();
        ctx.report.size = stat.size;
        ctx.report.is_web = false;
        ctx.report.meta_title = null;
        ctx.report.title = suggestedFilename;
        ctx.report.locale = null;
        ctx.report.description = null;
        ctx.report.content ??= null;
        ctx.report.links ??= [];

        if (!detection.mime) {
            this.registerWarning(
                ctx,
                "resources",
                "MIME_UNKNOWN",
                `Unable to determine MIME type for "${suggestedFilename}".`,
            );
        }

        this.register(ctx);
    }

    private detectMimeType(
        filePath: string,
        filename: string,
        headers?: Record<string, string>,
    ): MimeDetection {
        const headerMime = this.cleanContentType(headers?.["content-type"]);
        if (headerMime) {
            return { mime: headerMime, source: "response-header" };
        }

        const signatureMime = this.detectMimeFromSignature(filePath, filename);
        if (signatureMime) {
            return { mime: signatureMime, source: "signature" };
        }

        const extensionMime = this.detectMimeFromExtension(filename);
        if (extensionMime) {
            return { mime: extensionMime, source: "extension" };
        }

        return { mime: null, source: "unknown" };
    }

    private cleanContentType(contentType?: string): string | null {
        if (!contentType) {
            return null;
        }
        const mime = contentType.split(";")[0]?.trim().toLowerCase();
        return mime || null;
    }

    private detectMimeFromExtension(filename: string): string | null {
        const lower = filename.toLowerCase();

        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".docx")) {
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".xml")) return "application/xml";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".md")) return "text/markdown";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".zip")) return "application/zip";

        return null;
    }

    private detectMimeFromSignature(filePath: string, filename: string): string | null {
        const fd = fs.openSync(filePath, "r");

        try {
            const buffer = Buffer.alloc(16);
            const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
            const hex = buffer.subarray(0, bytesRead).toString("hex").toLowerCase();

            if (hex.startsWith("25504446")) return "application/pdf";
            if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
            if (hex.startsWith("ffd8ff")) return "image/jpeg";
            if (hex.startsWith("47494638")) return "image/gif";

            if (hex.startsWith("504b0304")) {
                const lower = filename.toLowerCase();
                if (lower.endsWith(".docx")) {
                    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                }
                return "application/zip";
            }

            return null;
        } finally {
            fs.closeSync(fd);
        }
    }

    private sanitizeFilename(filename: string): string {
        return filename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    }

    private filenameFromUrl(url: string): string | null {
        try {
            const pathname = new URL(url).pathname;
            return pathname.split("/").filter(Boolean).pop() ?? null;
        } catch {
            return null;
        }
    }

    private shortHash(value: string): string {
        return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
    }

    private async sha256(filePath: string): Promise<string> {
        const buffer = await fsp.readFile(filePath);
        return crypto.createHash("sha256").update(buffer).digest("hex");
    }

    isAuditPlugin(): boolean {
        return false;
    }
}
