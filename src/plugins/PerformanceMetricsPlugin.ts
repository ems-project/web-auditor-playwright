import type { Page, Request, Response } from "playwright";

import { BasePlugin } from "../engine/BasePlugin.js";
import type {
    EngineState,
    IPlugin,
    PluginPhase,
    Report,
    ResourceContext,
} from "../engine/types.js";

type PerformanceMetricsPluginOptions = {
    auditOnlyStartUrl?: boolean;
    slowResourceThresholdMs?: number;
    largeResourceThresholdBytes?: number;
    maxReportedResources?: number;
    highResourceCountThreshold?: number;
    largeTransferThresholdBytes?: number;
    slowLoadThresholdMs?: number;
    slowDomContentLoadedThresholdMs?: number;
};

type TrackedResource = {
    url: string;
    type: string;
    method: string;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    status?: number | null;
    transferSize?: number | null;
    encodedBodySize?: number | null;
    decodedBodySize?: number | null;
    failed?: boolean;
    failureText?: string | null;
};

type NavigationMetrics = {
    domContentLoadedMs: number | null;
    loadMs: number | null;
    responseEndMs: number | null;
    domInteractiveMs: number | null;
    transferSize: number | null;
    encodedBodySize: number | null;
    decodedBodySize: number | null;
};

type PagePerformanceState = {
    attached: boolean;
    trackedByUrl: Map<string, TrackedResource>;
    requestListener: ((request: Request) => void) | null;
    requestFinishedListener: ((request: Request) => void) | null;
    requestFailedListener: ((request: Request) => void) | null;
};

type PerformanceMetricsState = {
    pagesMeasured: number;
    domContentLoadedMs: number[];
    loadMs: number[];
    responseEndMs: number[];
    domInteractiveMs: number[];
    totalTransferSize: number[];
    resourceCount: number[];
    failedRequestCount: number[];
};

type NumericStats = {
    min: number;
    mean: number;
    median: number;
    max: number;
};

export class PerformanceMetricsPlugin extends BasePlugin implements IPlugin {
    name = "performance-metrics";
    phases: PluginPhase[] = ["beforeGoto", "afterGoto", "finally"];

    private readonly auditOnlyStartUrl: boolean;
    private readonly slowResourceThresholdMs: number;
    private readonly largeResourceThresholdBytes: number;
    private readonly maxReportedResources: number;
    private readonly highResourceCountThreshold: number;
    private readonly largeTransferThresholdBytes: number;
    private readonly slowLoadThresholdMs: number;
    private readonly slowDomContentLoadedThresholdMs: number;
    private readonly pageStates = new WeakMap<Page, PagePerformanceState>();

    constructor(options: PerformanceMetricsPluginOptions = {}) {
        super();
        this.auditOnlyStartUrl = options.auditOnlyStartUrl ?? true;
        this.slowResourceThresholdMs = options.slowResourceThresholdMs ?? 1_000;
        this.largeResourceThresholdBytes = options.largeResourceThresholdBytes ?? 500_000;
        this.maxReportedResources = options.maxReportedResources ?? 10;
        this.highResourceCountThreshold = options.highResourceCountThreshold ?? 100;
        this.largeTransferThresholdBytes = options.largeTransferThresholdBytes ?? 3_000_000;
        this.slowLoadThresholdMs = options.slowLoadThresholdMs ?? 3_000;
        this.slowDomContentLoadedThresholdMs = options.slowDomContentLoadedThresholdMs ?? 1_500;
    }

    applies(ctx: ResourceContext): boolean {
        return !this.auditOnlyStartUrl || ctx.depth === 0;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        if (this.auditOnlyStartUrl && ctx.depth !== 0) {
            return;
        }

        const pageState = this.getPageState(ctx.page);

        if (phase === "beforeGoto") {
            this.resetPageState(pageState);
            this.attachListeners(ctx.page, pageState);
            this.register(ctx);
            return;
        }

        if (phase === "afterGoto") {
            const metricsState = this.getMetricsState(ctx.engineState);
            await this.collectNavigationMetrics(ctx, pageState, metricsState);
            this.register(ctx);
            return;
        }

        if (phase === "finally") {
            this.detachListeners(ctx.page, pageState);
            this.register(ctx);
        }
    }

