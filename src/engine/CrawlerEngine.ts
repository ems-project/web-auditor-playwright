import path from "node:path";

import { chromium, type ConsoleMessage } from "playwright";

import { ErrorUtils } from "../utils/ErrorUtils.js";
import { AuditStore } from "./AuditStore.js";
import { PluginRegistry } from "./PluginRegistry.js";
import { RateLimiter } from "./RateLimiter.js";
import { createInitialReport } from "./report.js";
import type {
    CrawlOptions,
    EngineState,
    EnqueueRequest,
    EnqueueResult,
    NextUrlCandidate,
    ResourceContext,
    UrlRejectionReason,
} from "./types.js";
import {
    getStatusMessage,
    isAllowedHost,
    normalizeHost,
    normalizeUrl,
    parseMime,
} from "./utils.js";

type UrlDecision = { allowed: true } | { allowed: false; reason: UrlRejectionReason };

export class CrawlerEngine {
    private readonly rateLimiter: RateLimiter;
    private stopRequested = false;
    private currentState?: EngineState;
    private readonly store: AuditStore;
    private currentRunId?: number;

    constructor(
        private opts: CrawlOptions,
        private registry: PluginRegistry,
    ) {
        this.rateLimiter = new RateLimiter(this.opts.rateLimitMs);
        this.store = new AuditStore(path.join(this.opts.reportDir, "audit.db"));
        this.store.initSchema();
    }

