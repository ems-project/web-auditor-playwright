import assert from "node:assert/strict";
import test from "node:test";

import { renderCrawlProgressPage } from "../src/engine/CrawlProgressPage.js";

test("renderCrawlProgressPage renders the configured title and stop endpoint", () => {
    const html = renderCrawlProgressPage({
        title: "Custom Monitor",
        statusApiPath: "/custom/status",
        gracefulStopApiPath: "/custom/graceful-stop",
        refreshIntervalMs: 5000,
    });

    assert.match(html, /<title>Custom Monitor<\/title>/);
    assert.match(html, /const statusApiPath = "\/custom\/status";/);
    assert.match(html, /const gracefulStopApiPath = "\/custom\/graceful-stop";/);
    assert.match(html, /const refreshIntervalMs = 5000;/);
    assert.match(html, /<h1>Crawl Monitor<\/h1>/);
    assert.match(html, /Graceful Stop/);
});
