import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CspInventoryPlugin } from "../src/plugins/CspInventoryPlugin.js";

describe("CspInventoryPlugin", () => {
    describe("Plugin Configuration", () => {
        it("should use default options when none provided", () => {
            const plugin = new CspInventoryPlugin();

            assert.equal(plugin.name, "csp-inventory");
            assert.deepEqual(plugin.phases, ["beforeGoto", "afterGoto", "finally"]);
        });

        it("should accept custom options", () => {
            const plugin = new CspInventoryPlugin({ maxExampleUrls: 5 });

            assert.equal(plugin.name, "csp-inventory");
            // maxExampleUrls is private, but we can verify the plugin was created successfully
            assert.ok(plugin);
        });

        it("should apply to non-download contexts", () => {
            const plugin = new CspInventoryPlugin();

            const mockContext = { download: false } as any;
            assert.equal(plugin.applies(mockContext), true);

            const mockDownloadContext = { download: true } as any;
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
            } as any;

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
            } as any;

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
    });
});
