import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

import type { InventoryEntry, IssueEntry, PluginSummary } from "../reporting/XlsxExporter.js";

type SimplifiedAuditLocale = "fr" | "nl" | "de" | "en";

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
    columns: {
        severity: string;
        plugin: string;
        code: string;
        message: string;
        pages: string;
        example: string;
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
};

type BuildSimplifiedAuditPagesInput = {
    outputDir: string;
    origin: string;
    startedAt: Date;
    endedAt: Date;
    issues: IssueEntry[];
    inventory: InventoryEntry[];
    plugins: PluginSummary[];
};

const templatePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resources/templates/simplified-audit.ejs",
);
const templateSource = readFileSync(templatePath, "utf8");

const translations: Record<SimplifiedAuditLocale, TranslationBundle> = {
    fr: {
        htmlLang: "fr",
        pageTitle: "Rapport d’audit simplifié",
        lead: "Version synthétique orientée publication CMS, basée sur les constats accessibilité alignés EN 301 549 produits par Web Auditor.",
        copyButton: "Copier le contenu HTML",
        copySuccess: "Le contenu HTML a été copié dans le presse-papier.",
        copyError: "La copie a échoué. Vérifiez les permissions du navigateur.",
        generatedNotice:
            "Cette page est générée automatiquement et doit être relue avant publication.",
        sectionWhy: "1. Pourquoi recevez-vous ce rapport ?",
        whyParagraphs: [
            "Cette page présente une synthèse simplifiée des constats accessibilité relevés pendant l’audit du site.",
            "Le contenu est formulé en référence à la norme européenne EN 301 549 et vise à faciliter la mise à jour d’une page publique de rapport d’audit.",
        ],
        sectionHow: "2. Comment lire et comprendre ce rapport ?",
        howParagraphs: [
            "Le statut affiché ci-dessous est un statut indicatif calculé à partir des constats accessibilité générés par Web Auditor.",
            "Les tableaux regroupent les non-conformités par règle technique et indiquent le nombre de pages touchées ainsi qu’un exemple d’URL.",
        ],
        howBullets: [
            "Le rapport simplifié se concentre sur les constats accessibilité et exclut volontairement les constats SEO, sécurité ou performance.",
            "Les messages techniques repris dans l’annexe sont conservés tels qu’émis par le moteur d’audit.",
            "Une validation humaine reste nécessaire avant publication officielle.",
        ],
        sectionResults: "3. Résultats du contrôle simplifié",
        generalInfo: "Informations générales",
        siteName: "Nom du site",
        siteUrl: "URL du site",
        auditDate: "Date du contrôle",
        auditStartedAt: "Début de l’audit",
        auditEndedAt: "Fin de l’audit",
        auditType: "Type d’audit",
        auditTypeValue: "Simplifié automatisé",
        standard: "Référentiel",
        standardValue: "EN 301 549",
        auditTool: "Outil d’audit",
        auditToolValue: "Web Auditor",
        pagesChecked: "Nombre de pages vérifiées",
        provisionalStatus: "Statut indicatif",
        complianceStatusLabel: "Statut de conformité",
        summaryTitle: "Vue d’ensemble",
        summaryLead:
            "Le résumé ci-dessous se base uniquement sur les constats accessibilité détectés pendant l’audit.",
        summaryCards: {
            findings: "Constats",
            ruleGroups: "Groupes de règles",
            affectedPages: "Pages touchées",
            plugins: "Sources d’audit",
        },
        status: {
            compliant: "Conforme",
            partiallyCompliant: "Partiellement conforme",
            nonCompliant: "Non conforme",
        },
        statusDescriptions: {
            compliant:
                "Aucun constat accessibilité n’a été relevé par les contrôles pris en compte dans cette synthèse.",
            partiallyCompliant:
                "Des avertissements accessibilité ont été détectés. Une revue humaine est nécessaire pour statuer définitivement.",
            nonCompliant:
                "Au moins une non-conformité accessibilité de sévérité erreur a été détectée dans les contrôles pris en compte.",
        },
        pluginBreakdownTitle: "Répartition par source d’audit",
        findingsTitle: "Constats techniques regroupés",
        noFindings: "Aucun constat accessibilité n’a été relevé pour cette synthèse.",
        findingsLead:
            "Les constats sont regroupés par code technique afin de faciliter la publication d’un résumé éditorial.",
        columns: {
            severity: "Sévérité",
            plugin: "Source",
            code: "Code",
            message: "Message technique",
            pages: "Pages",
            example: "Exemple d’URL",
        },
        severity: {
            error: "Erreur",
            warning: "Avertissement",
            info: "Info",
        },
        appendixTitle: "Annexe technique",
        appendixParagraph:
            "Cette annexe reprend les messages bruts du moteur pour aider à préparer un contenu plus éditorial dans le CMS.",
        rawMessagesNotice:
            "Les messages ci-dessous sont affichés tels quels et peuvent nécessiter une reformulation manuelle.",
        breakdownErrors: "Erreurs",
        breakdownWarnings: "Avertissements",
        breakdownInfos: "Infos",
        occurrences: "Occurrences",
    },
    nl: {
        htmlLang: "nl",
        pageTitle: "Vereenvoudigd auditrapport",
        lead: "Beknopte versie voor CMS-publicatie, gebaseerd op EN 301 549-gerichte toegankelijkheidsbevindingen uit Web Auditor.",
        copyButton: "HTML-inhoud kopiëren",
        copySuccess: "De HTML-inhoud werd naar het klembord gekopieerd.",
        copyError: "Kopiëren is mislukt. Controleer de browserrechten.",
        generatedNotice:
            "Deze pagina wordt automatisch gegenereerd en moet vóór publicatie worden nagelezen.",
        sectionWhy: "1. Waarom ontvangt u dit rapport?",
        whyParagraphs: [
            "Deze pagina geeft een vereenvoudigde samenvatting van de toegankelijkheidsbevindingen die tijdens de audit van de site werden vastgesteld.",
            "De inhoud verwijst naar de Europese norm EN 301 549 en is bedoeld om een publieke auditrapportpagina eenvoudiger bij te werken.",
        ],
        sectionHow: "2. Hoe leest en begrijpt u dit rapport?",
        howParagraphs: [
            "De hieronder getoonde status is een indicatieve status die wordt berekend op basis van toegankelijkheidsbevindingen uit Web Auditor.",
            "De tabellen groeperen de technische bevindingen per regel en tonen het aantal betrokken pagina’s en een voorbeeld-URL.",
        ],
        howBullets: [
            "Dit vereenvoudigde rapport focust uitsluitend op toegankelijkheidsbevindingen en laat SEO-, veiligheids- en performantiebevindingen buiten beschouwing.",
            "De technische boodschappen in de bijlage blijven ongewijzigd zoals ze door de auditmotor werden geproduceerd.",
            "Een menselijke validatie blijft noodzakelijk vóór officiële publicatie.",
        ],
        sectionResults: "3. Resultaten van de vereenvoudigde controle",
        generalInfo: "Algemene informatie",
        siteName: "Naam van de site",
        siteUrl: "URL van de site",
        auditDate: "Controledatum",
        auditStartedAt: "Start van de audit",
        auditEndedAt: "Einde van de audit",
        auditType: "Type audit",
        auditTypeValue: "Vereenvoudigd geautomatiseerd",
        standard: "Norm",
        standardValue: "EN 301 549",
        auditTool: "Audittool",
        auditToolValue: "Web Auditor",
        pagesChecked: "Aantal gecontroleerde pagina’s",
        provisionalStatus: "Indicatieve status",
        complianceStatusLabel: "Conformiteitsstatus",
        summaryTitle: "Overzicht",
        summaryLead:
            "Het onderstaande overzicht is uitsluitend gebaseerd op toegankelijkheidsbevindingen uit de audit.",
        summaryCards: {
            findings: "Bevindingen",
            ruleGroups: "Regelgroepen",
            affectedPages: "Getroffen pagina’s",
            plugins: "Auditbronnen",
        },
        status: {
            compliant: "Conform",
            partiallyCompliant: "Gedeeltelijk conform",
            nonCompliant: "Niet conform",
        },
        statusDescriptions: {
            compliant:
                "Er werden geen toegankelijkheidsbevindingen gedetecteerd binnen de controles die in deze synthese zijn opgenomen.",
            partiallyCompliant:
                "Er werden toegankelijkheidswaarschuwingen gedetecteerd. Een menselijke beoordeling blijft nodig voor een definitieve conclusie.",
            nonCompliant:
                "Er werd minstens één toegankelijkheidsfout met ernstniveau error gedetecteerd binnen de opgenomen controles.",
        },
        pluginBreakdownTitle: "Verdeling per auditbron",
        findingsTitle: "Gegroepeerde technische bevindingen",
        noFindings: "Er werden geen toegankelijkheidsbevindingen opgenomen in deze synthese.",
        findingsLead:
            "De bevindingen zijn per technische code gegroepeerd om de publicatie van een redactionele samenvatting te vergemakkelijken.",
        columns: {
            severity: "Ernst",
            plugin: "Bron",
            code: "Code",
            message: "Technische boodschap",
            pages: "Pagina’s",
            example: "Voorbeeld-URL",
        },
        severity: {
            error: "Fout",
            warning: "Waarschuwing",
            info: "Info",
        },
        appendixTitle: "Technische bijlage",
        appendixParagraph:
            "Deze bijlage herneemt de ruwe boodschappen van de auditmotor om een meer redactionele CMS-tekst te helpen voorbereiden.",
        rawMessagesNotice:
            "De onderstaande boodschappen worden ongewijzigd weergegeven en kunnen manuele herformulering vereisen.",
        breakdownErrors: "Fouten",
        breakdownWarnings: "Waarschuwingen",
        breakdownInfos: "Info",
        occurrences: "Voorkomens",
    },
    de: {
        htmlLang: "de",
        pageTitle: "Vereinfachter Auditbericht",
        lead: "Kompakte Fassung für die Veröffentlichung im CMS auf Basis von EN 301 549-orientierten Barrierefreiheitsbefunden aus Web Auditor.",
        copyButton: "HTML-Inhalt kopieren",
        copySuccess: "Der HTML-Inhalt wurde in die Zwischenablage kopiert.",
        copyError: "Das Kopieren ist fehlgeschlagen. Bitte die Browserberechtigungen prüfen.",
        generatedNotice:
            "Diese Seite wird automatisch erzeugt und muss vor der Veröffentlichung geprüft werden.",
        sectionWhy: "1. Warum erhalten Sie diesen Bericht?",
        whyParagraphs: [
            "Diese Seite bietet eine vereinfachte Zusammenfassung der Barrierefreiheitsbefunde, die während des Audits der Website festgestellt wurden.",
            "Die Inhalte beziehen sich auf die europäische Norm EN 301 549 und sollen die Aktualisierung einer öffentlichen Auditseite erleichtern.",
        ],
        sectionHow: "2. Wie ist dieser Bericht zu lesen und zu verstehen?",
        howParagraphs: [
            "Der unten angezeigte Status ist ein indikatives Ergebnis auf Basis der von Web Auditor erzeugten Barrierefreiheitsbefunde.",
            "Die Tabellen gruppieren die technischen Befunde nach Regel und zeigen die Anzahl betroffener Seiten sowie eine Beispiel-URL.",
        ],
        howBullets: [
            "Dieser vereinfachte Bericht konzentriert sich ausschließlich auf Barrierefreiheitsbefunde und blendet SEO-, Sicherheits- und Performancebefunde aus.",
            "Die technischen Meldungen im Anhang werden unverändert aus der Audit-Engine übernommen.",
            "Vor einer offiziellen Veröffentlichung ist weiterhin eine menschliche Prüfung erforderlich.",
        ],
        sectionResults: "3. Ergebnisse der vereinfachten Prüfung",
        generalInfo: "Allgemeine Informationen",
        siteName: "Name der Website",
        siteUrl: "URL der Website",
        auditDate: "Prüfdatum",
        auditStartedAt: "Beginn des Audits",
        auditEndedAt: "Ende des Audits",
        auditType: "Audittyp",
        auditTypeValue: "Vereinfachte automatisierte Prüfung",
        standard: "Norm",
        standardValue: "EN 301 549",
        auditTool: "Auditwerkzeug",
        auditToolValue: "Web Auditor",
        pagesChecked: "Geprüfte Seiten",
        provisionalStatus: "Indikativer Status",
        complianceStatusLabel: "Konformitätsstatus",
        summaryTitle: "Überblick",
        summaryLead:
            "Die folgende Zusammenfassung basiert ausschließlich auf den während des Audits erkannten Barrierefreiheitsbefunden.",
        summaryCards: {
            findings: "Befunde",
            ruleGroups: "Regelgruppen",
            affectedPages: "Betroffene Seiten",
            plugins: "Auditquellen",
        },
        status: {
            compliant: "Konform",
            partiallyCompliant: "Teilweise konform",
            nonCompliant: "Nicht konform",
        },
        statusDescriptions: {
            compliant:
                "In den für diese Zusammenfassung berücksichtigten Prüfungen wurden keine Barrierefreiheitsbefunde festgestellt.",
            partiallyCompliant:
                "Es wurden Warnungen zur Barrierefreiheit festgestellt. Für eine endgültige Bewertung ist weiterhin eine menschliche Prüfung erforderlich.",
            nonCompliant:
                "Mindestens ein Barrierefreiheitsbefund mit dem Schweregrad error wurde in den berücksichtigten Prüfungen festgestellt.",
        },
        pluginBreakdownTitle: "Verteilung nach Auditquelle",
        findingsTitle: "Gruppierte technische Befunde",
        noFindings: "Für diese Zusammenfassung wurden keine Barrierefreiheitsbefunde festgestellt.",
        findingsLead:
            "Die Befunde sind nach technischem Code gruppiert, um die Erstellung einer redaktionellen Zusammenfassung zu erleichtern.",
        columns: {
            severity: "Schweregrad",
            plugin: "Quelle",
            code: "Code",
            message: "Technische Meldung",
            pages: "Seiten",
            example: "Beispiel-URL",
        },
        severity: {
            error: "Fehler",
            warning: "Warnung",
            info: "Info",
        },
        appendixTitle: "Technischer Anhang",
        appendixParagraph:
            "Dieser Anhang enthält die Rohmeldungen der Audit-Engine, um die Erstellung redaktioneller Inhalte im CMS zu erleichtern.",
        rawMessagesNotice:
            "Die folgenden Meldungen werden unverändert dargestellt und können eine manuelle Umformulierung erfordern.",
        breakdownErrors: "Fehler",
        breakdownWarnings: "Warnungen",
        breakdownInfos: "Infos",
        occurrences: "Vorkommen",
    },
    en: {
        htmlLang: "en",
        pageTitle: "Simplified Audit Report",
        lead: "Compact CMS-ready version based on EN 301 549-oriented accessibility findings produced by Web Auditor.",
        copyButton: "Copy HTML content",
        copySuccess: "The HTML content has been copied to the clipboard.",
        copyError: "Copy failed. Please check browser permissions.",
        generatedNotice:
            "This page is generated automatically and should be reviewed before publication.",
        sectionWhy: "1. Why are you receiving this report?",
        whyParagraphs: [
            "This page provides a simplified summary of the accessibility findings identified during the audit of the website.",
            "The content is framed against the EN 301 549 European standard and is intended to make it easier to update a public audit report page.",
        ],
        sectionHow: "2. How should this report be read and understood?",
        howParagraphs: [
            "The status shown below is an indicative status calculated from the accessibility findings produced by Web Auditor.",
            "The tables group technical findings by rule and show the number of impacted pages as well as one example URL.",
        ],
        howBullets: [
            "This simplified report focuses only on accessibility findings and intentionally excludes SEO, security and performance findings.",
            "The technical messages in the appendix are kept exactly as emitted by the audit engine.",
            "Human validation is still required before any official publication.",
        ],
        sectionResults: "3. Simplified audit results",
        generalInfo: "General information",
        siteName: "Site name",
        siteUrl: "Site URL",
        auditDate: "Audit date",
        auditStartedAt: "Audit started",
        auditEndedAt: "Audit ended",
        auditType: "Audit type",
        auditTypeValue: "Simplified automated audit",
        standard: "Standard",
        standardValue: "EN 301 549",
        auditTool: "Audit tool",
        auditToolValue: "Web Auditor",
        pagesChecked: "Checked pages",
        provisionalStatus: "Indicative status",
        complianceStatusLabel: "Compliance status",
        summaryTitle: "Overview",
        summaryLead:
            "The summary below is based only on accessibility findings detected during the audit.",
        summaryCards: {
            findings: "Findings",
            ruleGroups: "Rule groups",
            affectedPages: "Impacted pages",
            plugins: "Audit sources",
        },
        status: {
            compliant: "Compliant",
            partiallyCompliant: "Partially compliant",
            nonCompliant: "Non-compliant",
        },
        statusDescriptions: {
            compliant:
                "No accessibility findings were detected by the checks included in this summary.",
            partiallyCompliant:
                "Accessibility warnings were detected. Human review is still required before drawing a final conclusion.",
            nonCompliant:
                "At least one accessibility finding with error severity was detected by the checks included in this summary.",
        },
        pluginBreakdownTitle: "Breakdown by audit source",
        findingsTitle: "Grouped technical findings",
        noFindings: "No accessibility findings were detected for this summary.",
        findingsLead:
            "Findings are grouped by technical code to make editorial publication easier.",
        columns: {
            severity: "Severity",
            plugin: "Source",
            code: "Code",
            message: "Technical message",
            pages: "Pages",
            example: "Example URL",
        },
        severity: {
            error: "Error",
            warning: "Warning",
            info: "Info",
        },
        appendixTitle: "Technical appendix",
        appendixParagraph:
            "This appendix keeps the raw engine messages to help prepare more editorial wording in the CMS.",
        rawMessagesNotice:
            "The messages below are displayed verbatim and may require manual rewriting.",
        breakdownErrors: "Errors",
        breakdownWarnings: "Warnings",
        breakdownInfos: "Infos",
        occurrences: "Occurrences",
    },
};

export async function writeSimplifiedAuditPages(
    input: BuildSimplifiedAuditPagesInput,
): Promise<void> {
    await fs.mkdir(input.outputDir, { recursive: true });

    const locales: SimplifiedAuditLocale[] = ["fr", "nl", "de", "en"];
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
    };
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
