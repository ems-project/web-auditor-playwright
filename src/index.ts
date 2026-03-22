import { PluginRegistry } from "./engine/PluginRegistry.js";
import { CrawlerEngine } from "./engine/CrawlerEngine.js";
import { TimeUtils } from "./utils/TimeUtils.js";

import { A11yAxePlugin } from "./plugins/A11yAxePlugin.js";
import { StatsCollectorPlugin } from "./plugins/StatsCollectorPlugin.js";
import { ConsoleStatusPlugin } from "./plugins/ConsoleStatusPlugin.js";
import { SaveReportAsJsonPlugin } from "./plugins/SaveReportAsJsonPlugin.js";
import { ProcessHtmlPlugin } from "./plugins/ProcessHtmlPlugin.js";
import { DownloaderPlugin } from "./plugins/DownloaderPlugin.js";
import { CleanDownloadedPlugin } from "./plugins/CleanDownloadedPlugin.js";
import { TextExtractorPlugin } from "./plugins/TextExtractorPlugin.js";
import { PdfExtractorPlugin } from "./plugins/PdfExtractorPlugin.js";
import { DocxExtractorPlugin } from "./plugins/DocxExtractorPlugin.js";
import { TextractDownloadedExtractorPlugin } from "./plugins/TextractDownloadedExtractorPlugin.js";
import { printPluginSummaryTable } from "./engine/summaryPrinter.js";

async function main() {
    const registry = new PluginRegistry()
        .register(
            new DownloaderPlugin({
                outputDir: process.env.DOWNLOAD_OUTPUT_DIR ?? "./reports/downloads",
                keepFiles: process.env.DOWNLOAD_KEEP_FILES === "true",
            }),
        )
        .register(new StatsCollectorPlugin({ rollingWindowSize: 12 }))
        .register(
            new ConsoleStatusPlugin({
                refreshEveryMs: 2000,
                singleLine: true,
            }),
        )
        .register(
            new SaveReportAsJsonPlugin({
                outputDir: process.env.REPORT_OUTPUT_DIR ?? "./reports",
            }),
        )
        .register(new ProcessHtmlPlugin())
        .register(
            new A11yAxePlugin({
                relevantTags: (process.env.A11Y_AXE_RELEVANT_TAGS ?? "EN-301-549")
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
            }),
        )
        .register(
            new TextExtractorPlugin({
                maxExtractedChars: Number(process.env.DOWNLOAD_MAX_EXTRACTED_CHARS ?? 200000),
                maxLinks: Number(process.env.DOWNLOAD_MAX_LINKS ?? 500),
                maxFileSizeBytes: Number(
                    process.env.DOWNLOAD_MAX_TEXT_READ_BYTES ?? 5 * 1024 * 1024,
                ),
            }),
        )
        .register(
            new PdfExtractorPlugin({
                maxExtractedChars: Number(process.env.DOWNLOAD_MAX_EXTRACTED_CHARS ?? 200000),
                maxLinks: Number(process.env.DOWNLOAD_MAX_LINKS ?? 500),
                maxPages: Number(process.env.DOWNLOAD_MAX_PDF_PAGES ?? 200),
                maxFileSizeBytes: Number(
                    process.env.DOWNLOAD_MAX_TEXT_READ_BYTES ?? 5 * 1024 * 1024,
                ),
            }),
        )
        .register(
            new DocxExtractorPlugin({
                maxExtractedChars: Number(process.env.DOWNLOAD_MAX_EXTRACTED_CHARS ?? 200000),
                maxLinks: Number(process.env.DOWNLOAD_MAX_LINKS ?? 500),
                maxFileSizeBytes: Number(
                    process.env.DOWNLOAD_MAX_TEXT_READ_BYTES ?? 5 * 1024 * 1024,
                ),
            }),
        )
        .register(
            new TextractDownloadedExtractorPlugin({
                maxExtractedChars: Number(process.env.DOWNLOAD_MAX_EXTRACTED_CHARS ?? 200000),
                maxLinks: Number(process.env.DOWNLOAD_MAX_LINKS ?? 500),
                maxFileSizeBytes: Number(
                    process.env.DOWNLOAD_MAX_BINARY_READ_BYTES ?? 20 * 1024 * 1024,
                ),
            }),
        )
        .register(new CleanDownloadedPlugin());

    const outputFormat = process.env.OUTPUT_FORMAT ?? "both";
    const engine = new CrawlerEngine(
        {
            startUrl: process.env.START_URL || "https://example.org",
            sameOriginOnly: (process.env.SAME_ORIGIN_ONLY ?? "true") === "true",
            maxPages: Number(process.env.MAX_PAGES ?? 50),
            maxDepth: Number(process.env.MAX_DEPTH ?? 3),
            concurrency: Number(process.env.CONCURRENCY ?? 3),
            navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 30000),
            rateLimitMs: Number(process.env.RATE_LIMIT_MS ?? 500),
        },
        registry,
    );

    const state = await engine.run();
    const pluginSummaries = registry.getSummaries();
    pluginSummaries.push({
        plugin: "engine",
        treatedUrls: state.seen.size,
        infos: state.infoCount,
        errors: state.errorCount,
        warnings: state.warningCount,
    });
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - state.startedAt.getTime();

    if (outputFormat === "table" || outputFormat === "both") {
        console.log("\n\n=== Audit completed ===\n");
        console.log("  - Origin     : " + state.origin);
        console.log("  - Started at : " + state.startedAt.toISOString());
        console.log("  - Ended at   : " + endedAt.toISOString());
        console.log("  - Duration   : " + TimeUtils.formatHuman(durationMs));
        console.log("  - URLs seen  : " + state.seen.size);
        printPluginSummaryTable(pluginSummaries);
    }

    if (outputFormat === "json" || outputFormat === "both") {
        const report = {
            state: {
                startedAt: state.startedAt.toISOString(),
                endedAt: endedAt.toISOString(),
                durationMs: durationMs,
                origin: state.origin,
                seenCount: state.seen.size,
            },
            plugins: pluginSummaries,
            findings: state.findings,
        };
        console.log(JSON.stringify(report, null, 4));
    }

    const hasErrors = pluginSummaries.reduce((sum, p) => sum + p.errors, 0) > 0;
    process.exit(hasErrors ? 2 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
