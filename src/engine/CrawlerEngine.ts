import { chromium, type ConsoleMessage } from "playwright";
import type {
    CrawlOptions,
    EngineState,
    EnqueueRequest,
    EnqueueResult,
    ResourceContext,
    UrlRejectionReason,
} from "./types.js";
import { PluginRegistry } from "./PluginRegistry.js";
import { getStatusMessage, isSameOrigin, normalizeUrl, parseMime } from "./utils.js";
import { RateLimiter } from "./RateLimiter.js";
import { createInitialReport } from "./report.js";
import { ErrorUtils } from "../utils/ErrorUtils.js";

type UrlDecision = { allowed: true } | { allowed: false; reason: UrlRejectionReason };

export class CrawlerEngine {
    private readonly rateLimiter: RateLimiter;
    private stopRequested = false;
    private currentState?: EngineState;

    constructor(
        private opts: CrawlOptions,
        private registry: PluginRegistry,
    ) {
        this.rateLimiter = new RateLimiter(this.opts.rateLimitMs);
    }

    async run(): Promise<EngineState> {
        const start = normalizeUrl(this.opts.startUrl);
        const origin = new URL(start).origin;

        const state: EngineState = {
            startedAt: new Date(),
            origin,
            seen: new Set(),
            processedCount: 0,
            successCount: 0,
            infoCount: 0,
            warningCount: 0,
            errorCount: 0,
            queueSize: 1,
            activeWorkers: 0,
            maxPages: this.opts.maxPages,
            any: {},
            findings: [],
            inventory: [],
            stopRequested: false,
        };
        this.currentState = state;

        const queue: { url: string; depth: number }[] = [];
        this.enqueueUrl({ url: start, depth: 0, source: "engine:start" }, queue, state, start);

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: this.opts.userAgent,
            ignoreHTTPSErrors: this.opts.ignoreHttpsError,
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

            const ctx: ResourceContext = {
                url: item.url,
                depth: item.depth,
                page,
                context,
                console: consoleLogs,
                pageErrors,
                engineState: state,
                findings: [],
                crawler: {
                    enqueueUrl: (request: EnqueueRequest): EnqueueResult => {
                        const effectiveDepth = request.depth ?? item.depth + 1;
                        return this.enqueueUrl(
                            {
                                ...request,
                                depth: effectiveDepth,
                            },
                            queue,
                            state,
                            start,
                        );
                    },
                },
                report: createInitialReport({
                    url: item.url,
                    status: undefined,
                    mime: undefined,
                }),
            };
            const downloadPromise = page
                .waitForEvent("download", { timeout: 5000 })
                .catch(() => null);

            try {
                await this.rateLimiter.wait();
                await this.registry.runPhase("beforeGoto", ctx);

                const response = await page.goto(item.url, { waitUntil: "domcontentloaded" });
                ctx.response = response ?? undefined;
                ctx.status = response?.status();
                ctx.finalUrl = response?.url();
                const statusMessage =
                    ctx.response?.statusText() || getStatusMessage(ctx.status) || null;

                if (!ctx.status) {
                    ctx.findings.push({
                        plugin: "engine",
                        category: "network",
                        type: "error",
                        code: "MISSING_RETURN_CODE",
                        message: "Return code is missing",
                        url: ctx.url,
                    });
                } else if (ctx.status >= 400) {
                    ctx.findings.push({
                        plugin: "engine",
                        category: "network",
                        type: "error",
                        code: "UNEXPECTED_RETURN_CODE",
                        message: ctx.status + ": " + (statusMessage ?? ""),
                        url: ctx.url,
                    });
                } else if (ctx.status >= 300) {
                    ctx.findings.push({
                        plugin: "engine",
                        category: "network",
                        type: "warning",
                        code: "UNEXPECTED_RETURN_CODE",
                        message: ctx.status + ": " + (statusMessage ?? ""),
                        url: ctx.url,
                    });
                }

                ctx.mime = parseMime(response?.headers()["content-type"]);
                const size = response?.headers()["content-length"]
                    ? Number(response?.headers()["content-length"])
                    : null;
                const finalTargetUrl = ctx.finalUrl ?? ctx.url;
                const parsed = new URL(finalTargetUrl);
                ctx.report.url = finalTargetUrl;
                ctx.report.redirected = ctx.url !== finalTargetUrl;
                ctx.report.host = parsed.host;
                ctx.report.base_url = parsed.pathname;
                ctx.report.timestamp = new Date().toISOString();
                ctx.report.status_code = ctx.status ?? null;
                ctx.report.message = statusMessage;
                ctx.report.mimetype = response?.headers()["content-type"] ?? ctx.mime ?? null;
                ctx.report.size = size;

                await this.registry.runPhase("afterGoto", ctx);

                state.queueSize = queue.length;

                await this.registry.runPhase("process", ctx);

                if (!ctx.report.is_web) {
                    ctx.downloadTrigger = "inline-resource";
                    await this.registry.runPhase("download", ctx);
                } else {
                    await this.registry.runPhase("periodic", ctx);
                }
            } catch (e: unknown) {
                const download = await downloadPromise;
                if (download) {
                    ctx.download = download;
                    ctx.downloadTrigger = "playwright-download";
                    await this.registry.runPhase("download", ctx);
                } else {
                    ctx.findings.push({
                        plugin: "engine",
                        category: "network",
                        type: "error",
                        code: "NAVIGATION_FAILED",
                        message: ErrorUtils.errorMessage("Failed to open or download the url", e),
                        url: ctx.url,
                    });
                    await this.registry.runPhase("error", ctx);
                }
            } finally {
                await this.registry.runPhase("beforeFinally", ctx);
                if (ctx.findings.some((f) => f.type === "info")) {
                    state.infoCount += 1;
                }
                if (ctx.findings.some((f) => f.type === "warning")) {
                    state.warningCount += 1;
                }
                const hasErrorFinding = ctx.findings.some((f) => f.type === "error");
                if (hasErrorFinding) {
                    state.errorCount += 1;
                } else if (!ctx.audited) {
                    state.warningCount += 1;
                    ctx.findings.push({
                        plugin: "engine",
                        category: "resources",
                        type: "warning",
                        code: "URL_NOT_AUDITED",
                        message: "This URL is not supported",
                        url: ctx.url,
                    });
                    state.successCount += 1;
                } else {
                    state.successCount += 1;
                }
                state.processedCount += 1;
                state.queueSize = queue.length;
                state.activeWorkers -= 1;

                await page.close();
                ctx.report.auditors = ctx.auditors;
                state.findings.push(...ctx.findings);
                state.inventory.push({
                    depth: ctx.depth,
                    mime: ctx.mime,
                    status: ctx.status,
                    url: ctx.url,
                });
                await this.registry.runPhase("finally", ctx);
            }
        };

