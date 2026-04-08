import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

import type { CrawlCompletionSummary } from "./CrawlCompletionSummary.js";
import type { ReportItemValue } from "./types.js";

const templatePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resources/templates/crawl-completion.ejs",
);

const templateSource = readFileSync(templatePath, "utf8");

export function renderCrawlCompletionPage(summary: CrawlCompletionSummary): string {
    return ejs.render(templateSource, {
        summary,
        formatValue,
        isLinkValue,
        isLinkListValue,
        pluginAnchor,
    });
}

function formatValue(value: ReportItemValue): string {
    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }

    if (isLinkValue(value)) {
        return value.label;
    }

    if (isLinkListValue(value)) {
        return value.map((item) => item.label).join(", ");
    }

    return String(value);
}

function isLinkValue(value: ReportItemValue): value is { href: string; label: string } {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "href" in value;
}

function isLinkListValue(value: ReportItemValue): value is Array<{ href: string; label: string }> {
    return Array.isArray(value);
}

function pluginAnchor(pluginName: string): string {
    return `plugin-${pluginName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}
