import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

import type { InventoryEntry, IssueEntry, PluginSummary } from "../reporting/XlsxExporter.js";

export type SimplifiedAuditLocale = "fr" | "nl" | "de" | "en";

const SUPPORTED_SIMPLIFIED_AUDIT_LOCALES = ["fr", "nl", "de", "en"] as const;
export const DEFAULT_SIMPLIFIED_AUDIT_LOCALES: SimplifiedAuditLocale[] = ["fr", "nl", "de", "en"];

const require = createRequire(import.meta.url);
const axe = require("axe-core") as typeof import("axe-core");

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
    criterionStatus: {
        pass: string;
        error: string;
        warning: string;
        info: string;
    };
    pluginBreakdownTitle: string;
    findingsTitle: string;
    noFindings: string;
    findingsLead: string;
    criteriaTitle: string;
    criteriaLead: string;
    detectedFindingsLabel: string;
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
        criterion: string;
        status: string;
        checks: string;
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

type CriterionStatus = "pass" | "error" | "warning" | "info";

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
    axeCriteria: Array<{
        criterion: string;
        status: CriterionStatus;
        statusLabel: string;
        statusBadgeClass: string;
        pages: number;
        occurrences: number;
        checks: string[];
        findingMessages: string[];
        references: Array<{
            label: string;
            url: string;
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

type AxeIssueData = {
    help_url?: string;
    description?: string;
    help?: string;
    id?: string;
    en301549_criteria?: string[];
};

type AxeRuleEntry = {
    criterion: string;
    ruleId: string;
    help: string;
    helpUrl: string | null;
};

const engineDir = path.dirname(fileURLToPath(import.meta.url));
const resourcesDir = path.join(engineDir, "../resources");
const templatePath = path.join(resourcesDir, "templates/simplified-audit.ejs");
const templateSource = readFileSync(templatePath, "utf8");
const translationDir = path.join(resourcesDir, "i18n");
const translations = Object.fromEntries(
    SUPPORTED_SIMPLIFIED_AUDIT_LOCALES.map((locale) => [locale, readTranslationBundle(locale)]),
) as Record<SimplifiedAuditLocale, TranslationBundle>;
const auditedAxeCriteria = buildAuditedAxeCriteria();

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
        axeCriteria: buildAxeCriteriaRows(filteredIssues, t),
    };
}

function readTranslationBundle(locale: SimplifiedAuditLocale): TranslationBundle {
    const filePath = path.join(translationDir, `simplified-audit.${locale}.json`);
    return JSON.parse(readFileSync(filePath, "utf8")) as TranslationBundle;
}

function buildAuditedAxeCriteria(): Array<{ criterion: string; rules: AxeRuleEntry[] }> {
    const registry = new Map<string, Map<string, AxeRuleEntry>>();

    for (const rule of axe.getRules()) {
        const tags = Array.isArray(rule.tags) ? rule.tags : [];
        if (!tags.includes("EN-301-549")) {
            continue;
        }

        const criteria = tags
            .map((tag) => /^EN-(\d+(?:\.\d+)+)$/.exec(tag)?.[1] ?? null)
            .filter((criterion): criterion is string => criterion !== null);
        if (criteria.length === 0) {
            continue;
        }

        for (const criterion of criteria) {
            const bucket = registry.get(criterion) ?? new Map<string, AxeRuleEntry>();
            bucket.set(rule.ruleId, {
                criterion,
                ruleId: rule.ruleId,
                help: rule.help,
                helpUrl:
                    typeof rule.helpUrl === "string" && rule.helpUrl.length > 0
                        ? rule.helpUrl
                        : null,
            });
            registry.set(criterion, bucket);
        }
    }

    return [...registry.entries()]
        .map(([criterion, rules]) => ({
            criterion,
            rules: [...rules.values()].sort((left, right) =>
                left.ruleId.localeCompare(right.ruleId),
            ),
        }))
        .sort((left, right) => compareCriteria(left.criterion, right.criterion));
}