    public getReport(engineState: EngineState): Report {
        const state = this.getMetricsState(engineState);
        const domContentLoadedStats = this.computeStats(state.domContentLoadedMs);
        const loadStats = this.computeStats(state.loadMs);
        const resourceCountStats = this.computeStats(state.resourceCount);
        const transferSizeStats = this.computeStats(state.totalTransferSize);

        return {
            plugin: this.name,
            label: "Performance Metrics",
            items: [
                {
                    key: "pagesMeasured",
                    label: "Pages measured",
                    value: state.pagesMeasured,
                },
                {
                    key: "domContentLoadedMinMs",
                    label: "DOMContentLoaded min (ms)",
                    value: this.formatStatValue(domContentLoadedStats?.min),
                },
                {
                    key: "domContentLoadedMeanMs",
                    label: "DOMContentLoaded mean (ms)",
                    value: this.formatStatValue(domContentLoadedStats?.mean),
                },
                {
                    key: "domContentLoadedMedianMs",
                    label: "DOMContentLoaded median (ms)",
                    value: this.formatStatValue(domContentLoadedStats?.median),
                },
                {
                    key: "domContentLoadedMaxMs",
                    label: "DOMContentLoaded max (ms)",
                    value: this.formatStatValue(domContentLoadedStats?.max),
                },
                {
                    key: "loadMinMs",
                    label: "Load min (ms)",
                    value: this.formatStatValue(loadStats?.min),
                },
                {
                    key: "loadMeanMs",
                    label: "Load mean (ms)",
                    value: this.formatStatValue(loadStats?.mean),
                },
                {
                    key: "loadMedianMs",
                    label: "Load median (ms)",
                    value: this.formatStatValue(loadStats?.median),
                },
                {
                    key: "loadMaxMs",
                    label: "Load max (ms)",
                    value: this.formatStatValue(loadStats?.max),
                },
                {
                    key: "resourceCountMin",
                    label: "Resources min",
                    value: this.formatStatValue(resourceCountStats?.min),
                },
                {
                    key: "resourceCountMean",
                    label: "Resources mean",
                    value: this.formatStatValue(resourceCountStats?.mean),
                },
                {
                    key: "resourceCountMedian",
                    label: "Resources median",
                    value: this.formatStatValue(resourceCountStats?.median),
                },
                {
                    key: "resourceCountMax",
                    label: "Resources max",
                    value: this.formatStatValue(resourceCountStats?.max),
                },
                {
                    key: "transferSizeMinBytes",
                    label: "Transfer min (bytes)",
                    value: this.formatStatValue(transferSizeStats?.min),
                },
                {
                    key: "transferSizeMeanBytes",
                    label: "Transfer mean (bytes)",
                    value: this.formatStatValue(transferSizeStats?.mean),
                },
                {
                    key: "transferSizeMedianBytes",
                    label: "Transfer median (bytes)",
                    value: this.formatStatValue(transferSizeStats?.median),
                },
                {
                    key: "transferSizeMaxBytes",
                    label: "Transfer max (bytes)",
                    value: this.formatStatValue(transferSizeStats?.max),
                },
            ],
        };
    }

