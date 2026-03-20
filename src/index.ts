import { PluginRegistry } from "./engine/PluginRegistry.js";
import { CrawlerEngine } from "./engine/CrawlerEngine.js";
import { TimeUtils } from "./utils/TimeUtils.js";

// import { ConsoleErrorsPlugin } from "./plugins/ConsoleErrorsPlugin";
// import { A11yAxePlugin } from "./plugins/A11yAxePlugin";
// import { DeadLinksPlugin } from "./plugins/DeadLinksPlugin";
// import { PdfTextractPlugin } from "./plugins/PdfTextractPlugin";
// import { LighthouseEveryNHtmlPlugin } from "./plugins/LighthouseEveryNHtmlPlugin";
import { StatsCollectorPlugin } from "./plugins/StatsCollectorPlugin.js";
import { ConsoleStatusPlugin } from "./plugins/ConsoleStatusPlugin.js";
import { PerUrlJsonReportPlugin } from "./plugins/PerUrlJsonReportPlugin.js";
import { ProcessHtmlPlugin } from "./plugins/ProcessHtmlPlugin.js";
import { printPluginSummaryTable } from "./engine/summaryPrinter.js";

async function main() {
    const registry = new PluginRegistry()
        .register(new StatsCollectorPlugin({ rollingWindowSize: 12 }))
        .register(
            new ConsoleStatusPlugin({
                refreshEveryMs: 2000,
                singleLine: true,
            }),
        )
        .register(
            new PerUrlJsonReportPlugin({
                outputDir: process.env.REPORT_OUTPUT_DIR ?? "./reports",
            }),
        )
        .register(new ProcessHtmlPlugin());

    // .register(new A11yAxePlugin())
    // .register(new DeadLinksPlugin({ checkExternal: (process.env.CHECK_EXTERNAL_LINKS ?? "false") === "true" }))
    // .register(new PdfTextractPlugin())
    // .register(new LighthouseEveryNHtmlPlugin(Number(process.env.LH_EVERY_N ?? 10)));

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
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - state.startedAt.getTime();

    console.log("\n\n=== Audit completed ===\n");
    console.log("  - Origin     : " + state.origin);
    console.log("  - Started at : " + state.startedAt.toISOString());
    console.log("  - Ended at   : " + endedAt.toISOString());
    console.log("  - Duration   : " + TimeUtils.formatHuman(durationMs));
    console.log("  - URLs seen  : " + state.seen.size);

    const pluginSummaries = registry.getSummaries();
    pluginSummaries.push({
        plugin: "engine",
        auditedUrls: state.seen.size,
        errors: state.errorCount,
        warnings: state.warningCount,
    });
    printPluginSummaryTable(pluginSummaries);
    // const report = {
    //     state: {
    //         startedAt: state.startedAt.toISOString(),
    //         endedAt: endedAt.toISOString(),
    //         durationMs: durationMs,
    //         origin: state.origin,
    //         seenCount: state.seen.size,
    //     },
    //     plugins: pluginSummaries,
    // };
    //
    // console.log(JSON.stringify(report, null, 4));

    const hasErrors = pluginSummaries.reduce((sum, p) => sum + p.errors, 0) > 0;
    process.exit(hasErrors ? 2 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