function buildAxeCriteriaRows(
    issues: IssueEntry[],
    t: TranslationBundle,
): SimplifiedAuditViewModel["axeCriteria"] {
    const buckets = new Map<
        string,
        {
            status: Exclude<CriterionStatus, "pass">;
            urls: Set<string>;
            occurrences: number;
            messages: Set<string>;
            references: Map<string, { label: string; url: string }>;
        }
    >();

    for (const issue of issues) {
        if (issue.plugin !== "a11y-axe") {
            continue;
        }

        const data = extractAxeIssueData(issue);
        const criteria = data?.en301549_criteria?.filter(Boolean) ?? [];
        if (criteria.length === 0) {
            continue;
        }

        const severity = normalizeCriterionStatus(issue.type);
        for (const criterion of criteria) {
            const bucket = buckets.get(criterion) ?? {
                status: severity,
                urls: new Set<string>(),
                occurrences: 0,
                messages: new Set<string>(),
                references: new Map<string, { label: string; url: string }>(),
            };

            bucket.status = higherCriterionStatus(bucket.status, severity);
            bucket.occurrences += 1;
            if (issue.url) {
                bucket.urls.add(issue.url);
            }
            bucket.messages.add(issue.message);
            if (data?.description) {
                bucket.messages.add(data.description);
            }
            if (data?.help_url) {
                const label = data.id ? data.id : issue.code;
                bucket.references.set(data.help_url, { label, url: data.help_url });
            }
            buckets.set(criterion, bucket);
        }
    }

    return auditedAxeCriteria.map(({ criterion, rules }) => {
        const bucket = buckets.get(criterion);
        const status: CriterionStatus = bucket?.status ?? "pass";
        const references =
            bucket && bucket.references.size > 0
                ? [...bucket.references.values()].sort((left, right) =>
                      left.label.localeCompare(right.label),
                  )
                : rules
                      .filter((rule) => rule.helpUrl)
                      .map((rule) => ({ label: rule.ruleId, url: rule.helpUrl! }));

        return {
            criterion,
            status,
            statusLabel: t.criterionStatus[status],
            statusBadgeClass: criterionStatusBadgeClass(status),
            pages: bucket?.urls.size ?? 0,
            occurrences: bucket?.occurrences ?? 0,
            checks: rules.map((rule) => `${rule.ruleId}: ${rule.help}`),
            findingMessages: bucket
                ? [...bucket.messages].sort((left, right) => left.localeCompare(right))
                : [],
            references,
        };
    });
}

function extractAxeIssueData(issue: IssueEntry): AxeIssueData | null {
    if (!issue.data || typeof issue.data !== "object" || Array.isArray(issue.data)) {
        return null;
    }

    return issue.data as AxeIssueData;
}

function criterionStatusBadgeClass(status: CriterionStatus): string {
    if (status === "pass") {
        return "text-bg-success";
    }
    if (status === "warning") {
        return "text-bg-warning";
    }
    if (status === "info") {
        return "text-bg-info";
    }
    return "text-bg-danger";
}

function compareCriteria(left: string, right: string): number {
    const leftParts = left.split(".").map((part) => Number(part));
    const rightParts = right.split(".").map((part) => Number(part));
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index += 1) {
        const leftValue = leftParts[index] ?? -1;
        const rightValue = rightParts[index] ?? -1;
        if (leftValue !== rightValue) {
            return leftValue - rightValue;
        }
    }

    return left.localeCompare(right);
}

function higherCriterionStatus(
    left: Exclude<CriterionStatus, "pass">,
    right: Exclude<CriterionStatus, "pass">,
): Exclude<CriterionStatus, "pass"> {
    const rank = { info: 0, warning: 1, error: 2 } as const;
    return rank[right] > rank[left] ? right : left;
}

function normalizeCriterionStatus(value: string): Exclude<CriterionStatus, "pass"> {
    if (value === "warning") {
        return "warning";
    }
    if (value === "info") {
        return "info";
    }
    return "error";
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
