import assert from "node:assert/strict";
import test from "node:test";

import { SecurityHeadersPlugin } from "../src/plugins/SecurityHeadersPlugin.js";

function createPlugin(
    overrides: { auditOnlyStartUrl?: boolean; maxCookieLifetimeDays?: number } = {},
) {
    return new SecurityHeadersPlugin(overrides);
}

function callPrivateMethod<TArgs extends unknown[], TResult>(
    plugin: SecurityHeadersPlugin,
    methodName: string,
    ...args: TArgs
): TResult {
    const candidate = (plugin as unknown as Record<string, unknown>)[methodName];
    if (typeof candidate !== "function") {
        throw new Error(methodName + " is not accessible in tests");
    }

    return candidate.apply(plugin, args) as TResult;
}

test("parseSetCookie extracts domain and lifetime attributes", () => {
    const plugin = createPlugin();

    const parsed = callPrivateMethod<[string], Record<string, unknown> | null>(
        plugin,
        "parseSetCookie",
        "sid=abc; Domain=.example.com; Path=/; Max-Age=3600; SameSite=Lax; Secure; HttpOnly",
    );

    assert.ok(parsed);
    assert.equal(parsed.name, "sid");
    assert.equal(parsed.domain, ".example.com");
    assert.equal(parsed.path, "/");
    assert.equal(parsed.maxAgeSeconds, 3600);
    assert.equal(parsed.sameSite, "lax");
    assert.equal(parsed.secure, true);
    assert.equal(parsed.httpOnly, true);
});

test("auditCookies reports excessive lifetime and third-party cookies", () => {
    const plugin = createPlugin({ maxCookieLifetimeDays: 30 });
    const findings: Array<{ code: string }> = [];
    const ctx = {
        url: "https://app.example.com/",
        finalUrl: "https://app.example.com/",
        findings,
        audited: false,
        auditors: [],
        engineState: { any: {}, origin: "https://app.example.com" },
        response: {
            headersArray() {
                return [
                    {
                        name: "set-cookie",
                        value: "tracker=1; Domain=tracker.example.net; Path=/; Max-Age=3456000; SameSite=None; Secure",
                    },
                ];
            },
        },
    };

    callPrivateMethod<[typeof ctx, boolean], void>(plugin, "auditCookies", ctx, true);

    assert.deepEqual(findings.map((finding) => finding.code).sort(), [
        "COOKIE_EXCESSIVE_LIFETIME",
        "COOKIE_MISSING_HTTPONLY",
        "COOKIE_THIRD_PARTY_DETECTED",
    ]);
});

test("getReport lists observed cookies in the final report", () => {
    const plugin = createPlugin();
    const findings: Array<{ code: string }> = [];
    const ctx = {
        url: "https://app.example.com/",
        finalUrl: "https://app.example.com/",
        findings,
        audited: false,
        auditors: [],
        engineState: { any: {}, origin: "https://app.example.com" },
        response: {
            headersArray() {
                return [
                    {
                        name: "set-cookie",
                        value: "prefs=dark; Path=/; SameSite=Lax; Secure; HttpOnly",
                    },
                    {
                        name: "set-cookie",
                        value: "session=abc; Path=/account; SameSite=Strict; Secure; HttpOnly",
                    },
                ];
            },
        },
    };

    callPrivateMethod<[typeof ctx, boolean], void>(plugin, "auditCookies", ctx, true);
    const report = plugin.getReport(ctx.engineState as never);

    assert.equal(report.items.find((item) => item.key === "cookieCount")?.value, 2);
    assert.equal(
        report.items.some((item) => item.label === "Cookie 1: prefs"),
        true,
    );
    assert.equal(
        report.items.some((item) => item.label === "Cookie 2: session"),
        true,
    );
});
