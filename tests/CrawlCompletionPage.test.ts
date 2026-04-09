import assert from "node:assert/strict";
import test from "node:test";

import { renderCrawlCompletionPage } from "../src/engine/CrawlCompletionPage.js";

test("renderCrawlCompletionPage renders clickable artifact links and shutdown control", () => {
    const html = renderCrawlCompletionPage({
        status: "finished",
        title: "Audit Summary",
        subtitle: "example",
        overviewCards: [],
        runDetails: [
            {
                key: "reportJson",
                label: "report.json",
                value: { href: "/artifacts/report.json", label: "Open report.json" },
            },
            {
                key: "simplifiedAudits",
                label: "Simplified audit pages",
                value: [
                    {
                        href: "/artifacts/simplified-audit.fr.html",
                        label: "Open simplified-audit.fr.html",
                    },
                    {
                        href: "/artifacts/simplified-audit.en.html",
                        label: "Open simplified-audit.en.html",
                    },
                ],
            },
        ],
        auditPlugins: [],
        pluginDetails: [],
    });

    assert.match(html, /href="\/artifacts\/report\.json"/);
    assert.match(html, /Open report\.json/);
    assert.match(html, /href="\/artifacts\/simplified-audit\.fr\.html"/);
    assert.match(html, /href="\/artifacts\/simplified-audit\.en\.html"/);
    assert.match(html, /Stop Web Server/);
    assert.match(html, /fetch\('\/api\/shutdown'/);
});
