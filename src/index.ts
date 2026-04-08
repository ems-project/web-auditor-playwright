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
import { SiteDumpPlugin } from "./plugins/SiteDumpPlugin.js";
import { HtmlProcessorPlugin } from "./plugins/HtmlProcessorPlugin.js";
import { CssAuditPlugin } from "./plugins/CssAuditPlugin.js";
import { ImagePlugin } from "./plugins/ImagePlugin.js";
import { SeoUrlRulesPlugin } from "./plugins/SeoUrlRulesPlugin.js";
import { SoftHttpErrorPlugin } from "./plugins/SoftHttpErrorPlugin.js";
import { DownloaderPlugin } from "./plugins/DownloaderPlugin.js";
import { RobotsTxtPlugin } from "./plugins/RobotsTxtPlugin.js";
import { SitemapPlugin } from "./plugins/SitemapPlugin.js";
import { ImageMetadataPlugin } from "./plugins/ImageMetadataPlugin.js";
import { CleanDownloadedPlugin } from "./plugins/CleanDownloadedPlugin.js";
import { TextExtractorPlugin } from "./plugins/TextExtractorPlugin.js";
import { PdfExtractorPlugin } from "./plugins/PdfExtractorPlugin.js";
import { DocxExtractorPlugin } from "./plugins/DocxExtractorPlugin.js";
import { TextractExtractorPlugin } from "./plugins/TextractExtractorPlugin.js";
import { SecurityHeadersPlugin } from "./plugins/SecurityHeadersPlugin.js";
import { LanguageDetectionPlugin } from "./plugins/LanguageDetectionPlugin.js";
import { HreflangPlugin } from "./plugins/HreflangPlugin.js";
import { StandardUrlsAuditPlugin } from "./plugins/StandardUrlsAuditPlugin.js";
import { ConsolePlugin } from "./plugins/ConsolePlugin.js";
import { PdfAccessibilityPlugin } from "./plugins/PdfAccessibilityPlugin.js";
import { PerformanceMetricsPlugin } from "./plugins/PerformanceMetricsPlugin.js";
import { TlsCertificatePlugin } from "./plugins/TlsCertificatePlugin.js";
import { IpSupportPlugin } from "./plugins/IpSupportPlugin.js";
import { TextUtils } from "./utils/TextUtils.js";
import { fetchPublicIpAddresses } from "./utils/PublicIpResolver.js";
import { XlsxExporter } from "./reporting/XlsxExporter.js";
import { Report } from "./engine/types.js";
import { buildCrawlCompletionSummary } from "./engine/CrawlCompletionSummary.js";
import { AuditStore } from "./engine/AuditStore.js";
import { CrawlProgressServer } from "./engine/CrawlProgressServer.js";
import fsp from "node:fs/promises";

function buildSitemapXml(urls: string[]): string {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
        "</urlset>",
    ];

    return `${lines.join("\n")}\n`;
}

function collectValidSitemapUrls(
    inventory: Array<{ url: string; status?: number; mime?: string }>,
): string[] {
    const uniqueUrls = new Set<string>();

    for (const entry of inventory) {
        if (typeof entry.status !== "number" || entry.status >= 400) {
            continue;
        }
        if (!isSitemapEligibleMime(entry.mime)) {
            continue;
        }

        try {
            const parsed = new URL(entry.url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                continue;
            }
            uniqueUrls.add(parsed.href);
        } catch {}
    }

    return [...uniqueUrls].sort((a, b) => a.localeCompare(b));
}

