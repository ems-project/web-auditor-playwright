import fsp from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import { BasePlugin } from "../engine/BasePlugin.js";
import type { EngineState, IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type ParsedSitemap = {
    kind: "urlset" | "sitemapindex";
    urls: string[];
    childSitemaps: string[];
    invalidLocs: string[];
};

type SitemapState = {
    sitemapUrls: string[];
    observedPages: string[];
    reportedMissingPages: string[];
    enqueuedSitemaps: string[];
    hasParsedUrlset: boolean;
};

export class SitemapPlugin extends BasePlugin implements IPlugin {
    name = "sitemap";
    phases: PluginPhase[] = ["process", "download"];

    applies(ctx: ResourceContext): boolean {
        return this.isSameOrigin(ctx, ctx.finalUrl ?? ctx.url);
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const state = this.getState(ctx.engineState);
        const currentUrl = ctx.finalUrl ?? ctx.url;

        if (phase === "process") {
            this.recordObservedPage(ctx, state, currentUrl);
            if (state.hasParsedUrlset) {
                this.reportMissingCurrentPage(ctx, state, currentUrl);
            }
            return;
        }

        if (!this.looksLikeSitemapResource(ctx, currentUrl)) {
            return;
        }

        const savedPath = ctx.downloaded?.savedPath;
        if (!savedPath) {
            return;
        }

        let xml: string;
        try {
            const raw = await fsp.readFile(savedPath);
            xml = this.decodeSitemapBuffer(
                raw,
                currentUrl,
                ctx.downloaded?.mime ?? ctx.mime ?? null,
            );
        } catch (error) {
            this.registerWarning(
                ctx,
                "crawl",
                "SITEMAP_INVALID_XML",
                `Failed to read sitemap XML: ${this.errorMessage(error)}`,
            );
            this.register(ctx);
            return;
        }

        let parsed: ParsedSitemap;
        try {
            parsed = this.parseSitemapXml(xml);
        } catch (error) {
            const message = this.errorMessage(error);
            if (message.startsWith("invalid_root:")) {
                this.registerWarning(
                    ctx,
                    "crawl",
                    "SITEMAP_INVALID_ROOT",
                    `Sitemap XML has an unsupported root element: ${message.slice("invalid_root:".length)}.`,
                );
            } else {
                this.registerWarning(
                    ctx,
                    "crawl",
                    "SITEMAP_INVALID_XML",
                    `Failed to parse sitemap XML: ${message}`,
                );
            }
            this.register(ctx);
            return;
        }

        ctx.report.metas ??= [];
        ctx.report.metas.push({ key: "sitemap_kind", value: parsed.kind });
        ctx.report.metas.push({ key: "sitemap_url_count", value: `${parsed.urls.length}` });
        ctx.report.metas.push({
            key: "sitemap_child_count",
            value: `${parsed.childSitemaps.length}`,
        });

        for (const invalidLoc of parsed.invalidLocs) {
            this.registerWarning(
                ctx,
                "crawl",
                "SITEMAP_INVALID_URL",
                `Sitemap contains an invalid or missing <loc>: ${invalidLoc}`,
                { loc: invalidLoc },
            );
        }

        if (parsed.kind === "urlset") {
            state.hasParsedUrlset = true;
            for (const rawUrl of parsed.urls) {
                const absoluteUrl = this.normalizeAbsoluteUrl(rawUrl);
                if (!absoluteUrl) {
                    this.registerWarning(
                        ctx,
                        "crawl",
                        "SITEMAP_INVALID_URL",
                        `Sitemap contains an invalid URL: ${rawUrl}`,
                        { url: rawUrl },
                    );
                    continue;
                }

                if (state.sitemapUrls.includes(absoluteUrl)) {
                    this.registerWarning(
                        ctx,
                        "crawl",
                        "SITEMAP_DUPLICATE_URL",
                        `Sitemap declares the same URL more than once: ${absoluteUrl}`,
                        { url: absoluteUrl },
                    );
                    continue;
                }

                state.sitemapUrls.push(absoluteUrl);
            }

            this.reportMissingObservedPages(ctx, state);
        }

        if (parsed.kind === "sitemapindex") {
            for (const childUrl of parsed.childSitemaps) {
                const absoluteUrl = this.normalizeAbsoluteUrl(childUrl);
                if (!absoluteUrl) {
                    this.registerWarning(
                        ctx,
                        "crawl",
                        "SITEMAP_INVALID_URL",
                        `Sitemap index contains an invalid child sitemap URL: ${childUrl}`,
                        { url: childUrl },
                    );
                    continue;
                }

                if (state.enqueuedSitemaps.includes(absoluteUrl)) {
                    continue;
                }

                state.enqueuedSitemaps.push(absoluteUrl);
                ctx.crawler.enqueueUrl({
                    url: absoluteUrl,
                    source: this.name,
                });
            }
        }

        this.register(ctx);
    }

    private decodeSitemapBuffer(buffer: Buffer, url: string, mime: string | null): string {
        const inflated = this.isGzipPayload(buffer, url, mime) ? gunzipSync(buffer) : buffer;
        const text = inflated
            .toString("utf8")
            .replace(/^\uFEFF/, "")
            .trim();
        if (!text) {
            throw new Error("empty_document");
        }
        return text;
    }

    private parseSitemapXml(xml: string): ParsedSitemap {
        const rootTag = this.extractRootTagName(xml);
        if (!rootTag) {
            throw new Error("missing_root");
        }

        const localName = this.localName(rootTag);
        if (localName === "urlset") {
            return {
                kind: "urlset",
                urls: this.extractLocs(xml, "url"),
                childSitemaps: [],
                invalidLocs: this.findInvalidLocs(xml, "url"),
            };
        }

        if (localName === "sitemapindex") {
            return {
                kind: "sitemapindex",
                urls: [],
                childSitemaps: this.extractLocs(xml, "sitemap"),
                invalidLocs: this.findInvalidLocs(xml, "sitemap"),
            };
        }

        throw new Error(`invalid_root:${localName}`);
    }

    private extractRootTagName(xml: string): string | null {
        const match = xml.match(/<(?!\?|!|\/)([A-Za-z_][\w:.-]*)\b[^>]*>/);
        return match?.[1] ?? null;
    }

    private extractLocs(xml: string, containerTag: "url" | "sitemap"): string[] {
        const values: string[] = [];
        const matcher = new RegExp(
            `<${containerTag}\\b[^>]*>([\\s\\S]*?)<\\/${containerTag}>`,
            "gi",
        );

        for (const match of xml.matchAll(matcher)) {
            const block = match[1] ?? "";
            const loc = this.extractLocValue(block);
            if (loc) {
                values.push(loc);
            }
        }

        return values;
    }

    private findInvalidLocs(xml: string, containerTag: "url" | "sitemap"): string[] {
        const values: string[] = [];
        const matcher = new RegExp(
            `<${containerTag}\\b[^>]*>([\\s\\S]*?)<\\/${containerTag}>`,
            "gi",
        );

        for (const match of xml.matchAll(matcher)) {
            const block = match[1] ?? "";
            if (!this.extractLocValue(block)) {
                values.push("<missing loc>");
            }
        }

        return values;
    }

    private extractLocValue(block: string): string | null {
        const match = block.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i);
        if (!match) {
            return null;
        }

        const normalized = this.decodeXmlEntities(match[1]).trim();
        return normalized || null;
    }

    private decodeXmlEntities(value: string): string {
        return value
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, "&");
    }

    private recordObservedPage(ctx: ResourceContext, state: SitemapState, targetUrl: string): void {
        if (
            !ctx.report.is_web ||
            !this.isSuccessfulPage(ctx) ||
            !this.isSameOrigin(ctx, targetUrl)
        ) {
            return;
        }

        const absoluteUrl = this.normalizeAbsoluteUrl(targetUrl);
        if (!absoluteUrl || state.observedPages.includes(absoluteUrl)) {
            return;
        }

        state.observedPages.push(absoluteUrl);
    }

    private reportMissingObservedPages(ctx: ResourceContext, state: SitemapState): void {
        for (const observedUrl of state.observedPages) {
            this.reportMissingPage(ctx, state, observedUrl);
        }
    }

    private reportMissingCurrentPage(
        ctx: ResourceContext,
        state: SitemapState,
        targetUrl: string,
    ): void {
        if (!ctx.report.is_web || !this.isSuccessfulPage(ctx)) {
            return;
        }

        const absoluteUrl = this.normalizeAbsoluteUrl(targetUrl);
        if (!absoluteUrl) {
            return;
        }

        this.reportMissingPage(ctx, state, absoluteUrl);
    }

    private reportMissingPage(
        ctx: ResourceContext,
        state: SitemapState,
        absoluteUrl: string,
    ): void {
        if (
            state.sitemapUrls.includes(absoluteUrl) ||
            state.reportedMissingPages.includes(absoluteUrl)
        ) {
            return;
        }

        state.reportedMissingPages.push(absoluteUrl);
        this.registerWarning(
            ctx,
            "crawl",
            "SITEMAP_PAGE_MISSING_FROM_SITEMAP",
            `Crawled page is missing from sitemap: ${absoluteUrl}`,
            { url: absoluteUrl },
        );
    }

    private normalizeAbsoluteUrl(value: string): string | null {
        try {
            return new URL(value).href;
        } catch {
            return null;
        }
    }

    private isSuccessfulPage(ctx: ResourceContext): boolean {
        return typeof ctx.status !== "number" || ctx.status < 400;
    }

    private looksLikeSitemapResource(ctx: ResourceContext, targetUrl: string): boolean {
        try {
            const parsed = new URL(targetUrl);
            const pathname = parsed.pathname.toLowerCase();
            const mime = (ctx.downloaded?.mime ?? ctx.mime ?? "").toLowerCase();
            return (
                pathname.endsWith(".xml") ||
                pathname.endsWith(".xml.gz") ||
                pathname.includes("sitemap") ||
                mime.includes("xml") ||
                mime.includes("gzip")
            );
        } catch {
            return false;
        }
    }

    private isGzipPayload(buffer: Buffer, url: string, mime: string | null): boolean {
        const lowerMime = (mime ?? "").toLowerCase();
        if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
            return true;
        }

        return url.toLowerCase().endsWith(".gz") || lowerMime.includes("gzip");
    }

    private localName(tagName: string): string {
        const parts = tagName.split(":");
        return parts[parts.length - 1].toLowerCase();
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private isSameOrigin(ctx: ResourceContext, targetUrl: string): boolean {
        try {
            return new URL(targetUrl).origin === ctx.engineState.origin;
        } catch {
            return false;
        }
    }

    private getState(state: EngineState): SitemapState {
        const existing = state.any[this.name];
        if (this.isSitemapState(existing)) {
            return existing;
        }

        const created: SitemapState = {
            sitemapUrls: [],
            observedPages: [],
            reportedMissingPages: [],
            enqueuedSitemaps: [],
            hasParsedUrlset: false,
        };
        state.any[this.name] = created;
        return created;
    }

    private isSitemapState(value: unknown): value is SitemapState {
        if (!value || typeof value !== "object") {
            return false;
        }

        const candidate = value as Record<string, unknown>;
        return (
            Array.isArray(candidate.sitemapUrls) &&
            Array.isArray(candidate.observedPages) &&
            Array.isArray(candidate.reportedMissingPages) &&
            Array.isArray(candidate.enqueuedSitemaps) &&
            typeof candidate.hasParsedUrlset === "boolean"
        );
    }
}
