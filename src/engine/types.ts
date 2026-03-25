import type { BrowserContext, Download, Page, Response } from "playwright";

export type Mime = string;

export type CrawlOptions = {
    startUrl: string;
    sameOriginOnly: boolean;
    ignoreHttpsError: boolean;
    maxPages: number;
    maxDepth: number;
    concurrency: number;
    navTimeoutMs: number;
    userAgent?: string;
    rateLimitMs: number;
    urlAllowlist?: RegExp[];
    urlBlocklist?: RegExp[];
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
    auditors?: string[];
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
    metas?: MetaItem[];
    size: number | null;
    auditors?: string[];
};

export type EnqueueRequest = {
    url: string;
    depth?: number;
    source?: string;
};

export type UrlRejectionReason =
    | "invalid_url"
    | "already_seen"
    | "max_depth_reached"
    | "not_in_allowlist"
    | "cross_origin_blocked"
    | "blocked_by_blocklist"
    | "stop_requested"
    | "max_pages_reached";

export type EnqueueResult = {
    accepted: boolean;
    normalizedUrl?: string;
    reason?: UrlRejectionReason;
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
    securityHeaderGrade?: string;
    securityHeaderScore?: number;
    tlsGrade?: string;
    tlsScore?: number;
    tlsValidFrom?: string;
    tlsValidTo?: string;
    tlsDaysRemaining?: number;
    ipV4Supported?: boolean;
    ipV6Supported?: boolean;
    ipV4Reachable?: boolean;
    ipV6Reachable?: boolean;
    stopRequested: boolean;
    stopConfirmedAt?: string;
};

export type FindingSeverity = "info" | "warning" | "error";

export type InventoryItem = {
    depth: number;
    status?: number;
    mime?: Mime;
    url: string;
};

export type FindingCategory =
    | "a11y"
    | "seo"
    | "performance"
    | "security"
    | "network"
    | "content"
    | "html"
    | "links"
    | "resources"
    | "technical"
    | "best-practices"
    | "compliance"
    | "crawl"
    | "plugins";

export type Finding = {
    plugin: string;
    category: FindingCategory;
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
    | "beforeFinally"
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