function isSitemapEligibleMime(mime: string | undefined): boolean {
    if (!mime) {
        return false;
    }

    if (mime.includes("text/html")) {
        return true;
    }

    return [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/rtf",
        "text/rtf",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.presentation",
        "text/csv",
    ].includes(mime);
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

async function waitForTerminationSignal(): Promise<void> {
    await new Promise<void>((resolve) => {
        const onSignal = (): void => {
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
            resolve();
        };

        process.on("SIGINT", onSignal);
        process.on("SIGTERM", onSignal);
    });
}

async function main() {
    const reportOutputDir = process.env.REPORT_OUTPUT_DIR ?? "./reports";
    const websiteId = process.env.WEBSITE_ID ?? "my_website";
    const resumeRunIdValue = process.env.RESUME_RUN_ID?.trim();
    const resumeRunId = resumeRunIdValue ? Number(resumeRunIdValue) : undefined;

    if (resumeRunIdValue && !Number.isInteger(resumeRunId)) {
        throw new Error(`Invalid RESUME_RUN_ID: ${resumeRunIdValue}`);
    }
    const urlAllowlist = TextUtils.parseRegexList(process.env.URL_ALLOWLIST_REGEX);
    const urlBlocklist = TextUtils.parseRegexList(process.env.URL_BLOCKLIST_REGEX);
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const soft404Patterns = TextUtils.parseRegexList(process.env.SOFT_404_PATTERNS);
    const soft500Patterns = TextUtils.parseRegexList(process.env.SOFT_500_PATTERNS);
    const dumpDir = process.env.DUMP_DIR?.trim() || null;
    const webUiEnabled = (process.env.WEB_UI_ENABLED ?? "true") === "true";
    const webUiPortValue = process.env.WEB_UI_PORT ?? "3030";
    const webUiPort = Number(webUiPortValue);
    if (!Number.isInteger(webUiPort) || webUiPort < 0 || webUiPort > 65535) {
        throw new Error("Invalid WEB_UI_PORT: " + webUiPortValue);
    }
    const webUiHost = process.env.WEB_UI_HOST ?? "127.0.0.1";
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
                outputDir: path.join(reportOutputDir, websiteId, "pages"),
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
            new CssAuditPlugin({
                maxInlineStyleAttributes: Number(process.env.CSS_MAX_INLINE_STYLE_ATTRIBUTES ?? 0),
                maxStyleTags: Number(process.env.CSS_MAX_STYLE_TAGS ?? 0),
            }),
        )
        .register(
            new ImagePlugin({
                lazyLoadingAboveFoldBufferPx: Number(
                    process.env.IMAGE_LAZY_LOADING_ABOVE_FOLD_BUFFER_PX ?? 200,
                ),
                minLazyLoadingWidthPx: Number(process.env.IMAGE_MIN_LAZY_LOADING_WIDTH_PX ?? 80),
                minLazyLoadingHeightPx: Number(process.env.IMAGE_MIN_LAZY_LOADING_HEIGHT_PX ?? 80),
            }),
        )
        .register(
            new SeoUrlRulesPlugin({
                maxUrlLength: Number(process.env.MAX_URL_LENGTH ?? 120),
            }),
        )
        .register(
            new SoftHttpErrorPlugin({
                soft404Patterns: soft404Patterns.length > 0 ? soft404Patterns : undefined,
                soft500Patterns: soft500Patterns.length > 0 ? soft500Patterns : undefined,
            }),
        )
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
            new RobotsTxtPlugin({
                requireCrawlDelay:
                    (process.env.ROBOTS_TXT_REQUIRE_CRAWL_DELAY ?? "true") === "true",
                requireSitemap: (process.env.ROBOTS_TXT_REQUIRE_SITEMAP ?? "true") === "true",
            }),
        )
        .register(new SitemapPlugin())
        .register(
            new ImageMetadataPlugin({
                maxFileSizeBytes: Number(
                    process.env.IMAGE_METADATA_MAX_FILE_SIZE_BYTES ?? 20 * 1024 * 1024,
                ),
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
                maxCookieLifetimeDays: Number(process.env.COOKIE_MAX_LIFETIME_DAYS ?? 365),
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
        .register(new HreflangPlugin())
        .register(new StandardUrlsAuditPlugin())
        .register(new CleanDownloadedPlugin());

    if (dumpDir) {
        registry.register(new SiteDumpPlugin({ outputDir: dumpDir }));
    }
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

    await fsp.mkdir(path.join(reportOutputDir, websiteId), { recursive: true });
    const outputFormat = process.env.OUTPUT_FORMAT ?? "table";
    const engine = new CrawlerEngine(
        {
            startUrl: process.env.START_URL || "https://example.org",
            allowedHosts: allowedOrigins,
            ignoreHttpsError: (process.env.IGNORE_HTTPS_ERRORS ?? "false") === "true",
            maxPages: Number(process.env.MAX_PAGES ?? 50),
            maxDepth: Number(process.env.MAX_DEPTH ?? 3),
            concurrency: Number(process.env.CONCURRENCY ?? 3),
            navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 30000),
            userAgent: process.env.USER_AGENT,
            rateLimitMs: Number(process.env.RATE_LIMIT_MS ?? 500),
            urlAllowlist: urlAllowlist,
            urlBlocklist: urlBlocklist,
            reportDir: path.join(reportOutputDir, websiteId),
            resumeRunId,
        },
        registry,
    );

    const progressServer =
        webUiEnabled && webUiPort > 0
            ? new CrawlProgressServer({
                  auditDbPath: path.join(reportOutputDir, websiteId, "audit.db"),
                  port: webUiPort,
                  host: webUiHost,
                  getRunId: () => engine.getCurrentRunId(),
              })
            : null;

    if (progressServer) {
        await progressServer.start();
        console.log("Crawl monitor available at " + progressServer.getUrl());
    }

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
    const publicIpAddresses = await fetchPublicIpAddresses({
        ipv4Url: process.env.CLIENT_PUBLIC_IPV4_URL ?? "https://ipv4.icanhazip.com/",
        ipv6Url: process.env.CLIENT_PUBLIC_IPV6_URL ?? "https://ipv6.icanhazip.com/",
        timeoutMs: Number(process.env.CLIENT_PUBLIC_IP_TIMEOUT_MS ?? 5000),
    });

    const auditStore = new AuditStore(path.join(reportOutputDir, websiteId, "audit.db"));
    const runId = Number(state.any["runId"]);
    const issues = auditStore
        .getFindings(runId)
        .filter((finding) => !findingCodesBlocklist.includes(finding.code));
    const inventory = auditStore.getInventory(runId);
    const run = auditStore.getRun(runId);

    const pluginSummaries = registry.getSummaries(state);
    const engineReport = {
        plugin: "engine",
        label: "Crawler",
        items: [
            {
                key: "runId",
                label: "Run ID",
                value: runId,
            },
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
            {
                key: "clientPublicIpv4",
                label: "Client Public IPv4",
                value: publicIpAddresses.ipv4 ?? "unavailable",
            },
            {
                key: "clientPublicIpv6",
                label: "Client Public IPv6",
                value: publicIpAddresses.ipv6 ?? "unavailable",
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
        issues,
        inventory,
    };
    const jsonReport = JSON.stringify(globalReport, null, 4);
    if (outputFormat === "json" || outputFormat === "both") {
        console.log(jsonReport);
    }
    await fs.writeFile(path.join(reportOutputDir, websiteId, "report.json"), jsonReport, "utf-8");

    const sitemapUrls = collectValidSitemapUrls(inventory);
    await fs.writeFile(
        path.join(reportOutputDir, websiteId, "sitemap.xml"),
        buildSitemapXml(sitemapUrls),
        "utf-8",
    );

    const xlsxExporter = new XlsxExporter({
        outputPath: path.join(reportOutputDir, websiteId, "report.xlsx"),
    });
    await xlsxExporter.export(globalReport);

    const hasErrors = pluginSummaries.reduce((sum, p) => sum + p.errors, 0) > 0;

    if (progressServer) {
        progressServer.setCompletionSummary(
            buildCrawlCompletionSummary({
                registry,
                state,
                status: run?.status ?? "finished",
                title: "Audit Summary",
                subtitle: `${state.origin} | started ${state.startedAt.toISOString()} | ended ${endedAt.toISOString()}`,
                overviewCards: [
                    {
                        key: "runId",
                        label: "Run ID",
                        value: runId,
                    },
                    {
                        key: "duration",
                        label: "Duration",
                        value: TimeUtils.formatHuman(durationMs),
                    },
                    {
                        key: "urlsSeen",
                        label: "URLs Seen",
                        value: state.seen.size,
                    },
                    {
                        key: "findings",
                        label: "Findings",
                        value: issues.length,
                    },
                    {
                        key: "warnings",
                        label: "Warnings",
                        value: pluginSummaries.reduce((sum, plugin) => sum + plugin.warnings, 0),
                    },
                    {
                        key: "errors",
                        label: "Errors",
                        value: pluginSummaries.reduce((sum, plugin) => sum + plugin.errors, 0),
                    },
                ],
                runDetails: engineReport.items,
                reports,
                issues,
            }),
        );
        console.log("Audit summary available at " + progressServer.getUrl());
        console.log("Press Ctrl+C to stop the HTTP server.");
        process.exitCode = hasErrors ? 2 : 0;
        await waitForTerminationSignal();
        await progressServer.stop();
        return;
    }

    process.exit(hasErrors ? 2 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