    private attachListeners(page: Page, state: PagePerformanceState): void {
        if (state.attached) {
            return;
        }

        state.requestListener = (request: Request) => {
            const resource: TrackedResource = {
                url: request.url(),
                type: request.resourceType(),
                method: request.method(),
                startTime: Date.now(),
            };

            state.trackedByUrl.set(this.buildResourceKey(request), resource);
        };

        state.requestFinishedListener = async (request: Request) => {
            const key = this.buildResourceKey(request);
            const tracked = state.trackedByUrl.get(key);
            if (!tracked) {
                return;
            }

            const response = await request.response().catch(() => null);
            tracked.endTime = Date.now();
            tracked.durationMs = tracked.endTime - tracked.startTime;
            tracked.status = response?.status() ?? null;

            const sizes = await this.readResponseSizes(response);
            tracked.transferSize = sizes.transferSize;
            tracked.encodedBodySize = sizes.encodedBodySize;
            tracked.decodedBodySize = sizes.decodedBodySize;
        };

        state.requestFailedListener = (request: Request) => {
            const key = this.buildResourceKey(request);
            const tracked = state.trackedByUrl.get(key) ?? {
                url: request.url(),
                type: request.resourceType(),
                method: request.method(),
                startTime: Date.now(),
            };

            tracked.endTime = Date.now();
            tracked.durationMs = tracked.endTime - tracked.startTime;
            tracked.failed = true;
            tracked.failureText = request.failure()?.errorText ?? null;

            state.trackedByUrl.set(key, tracked);
        };

        page.on("request", state.requestListener);
        page.on("requestfinished", state.requestFinishedListener);
        page.on("requestfailed", state.requestFailedListener);
        state.attached = true;
    }

    private detachListeners(page: Page, state: PagePerformanceState): void {
        if (!state.attached) {
            return;
        }

        if (state.requestListener) {
            page.off("request", state.requestListener);
        }
        if (state.requestFinishedListener) {
            page.off("requestfinished", state.requestFinishedListener);
        }
        if (state.requestFailedListener) {
            page.off("requestfailed", state.requestFailedListener);
        }

        state.requestListener = null;
        state.requestFinishedListener = null;
        state.requestFailedListener = null;
        state.attached = false;
    }

    private resetPageState(state: PagePerformanceState): void {
        state.trackedByUrl.clear();
    }

