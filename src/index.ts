import fs from "node:fs/promises";
import path from "node:path";

import { PluginRegistry } from "./engine/PluginRegistry.js";
import { CrawlerEngine } from "./engine/CrawlerEngine.js";
import { GracefulStopController } from "./engine/GracefulStopController.js";
import { printPluginSummaryTable, printReports } from "./engine/outputPrinters.js";

import { TimeUtils } from "./utils/TimeUtils.js";

import { A11yAxePlugin } from "./plugins/A11yAxePlugin.js";
import { StatsCollectorPlugin } from "./plugins/StatsCollectorPlugin.js";
import { ConsoleStatusPlugin } from "./plugins/ConsoleStatusPlugin.js";
import { SaveReportAsJsonPlugin } from "./plugins/SaveReportAsJsonPlugin.js";
import { HtmlProcessorPlugin } from "./plugins/HtmlProcessorPlugin.js";
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
import { TlsCertificatePlugin } from "./plugins/TlsCertificatePlugin.js";
import { IpSupportPlugin } from "./plugins/IpSupportPlugin.js";
import { TextUtils } from "./utils/TextUtils.js";
import { XlsxExporter } from "./reporting/XlsxExporter.js";
import { Report } from "./engine/types.js";

async function main() {
    const reportOutputDir = process.env.REPORT_OUTPUT_DIR ?? "./reports";
    const websiteId = process.env.WEBSITE_ID ?? "my_website";
    const urlAllowlist = TextUtils.parseRegexList(process.env.URL_ALLOWLIST_REGEX);
    const urlBlocklist = TextUtils.parseRegexList(process.env.URL_BLOCKLIST_REGEX);
    const findingCodesBlocklist = (process.env.FINDING_CODES_BLOCKLIST ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    const registry = new PluginRegistry({
        disabledPlugins: (process.env.DISABLED_PLUGINS ?? "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
    })
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
                ignoredTextPatterns: TextUtils.parseRegexList(
                    process.env.CONSOLE_IGNORED_PATTERNS ??
                        "favicon\\.ico,chrome-extension:\\/\\/,Failed to load resource: .*",
                ),
            }),
        )
        .register(new HtmlProcessorPlugin())
        .register(
            new A11yAxePlugin({
                relevantTags: (process.env.A11Y_AXE_RELEVANT_TAGS ?? "EN-301-549,best-practice")
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
            new TlsCertificatePlugin({
                auditOnlyStartUrl: (process.env.TLS_CERT_AUDIT_ONLY_START_URL ?? "true") === "true",
                warnIfExpiresInDays: Number(process.env.TLS_CERT_WARN_IF_EXPIRES_IN_DAYS ?? 30),
                timeoutMs: Number(process.env.TLS_CERT_TIMEOUT_MS ?? 10000),
                minAcceptedTlsVersion: (process.env.TLS_CERT_MIN_TLS_VERSION ?? "TLSv1.2") as
                    | "TLSv1.2"
                    | "TLSv1.3",
                minScoreForError: Number(process.env.TLS_CERT_MIN_SCORE_FOR_ERROR ?? 50),
            }),
        )
        .register(
            new IpSupportPlugin({
                auditOnlyStartUrl:
                    (process.env.IP_SUPPORT_AUDIT_ONLY_START_URL ?? "true") === "true",
                timeoutMs: Number(process.env.IP_SUPPORT_TIMEOUT_MS ?? 5000),
                testConnectivity: (process.env.IP_SUPPORT_TEST_CONNECTIVITY ?? "false") === "true",
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
            ignoreHttpsError: (process.env.IGNORE_HTTPS_ERRORS ?? "false") === "true",
            maxPages: Number(process.env.MAX_PAGES ?? 50),
            maxDepth: Number(process.env.MAX_DEPTH ?? 3),
            concurrency: Number(process.env.CONCURRENCY ?? 3),
            navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 30000),
            userAgent: process.env.USER_AGENT,
            rateLimitMs: Number(process.env.RATE_LIMIT_MS ?? 500),
            urlAllowlist: urlAllowlist,
            urlBlocklist: urlBlocklist,
        },
        registry,
    );

    const stopController = new GracefulStopController({
        onConfirmedStop: () => engine.requestStop(),
        isStopAlreadyRequested: () => engine.isStopRequested(),
    });

    stopController.start();
    let state;
    try {
        state = await engine.run();
    } finally {
        stopController.stop();
    }
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - state.startedAt.getTime();

    const pluginSummaries = registry.getSummaries();
    const engineReport = {
        plugin: "engine",
        label: "Crawler",
        items: [
            {
                key: "origin",
                label: "Origin",
                value: state.origin,
            },
            {
                key: "startedAt",
                label: "Started at",
                value: state.startedAt.toISOString(),
            },
            {
                key: "endedAt",
                label: "Ended at",
                value: endedAt.toISOString(),
            },
            {
                key: "duration",
                label: "Duration",
                value: TimeUtils.formatHuman(durationMs),
            },
            {
                key: "urlsSeen",
                label: "URLs seen",
                value: state.seen.size,
            },
            {
                key: "stopRequested",
                label: "Stop Requested",
                value: state.stopRequested,
            },
        ],
    };
    if (state.stopConfirmedAt) {
        engineReport.items.push({
            key: "stopConfirmedAt",
            label: "Stop Confirmed ",
            value: state.stopConfirmedAt,
        });
    }
    const reports: Report[] = [engineReport];
    reports.push(...registry.getReports(state));

    pluginSummaries.push({
        plugin: "engine",
        treatedUrls: state.seen.size,
        infos: state.infoCount,
        errors: state.errorCount,
        warnings: state.warningCount,
    });

    if (outputFormat === "table" || outputFormat === "both") {
        printReports(reports);
        printPluginSummaryTable(pluginSummaries);
    }

    const globalReport = {
        reports,
        plugins: pluginSummaries,
        issues: state.findings.filter((f) => !findingCodesBlocklist.includes(f.code)),
        inventory: state.inventory,
    };
    const jsonReport = JSON.stringify(globalReport, null, 4);
    if (outputFormat === "json" || outputFormat === "both") {
        console.log(jsonReport);
    }
    await fs.writeFile(path.join(reportOutputDir, `${websiteId}.json`), jsonReport, "utf-8");

    const xlsxExporter = new XlsxExporter({
        outputPath: path.join(reportOutputDir, `${websiteId}.xlsx`),
    });
    await xlsxExporter.export(globalReport);

    const hasErrors = pluginSummaries.reduce((sum, p) => sum + p.errors, 0) > 0;
    process.exit(hasErrors ? 2 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