    async run(): Promise<EngineState> {
        const initialStart = normalizeUrl(this.opts.startUrl);

        let runId: number;
        let start = initialStart;
        let state: EngineState;
        let allowedHosts: ReadonlySet<string>;

        if (typeof this.opts.resumeRunId === "number") {
            const resumeRunId = this.opts.resumeRunId;
            const existingRun = this.store.getRun(resumeRunId);
            if (!existingRun) {
                throw new Error(`Run ${resumeRunId} not found in audit database`);
            }

            this.store.resumeRun(resumeRunId);
            const runSnapshot = this.store.getRunSnapshot(resumeRunId);
            if (!runSnapshot) {
                throw new Error(`Run ${resumeRunId} not found in audit database`);
            }

            start = normalizeUrl(runSnapshot.startUrl);
            runId = resumeRunId;

            state = {
                startedAt: new Date(runSnapshot.startedAt),
                origin: new URL(start).origin,
                seen: new Set(runSnapshot.normalizedUrls),
                processedCount: runSnapshot.processedCount,
                successCount: Math.max(0, runSnapshot.processedCount - runSnapshot.errorCount),
                infoCount: runSnapshot.infoCount,
                warningCount: runSnapshot.warningCount,
                errorCount: runSnapshot.errorCount,
                queueSize: runSnapshot.queuedCount,
                activeWorkers: 0,
                maxPages: this.opts.maxPages,
                any: this.store.loadPluginState(resumeRunId),
                stopRequested: false,
            };
            allowedHosts = this.buildAllowedHosts(start);
        } else {
            runId = this.store.createRun({ startUrl: start });
            state = {
                startedAt: new Date(),
                origin: new URL(start).origin,
                seen: new Set(),
                processedCount: 0,
                successCount: 0,
                infoCount: 0,
                warningCount: 0,
                errorCount: 0,
                queueSize: 0,
                activeWorkers: 0,
                maxPages: this.opts.maxPages,
                any: {},
                stopRequested: false,
            };
            allowedHosts = this.buildAllowedHosts(start);
            this.enqueueUrl(
                { url: start, depth: 0, source: "engine:start" },
                runId,
                state,
                allowedHosts,
            );
        }

        this.currentRunId = runId;
        state.any["runId"] = runId;
        this.currentState = state;

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: this.opts.userAgent,
            ignoreHTTPSErrors: this.opts.ignoreHttpsError,
        });

        const processOne = async (item: NextUrlCandidate) => {
            state.activeWorkers += 1;

            const page = await context.newPage();
            page.setDefaultNavigationTimeout(this.opts.navTimeoutMs);

            const consoleLogs: ResourceContext["console"] = [];
            const pageErrors: string[] = [];
            let failedInStore = false;

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
                            runId,
                            state,
                            allowedHosts,
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
                await this.registry.runPhase("process", ctx);

                if (!ctx.report.is_web) {
                    ctx.downloadTrigger = "inline-resource";
                    await this.registry.runPhase("download", ctx);
                } else {
                    await this.registry.runPhase("periodic", ctx);
                }
                state.successCount += 1;
            } catch (e: unknown) {
                const download = await downloadPromise;
                if (download) {
                    ctx.download = download;
                    ctx.downloadTrigger = "playwright-download";
                    await this.registry.runPhase("download", ctx);
                    state.successCount += 1;
                } else {
                    const errorMessage = ErrorUtils.errorMessage(
                        "Failed to open or download the url",
                        e,
                    );
                    ctx.findings.push({
                        plugin: "engine",
                        category: "network",
                        type: "error",
                        code: "NAVIGATION_FAILED",
                        message: errorMessage,
                        url: ctx.url,
                    });
                    this.store.markUrlFailed(runId, item.id, errorMessage);
                    failedInStore = true;
                    await this.registry.runPhase("error", ctx);
                    state.errorCount += 1;
                }
            } finally {
                await this.registry.runPhase("beforeFinally", ctx);
                if (!ctx.audited) {
                    state.warningCount += 1;
                    ctx.findings.push({
                        plugin: "engine",
                        category: "resources",
                        type: "warning",
                        code: "URL_NOT_AUDITED",
                        message: "This URL is not supported",
                        url: ctx.url,
                    });
                }
                state.processedCount += 1;
                state.activeWorkers -= 1;

                await page.close();
                ctx.report.auditors = ctx.auditors;
                await this.registry.runPhase("finally", ctx);

                if (!failedInStore) {
                    this.persistProcessedUrl(runId, item.id, ctx, allowedHosts);
                }
            }
        };

        try {
            let visited = state.processedCount;
            while (visited < this.opts.maxPages) {
                const batch: NextUrlCandidate[] = [];
                while (
                    batch.length < this.opts.concurrency &&
                    visited + batch.length < this.opts.maxPages
                ) {
                    const next = this.store.claimNextQueuedUrl(runId);
                    if (!next) {
                        break;
                    }
                    batch.push(next);
                    state.queueSize = Math.max(0, state.queueSize - 1);
                }

                if (batch.length === 0) {
                    break;
                }

                await Promise.all(batch.map(processOne));
                visited += batch.length;

                if (this.stopRequested) {
                    state.queueSize = 0;
                    break;
                }
            }

            await context.close();
            await browser.close();

            if (this.stopRequested) {
                state.stopConfirmedAt = new Date().toISOString();
            }
            this.store.finishRun(runId, "finished");

            return state;
        } catch (error) {
            this.store.finishRun(runId, "failed");
            throw error;
        } finally {
            this.store.savePluginState(runId, state.any);
            this.currentState = undefined;
        }
    }

    private enqueueUrl(
        request: EnqueueRequest,
        runId: number,
        state: EngineState,
        allowedHosts: ReadonlySet<string>,
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

        if (!isAllowedHost(normalizedUrl, allowedHosts)) {
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

        const reservedCount = state.processedCount + state.queueSize + state.activeWorkers;
        if (reservedCount >= this.opts.maxPages) {
            return {
                accepted: false,
                normalizedUrl,
                reason: "max_pages_reached",
            };
        }

        const inserted = this.store.enqueueUrl({
            runId,
            url: request.url,
            normalizedUrl,
            depth,
            sourceUrl: request.source ?? null,
        });

        if (!inserted) {
            return {
                accepted: false,
                normalizedUrl,
                reason: "already_seen",
            };
        }

        state.seen.add(normalizedUrl);
        state.queueSize += 1;

        return {
            accepted: true,
            normalizedUrl,
        };
    }

    private persistProcessedUrl(
        runId: number,
        urlId: number,
        ctx: ResourceContext,
        allowedHosts: ReadonlySet<string>,
    ): void {
        const discoveredLinks = (ctx.report.links ?? [])
            .map((link) => {
                try {
                    const normalizedToUrl = normalizeUrl(link.url);
                    return {
                        toUrl: link.url,
                        normalizedToUrl,
                        linkText: link.text ?? null,
                        tag: link.tag ?? link.type ?? null,
                        target: link.target ?? null,
                        nofollow: false,
                        isInternal: isAllowedHost(normalizedToUrl, allowedHosts),
                        enqueueResult: link.enqueueResult,
                    };
                } catch {
                    return null;
                }
            })
            .filter((link): link is NonNullable<typeof link> => link !== null);

        this.store.persistPageResult({
            runId,
            urlId,
            httpStatus: ctx.status ?? null,
            contentType: ctx.downloaded?.mime ?? ctx.report.mimetype ?? ctx.mime ?? null,
            pageTitle: ctx.report.title ?? ctx.report.meta_title ?? null,
            findings: ctx.findings.map((finding) => ({
                plugin: finding.plugin,
                category: finding.category,
                code: finding.code,
                severity: finding.type,
                message: finding.message,
                resourceUrl: finding.url,
                payload: finding.data,
            })),
            discoveredLinks,
        });
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

    private buildAllowedHosts(startUrl: string): ReadonlySet<string> {
        const allowedHosts = new Set<string>([normalizeHost(startUrl)]);

        for (const value of this.opts.allowedHosts ?? []) {
            try {
                allowedHosts.add(normalizeHost(value));
            } catch {
                continue;
            }
        }

        return allowedHosts;
    }

    getCurrentRunId(): number | undefined {
        return this.currentRunId;
    }

    requestStop(): void {
        this.stopRequested = true;
        if (this.currentState) {
            this.currentState.stopRequested = true;
        }
    }

    isStopRequested(): boolean {
        return this.stopRequested;
    }
}