        try {
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

                if (this.stopRequested) {
                    queue.length = 0;
                    state.queueSize = 0;
                    break;
                }
            }

            await context.close();
            await browser.close();

            return state;
        } finally {
            this.currentState = undefined;
        }
    }

    private enqueueUrl(
        request: EnqueueRequest,
        queue: Array<{ url: string; depth: number }>,
        state: EngineState,
        startUrl: string,
    ): EnqueueResult {
        if (this.stopRequested) {
            return {
                accepted: false,
                reason: "stop_requested",
            };
        }

        let normalizedUrl: string;
        try {
            normalizedUrl = normalizeUrl(request.url);
        } catch {
            return {
                accepted: false,
                reason: "invalid_url",
            };
        }

        const depth = request.depth ?? 0;

        if (depth > this.opts.maxDepth) {
            return {
                accepted: false,
                normalizedUrl,
                reason: "max_depth_reached",
            };
        }

        if (this.opts.sameOriginOnly && !isSameOrigin(normalizedUrl, startUrl)) {
            return {
                accepted: false,
                normalizedUrl,
                reason: "cross_origin_blocked",
            };
        }

        const decision = this.evaluateUrl(normalizedUrl);
        if (!decision.allowed) {
            return {
                accepted: false,
                normalizedUrl,
                reason: decision.reason,
            };
        }

        if (state.seen.has(normalizedUrl)) {
            return {
                accepted: false,
                normalizedUrl,
                reason: "already_seen",
            };
        }

        const reservedCount = state.processedCount + queue.length + state.activeWorkers;
        if (reservedCount >= this.opts.maxPages) {
            return {
                accepted: false,
                normalizedUrl,
                reason: "max_pages_reached",
            };
        }

        state.seen.add(normalizedUrl);
        queue.push({
            url: normalizedUrl,
            depth,
        });
        state.queueSize = queue.length;

        return {
            accepted: true,
            normalizedUrl,
        };
    }

    private evaluateUrl(url: string): UrlDecision {
        const { urlAllowlist, urlBlocklist } = this.opts;

        if (urlAllowlist && urlAllowlist.length > 0) {
            const matches = urlAllowlist.some((r) => {
                r.lastIndex = 0;
                return r.test(url);
            });

            if (!matches) {
                return { allowed: false, reason: "not_in_allowlist" };
            }
        }

        if (urlBlocklist && urlBlocklist.length > 0) {
            const blocked = urlBlocklist.some((r) => {
                r.lastIndex = 0;
                return r.test(url);
            });

            if (blocked) {
                return { allowed: false, reason: "blocked_by_blocklist" };
            }
        }

        return { allowed: true };
    }

    public requestStop(): void {
        if (this.stopRequested) {
            return;
        }

        this.stopRequested = true;

        if (this.currentState) {
            this.currentState.stopRequested = true;
            this.currentState.stopConfirmedAt ??= new Date().toISOString();
        }
    }

    public isStopRequested(): boolean {
        return this.stopRequested;
    }
}
