import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

import type { InventoryEntry, IssueEntry, PluginSummary } from "../reporting/XlsxExporter.js";

export type SimplifiedAuditLocale = "fr" | "nl" | "de" | "en";

const SUPPORTED_SIMPLIFIED_AUDIT_LOCALES = ["fr", "nl", "de", "en"] as const;
export const DEFAULT_SIMPLIFIED_AUDIT_LOCALES: SimplifiedAuditLocale[] = ["fr", "nl", "de", "en"];

type TranslationBundle = {
    htmlLang: string;
    pageTitle: string;
    lead: string;
    copyButton: string;
    copySuccess: string;
    copyError: string;
    generatedNotice: string;
    sectionWhy: string;
    whyParagraphs: string[];
    sectionHow: string;
    howParagraphs: string[];
    howBullets: string[];
    sectionResults: string;
    generalInfo: string;
    siteName: string;
    siteUrl: string;
    auditDate: string;
    auditStartedAt: string;
    auditEndedAt: string;
    auditType: string;
    auditTypeValue: string;
    standard: string;
    standardValue: string;
    auditTool: string;
    auditToolValue: string;
    pagesChecked: string;
    provisionalStatus: string;
    complianceStatusLabel: string;
    summaryTitle: string;
    summaryLead: string;
    summaryCards: {
        findings: string;
        ruleGroups: string;
        affectedPages: string;
        plugins: string;
    };
    status: {
        compliant: string;
        partiallyCompliant: string;
        nonCompliant: string;
    };
    statusDescriptions: {
        compliant: string;
        partiallyCompliant: string;
        nonCompliant: string;
    };
    pluginBreakdownTitle: string;
    findingsTitle: string;
    noFindings: string;
    findingsLead: string;
    auditDetailsIntro: string;
    sourceHeading: string;
    sourceLead: string;
    columns: {
        severity: string;
        plugin: string;
        code: string;
        message: string;
        pages: string;
        example: string;
        description: string;
        references: string;
    };
    severity: {
        error: string;
        warning: string;
        info: string;
    };
    appendixTitle: string;
    appendixParagraph: string;
    rawMessagesNotice: string;
    breakdownErrors: string;
    breakdownWarnings: string;
    breakdownInfos: string;
    occurrences: string;
};

type SimplifiedAuditViewModel = {
    locale: SimplifiedAuditLocale;
    t: TranslationBundle;
    pageTitle: string;
    origin: string;
    siteName: string;
    generatedAtIso: string;
    generatedAtDisplay: string;
    startedAtDisplay: string;
    endedAtDisplay: string;
    statusLabel: string;
    statusDescription: string;
    statusBadgeClass: string;
    pagesChecked: number;
    findingCount: number;
    groupedFindingCount: number;
    affectedPageCount: number;
    pluginCount: number;
    pluginBreakdown: Array<{
        name: string;
        errors: number;
        warnings: number;
        infos: number;
        total: number;
    }>;
    findings: Array<{
        severity: "error" | "warning" | "info";
        severityLabel: string;
        plugin: string;
        pluginLabel: string;
        code: string;
        message: string;
        pages: number;
        exampleUrl: string | null;
        occurrences: number;
    }>;
    findingsByPlugin: Array<{
        plugin: string;
        pluginLabel: string;
        findings: Array<{
            severity: "error" | "warning" | "info";
            severityLabel: string;
            plugin: string;
            pluginLabel: string;
            code: string;
            message: string;
            pages: number;
            exampleUrl: string | null;
            occurrences: number;
        }>;
    }>;
};

type BuildSimplifiedAuditPagesInput = {
    outputDir: string;
    origin: string;
    startedAt: Date;
    endedAt: Date;
    issues: IssueEntry[];
    inventory: InventoryEntry[];
    plugins: PluginSummary[];
    locales?: SimplifiedAuditLocale[];
};

const engineDir = path.dirname(fileURLToPath(import.meta.url));
const resourcesDir = path.join(engineDir, "../resources");
const templatePath = path.join(resourcesDir, "templates/simplified-audit.ejs");
const templateSource = readFileSync(templatePath, "utf8");
const translationDir = path.join(resourcesDir, "i18n");
const translations = Object.fromEntries(
    SUPPORTED_SIMPLIFIED_AUDIT_LOCALES.map((locale) => [locale, readTranslationBundle(locale)]),
) as Record<SimplifiedAuditLocale, TranslationBundle>;

