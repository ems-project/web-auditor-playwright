import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublicIpResponse } from "../src/utils/PublicIpResolver.js";

test("normalizePublicIpResponse parses IPv4 responses with trailing newline", () => {
    assert.equal(normalizePublicIpResponse("203.0.113.42\n", 4), "203.0.113.42");
});

test("normalizePublicIpResponse rejects invalid IPv4 responses", () => {
    assert.equal(normalizePublicIpResponse("not-an-ip", 4), null);
    assert.equal(normalizePublicIpResponse("999.0.0.1", 4), null);
});

test("normalizePublicIpResponse parses IPv6 responses with trailing newline", () => {
    assert.equal(normalizePublicIpResponse("2001:db8::42\n", 6), "2001:db8::42");
});

test("normalizePublicIpResponse rejects invalid IPv6 responses", () => {
    assert.equal(normalizePublicIpResponse("hello", 6), null);
    assert.equal(normalizePublicIpResponse("2001:::1", 6), null);
});
