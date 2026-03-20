import type { BrowserContext, Page, Response } from "playwright";

export type Mime = string;

export type CrawlOptions = {
    startUrl: string;
    sameOriginOnly: boolean;
    maxPages: number;
    maxDepth: number;
    concurrency: number;
    navTimeoutMs: number;
    userAgent?: string;
    rateLimitMs: number;
};

export type ResourceContext = {
    // identification
    url: string;
    finalUrl?: string;
    depth: number;

    // network
    status?: number;
    mime?: Mime;

    // playwright
    page: Page;
    context: BrowserContext;
    response?: Response;

    // signals collected
    console: { type: string; text: string; location?: string }[];
    pageErrors: string[];
    extractedText?: string; // ex: textract PDF

    report: ResourceReport;
    crawler: CrawlerControl;
    engineState: EngineState;
    findings: Finding[];
};

export type FindingData = Record<string, unknown>;

export type ResourceReportLink = {
    type: string;
    text: string;
    url: string;
};

export type ResourceReportPa11yItem = {
    code: string;
    type: string;
    message: string;
    selector?: string | null;
    context?: string | null;
};

export type ResourceReport = {
    url: string | null;
    redirected: boolean;
    host: string | null;
    base_url: string | null;
    timestamp: string;
    is_web: boolean;
    status_code: number | null;
    message: string | null;
    mimetype: string | null;
    meta_title: string | null;
    title: string | null;
    locale: string | null;
    description: string | null;
    links: ResourceReportLink[];
    pa11y: ResourceReportPa11yItem[];
    data: Record<string, unknown>;
    findings: Finding[];
};

export type EnqueueRequest = {
    url: string;
    depth?: number;
    source?: string;
};

export type EnqueueResult = {
    accepted: boolean;
    normalizedUrl?: string;
    reason?:
        | "invalid_url"
        | "already_seen"
        | "max_depth_reached"
        | "cross_origin_blocked"
        | "max_pages_reached";
};

export type CrawlerControl = {
    enqueueUrl: (request: EnqueueRequest) => EnqueueResult;
};

export type EngineState = {
    startedAt: Date;
    origin: string;
    seen: Set<string>;
    processedCount: number;
    successCount: number;
    errorCount: number;
    queueSize: number;
    activeWorkers: number;
    maxPages: number;
    any: Record<string, unknown>;
};

export type Finding = {
    plugin: string;
    type: "info" | "warning" | "error";
    code: string;
    message: string;
    data?: FindingData;
};

export type PluginPhase =
    | "beforeGoto"
    | "afterGoto"
    | "process"
    | "periodic"
    | "download"
    | "error"
    | "finally";

export type PluginSummary = {
    plugin: string;
    auditedUrls: number;
    warnings: number;
    errors: number;
};

export interface IPlugin {
    name: string;
    applies(ctx: ResourceContext): boolean;
    phases: PluginPhase[];
    run(phase: PluginPhase, ctx: ResourceContext): Promise<void>;
    includeInSummary?(): boolean;
    getSummary?(): PluginSummary | null;
}
