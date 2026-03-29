import { PluginRegistry } from "./PluginRegistry.js";
import type { EngineState, Report, ReportItem } from "./types.js";

export type CompletionFinding = {
    plugin: string;
    type: string;
    category: string;
    code: string;
    message: string;
    url?: string;
    data?: unknown;
};

export type CompletionPluginSummary = {
    plugin: string;
    label: string;
    treatedUrls: number;
    infos: number;
    warnings: number;
    errors: number;
};

export type CompletionPluginDetail = {
    plugin: string;
    label: string;
    sections: Array<{
        title: string;
        items: ReportItem[];
    }>;
    findings: CompletionFinding[];
};

export type CrawlCompletionSummary = {
    status: string;
    title: string;
    subtitle: string;
    overviewCards: ReportItem[];
    runDetails: ReportItem[];
    auditPlugins: CompletionPluginSummary[];
    pluginDetails: CompletionPluginDetail[];
};

type BuildCompletionSummaryInput = {
    registry: PluginRegistry;
    state: EngineState;
    status: string;
    title: string;
    subtitle: string;
    overviewCards: ReportItem[];
    runDetails: ReportItem[];
    reports: Report[];
    issues: CompletionFinding[];
};

export function buildCrawlCompletionSummary(
    input: BuildCompletionSummaryInput,
): CrawlCompletionSummary {
    const reportByPlugin = new Map(input.reports.map((report) => [report.plugin, report]));
    const issuesByPlugin = new Map<string, CompletionFinding[]>();

    for (const issue of input.issues) {
        const bucket = issuesByPlugin.get(issue.plugin) ?? [];
        bucket.push(issue);
        issuesByPlugin.set(issue.plugin, bucket);
    }

    const auditPlugins: CompletionPluginSummary[] = [];
    const pluginDetails: CompletionPluginDetail[] = [];
    const engineReport = reportByPlugin.get("engine");

    if (engineReport) {
        const engineSummary: CompletionPluginSummary = {
            plugin: "engine",
            label: engineReport.label,
            treatedUrls: input.state.seen.size,
            infos: input.state.infoCount,
            warnings: input.state.warningCount,
            errors: input.state.errorCount,
        };
        const findings = [...(issuesByPlugin.get("engine") ?? [])].sort(compareFindings);

        auditPlugins.push(engineSummary);
        pluginDetails.push({
            plugin: engineSummary.plugin,
            label: engineSummary.label,
            sections: [
                {
                    title: "Summary",
                    items: [
                        {
                            key: "treatedUrls",
                            label: "Audited resources",
                            value: engineSummary.treatedUrls,
                        },
                        {
                            key: "infos",
                            label: "Infos",
                            value: engineSummary.infos,
                        },
                        {
                            key: "warnings",
                            label: "Warnings",
                            value: engineSummary.warnings,
                        },
                        {
                            key: "errors",
                            label: "Errors",
                            value: engineSummary.errors,
                        },
                    ],
                },
                {
                    title: engineReport.label,
                    items: engineReport.items,
                },
            ],
            findings,
        });
    }

    for (const plugin of input.registry.list()) {
        if (!(plugin.includeInSummary?.() ?? false)) {
            continue;
        }
        if (!(plugin.isAuditPlugin?.() ?? true)) {
            continue;
        }

        plugin.hydrateFromState?.(input.state);
        const summary = plugin.getSummary?.();
        if (!summary) {
            continue;
        }

        const report = reportByPlugin.get(plugin.name);
        const label = report?.label ?? humanizePluginName(plugin.name);
        const findings = [...(issuesByPlugin.get(plugin.name) ?? [])].sort(compareFindings);
        const sections: CompletionPluginDetail["sections"] = [
            {
                title: "Summary",
                items: [
                    {
                        key: "treatedUrls",
                        label: "Audited resources",
                        value: summary.treatedUrls,
                    },
                    {
                        key: "infos",
                        label: "Infos",
                        value: summary.infos,
                    },
                    {
                        key: "warnings",
                        label: "Warnings",
                        value: summary.warnings,
                    },
                    {
                        key: "errors",
                        label: "Errors",
                        value: summary.errors,
                    },
                ],
            },
        ];

        if (report && report.items.length > 0) {
            sections.push({
                title: report.label,
                items: report.items,
            });
        }

        auditPlugins.push({
            plugin: summary.plugin,
            label,
            treatedUrls: summary.treatedUrls,
            infos: summary.infos,
            warnings: summary.warnings,
            errors: summary.errors,
        });

        pluginDetails.push({
            plugin: summary.plugin,
            label,
            sections,
            findings,
        });
    }

    return {
        status: input.status,
        title: input.title,
        subtitle: input.subtitle,
        overviewCards: input.overviewCards,
        runDetails: input.runDetails,
        auditPlugins,
        pluginDetails,
    };
}

function compareFindings(left: CompletionFinding, right: CompletionFinding): number {
    const severityRank = {
        error: 0,
        warning: 1,
        info: 2,
    } as const;

    const leftRank = severityRank[left.type as keyof typeof severityRank] ?? 99;
    const rightRank = severityRank[right.type as keyof typeof severityRank] ?? 99;

    if (leftRank !== rightRank) {
        return leftRank - rightRank;
    }

    return `${left.code}|${left.url ?? ""}|${left.message}`.localeCompare(
        `${right.code}|${right.url ?? ""}|${right.message}`,
    );
}

function humanizePluginName(value: string): string {
    return value
        .split(/[-_]+/)
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
