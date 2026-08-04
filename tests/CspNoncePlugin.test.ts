import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CspNoncePlugin } from "../src/plugins/CspNoncePlugin.js";
import type { ResourceContext, EngineState } from "../src/engine/types.js";

describe("CspNoncePlugin", () => {
    describe("CSP Nonce Parsing", () => {
        it("should parse script-src nonces correctly", () => {
            const plugin = new CspNoncePlugin();
            const cspHeader = "script-src 'self' 'nonce-abc123' 'nonce-def456'; style-src 'self'";

            // Access private method for testing
            const result = (plugin as unknown as { parseCspNonces: (header: string) => { scriptNonces: string[]; styleNonces: string[] } }).parseCspNonces(cspHeader);

            assert.deepEqual(result.scriptNonces, ["abc123", "def456"]);
            assert.deepEqual(result.styleNonces, []);
        });

        it("should parse style-src nonces correctly", () => {
            const plugin = new CspNoncePlugin();
            const cspHeader = "style-src 'self' 'nonce-xyz789'; script-src 'self'";

            const result = (plugin as unknown as { parseCspNonces: (header: string) => { scriptNonces: string[]; styleNonces: string[] } }).parseCspNonces(cspHeader);

            assert.deepEqual(result.scriptNonces, []);
            assert.deepEqual(result.styleNonces, ["xyz789"]);
        });

        it("should parse default-src nonces for both script and style", () => {
            const plugin = new CspNoncePlugin();
            const cspHeader = "default-src 'self' 'nonce-universal123'";

            const result = (plugin as unknown as { parseCspNonces: (header: string) => { scriptNonces: string[]; styleNonces: string[] } }).parseCspNonces(cspHeader);

            assert.deepEqual(result.scriptNonces, ["universal123"]);
            assert.deepEqual(result.styleNonces, ["universal123"]);
        });

        it("should handle mixed directives correctly", () => {
            const plugin = new CspNoncePlugin();
            const cspHeader =
                "default-src 'self' 'nonce-default123'; script-src 'self' 'nonce-script456'; style-src 'self' 'nonce-style789'";

            const result = (plugin as unknown as { parseCspNonces: (header: string) => { scriptNonces: string[]; styleNonces: string[] } }).parseCspNonces(cspHeader);

            assert.deepEqual(result.scriptNonces, ["default123", "script456"]);
            assert.deepEqual(result.styleNonces, ["default123", "style789"]);
        });

        it("should handle empty or invalid CSP headers", () => {
            const plugin = new CspNoncePlugin();

            const result1 = (plugin as unknown as { parseCspNonces: (header: string) => { scriptNonces: string[]; styleNonces: string[] } }).parseCspNonces("");
            assert.deepEqual(result1.scriptNonces, []);
            assert.deepEqual(result1.styleNonces, []);

            const result2 = (plugin as unknown as { parseCspNonces: (header: string) => { scriptNonces: string[]; styleNonces: string[] } }).parseCspNonces("invalid-directive");
            assert.deepEqual(result2.scriptNonces, []);
            assert.deepEqual(result2.styleNonces, []);
        });

        it("should handle malformed nonce values", () => {
            const plugin = new CspNoncePlugin();
            const cspHeader =
                "script-src 'self' 'nonce-valid123' nonce-invalid 'nonce-' 'nonce-valid456'";

            const result = (plugin as unknown as { parseCspNonces: (header: string) => { scriptNonces: string[]; styleNonces: string[] } }).parseCspNonces(cspHeader);

            // Should only extract properly formatted nonces
            assert.deepEqual(result.scriptNonces, ["valid123", "valid456"]);
        });
    });

    describe("Nonce Statistics", () => {
        it("should calculate statistics correctly", () => {
            const plugin = new CspNoncePlugin();
            const mockState = {
                nonces: {
                    "https://example.com/page1": [
                        {
                            nonce: "abc123",
                            directive: "script-src" as const,
                            source: "csp-header" as const,
                        },
                        {
                            nonce: "abc123",
                            directive: "script-src" as const,
                            source: "inline-element" as const,
                            elementType: "script" as const,
                        },
                    ],
                    "https://example.com/page2": [
                        {
                            nonce: "def456",
                            directive: "style-src" as const,
                            source: "csp-header" as const,
                        },
                        {
                            nonce: "wrong789",
                            directive: "style-src" as const,
                            source: "inline-element" as const,
                            elementType: "style" as const,
                        },
                    ],
                    "https://example.com/page3": [
                        {
                            nonce: "ghi789",
                            directive: "script-src" as const,
                            source: "inline-element" as const,
                            elementType: "script" as const,
                        },
                    ],
                },
            };

            const stats = (plugin as unknown as { getNonceStatistics: (state: unknown) => { totalPages: number; pagesWithNonces: number; uniqueNonces: number; totalNonceIssues: number; reusedNonces: number } }).getNonceStatistics(mockState);

            assert.equal(stats.totalPages, 3);
            assert.equal(stats.pagesWithNonces, 2); // page1 and page2 have CSP header nonces
            assert.equal(stats.uniqueNonces, 4); // abc123, def456, wrong789, ghi789
            assert.equal(stats.totalNonceIssues, 2); // wrong789 and ghi789 don't match header nonces
            assert.equal(stats.reusedNonces, 0); // no nonces are reused in this example
        });

        it("should detect reused nonces", () => {
            const plugin = new CspNoncePlugin();
            const mockState = {
                nonces: {
                    "https://example.com/page1": [
                        {
                            nonce: "reused123",
                            directive: "script-src" as const,
                            source: "csp-header" as const,
                        },
                    ],
                    "https://example.com/page2": [
                        {
                            nonce: "reused123",
                            directive: "script-src" as const,
                            source: "csp-header" as const,
                        },
                    ],
                },
            };

            const stats = (plugin as unknown as { getNonceStatistics: (state: unknown) => { totalPages: number; pagesWithNonces: number; uniqueNonces: number; totalNonceIssues: number; reusedNonces: number } }).getNonceStatistics(mockState);

            assert.equal(stats.reusedNonces, 1); // reused123 appears twice
        });

        it("should handle empty nonce data", () => {
            const plugin = new CspNoncePlugin();
            const mockState = {
                nonces: {},
            };

            const stats = (plugin as unknown as { getNonceStatistics: (state: unknown) => { totalPages: number; pagesWithNonces: number; uniqueNonces: number; totalNonceIssues: number; reusedNonces: number } }).getNonceStatistics(mockState);

            assert.equal(stats.totalPages, 0);
            assert.equal(stats.pagesWithNonces, 0);
            assert.equal(stats.uniqueNonces, 0);
            assert.equal(stats.totalNonceIssues, 0);
            assert.equal(stats.reusedNonces, 0);
        });
    });

    describe("Plugin Configuration", () => {
        it("should use default options when none provided", () => {
            const plugin = new CspNoncePlugin();

            assert.equal(plugin.name, "csp-nonce");
            assert.deepEqual(plugin.phases, ["afterGoto"]);
        });

        it("should accept custom options", () => {
            const plugin = new CspNoncePlugin({ checkNonceReuse: false });

            assert.equal(plugin.name, "csp-nonce");
            // checkNonceReuse is private, but we can verify the plugin was created successfully
            assert.ok(plugin);
        });

        it("should apply to HTML contexts only", () => {
            const plugin = new CspNoncePlugin();

            const mockHtmlContext = { download: false, mime: "text/html" } as ResourceContext;
            assert.equal(plugin.applies(mockHtmlContext), true);

            const mockDownloadContext = { download: true, mime: "text/html" } as ResourceContext;
            assert.equal(plugin.applies(mockDownloadContext), false);

            const mockNonHtmlContext = { download: false, mime: "application/json" } as ResourceContext;
            assert.equal(plugin.applies(mockNonHtmlContext), false);
        });
    });

    describe("Report Generation", () => {
        it("should generate empty report for no nonce data", () => {
            const plugin = new CspNoncePlugin();
            const mockEngineState = {
                any: {
                    cspNonceState: { nonces: {} },
                },
            } as EngineState;

            const report = plugin.getReport(mockEngineState);

            assert.equal(report.plugin, "csp-nonce");
            assert.equal(report.label, "CSP Nonce Analysis");
            assert.equal(report.items.length, 0);
        });

        it("should generate report with nonce statistics", () => {
            const plugin = new CspNoncePlugin();
            const mockEngineState = {
                any: {
                    cspNonceState: {
                        nonces: {
                            "https://example.com/page1": [
                                {
                                    nonce: "abc123",
                                    directive: "script-src" as const,
                                    source: "csp-header" as const,
                                },
                            ],
                        },
                    },
                },
            } as EngineState;

            const report = plugin.getReport(mockEngineState);

            assert.equal(report.plugin, "csp-nonce");
            assert.equal(report.label, "CSP Nonce Analysis");
            assert.ok(report.items.length > 0);

            const analyzedPagesItem = report.items.find(
                (item) => item.key === "nonceAnalyzedPages",
            );
            assert.ok(analyzedPagesItem);
            assert.equal(analyzedPagesItem.value, 1);
        });
    });
});