export function parseSimplifiedAuditLocales(value: string | undefined): SimplifiedAuditLocale[] {
    const requested = (value ?? DEFAULT_SIMPLIFIED_AUDIT_LOCALES.join(","))
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);

    const locales = requested.filter(isSimplifiedAuditLocale);
    return locales.length > 0 ? [...new Set(locales)] : [...DEFAULT_SIMPLIFIED_AUDIT_LOCALES];
}

export async function writeSimplifiedAuditPages(
    input: BuildSimplifiedAuditPagesInput,
): Promise<void> {
    await fs.mkdir(input.outputDir, { recursive: true });

    const locales = input.locales ?? DEFAULT_SIMPLIFIED_AUDIT_LOCALES;
    for (const locale of locales) {
        const model = buildSimplifiedAuditViewModel({ ...input, locale });
        const html = renderSimplifiedAuditPage(model);
        await fs.writeFile(
            path.join(input.outputDir, `simplified-audit.${locale}.html`),
            html,
            "utf8",
        );
    }
}

export function renderSimplifiedAuditPage(model: SimplifiedAuditViewModel): string {
    return ejs.render(templateSource, { model });
}

export function buildSimplifiedAuditViewModel(
    input: BuildSimplifiedAuditPagesInput & { locale: SimplifiedAuditLocale },
): SimplifiedAuditViewModel {
    const t = translations[input.locale];
    const filteredIssues = input.issues.filter(isAccessibilityIssue);
    const groupedFindings = groupIssues(filteredIssues, t);
    const pluginBreakdown = buildPluginBreakdown(filteredIssues);
    const pagesChecked = countCheckedPages(input.inventory, input.origin);
    const affectedPageCount = new Set(filteredIssues.map((issue) => issue.url).filter(Boolean))
        .size;
    const statusKey = computeStatus(filteredIssues);
    const siteName = toSiteName(input.origin);

    return {
        locale: input.locale,
        t,
        pageTitle: `${t.pageTitle} | ${siteName}`,
        origin: input.origin,
        siteName,
        generatedAtIso: input.endedAt.toISOString(),
        generatedAtDisplay: formatDate(input.endedAt, input.locale, {
            dateStyle: "long",
            timeStyle: "short",
        }),
        startedAtDisplay: formatDate(input.startedAt, input.locale, {
            dateStyle: "medium",
            timeStyle: "short",
        }),
        endedAtDisplay: formatDate(input.endedAt, input.locale, {
            dateStyle: "medium",
            timeStyle: "short",
        }),
        statusLabel: t.status[statusKey],
        statusDescription: t.statusDescriptions[statusKey],
        statusBadgeClass:
            statusKey === "compliant"
                ? "text-bg-success"
                : statusKey === "partiallyCompliant"
                  ? "text-bg-warning"
                  : "text-bg-danger",
        pagesChecked,
        findingCount: filteredIssues.length,
        groupedFindingCount: groupedFindings.length,
        affectedPageCount,
        pluginCount: pluginBreakdown.length,
        pluginBreakdown,
        findings: groupedFindings,
        findingsByPlugin: groupFindingsByPlugin(groupedFindings),
    };
}

function readTranslationBundle(locale: SimplifiedAuditLocale): TranslationBundle {
    const filePath = path.join(translationDir, `simplified-audit.${locale}.json`);
    return JSON.parse(readFileSync(filePath, "utf8")) as TranslationBundle;
}

function isSimplifiedAuditLocale(value: string): value is SimplifiedAuditLocale {
    return SUPPORTED_SIMPLIFIED_AUDIT_LOCALES.includes(value as SimplifiedAuditLocale);
}

function isAccessibilityIssue(issue: IssueEntry): boolean {
    return issue.category === "a11y" || issue.plugin === "pdf-accessibility";
}

function countCheckedPages(inventory: InventoryEntry[], origin: string): number {
    const urls = new Set<string>();

    for (const entry of inventory) {
        if (!entry.url || !isSameOrigin(entry.url, origin)) {
            continue;
        }
        if (typeof entry.status === "number" && entry.status >= 400) {
            continue;
        }
        if (!looksLikeAccessibilityRelevantResource(entry.mime)) {
            continue;
        }

        urls.add(entry.url);
    }

    return urls.size;
}

function looksLikeAccessibilityRelevantResource(mime: string | undefined): boolean {
    const value = (mime ?? "").toLowerCase();
    return value.includes("text/html") || value.includes("application/pdf") || value === "";
}

