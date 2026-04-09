import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

const templatePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resources/templates/crawl-progress.ejs",
);

const templateSource = readFileSync(templatePath, "utf8");

type CrawlProgressPageModel = {
    title: string;
    refreshIntervalMs: number;
    statusApiPath: string;
    gracefulStopApiPath: string;
};

export function renderCrawlProgressPage(model: CrawlProgressPageModel): string {
    return ejs.render(templateSource, model);
}