    private async collectNavigationMetrics(
        ctx: ResourceContext,
        pageState: PagePerformanceState,
        metricsState: PerformanceMetricsState,
    ): Promise<void> {
        const navigation = await this.readNavigationMetrics(ctx.page);
        const resources = [...pageState.trackedByUrl.values()];

        const failedResources = resources.filter((resource) => resource.failed);
        const slowResources = resources
            .filter((resource) => (resource.durationMs ?? 0) >= this.slowResourceThresholdMs)
            .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
            .slice(0, this.maxReportedResources);

        const largeResources = resources
            .filter(
                (resource) =>
                    (resource.transferSize ?? resource.encodedBodySize ?? 0) >=
                    this.largeResourceThresholdBytes,
            )
            .sort(
                (a, b) =>
                    (b.transferSize ?? b.encodedBodySize ?? 0) -
                    (a.transferSize ?? a.encodedBodySize ?? 0),
            )
            .slice(0, this.maxReportedResources);

        const totalTransferSize =
            navigation.transferSize ??
            resources.reduce(
                (sum, resource) => sum + (resource.transferSize ?? resource.encodedBodySize ?? 0),
                0,
            );

        this.pushMetric(metricsState.domContentLoadedMs, navigation.domContentLoadedMs);
        this.pushMetric(metricsState.loadMs, navigation.loadMs);
        this.pushMetric(metricsState.responseEndMs, navigation.responseEndMs);
        this.pushMetric(metricsState.domInteractiveMs, navigation.domInteractiveMs);
        this.pushMetric(metricsState.totalTransferSize, totalTransferSize);
        this.pushMetric(metricsState.resourceCount, resources.length);
        this.pushMetric(metricsState.failedRequestCount, failedResources.length);
        metricsState.pagesMeasured += 1;

        const performanceData = {
            domContentLoadedMs: navigation.domContentLoadedMs,
            loadMs: navigation.loadMs,
            responseEndMs: navigation.responseEndMs,
            domInteractiveMs: navigation.domInteractiveMs,
            resourceCount: resources.length,
            failedRequestCount: failedResources.length,
            totalTransferSize,
            slowestResources: slowResources.map((resource) => ({
                url: resource.url,
                type: resource.type,
                durationMs: resource.durationMs ?? null,
                status: resource.status ?? null,
            })),
            largestResources: largeResources.map((resource) => ({
                url: resource.url,
                type: resource.type,
                transferSize: resource.transferSize ?? resource.encodedBodySize ?? null,
                status: resource.status ?? null,
            })),
        };

        this.registerInfo(
            ctx,
            "performance",
            "PERFORMANCE_MEASURED",
            "Collected basic page performance metrics.",
            performanceData,
        );

        if (
            typeof navigation.domContentLoadedMs === "number" &&
            navigation.domContentLoadedMs > this.slowDomContentLoadedThresholdMs
        ) {
            this.registerWarning(
                ctx,
                "performance",
                "SLOW_DOM_CONTENT_LOADED",
                `DOMContentLoaded is slow (${Math.round(navigation.domContentLoadedMs)} ms).`,
                { domContentLoadedMs: navigation.domContentLoadedMs },
            );
        }

        if (typeof navigation.loadMs === "number" && navigation.loadMs > this.slowLoadThresholdMs) {
            this.registerWarning(
                ctx,
                "performance",
                "SLOW_PAGE_LOAD",
                `Page load is slow (${Math.round(navigation.loadMs)} ms).`,
                { loadMs: navigation.loadMs },
            );
        }

        if (resources.length > this.highResourceCountThreshold) {
            this.registerWarning(
                ctx,
                "performance",
                "HIGH_RESOURCE_COUNT",
                `Page loads a high number of resources (${resources.length}).`,
                { resourceCount: resources.length },
            );
        }

        if (totalTransferSize > this.largeTransferThresholdBytes) {
            this.registerWarning(
                ctx,
                "performance",
                "LARGE_TOTAL_TRANSFER_SIZE",
                `Page transfers a large amount of data (${totalTransferSize} bytes).`,
                { totalTransferSize },
            );
        }

        if (failedResources.length > 0) {
            this.registerWarning(
                ctx,
                "performance",
                "FAILED_RESOURCES_DETECTED",
                `Detected ${failedResources.length} failed resource request(s).`,
                {
                    failedResources: failedResources
                        .slice(0, this.maxReportedResources)
                        .map((resource) => ({
                            url: resource.url,
                            type: resource.type,
                            failureText: resource.failureText ?? null,
                        })),
                },
            );
        }

        if (slowResources.length > 0) {
            this.registerInfo(
                ctx,
                "performance",
                "SLOW_RESOURCES_DETECTED",
                `Detected ${slowResources.length} slow resource(s).`,
                { slowResources: performanceData.slowestResources },
            );
        }

        if (largeResources.length > 0) {
            this.registerInfo(
                ctx,
                "performance",
                "LARGE_RESOURCES_DETECTED",
                `Detected ${largeResources.length} large resource(s).`,
                { largeResources: performanceData.largestResources },
            );
        }
    }

