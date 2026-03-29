import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

import type { CrawlCompletionSummary } from "./CrawlCompletionSummary.js";

const templatePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resources/templates/crawl-completion.ejs",
);

const templateSource = readFileSync(templatePath, "utf8");

export function renderCrawlCompletionPage(summary: CrawlCompletionSummary): string {
    return ejs.render(templateSource, {
        summary,
        formatValue,
        pluginAnchor,
    });
}

function formatValue(value: string | number | boolean): string {
    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }

    return String(value);
}

function pluginAnchor(pluginName: string): string {
    return `plugin-${pluginName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}
