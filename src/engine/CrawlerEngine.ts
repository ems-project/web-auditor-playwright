import { chromium, type ConsoleMessage } from "playwright";
import type { CrawlOptions, ResourceContext, EngineState } from "./types.js";
import { PluginRegistry } from "./PluginRegistry.js";
import { normalizeUrl, parseMime, kindFromMime, isSameOrigin } from "./utils.js";
import { RateLimiter } from "./RateLimiter.js";
import { createInitialReport } from "./report.js";

export class CrawlerEngine {
    private readonly rateLimiter: RateLimiter;

    constructor(
        private opts: CrawlOptions,
        private registry: PluginRegistry,
    ) {
        this.rateLimiter = new RateLimiter(this.opts.rateLimitMs);
    }

    async run(): Promise<{ state: EngineState; results: ResourceContext[] }> {
        const start = normalizeUrl(this.opts.startUrl);
        const origin = new URL(start).origin;

        const state: EngineState = {
            startedAt: new Date().toISOString(),
            origin,
            seen: new Set([start]),
            htmlVisitedCount: 0,
            processedCount: 0,
            successCount: 0,
            errorCount: 0,
            queueSize: 1,
            activeWorkers: 0,
            maxPages: this.opts.maxPages,
            any: {},
        };

        const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
        const results: ResourceContext[] = [];

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: this.opts.userAgent,
        });

        const processOne = async (item: { url: string; depth: number }) => {
            state.activeWorkers += 1;
            state.queueSize = queue.length;

            const page = await context.newPage();
            page.setDefaultNavigationTimeout(this.opts.navTimeoutMs);

            const consoleLogs: ResourceContext["console"] = [];
            const pageErrors: string[] = [];

            page.on("console", (msg: ConsoleMessage) => {
                const type = msg.type();
                if (["error", "warning"].includes(type)) {
                    const loc = msg.location();
                    consoleLogs.push({
                        type,
                        text: msg.text(),
                        location: loc?.url
                            ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}`
                            : undefined,
                    });
                }
            });
            page.on("pageerror", (err) => pageErrors.push(err.message));

            // contexte minimal avant navigation
            const ctx: ResourceContext = {
                url: item.url,
                depth: item.depth,
                kind: "unknown",
                page,
                context,
                console: consoleLogs,
                pageErrors,
                links: [],
                engineState: state,
                findings: [],
                report: createInitialReport({
                    url: item.url,
                    kind: "unknown",
                    status: undefined,
                    mime: undefined,
                }),
            };

            try {
                await this.registry.runPhase("beforeGoto", ctx);

                // Rate limit global avant toute navigation
                await this.rateLimiter.wait();

                const response = await page.goto(item.url, { waitUntil: "domcontentloaded" });
                ctx.response = response ?? undefined;
                ctx.status = response?.status();
                ctx.finalUrl = response?.url();

                const mime = parseMime(response?.headers()["content-type"]);
                ctx.mime = mime;
                ctx.kind = kindFromMime(mime);
                const finalTargetUrl = ctx.finalUrl ?? ctx.url;
                const parsed = new URL(finalTargetUrl);
                ctx.report.url = finalTargetUrl;
                ctx.report.redirected = ctx.url !== finalTargetUrl;
                ctx.report.host = parsed.host;
                ctx.report.base_url = parsed.pathname;
                ctx.report.timestamp = new Date().toISOString();
                ctx.report.is_web = ctx.kind === "html";
                ctx.report.status_code = ctx.status ?? null;
                ctx.report.message = ctx.response?.statusText() ?? null;
                ctx.report.mimetype = response?.headers()["content-type"] ?? ctx.mime ?? null;

                await this.registry.runPhase("afterGoto", ctx);

                // Extraction brute selon kind
                if (ctx.kind === "html") {
                    ctx.html = await page.content();

                    // liens (utile crawl + deadlinks)
                    const hrefs: string[] = await page.$$eval("a[href]", (as) =>
                        as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
                    );
                    ctx.links = hrefs;

                    // enqueue
                    for (const h of hrefs) {
                        let n: string;
                        try {
                            n = normalizeUrl(h);
                        } catch {
                            continue;
                        }

                        if (this.opts.sameOriginOnly && !isSameOrigin(n, start)) {
                            continue;
                        }
                        if (item.depth + 1 > this.opts.maxDepth) {
                            continue;
                        }
                        if (state.seen.has(n)) {
                            continue;
                        }

                        state.seen.add(n);
                        queue.push({ url: n, depth: item.depth + 1 });
                    }

                    state.htmlVisitedCount += 1;
                } else if (ctx.kind === "pdf") {
                    // récupérer le buffer PDF
                    // IMPORTANT: response.body() marche si Playwright a la réponse; sinon fallback via fetch page.request
                    const body = response ? await response.body() : undefined;
                    ctx.pdfBuffer = body ? Buffer.from(body) : undefined;
                }

                state.queueSize = queue.length;

                await this.registry.runPhase("afterExtract", ctx);

                // plugins de “process”
                await this.registry.runPhase("afterProcess", ctx);

                const hasErrorFinding = ctx.findings.some((f) => f.type === "error");
                if (hasErrorFinding) {
                    state.errorCount += 1;
                } else {
                    state.successCount += 1;
                }
            } catch (e: unknown) {
                state.errorCount += 1;
                let errorMessage = "Unknown error: " + String(e);
                if (e instanceof Error) {
                    errorMessage = e.message;
                }
                ctx.findings.push({
                    plugin: "engine",
                    type: "error",
                    code: "NAVIGATION_FAILED",
                    message: errorMessage,
                    url: ctx.url,
                });
            } finally {
                state.processedCount += 1;
                state.queueSize = queue.length;
                state.activeWorkers -= 1;

                // phase périodique (plugins peuvent décider via engineState)
                await this.registry.runPhase("periodic", ctx);

                results.push(ctx);
                await page.close();
            }
        };

        let visited = 0;
        while (queue.length > 0 && visited < this.opts.maxPages) {
            const batch: { url: string; depth: number }[] = [];
            while (
                batch.length < this.opts.concurrency &&
                queue.length > 0 &&
                visited + batch.length < this.opts.maxPages
            ) {
                batch.push(queue.shift()!);
            }

            state.queueSize = queue.length;
            await Promise.all(batch.map(processOne));
            visited += batch.length;
            state.queueSize = queue.length;
        }

        await context.close();
        await browser.close();

        return { state, results };
    }
}
