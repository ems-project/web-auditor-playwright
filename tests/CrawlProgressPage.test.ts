import assert from "node:assert/strict";
import test from "node:test";

import { renderCrawlProgressPage } from "../src/engine/CrawlProgressPage.js";

test("renderCrawlProgressPage renders the configured title and polling settings", () => {
    const html = renderCrawlProgressPage({
        title: "Custom Monitor",
        statusApiPath: "/custom/status",
        refreshIntervalMs: 5000,
    });

    assert.match(html, /<title>Custom Monitor<\/title>/);
    assert.match(html, /const statusApiPath = "\/custom\/status";/);
    assert.match(html, /const refreshIntervalMs = 5000;/);
    assert.match(html, /<h1>Crawl Monitor<\/h1>/);
});
