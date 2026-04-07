import assert from "node:assert/strict";
import test from "node:test";

import { HreflangPlugin } from "../src/plugins/HreflangPlugin.js";

type PageRecord = {
    url: string;
    locale: string | null;
    alternates: Array<{ hreflang: string; normalized: string; url: string }>;
};

function callPrivateMethod<TArgs extends unknown[], TResult>(
    plugin: HreflangPlugin,
    methodName: string,
    ...args: TArgs
): TResult {
    const candidate = (plugin as unknown as Record<string, unknown>)[methodName];
    if (typeof candidate !== "function") {
        throw new Error(methodName + " is not accessible in tests");
    }

    return candidate.apply(plugin, args) as TResult;
}

test("isValidHreflangCode accepts hyphenated values and rejects underscores", () => {
    const plugin = new HreflangPlugin();

    assert.equal(
        callPrivateMethod<[string], boolean>(plugin, "isValidHreflangCode", "fr-be"),
        true,
    );
    assert.equal(
        callPrivateMethod<[string], boolean>(plugin, "isValidHreflangCode", "x-default"),
        true,
    );
    assert.equal(
        callPrivateMethod<[string], boolean>(plugin, "isValidHreflangCode", "fr_BE"),
        false,
    );
});

test("matchesLocale compares primary language subtags", () => {
    const plugin = new HreflangPlugin();

    assert.equal(
        callPrivateMethod<[string, string | null], boolean>(plugin, "matchesLocale", "fr-be", "fr"),
        true,
    );
    assert.equal(
        callPrivateMethod<[string, string | null], boolean>(plugin, "matchesLocale", "en-us", "fr"),
        false,
    );
});

test("findMissingCrossLinks returns alternates without reciprocal links", () => {
    const plugin = new HreflangPlugin();
    const pages: Record<string, PageRecord> = {
        "https://example.com/fr": {
            url: "https://example.com/fr",
            locale: "fr",
            alternates: [
                {
                    hreflang: "en-us",
                    normalized: "en-us",
                    url: "https://example.com/en",
                },
            ],
        },
        "https://example.com/en": {
            url: "https://example.com/en",
            locale: "en",
            alternates: [],
        },
    };

    const missing = callPrivateMethod<[Record<string, PageRecord>], Array<Record<string, unknown>>>(
        plugin,
        "findMissingCrossLinks",
        pages,
    );

    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.sourceUrl, "https://example.com/fr");
    assert.equal(missing[0]?.targetUrl, "https://example.com/en");
});
