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
    findingsTitle: string;
    noFindings: string;
    findingsLead: string;
    criteriaTitle: string;
    criteriaLead: string;
    detectedFindingsLabel: string;
    columns: {
        pages: string;
        description: string;
        references: string;
        criterion: string;
        status: string;
        checks: string;
    };
    appendixTitle: string;
    appendixParagraph: string;
    rawMessagesNotice: string;
    occurrences: string;
    structure: {
        principles: Record<string, { title: string; description: string }>;
        guidelines: Record<string, { title: string; description: string }>;
        criteria: Record<string, { title: string }>;
    };
};

type CriterionStatus = "pass" | "error" | "warning" | "info";

type CriterionRow = {
    criterion: string;
    criterionTitle: string;
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
};

type SimplifiedAuditViewModel = {
    locale: SimplifiedAuditLocale;
    t: TranslationBundle;
    origin: string;
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
    axePrinciples: Array<{
        code: string;
        title: string;
        description: string;
        guidelines: Array<{
            code: string;
            title: string;
            description: string;
            criteria: CriterionRow[];
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
    const criterionRows = buildCriterionRows(filteredIssues, t);
    const pagesChecked = countCheckedPages(input.inventory, input.origin);
    const affectedPageCount = new Set(filteredIssues.map((issue) => issue.url).filter(Boolean))
        .size;
    const statusKey = computeStatus(filteredIssues);

    return {
        locale: input.locale,
        t,
        origin: input.origin,
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
        groupedFindingCount: criterionRows.filter((row) => row.status !== "pass").length,
        affectedPageCount,
        axePrinciples: groupCriterionRowsByStructure(criterionRows, t),
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
            .filter((criterion): criterion is string => criterion !== null)
            .map(stripEnPrefix);
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
        .sort((left, right) => compareCodes(left.criterion, right.criterion));
}

function buildCriterionRows(issues: IssueEntry[], t: TranslationBundle): CriterionRow[] {
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
        const criteria = data?.en301549_criteria?.map(stripEnPrefix).filter(Boolean) ?? [];
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
                bucket.references.set(data.help_url, {
                    label: data.id ? data.id : issue.code,
                    url: data.help_url,
                });
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
            criterionTitle: t.structure.criteria[criterion]?.title ?? criterion,
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

function groupCriterionRowsByStructure(
    rows: CriterionRow[],
    t: TranslationBundle,
): SimplifiedAuditViewModel["axePrinciples"] {
    const principles = new Map<
        string,
        {
            code: string;
            title: string;
            description: string;
            guidelines: Map<
                string,
                {
                    code: string;
                    title: string;
                    description: string;
                    criteria: CriterionRow[];
                }
            >;
        }
    >();

    for (const row of rows) {
        const parts = row.criterion.split(".");
        const principleCode = parts[0] ?? row.criterion;
        const guidelineCode = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : row.criterion;

        const principleEntry = principles.get(principleCode) ?? {
            code: principleCode,
            title: t.structure.principles[principleCode]?.title ?? principleCode,
            description: t.structure.principles[principleCode]?.description ?? "",
            guidelines: new Map(),
        };
        const guidelineEntry = principleEntry.guidelines.get(guidelineCode) ?? {
            code: guidelineCode,
            title: t.structure.guidelines[guidelineCode]?.title ?? guidelineCode,
            description: t.structure.guidelines[guidelineCode]?.description ?? "",
            criteria: [],
        };

        guidelineEntry.criteria.push(row);
        principleEntry.guidelines.set(guidelineCode, guidelineEntry);
        principles.set(principleCode, principleEntry);
    }

    return [...principles.values()]
        .sort((left, right) => compareCodes(left.code, right.code))
        .map((principle) => ({
            code: principle.code,
            title: principle.title,
            description: principle.description,
            guidelines: [...principle.guidelines.values()]
                .sort((left, right) => compareCodes(left.code, right.code))
                .map((guideline) => ({
                    code: guideline.code,
                    title: guideline.title,
                    description: guideline.description,
                    criteria: guideline.criteria.sort((left, right) =>
                        compareCodes(left.criterion, right.criterion),
                    ),
                })),
        }));
}

function extractAxeIssueData(issue: IssueEntry): AxeIssueData | null {
    if (!issue.data || typeof issue.data !== "object" || Array.isArray(issue.data)) {
        return null;
    }

    return issue.data as AxeIssueData;
}

function stripEnPrefix(value: string): string {
    return value.startsWith("9.") ? value.slice(2) : value;
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

function compareCodes(left: string, right: string): number {
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

function computeStatus(issues: IssueEntry[]): keyof TranslationBundle["status"] {
    if (issues.some((issue) => normalizeCriterionStatus(issue.type) === "error")) {
        return "nonCompliant";
    }
    if (issues.length > 0) {
        return "partiallyCompliant";
    }
    return "compliant";
}

function formatDate(
    value: Date,
    locale: SimplifiedAuditLocale,
    options: Intl.DateTimeFormatOptions,
): string {
    return new Intl.DateTimeFormat(locale, options).format(value);
}

function isSameOrigin(targetUrl: string, origin: string): boolean {
    try {
        return new URL(targetUrl).origin === new URL(origin).origin;
    } catch {
        return false;
    }
}
