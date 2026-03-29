import assert from "node:assert/strict";
import test from "node:test";

import { HtmlProcessorPlugin } from "../src/plugins/HtmlProcessorPlugin.js";

type ValidateSpecialHref = (href: string) => { code: string; message: string } | null;

function createValidator(): ValidateSpecialHref {
    const plugin = new HtmlProcessorPlugin();
    const candidate = (plugin as unknown as Record<string, unknown>)["validateSpecialHref"];

    if (typeof candidate !== "function") {
        throw new Error("validateSpecialHref is not accessible in tests");
    }

    return candidate.bind(plugin) as ValidateSpecialHref;
}

test("validateSpecialHref accepts valid mailto hrefs", () => {
    const validateSpecialHref = createValidator();

    assert.equal(validateSpecialHref("mailto:john.doe@example.com"), null);
    assert.equal(
        validateSpecialHref("mailto:john.doe@example.com,jane.doe@example.com?subject=Hello"),
        null,
    );
});

test("validateSpecialHref rejects invalid mailto hrefs", () => {
    const validateSpecialHref = createValidator();

    assert.deepEqual(validateSpecialHref("mailto:"), {
        code: "INVALID_MAILTO_HREF",
        message: "Invalid mailto href format: mailto:",
    });
    assert.deepEqual(validateSpecialHref("mailto:not-an-email"), {
        code: "INVALID_MAILTO_HREF",
        message: "Invalid mailto href format: mailto:not-an-email",
    });
});

test("validateSpecialHref accepts valid tel hrefs", () => {
    const validateSpecialHref = createValidator();

    assert.equal(validateSpecialHref("tel:+33123456789"), null);
});

test("validateSpecialHref rejects tel hrefs without a leading plus", () => {
    const validateSpecialHref = createValidator();

    assert.deepEqual(validateSpecialHref("tel:0123456789"), {
        code: "INVALID_TEL_HREF",
        message: 'Invalid tel href format: tel:0123456789. Telephone links must start with "+".',
    });
});

test("validateSpecialHref rejects tel hrefs containing non digits", () => {
    const validateSpecialHref = createValidator();

    assert.deepEqual(validateSpecialHref("tel:+33-abc"), {
        code: "INVALID_TEL_HREF",
        message:
            'Invalid tel href format: tel:+33-abc. Telephone links must contain only digits after "+".',
    });
});

test("validateSpecialHref rejects empty tel hrefs", () => {
    const validateSpecialHref = createValidator();

    assert.deepEqual(validateSpecialHref("tel:"), {
        code: "INVALID_TEL_HREF",
        message: "Invalid tel href format: tel:",
    });
});

test("validateSpecialHref ignores non tel and mailto hrefs", () => {
    const validateSpecialHref = createValidator();

    assert.equal(validateSpecialHref("https://example.com"), null);
    assert.equal(validateSpecialHref("/contact"), null);
});
