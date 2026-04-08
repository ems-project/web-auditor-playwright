import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSimplifiedAuditViewModel,
    renderSimplifiedAuditPage,
} from "../src/engine/SimplifiedAuditPage.js";

test("renderSimplifiedAuditPage renders localized bootstrap page with copy button", () => {
    const model = buildSimplifiedAuditViewModel({
        locale: "fr",
        origin: "https://example.com",
        startedAt: new Date("2026-04-08T10:00:00Z"),
        endedAt: new Date("2026-04-08T10:30:00Z"),
        issues: [
            {
                plugin: "a11y-axe",
                type: "error",
                category: "a11y",
                code: "image-alt",
                message: "Images must have alternate text.",
                url: "https://example.com/home",
            },
        ],
        inventory: [
            {
                url: "https://example.com/home",
                status: 200,
                mime: "text/html",
            },
        ],
        plugins: [],
    });

    const html = renderSimplifiedAuditPage(model);

    assert.match(
        html,
        /cdn\.jsdelivr\.net\/npm\/bootstrap@5\.3\.3\/dist\/css\/bootstrap\.min\.css/,
    );
    assert.match(html, /Copier le contenu HTML/);
    assert.match(html, /EN 301 549/);
    assert.match(html, /image-alt/);
    assert.match(html, /ClipboardItem/);
});

test("buildSimplifiedAuditViewModel scopes the summary to accessibility issues only", () => {
    const model = buildSimplifiedAuditViewModel({
        locale: "en",
        origin: "https://example.com",
        startedAt: new Date("2026-04-08T10:00:00Z"),
        endedAt: new Date("2026-04-08T10:30:00Z"),
        issues: [
            {
                plugin: "a11y-axe",
                type: "warning",
                category: "a11y",
                code: "color-contrast",
                message: "Insufficient color contrast.",
                url: "https://example.com/home",
            },
            {
                plugin: "security-headers",
                type: "warning",
                category: "security",
                code: "MISSING_CSP",
                message: "Missing Content-Security-Policy header.",
                url: "https://example.com/home",
            },
        ],
        inventory: [
            {
                url: "https://example.com/home",
                status: 200,
                mime: "text/html",
            },
        ],
        plugins: [],
    });

    assert.equal(model.findingCount, 1);
    assert.equal(model.groupedFindingCount, 1);
    assert.equal(model.statusLabel, "Partially compliant");
    assert.equal(model.findings[0]?.code, "color-contrast");
});
