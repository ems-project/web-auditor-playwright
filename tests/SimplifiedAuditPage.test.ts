import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSimplifiedAuditViewModel,
    parseSimplifiedAuditLocales,
    renderSimplifiedAuditPage,
} from "../src/engine/SimplifiedAuditPage.js";

test("renderSimplifiedAuditPage renders BOSA-style EN 301 549 sections with help_url references", () => {
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
                data: {
                    id: "image-alt",
                    description: "Ensure <img> elements have text alternatives.",
                    help_url:
                        "https://dequeuniversity.com/rules/axe/4.11/image-alt?application=axeAPI",
                    en301549_criteria: ["9.1.1.1"],
                },
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
    assert.match(html, /9\.1 Perceptible/);
    assert.match(html, /9\.1\.1 Alternatives textuelles/);
    assert.match(html, /9\.1\.1\.1/);
    assert.match(html, /Contenu non textuel/);
    assert.match(html, /Non-conformité détectée/);
});

test("buildSimplifiedAuditViewModel groups criteria by principle and guideline and keeps passing criteria", () => {
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
                data: {
                    id: "color-contrast",
                    help_url:
                        "https://dequeuniversity.com/rules/axe/4.11/color-contrast?application=axeAPI",
                    en301549_criteria: ["9.1.4.3"],
                },
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
    assert.ok(model.axePrinciples.length >= 4);

    const perceptible = model.axePrinciples.find((principle) => principle.code === "1");
    assert.ok(perceptible);
    assert.equal(perceptible?.title, "Perceivable");

    const distinguishable = perceptible?.guidelines.find((guideline) => guideline.code === "1.4");
    assert.ok(distinguishable);
    assert.equal(distinguishable?.title, "Distinguishable");

    const failingCriterion = distinguishable?.criteria.find(
        (criterion) => criterion.criterion === "1.4.3",
    );
    assert.ok(failingCriterion);
    assert.equal(failingCriterion?.status, "warning");

    const passingCriterion = perceptible?.guidelines
        .flatMap((guideline) => guideline.criteria)
        .find((criterion) => criterion.status === "pass");
    assert.ok(passingCriterion);
    assert.equal(passingCriterion?.statusLabel, "No issue detected");
});

test("parseSimplifiedAuditLocales filters invalid locales and falls back to defaults", () => {
    assert.deepEqual(parseSimplifiedAuditLocales("de,fr,xx,de"), ["de", "fr"]);
    assert.deepEqual(parseSimplifiedAuditLocales("xx,yy"), ["fr", "nl", "de", "en"]);
    assert.deepEqual(parseSimplifiedAuditLocales(undefined), ["fr", "nl", "de", "en"]);
});
