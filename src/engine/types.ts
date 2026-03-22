import type { BrowserContext, Download, Page, Response } from "playwright";

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

export type DownloadArtifact = {
    sourceUrl: string;
    suggestedFilename: string;
    savedPath?: string;
    size?: number;
    sha256?: string;
    mime?: string | null;
    mimeSource?: "response-header" | "signature" | "extension" | "unknown";
    cleanup?: boolean;
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
    download?: Download;
    downloaded?: DownloadArtifact;
    downloadTrigger?: "playwright-download" | "inline-resource";

    // signals collected
    console: { type: string; text: string; location?: string }[];
    pageErrors: string[];
    extractedText?: string; // ex: textract PDF

    audited?: boolean;
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

export type ResourceReportA11yAxeNode = {
    impact: string | null | undefined;
    html: string;
    target: string | null;
    failure_summary: string | undefined;
    xpath: string[] | undefined;
};

export type ResourceReportA11yAxeItem = {
    id: string;
    impact: string | null | undefined;
    tags: string[];
    wcag_criteria: string[];
    en301549_criteria: string[];
    description: string;
    help: string;
    help_url: string;
    nodes: ResourceReportA11yAxeNode[];
};

export type MetaItem = {
    key: string;
    value: string;
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
    content: string | null;
    links: ResourceReportLink[];
    a11y_axe?: ResourceReportA11yAxeItem[];
    findings: Finding[];
    metas?: MetaItem[];
    size: number | null;
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
    infoCount: number;
    warningCount: number;
    errorCount: number;
    queueSize: number;
    activeWorkers: number;
    maxPages: number;
    any: Record<string, unknown>;
    findings: Finding[];
    inventory: InventoryItem[];
};

export type FindingSeverity = "info" | "warning" | "error";

export type InventoryItem = {
    depth: number;
    status?: number;
    mime?: Mime;
    url: string;
};

export type Finding = {
    plugin: string;
    type: FindingSeverity;
    code: string;
    message: string;
    url: string;
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
    treatedUrls: number;
    infos: number;
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
