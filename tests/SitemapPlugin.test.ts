import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { SitemapPlugin } from "../src/plugins/SitemapPlugin.js";

function createPlugin() {
    return new SitemapPlugin();
}

function callPrivateMethod<TArgs extends unknown[], TResult>(
    plugin: SitemapPlugin,
    methodName: string,
    ...args: TArgs
): TResult {
    const candidate = (plugin as unknown as Record<string, unknown>)[methodName];
    if (typeof candidate !== "function") {
        throw new Error(methodName + " is not accessible in tests");
    }

    return candidate.apply(plugin, args) as TResult;
}

test("parseSitemapXml parses urlset entries", () => {
    const plugin = createPlugin();

    const parsed = callPrivateMethod<[string], Record<string, unknown>>(
        plugin,
        "parseSitemapXml",
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            "  <url><loc>https://example.com/</loc></url>",
            "  <url><loc>https://example.com/about</loc></url>",
            "</urlset>",
        ].join("\n"),
    );

    assert.equal(parsed.kind, "urlset");
    assert.deepEqual(parsed.urls, ["https://example.com/", "https://example.com/about"]);
    assert.deepEqual(parsed.childSitemaps, []);
    assert.deepEqual(parsed.invalidLocs, []);
});

test("parseSitemapXml parses sitemapindex entries", () => {
    const plugin = createPlugin();

    const parsed = callPrivateMethod<[string], Record<string, unknown>>(
        plugin,
        "parseSitemapXml",
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            "  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>",
            "  <sitemap><loc>https://example.com/sitemap-images.xml</loc></sitemap>",
            "</sitemapindex>",
        ].join("\n"),
    );

    assert.equal(parsed.kind, "sitemapindex");
    assert.deepEqual(parsed.urls, []);
    assert.deepEqual(parsed.childSitemaps, [
        "https://example.com/sitemap-pages.xml",
        "https://example.com/sitemap-images.xml",
    ]);
    assert.deepEqual(parsed.invalidLocs, []);
});

test("parseSitemapXml reports missing loc blocks", () => {
    const plugin = createPlugin();

    const parsed = callPrivateMethod<[string], Record<string, unknown>>(
        plugin,
        "parseSitemapXml",
        "<urlset><url><loc>https://example.com/</loc></url><url><lastmod>2026-01-01</lastmod></url></urlset>",
    );

    assert.deepEqual(parsed.invalidLocs, ["<missing loc>"]);
});

test("decodeSitemapBuffer inflates gzipped sitemap payloads", () => {
    const plugin = createPlugin();
    const gzipped = gzipSync(
        Buffer.from("<urlset><url><loc>https://example.com/</loc></url></urlset>"),
    );

    const xml = callPrivateMethod<[Buffer, string, string | null], string>(
        plugin,
        "decodeSitemapBuffer",
        gzipped,
        "https://example.com/sitemap.xml.gz",
        "application/gzip",
    );

    assert.equal(xml, "<urlset><url><loc>https://example.com/</loc></url></urlset>");
});

test("reportMissingPage only reports once for a missing crawled page", () => {
    const plugin = createPlugin();
    const findings: Array<{ code: string; message: string }> = [];
    const ctx = {
        url: "https://example.com/sitemap.xml",
        findings,
        engineState: { any: {}, origin: "https://example.com" },
        report: { is_web: false },
        audited: false,
        auditors: [],
    };
    const state = {
        sitemapUrls: ["https://example.com/"],
        observedPages: [],
        reportedMissingPages: [],
        enqueuedSitemaps: [],
        hasParsedUrlset: true,
    };

    callPrivateMethod<[typeof ctx, typeof state, string], void>(
        plugin,
        "reportMissingPage",
        ctx,
        state,
        "https://example.com/about",
    );
    callPrivateMethod<[typeof ctx, typeof state, string], void>(
        plugin,
        "reportMissingPage",
        ctx,
        state,
        "https://example.com/about",
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, "SITEMAP_PAGE_MISSING_FROM_SITEMAP");
});
