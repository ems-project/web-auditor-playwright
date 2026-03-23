import fs from "node:fs/promises";
import path from "node:path";

import { PluginRegistry } from "./engine/PluginRegistry.js";
import { CrawlerEngine } from "./engine/CrawlerEngine.js";
import { printPluginSummaryTable } from "./engine/summaryPrinter.js";

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
import { TextractExtractorPlugin } from "./plugins/TextractExtractorPlugin.js";
import { SecurityHeadersPlugin } from "./plugins/SecurityHeadersPlugin.js";
import { LanguageDetectionPlugin } from "./plugins/LanguageDetectionPlugin.js";
import { StandardUrlsAuditPlugin } from "./plugins/StandardUrlsAuditPlugin.js";
import { ConsolePlugin } from "./plugins/ConsolePlugin.js";
import { PdfAccessibilityPlugin } from "./plugins/PdfAccessibilityPlugin.js";
import { PerformanceMetricsPlugin } from "./plugins/PerformanceMetricsPlugin.js";

async function main() {
    const reportOutputDir = process.env.REPORT_OUTPUT_DIR ?? "./reports";
    const websiteId = process.env.WEBSITE_ID ?? "my_website";
    const registry = new PluginRegistry()
        .register(new StatsCollectorPlugin({ rollingWindowSize: 12 }))
        .register(
            new ConsoleStatusPlugin({
                refreshEveryMs: 2000,
                singleLine: true,
            }),
        )
        .register(
            new SaveReportAsJsonPlugin({
                outputDir: path.join(reportOutputDir, websiteId),
            }),
        )
        .register(
            new PerformanceMetricsPlugin({
                auditOnlyStartUrl: (process.env.PERF_AUDIT_ONLY_START_URL ?? "false") === "true",
                slowResourceThresholdMs: Number(
                    process.env.PERF_SLOW_RESOURCE_THRESHOLD_MS ?? 1000,
                ),
                largeResourceThresholdBytes: Number(
                    process.env.PERF_LARGE_RESOURCE_THRESHOLD_BYTES ?? 500000,
                ),
                maxReportedResources: Number(process.env.PERF_MAX_REPORTED_RESOURCES ?? 10),
                highResourceCountThreshold: Number(
                    process.env.PERF_HIGH_RESOURCE_COUNT_THRESHOLD ?? 100,
                ),
                largeTransferThresholdBytes: Number(
                    process.env.PERF_LARGE_TRANSFER_THRESHOLD_BYTES ?? 3000000,
                ),
                slowLoadThresholdMs: Number(process.env.PERF_SLOW_LOAD_THRESHOLD_MS ?? 3000),
                slowDomContentLoadedThresholdMs: Number(
                    process.env.PERF_SLOW_DOMCONTENTLOADED_THRESHOLD_MS ?? 1500,
                ),
            }),
        )
        .register(
            new ConsolePlugin({
                auditOnlyStartUrl: process.env.CONSOLE_AUDIT_ONLY_START_URL === "true",
                includeWarnings: (process.env.CONSOLE_INCLUDE_WARNINGS ?? "true") === "true",
                ignoredTextPatterns: (
                    process.env.CONSOLE_IGNORED_PATTERNS ??
                    "favicon\\.ico,chrome-extension:\\/\\/,Failed to load resource: .*"
                )
                    .split(",")
                    .map((p) => p.trim())
                    .filter((p) => p.length > 0)
                    .map((p) => new RegExp(p, "i")),
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
            new DownloaderPlugin({
                outputDir: process.env.DOWNLOAD_OUTPUT_DIR ?? "./downloads",
                keepFiles: process.env.DOWNLOAD_KEEP_FILES === "true",
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
            new PdfAccessibilityPlugin({
                minExtractedChars: Number(process.env.PDF_A11Y_MIN_EXTRACTED_CHARS ?? 30),
                maxPages: Number(process.env.PDF_A11Y_MAX_PAGES ?? 200),
                lowTextThreshold: Number(process.env.PDF_A11Y_LOW_TEXT_THRESHOLD ?? 20),
                warnOnMissingBookmarksMinPages: Number(
                    process.env.PDF_A11Y_WARN_MISSING_BOOKMARKS_MIN_PAGES ?? 5,
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
            new SecurityHeadersPlugin({
                auditOnlyStartUrl: (process.env.SECURITY_ONLY_START_URL ?? "true") === "true",
            }),
        )
        .register(
            new LanguageDetectionPlugin({
                minLength: Number(process.env.LANGUAGE_DETECTION_MIN_LENGTH ?? 100),
                maxSampleLength: Number(process.env.LANGUAGE_DETECTION_MAX_SAMPLE_LENGTH ?? 5000),
                overwriteExistingLocale: process.env.LANGUAGE_DETECTION_OVERWRITE === "true",
            }),
        )
        .register(new StandardUrlsAuditPlugin())
        .register(new CleanDownloadedPlugin());

    if (process.env.DOWNLOAD_ENABLE_TEXTRACT_FALLBACK ?? "true") {
        registry.register(
            new TextractExtractorPlugin({
                maxExtractedChars: Number(process.env.DOWNLOAD_MAX_EXTRACTED_CHARS ?? 200000),
                maxLinks: Number(process.env.DOWNLOAD_MAX_LINKS ?? 500),
                maxFileSizeBytes: Number(
                    process.env.DOWNLOAD_MAX_BINARY_READ_BYTES ?? 20 * 1024 * 1024,
                ),
            }),
        );
    }

    const outputFormat = process.env.OUTPUT_FORMAT ?? "table";
    const engine = new CrawlerEngine(
        {
            startUrl: process.env.START_URL || "https://example.org",
            sameOriginOnly: (process.env.SAME_ORIGIN_ONLY ?? "true") === "true",
            maxPages: Number(process.env.MAX_PAGES ?? 50),
            maxDepth: Number(process.env.MAX_DEPTH ?? 3),
            concurrency: Number(process.env.CONCURRENCY ?? 3),
            navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 30000),
            userAgent: process.env.USER_AGENT,
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
    const firstSecurityHeaderScore =
        state.findings.filter((f) => f.code === "SECURITY_HEADERS_SCORE").at(0) ?? 0;
    let securityGrade: string = "N/A";
    let securityScore: string = "N/A";
    if (firstSecurityHeaderScore) {
        securityGrade = String(firstSecurityHeaderScore.data?.grade ?? "N/A");
        securityScore = String(firstSecurityHeaderScore.data?.score ?? "N/A");
    }

    if (outputFormat === "table" || outputFormat === "both") {
        console.log("\n\n=== Audit completed ===\n");
        console.log("  - Origin         : " + state.origin);
        console.log("  - Started at     : " + state.startedAt.toISOString());
        console.log("  - Ended at       : " + endedAt.toISOString());
        console.log("  - Duration       : " + TimeUtils.formatHuman(durationMs));
        console.log("  - URLs seen      : " + state.seen.size);
        console.log(`  - Security grade : ${securityGrade} (${securityScore})%`);
        printPluginSummaryTable(pluginSummaries);
    }

    const report = {
        state: {
            startedAt: state.startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: durationMs,
            origin: state.origin,
            seenCount: state.seen.size,
            securityGrade: securityGrade,
            securityScore: securityScore,
        },
        plugins: pluginSummaries,
        findings: state.findings,
        inventory: state.inventory,
    };
    const jsonReport = JSON.stringify(report, null, 4);
    if (outputFormat === "json" || outputFormat === "both") {
        console.log(jsonReport);
    }
    await fs.writeFile(path.join(reportOutputDir, `${websiteId}.json`), jsonReport, "utf-8");

    const hasErrors = pluginSummaries.reduce((sum, p) => sum + p.errors, 0) > 0;
    process.exit(hasErrors ? 2 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
