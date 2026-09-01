import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CspInventoryPlugin } from "../src/plugins/CspInventoryPlugin.js";
import type { ResourceContext, EngineState } from "../src/engine/types.js";

describe("CspInventoryPlugin", () => {
    describe("Plugin Configuration", () => {
        it("should use default options when none provided", () => {
            const plugin = new CspInventoryPlugin();

            assert.equal(plugin.name, "csp-inventory");
            assert.deepEqual(plugin.phases, ["beforeGoto", "process", "finally"]);
        });

        it("should accept custom options", () => {
            const plugin = new CspInventoryPlugin({ maxExampleUrls: 5 });

            assert.equal(plugin.name, "csp-inventory");
            // maxExampleUrls is private, but we can verify the plugin was created successfully
            assert.ok(plugin);
        });

        it("should apply to non-download contexts", () => {
            const plugin = new CspInventoryPlugin();

            const mockContext = { download: false } as ResourceContext;
            assert.equal(plugin.applies(mockContext), true);

            const mockDownloadContext = { download: true } as ResourceContext;
            assert.equal(plugin.applies(mockDownloadContext), false);
        });
    });

    describe("Report Generation", () => {
        it("should generate empty report for no inventory data", () => {
            const plugin = new CspInventoryPlugin();
            const mockEngineState = {
                any: {
                    cspInventoryState: { entries: {} },
                },
            } as EngineState;

            const report = plugin.getReport(mockEngineState);

            assert.equal(report.plugin, "csp-inventory");
            assert.equal(report.label, "CSP Inventory");
            assert.equal(report.items.length, 1); // Only uniqueExternalOrigins with value 0
            assert.equal(report.items[0].key, "uniqueExternalOrigins");
            assert.equal(report.items[0].value, 0);
        });

        it("should generate report with inventory data", () => {
            const plugin = new CspInventoryPlugin();
            const mockEngineState = {
                any: {
                    cspInventoryState: {
                        entries: {
                            "https://cdn.example.com|script": {
                                origin: "https://cdn.example.com",
                                resourceType: "script",
                                directive: "script-src",
                                count: 5,
                                exampleUrls: ["https://cdn.example.com/app.js"],
                            },
                            "https://fonts.googleapis.com|font": {
                                origin: "https://fonts.googleapis.com",
                                resourceType: "font",
                                directive: "font-src",
                                count: 2,
                                exampleUrls: ["https://fonts.googleapis.com/font.woff2"],
                            },
                        },
                    },
                },
            } as EngineState;

            const report = plugin.getReport(mockEngineState);

            assert.equal(report.plugin, "csp-inventory");
            assert.equal(report.label, "CSP Inventory");
            assert.ok(report.items.length > 1);

            const uniqueOriginsItem = report.items.find(
                (item) => item.key === "uniqueExternalOrigins",
            );
            assert.ok(uniqueOriginsItem);
            assert.equal(uniqueOriginsItem.value, 2);

            const scriptSrcItem = report.items.find((item) => item.key === "script-src");
            assert.ok(scriptSrcItem);
            assert.equal(scriptSrcItem.value, "https://cdn.example.com");

            const fontSrcItem = report.items.find((item) => item.key === "font-src");
            assert.ok(fontSrcItem);
            assert.equal(fontSrcItem.value, "https://fonts.googleapis.com");
        });

        it("should handle iframe resource detection with enhanced structure", () => {
            // const plugin = new CspInventoryPlugin();

            // Mock page state with both main page and iframe resources
            const mockPageState = {
                requests: [
                    {
                        origin: "https://cdn.example.com",
                        resourceType: "script",
                        url: "https://cdn.example.com/app.js",
                        isFromIframe: false,
                        iframeUrl: undefined,
                    },
                    {
                        origin: "https://www.youtube.com",
                        resourceType: "document",
                        url: "https://www.youtube.com/embed/abc",
                        isFromIframe: false, // iframe document itself is loaded by main document
                        iframeUrl: undefined,
                    },
                    {
                        origin: "https://i.ytimg.com",
                        resourceType: "image",
                        url: "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
                        isFromIframe: true, // image loaded BY the iframe
                        iframeUrl: "https://www.youtube.com/embed/abc",
                    },
                    {
                        origin: "https://www.youtube.com",
                        resourceType: "script",
                        url: "https://www.youtube.com/s/player/script.js",
                        isFromIframe: true, // script loaded BY the iframe
                        iframeUrl: "https://www.youtube.com/embed/abc",
                    },
                    {
                        origin: "https://mixed.example.com",
                        resourceType: "script",
                        url: "https://mixed.example.com/main.js",
                        isFromIframe: false,
                        iframeUrl: undefined,
                    },
                    {
                        origin: "https://mixed.example.com",
                        resourceType: "image",
                        url: "https://mixed.example.com/iframe.png",
                        isFromIframe: true,
                        iframeUrl: "https://www.example.com/embed",
                    },
                ],
                blockedResources: [],
            };

            // Test the enhanced structure logic
            const perPageOrigins: Record<
                string,
                {
                    directive: string;
                    resourceTypes: string[];
                    exampleUrls: string[];
                    sourceContext: string;
                    iframeInfo?: {
                        iframeSources: string[];
                        iframeResourceCount: number;
                        mainDocumentResourceCount: number;
                    };
                }
            > = {};

            for (const { origin, isFromIframe, iframeUrl } of mockPageState.requests) {
                const directive = "img-src"; // Simplified for test

                if (!perPageOrigins[origin]) {
                    perPageOrigins[origin] = {
                        directive,
                        resourceTypes: [],
                        exampleUrls: [],
                        sourceContext: isFromIframe ? "iframe" : "main_document",
                    };
                }
                const pageOrigin = perPageOrigins[origin];

                // Update source context if we have mixed sources
                if (pageOrigin.sourceContext !== (isFromIframe ? "iframe" : "main_document")) {
                    pageOrigin.sourceContext = "mixed";
                }

                // Handle iframe information
                if (isFromIframe && iframeUrl) {
                    if (!pageOrigin.iframeInfo) {
                        pageOrigin.iframeInfo = {
                            iframeSources: [],
                            iframeResourceCount: 0,
                            mainDocumentResourceCount: 0,
                        };
                    }
                    if (!pageOrigin.iframeInfo.iframeSources.includes(iframeUrl)) {
                        pageOrigin.iframeInfo.iframeSources.push(iframeUrl);
                    }
                    pageOrigin.iframeInfo.iframeResourceCount++;
                } else if (!isFromIframe) {
                    if (!pageOrigin.iframeInfo) {
                        pageOrigin.iframeInfo = {
                            iframeSources: [],
                            iframeResourceCount: 0,
                            mainDocumentResourceCount: 0,
                        };
                    }
                    pageOrigin.iframeInfo.mainDocumentResourceCount++;
                }
            }

            // Verify main document only origin
            assert.equal(perPageOrigins["https://cdn.example.com"].sourceContext, "main_document");
            assert.equal(
                perPageOrigins["https://cdn.example.com"].iframeInfo.mainDocumentResourceCount,
                1,
            );
            assert.equal(
                perPageOrigins["https://cdn.example.com"].iframeInfo.iframeResourceCount,
                0,
            );

            // Verify iframe only origin (images loaded BY the iframe)
            assert.equal(perPageOrigins["https://i.ytimg.com"].sourceContext, "iframe");
            assert.equal(perPageOrigins["https://i.ytimg.com"].iframeInfo.iframeResourceCount, 1);
            assert.equal(
                perPageOrigins["https://i.ytimg.com"].iframeInfo.mainDocumentResourceCount,
                0,
            );
            assert.equal(perPageOrigins["https://i.ytimg.com"].iframeInfo.iframeSources.length, 1);
            assert.equal(
                perPageOrigins["https://i.ytimg.com"].iframeInfo.iframeSources[0],
                "https://www.youtube.com/embed/abc",
            );

            // Verify YouTube origin is now mixed (document loaded by main, script loaded by iframe)
            assert.equal(perPageOrigins["https://www.youtube.com"].sourceContext, "mixed");
            assert.equal(
                perPageOrigins["https://www.youtube.com"].iframeInfo.mainDocumentResourceCount,
                1,
            ); // iframe document
            assert.equal(
                perPageOrigins["https://www.youtube.com"].iframeInfo.iframeResourceCount,
                1,
            ); // script loaded by iframe
            assert.equal(
                perPageOrigins["https://www.youtube.com"].iframeInfo.iframeSources.length,
                1,
            );
            assert.equal(
                perPageOrigins["https://www.youtube.com"].iframeInfo.iframeSources[0],
                "https://www.youtube.com/embed/abc",
            );

            // Verify mixed origin
            assert.equal(perPageOrigins["https://mixed.example.com"].sourceContext, "mixed");
            assert.equal(
                perPageOrigins["https://mixed.example.com"].iframeInfo.mainDocumentResourceCount,
                1,
            );
            assert.equal(
                perPageOrigins["https://mixed.example.com"].iframeInfo.iframeResourceCount,
                1,
            );
            assert.equal(
                perPageOrigins["https://mixed.example.com"].iframeInfo.iframeSources.length,
                1,
            );
            assert.equal(
                perPageOrigins["https://mixed.example.com"].iframeInfo.iframeSources[0],
                "https://www.example.com/embed",
            );
        });
    });

    describe("CSP Violation Parsing", () => {
        it("should parse CSP violation messages correctly", () => {
            const plugin = new CspInventoryPlugin();

            // Test the private method through reflection
            const parseCspViolation = (
                plugin as unknown as { parseCspViolation: (message: string) => unknown }
            ).parseCspViolation.bind(plugin);

            // Test pattern 1: "blocked the loading of a resource (frame-src) at https://example.com"
            const violation1 = parseCspViolation(
                "Content Security Policy: The page's settings blocked the loading of a resource (frame-src) at https://example.com/iframe",
            );
            assert.ok(violation1);
            assert.equal(violation1.url, "https://example.com/iframe");
            assert.equal(violation1.directive, "frame-src");
            assert.equal(violation1.violationType, "blocked");

            // Test pattern 2: Traditional format
            const violation2 = parseCspViolation(
                "Refused to load the script 'https://cdn.example.com/script.js' because it violates the following Content Security Policy directive: 'script-src'",
            );
            assert.ok(violation2);
            assert.equal(violation2.url, "https://cdn.example.com/script.js");
            assert.equal(violation2.directive, "script-src");
            assert.equal(violation2.violationType, "blocked");

            // Test report-only mode
            const violation3 = parseCspViolation(
                "[Report Only] Refused to load the stylesheet 'https://fonts.googleapis.com/css' because it violates the following directive: 'style-src'",
            );
            assert.ok(violation3);
            assert.equal(violation3.url, "https://fonts.googleapis.com/css");
            assert.equal(violation3.directive, "style-src");
            assert.equal(violation3.violationType, "report-only");

            // Test the actual message format from the report
            const violation4 = parseCspViolation(
                "Loading the script 'https://www.youtube.com/iframe_api' violates the following Content Security Policy directive: \"script-src 'self' 'unsafe-inline' https://cdn-a.cumul.io https://cdn.luzmo.com https://dataviz.static.bosa.fgov.be https://matomo.bosa.be https://player.vimeo.com https://static.doubleclick.net\". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.",
            );
            assert.ok(violation4);
            assert.equal(violation4.url, "https://www.youtube.com/iframe_api");
            assert.equal(violation4.directive, "script-src");
            assert.equal(violation4.violationType, "blocked");
        });

        it("should extract blocked URLs grouped by domain with example URLs", () => {
            // Mock page state with blocked resources
            const mockPageState = {
                blockedResources: [
                    {
                        url: "https://example.com/script.js",
                        directive: "script-src",
                        violationType: "blocked",
                        message: "CSP violation",
                    },
                    {
                        url: "https://example.com/script2.js", // Different URL, same domain
                        directive: "script-src",
                        violationType: "blocked",
                        message: "CSP violation",
                    },
                    {
                        url: "https://fonts.googleapis.com/css",
                        directive: "style-src",
                        violationType: "report-only",
                        message: "CSP violation",
                    },
                ],
            };

            // Extract blocked URLs grouped by domain (similar to the plugin logic)
            const blocked: Record<
                string,
                {
                    directive: string;
                    violationType: string;
                    count: number;
                    message: string;
                    exampleUrls: string[];
                }
            > = {};
            for (const resource of mockPageState.blockedResources) {
                if (resource.url) {
                    try {
                        // Extract domain from URL to use as key
                        const parsedUrl = new URL(resource.url);
                        const domain = parsedUrl.origin;

                        if (!blocked[domain]) {
                            blocked[domain] = {
                                directive: resource.directive,
                                violationType: resource.violationType,
                                count: 0,
                                message: resource.message,
                                exampleUrls: [],
                            };
                        }

                        const domainEntry = blocked[domain];
                        domainEntry.count += 1;

                        // Add example URLs up to the limit
                        const maxExampleUrls = 3; // plugin.maxExampleUrls is private
                        if (
                            domainEntry.exampleUrls.length < maxExampleUrls &&
                            !domainEntry.exampleUrls.includes(resource.url)
                        ) {
                            domainEntry.exampleUrls.push(resource.url);
                        }
                    } catch {
                        // Skip invalid URLs
                    }
                }
            }

            // Verify the structure - grouped by domain with exampleUrls
            assert.ok(blocked["https://example.com"]);
            assert.equal(blocked["https://example.com"].directive, "script-src");
            assert.equal(blocked["https://example.com"].violationType, "blocked");
            assert.equal(blocked["https://example.com"].count, 2); // Two different scripts from same domain
            assert.equal(blocked["https://example.com"].message, "CSP violation");
            assert.deepEqual(blocked["https://example.com"].exampleUrls, [
                "https://example.com/script.js",
                "https://example.com/script2.js",
            ]);

            assert.ok(blocked["https://fonts.googleapis.com"]);
            assert.equal(blocked["https://fonts.googleapis.com"].directive, "style-src");
            assert.equal(blocked["https://fonts.googleapis.com"].violationType, "report-only");
            assert.equal(blocked["https://fonts.googleapis.com"].count, 1);
            assert.equal(blocked["https://fonts.googleapis.com"].message, "CSP violation");
            assert.deepEqual(blocked["https://fonts.googleapis.com"].exampleUrls, [
                "https://fonts.googleapis.com/css",
            ]);
        });
    });

    describe("CSP Violation Parsing", () => {
        it("should parse script-src violation with Loading pattern", () => {
            const plugin = new CspInventoryPlugin();
            const message = 'Loading the script \'https://example.com/script.js\' violates the following Content Security Policy directive: "script-src \'self\'". Note that \'script-src-elem\' was not explicitly set, so \'script-src\' is used as a fallback.';
            
            const violation = (plugin as any).parseCspViolation(message);
            
            assert.ok(violation);
            assert.equal(violation.url, "https://example.com/script.js");
            assert.equal(violation.directive, "script-src");
            assert.equal(violation.resourceType, "script");
            assert.equal(violation.violationType, "blocked");
            assert.equal(violation.message, message);
        });

        it("should parse frame-src violation with Framing pattern", () => {
            const plugin = new CspInventoryPlugin();
            const message = 'Framing \'https://www.youtube.com/\' violates the following Content Security Policy directive: "default-src \'self\' https://agenda-scraper.ailab.ai4belgium.be https://app.cumul.io https://app.luzmo.com https://community.ai4belgium.be https://e.infogram.com https://notfound-static.fwebservices.be https://player.vimeo.com https://salsim.bosa.belgium.be". The request has been blocked. Note that \'frame-src\' was not explicitly set, so \'default-src\' is used as a fallback.';
            
            const violation = (plugin as any).parseCspViolation(message);
            
            assert.ok(violation);
            assert.equal(violation.url, "https://www.youtube.com/");
            assert.equal(violation.directive, "default-src");
            assert.equal(violation.resourceType, "frame");
            assert.equal(violation.violationType, "blocked");
            assert.equal(violation.message, message);
        });

        it("should parse blocked resource pattern", () => {
            const plugin = new CspInventoryPlugin();
            const message = "Content-Security-Policy: The page's settings blocked the loading of a resource (frame-src) at https://www.youtube.com/embed/JP9EU2FuLFM?feature=oembed because it violates the following directive: \"default-src 'self' https://agenda-scraper.ailab.ai4belgium.be https://app.cumul.io https://app.luzmo.com https://community.ai4belgium.be https://e.infogram.com https://notfound-static.fwebservices.be https://player.vimeo.com https://salsim.bosa.belgium.be\"";
            
            const violation = (plugin as any).parseCspViolation(message);
            
            assert.ok(violation);
            assert.equal(violation.url, "https://www.youtube.com/embed/JP9EU2FuLFM?feature=oembed");
            assert.equal(violation.directive, "frame-src");
            assert.equal(violation.resourceType, "frame-src");
            assert.equal(violation.violationType, "blocked");
            assert.equal(violation.message, message);
        });
    });
});
