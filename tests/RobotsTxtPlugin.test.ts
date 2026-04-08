import assert from "node:assert/strict";
import test from "node:test";

import { RobotsTxtPlugin } from "../src/plugins/RobotsTxtPlugin.js";

function createPlugin(overrides: { requireCrawlDelay?: boolean; requireSitemap?: boolean } = {}) {
    return new RobotsTxtPlugin(overrides);
}

function callPrivateMethod<TArgs extends unknown[], TResult>(
    plugin: RobotsTxtPlugin,
    methodName: string,
    ...args: TArgs
): TResult {
    const candidate = (plugin as unknown as Record<string, unknown>)[methodName];
    if (typeof candidate !== "function") {
        throw new Error(methodName + " is not accessible in tests");
    }

    return candidate.apply(plugin, args) as TResult;
}

test("parseRobotsTxt parses wildcard groups, sitemap and crawl-delay", () => {
    const plugin = createPlugin();
    const parsed = callPrivateMethod<
        [string],
        {
            groups: Array<{ userAgents: string[]; crawlDelay: string[]; disallow: string[] }>;
            sitemaps: string[];
        }
    >(
        plugin,
        "parseRobotsTxt",
        [
            "User-agent: *",
            "Disallow: /private/",
            "Crawl-delay: 5",
            "Sitemap: https://example.com/sitemap.xml",
            "",
        ].join("\n"),
    );

    assert.equal(parsed.groups.length, 1);
    assert.deepEqual(parsed.sitemaps, ["https://example.com/sitemap.xml"]);
    assert.deepEqual(parsed.groups[0].userAgents, ["*"]);
    assert.deepEqual(parsed.groups[0].crawlDelay, ["5"]);
    assert.deepEqual(parsed.groups[0].disallow, ["/private/"]);
});

test("isValidCrawlDelay accepts numeric values and rejects invalid ones", () => {
    const plugin = createPlugin();

    assert.equal(callPrivateMethod<[string], boolean>(plugin, "isValidCrawlDelay", "0"), true);
    assert.equal(callPrivateMethod<[string], boolean>(plugin, "isValidCrawlDelay", "2.5"), true);
    assert.equal(callPrivateMethod<[string], boolean>(plugin, "isValidCrawlDelay", "abc"), false);
    assert.equal(callPrivateMethod<[string], boolean>(plugin, "isValidCrawlDelay", "-1"), false);
});

test("blocksAllCrawlers detects Disallow slash in wildcard group", () => {
    const plugin = createPlugin();

    assert.equal(
        callPrivateMethod<[Record<string, unknown>], boolean>(plugin, "blocksAllCrawlers", {
            userAgents: ["*"],
            crawlDelay: [],
            allow: [],
            disallow: ["/"],
        }),
        true,
    );
});

test("isBlockedByWildcardRules respects longest allow/disallow match", () => {
    const plugin = createPlugin();
    const parsed = {
        groups: [
            {
                userAgents: ["*"],
                crawlDelay: [],
                allow: ["/assets/public/"],
                disallow: ["/assets/"],
            },
        ],
        sitemaps: [],
    };

    assert.equal(
        callPrivateMethod<[typeof parsed, string], boolean>(
            plugin,
            "isBlockedByWildcardRules",
            parsed,
            "/assets/app.css",
        ),
        true,
    );
    assert.equal(
        callPrivateMethod<[typeof parsed, string], boolean>(
            plugin,
            "isBlockedByWildcardRules",
            parsed,
            "/assets/public/logo.png",
        ),
        false,
    );
});

test("detectResourceKind classifies css, js and image resources", () => {
    const plugin = createPlugin();

    assert.equal(
        callPrivateMethod<[Record<string, unknown>, string], string | null>(
            plugin,
            "detectResourceKind",
            { mime: "text/css" },
            "https://example.com/assets/app.css",
        ),
        "css",
    );
    assert.equal(
        callPrivateMethod<[Record<string, unknown>, string], string | null>(
            plugin,
            "detectResourceKind",
            { mime: "application/javascript" },
            "https://example.com/assets/app.js",
        ),
        "js",
    );
    assert.equal(
        callPrivateMethod<[Record<string, unknown>, string], string | null>(
            plugin,
            "detectResourceKind",
            { mime: "image/png" },
            "https://example.com/assets/logo.png",
        ),
        "image",
    );
});

test("enqueueSitemaps queues absolute and relative sitemap URLs once", () => {
    const plugin = createPlugin();
    const queued: Array<{ url: string; source?: string }> = [];
    const state = {
        parsed: null,
        observedResources: [],
        observedKeys: [],
        blockedKeys: [],
        enqueuedSitemaps: [],
    };
    const ctx = {
        engineState: { origin: "https://example.com", any: {} },
        crawler: {
            enqueueUrl(request: { url: string; source?: string }) {
                queued.push(request);
                return { accepted: true };
            },
        },
    };

    callPrivateMethod<[typeof ctx, typeof state, string[]], void>(
        plugin,
        "enqueueSitemaps",
        ctx,
        state,
        [
            "https://example.com/sitemap.xml",
            "/sitemap-images.xml",
            "https://[invalid",
            "https://example.com/sitemap.xml",
        ],
    );

    assert.deepEqual(queued, [
        { url: "https://example.com/sitemap.xml", source: "robots-txt" },
        { url: "https://example.com/sitemap-images.xml", source: "robots-txt" },
    ]);
    assert.deepEqual(state.enqueuedSitemaps, [
        "https://example.com/sitemap.xml",
        "https://example.com/sitemap-images.xml",
    ]);
});
