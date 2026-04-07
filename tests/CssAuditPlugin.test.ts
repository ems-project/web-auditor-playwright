import assert from "node:assert/strict";
import test from "node:test";

import { CssAuditPlugin } from "../src/plugins/CssAuditPlugin.js";

type CssIssue = {
    severity: string;
    category: string;
    code: string;
    message: string;
    data?: Record<string, unknown>;
};

type StylesheetRef = {
    href: string | null;
    media: string | null;
    disabled: boolean;
};

type PageCssState = {
    stylesheetResponses: Map<string, { url: string; status: number | null }>;
    stylesheetFailures: Map<string, { url: string; errorText: string | null }>;
};

function createPlugin(
    overrides: { maxInlineStyleAttributes?: number; maxStyleTags?: number } = {},
) {
    return new CssAuditPlugin(overrides);
}

function callPrivateMethod<TArgs extends unknown[], TResult>(
    plugin: CssAuditPlugin,
    methodName: string,
    ...args: TArgs
): TResult {
    const candidate = (plugin as unknown as Record<string, unknown>)[methodName];
    if (typeof candidate !== "function") {
        throw new Error(methodName + " is not accessible in tests");
    }

    return candidate.apply(plugin, args) as TResult;
}

test("buildStylesheetNetworkIssues reports missing hrefs and failed stylesheets", () => {
    const plugin = createPlugin();
    const pageState: PageCssState = {
        stylesheetResponses: new Map([
            ["https://example.com/app.css", { url: "https://example.com/app.css", status: 404 }],
        ]),
        stylesheetFailures: new Map([
            [
                "https://example.com/broken.css",
                { url: "https://example.com/broken.css", errorText: "net::ERR_ABORTED" },
            ],
        ]),
    };

    const issues = callPrivateMethod<[StylesheetRef[], PageCssState], CssIssue[]>(
        plugin,
        "buildStylesheetNetworkIssues",
        [
            { href: null, media: null, disabled: false },
            { href: "https://example.com/app.css", media: "all", disabled: false },
            { href: "https://example.com/broken.css", media: null, disabled: false },
            { href: "https://example.com/disabled.css", media: null, disabled: true },
        ],
        pageState,
    );

    assert.deepEqual(
        issues.map((issue) => issue.code),
        ["STYLESHEET_MISSING_HREF", "STYLESHEET_HTTP_ERROR", "STYLESHEET_REQUEST_FAILED"],
    );
    assert.match(issues[1].message, /HTTP 404/);
    assert.equal(issues[2].data?.errorText, "net::ERR_ABORTED");
});

test("buildInlineCssIssues reports pages above inline CSS thresholds", () => {
    const plugin = createPlugin({ maxInlineStyleAttributes: 2, maxStyleTags: 1 });

    const issues = callPrivateMethod<
        [
            {
                inlineStyleAttributeCount: number;
                styleTagCount: number;
                stylesheets: StylesheetRef[];
            },
        ],
        CssIssue[]
    >(plugin, "buildInlineCssIssues", {
        inlineStyleAttributeCount: 3,
        styleTagCount: 2,
        stylesheets: [],
    });

    assert.deepEqual(
        issues.map((issue) => issue.code),
        ["INLINE_STYLE_ATTRIBUTES_EXCESSIVE", "STYLE_TAGS_EXCESSIVE"],
    );
});

test("buildInlineCssIssues stays silent when counts are within thresholds", () => {
    const plugin = createPlugin({ maxInlineStyleAttributes: 3, maxStyleTags: 2 });

    const issues = callPrivateMethod<
        [
            {
                inlineStyleAttributeCount: number;
                styleTagCount: number;
                stylesheets: StylesheetRef[];
            },
        ],
        CssIssue[]
    >(plugin, "buildInlineCssIssues", {
        inlineStyleAttributeCount: 3,
        styleTagCount: 2,
        stylesheets: [],
    });

    assert.deepEqual(issues, []);
});