function groupIssues(
    issues: IssueEntry[],
    t: TranslationBundle,
): SimplifiedAuditViewModel["findings"] {
    const map = new Map<
        string,
        SimplifiedAuditViewModel["findings"][number] & { urls: Set<string> }
    >();

    for (const issue of issues) {
        const severity = normalizeSeverity(issue.type);
        const key = `${issue.plugin}|${issue.code}|${severity}`;
        const existing = map.get(key);
        if (existing) {
            existing.occurrences += 1;
            if (issue.url) {
                existing.urls.add(issue.url);
                if (!existing.exampleUrl) {
                    existing.exampleUrl = issue.url;
                }
            }
            continue;
        }

        map.set(key, {
            severity,
            severityLabel: t.severity[severity],
            plugin: issue.plugin,
            pluginLabel: humanizePluginName(issue.plugin),
            code: issue.code,
            message: issue.message,
            pages: issue.url ? 1 : 0,
            exampleUrl: issue.url ?? null,
            occurrences: 1,
            urls: new Set(issue.url ? [issue.url] : []),
        });
    }

    return [...map.values()]
        .map((entry) => ({
            severity: entry.severity,
            severityLabel: entry.severityLabel,
            plugin: entry.plugin,
            pluginLabel: entry.pluginLabel,
            code: entry.code,
            message: entry.message,
            pages: entry.urls.size,
            exampleUrl: entry.exampleUrl,
            occurrences: entry.occurrences,
        }))
        .sort((left, right) => {
            const rank = { error: 0, warning: 1, info: 2 } as const;
            const severityDelta = rank[left.severity] - rank[right.severity];
            if (severityDelta !== 0) {
                return severityDelta;
            }
            if (right.pages !== left.pages) {
                return right.pages - left.pages;
            }
            if (right.occurrences !== left.occurrences) {
                return right.occurrences - left.occurrences;
            }
            return `${left.plugin}|${left.code}`.localeCompare(`${right.plugin}|${right.code}`);
        });
}

function groupFindingsByPlugin(
    findings: SimplifiedAuditViewModel["findings"],
): SimplifiedAuditViewModel["findingsByPlugin"] {
    const map = new Map<string, SimplifiedAuditViewModel["findingsByPlugin"][number]>();

    for (const finding of findings) {
        const bucket = map.get(finding.plugin) ?? {
            plugin: finding.plugin,
            pluginLabel: finding.pluginLabel,
            findings: [],
        };
        bucket.findings.push(finding);
        map.set(finding.plugin, bucket);
    }

    return [...map.values()].sort((left, right) =>
        left.pluginLabel.localeCompare(right.pluginLabel),
    );
}

function buildPluginBreakdown(issues: IssueEntry[]): SimplifiedAuditViewModel["pluginBreakdown"] {
    const map = new Map<string, SimplifiedAuditViewModel["pluginBreakdown"][number]>();

    for (const issue of issues) {
        const severity = normalizeSeverity(issue.type);
        const existing = map.get(issue.plugin) ?? {
            name: humanizePluginName(issue.plugin),
            errors: 0,
            warnings: 0,
            infos: 0,
            total: 0,
        };
        if (severity === "error") {
            existing.errors += 1;
        } else if (severity === "warning") {
            existing.warnings += 1;
        } else {
            existing.infos += 1;
        }
        existing.total += 1;
        map.set(issue.plugin, existing);
    }

    return [...map.values()].sort(
        (left, right) => right.total - left.total || left.name.localeCompare(right.name),
    );
}

function computeStatus(issues: IssueEntry[]): keyof TranslationBundle["status"] {
    if (issues.some((issue) => normalizeSeverity(issue.type) === "error")) {
        return "nonCompliant";
    }
    if (issues.length > 0) {
        return "partiallyCompliant";
    }
    return "compliant";
}

function normalizeSeverity(value: string): "error" | "warning" | "info" {
    if (value === "error") {
        return "error";
    }
    if (value === "warning") {
        return "warning";
    }
    return "info";
}

function humanizePluginName(value: string): string {
    return value
        .split(/[-_]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatDate(
    value: Date,
    locale: SimplifiedAuditLocale,
    options: Intl.DateTimeFormatOptions,
): string {
    return new Intl.DateTimeFormat(locale, options).format(value);
}

function toSiteName(origin: string): string {
    try {
        return new URL(origin).hostname;
    } catch {
        return origin;
    }
}

function isSameOrigin(targetUrl: string, origin: string): boolean {
    try {
        return new URL(targetUrl).origin === new URL(origin).origin;
    } catch {
        return false;
    }
}
