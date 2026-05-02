import assert from "node:assert/strict";
import test from "node:test";

import { TextUtils } from "../src/utils/TextUtils.js";

test("parseHttpHeadersJson returns undefined for empty input", () => {
    assert.equal(TextUtils.parseHttpHeadersJson(undefined), undefined);
    assert.equal(TextUtils.parseHttpHeadersJson("   "), undefined);
});

test("parseHttpHeadersJson parses string header values", () => {
    assert.deepEqual(
        TextUtils.parseHttpHeadersJson(
            '{"Authorization":"Bearer test-token","X-Audit-Mode":"preview"}',
        ),
        {
            Authorization: "Bearer test-token",
            "X-Audit-Mode": "preview",
        },
    );
});

test("parseHttpHeadersJson rejects invalid JSON", () => {
    assert.throws(
        () => TextUtils.parseHttpHeadersJson("Authorization: Bearer test-token"),
        /Invalid PLAYWRIGHT_EXTRA_HTTP_HEADERS JSON/,
    );
});

test("parseHttpHeadersJson rejects non-object values", () => {
    assert.throws(
        () => TextUtils.parseHttpHeadersJson('["Authorization"]'),
        /must be a JSON object/,
    );
});

test("parseHttpHeadersJson rejects non-string header values", () => {
    assert.throws(
        () => TextUtils.parseHttpHeadersJson('{"X-Retry":3}'),
        /value for "X-Retry" must be a string/,
    );
});