    private async readNavigationMetrics(page: Page): Promise<NavigationMetrics> {
        return page.evaluate(() => {
            const entry = performance.getEntriesByType("navigation")[0] as
                | PerformanceNavigationTiming
                | undefined;

            if (!entry) {
                return {
                    domContentLoadedMs: null,
                    loadMs: null,
                    responseEndMs: null,
                    domInteractiveMs: null,
                    transferSize: null,
                    encodedBodySize: null,
                    decodedBodySize: null,
                };
            }

            return {
                domContentLoadedMs:
                    Number.isFinite(entry.domContentLoadedEventEnd) &&
                    entry.domContentLoadedEventEnd > 0
                        ? entry.domContentLoadedEventEnd
                        : null,
                loadMs:
                    Number.isFinite(entry.loadEventEnd) && entry.loadEventEnd > 0
                        ? entry.loadEventEnd
                        : null,
                responseEndMs:
                    Number.isFinite(entry.responseEnd) && entry.responseEnd > 0
                        ? entry.responseEnd
                        : null,
                domInteractiveMs:
                    Number.isFinite(entry.domInteractive) && entry.domInteractive > 0
                        ? entry.domInteractive
                        : null,
                transferSize:
                    Number.isFinite(entry.transferSize) && entry.transferSize >= 0
                        ? entry.transferSize
                        : null,
                encodedBodySize:
                    Number.isFinite(entry.encodedBodySize) && entry.encodedBodySize >= 0
                        ? entry.encodedBodySize
                        : null,
                decodedBodySize:
                    Number.isFinite(entry.decodedBodySize) && entry.decodedBodySize >= 0
                        ? entry.decodedBodySize
                        : null,
            };
        });
    }

    private async readResponseSizes(response: Response | null): Promise<{
        transferSize: number | null;
        encodedBodySize: number | null;
        decodedBodySize: number | null;
    }> {
        if (!response) {
            return {
                transferSize: null,
                encodedBodySize: null,
                decodedBodySize: null,
            };
        }

        try {
            const sizes = await response.request().sizes();
            return {
                transferSize: sizes.responseBodySize + sizes.responseHeadersSize,
                encodedBodySize: sizes.responseBodySize,
                decodedBodySize: sizes.responseBodySize,
            };
        } catch {
            return {
                transferSize: null,
                encodedBodySize: null,
                decodedBodySize: null,
            };
        }
    }

    private buildResourceKey(request: Request): string {
        return `${request.method()}|${request.resourceType()}|${request.url()}`;
    }

    private getPageState(page: Page): PagePerformanceState {
        const existing = this.pageStates.get(page);
        if (existing) {
            return existing;
        }

        const created: PagePerformanceState = {
            attached: false,
            trackedByUrl: new Map<string, TrackedResource>(),
            requestListener: null,
            requestFinishedListener: null,
            requestFailedListener: null,
        };

        this.pageStates.set(page, created);
        return created;
    }

    private getMetricsState(engineState: EngineState): PerformanceMetricsState {
        const key = "performanceMetricsState";
        const existing = engineState.any[key];

        if (this.isPerformanceMetricsState(existing)) {
            return existing;
        }

        const created: PerformanceMetricsState = {
            pagesMeasured: 0,
            domContentLoadedMs: [],
            loadMs: [],
            responseEndMs: [],
            domInteractiveMs: [],
            totalTransferSize: [],
            resourceCount: [],
            failedRequestCount: [],
        };

        engineState.any[key] = created;
        return created;
    }

    private isPerformanceMetricsState(value: unknown): value is PerformanceMetricsState {
        if (!value || typeof value !== "object") {
            return false;
        }

        const record = value as Record<string, unknown>;
        return (
            typeof record.pagesMeasured === "number" &&
            Array.isArray(record.domContentLoadedMs) &&
            Array.isArray(record.loadMs) &&
            Array.isArray(record.resourceCount) &&
            Array.isArray(record.totalTransferSize)
        );
    }

    private pushMetric(target: number[], value: number | null): void {
        if (typeof value === "number" && Number.isFinite(value)) {
            target.push(value);
        }
    }

    private computeStats(values: number[]): NumericStats | null {
        if (values.length === 0) {
            return null;
        }

        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((acc, value) => acc + value, 0);
        const middle = Math.floor(sorted.length / 2);
        const median =
            sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];

        return {
            min: sorted[0],
            mean: sum / sorted.length,
            median,
            max: sorted[sorted.length - 1],
        };
    }

    private formatStatValue(value: number | undefined): string {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return "n/a";
        }

        return String(Math.round(value * 100) / 100);
    }
}
