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

export type FindingCode =
    // Content / SEO / HTML
    | "LANGUAGE_UNDETERMINED"
    | "LANGUAGE_DETECTION_SKIPPED"
    | "LOW_CONTENT"
    | "MAIL_OR_TEL_LINK"
    | "TITLE_MISSING"
    | "TITLE_TOO_SHORT"
    | "TITLE_TOO_LONG"
    | "TITLE_BRAND_TOO_LONG"
    | "TITLE_BRAND_DUPLICATED"
    | "TITLE_MAIN_TOO_SHORT"
    | "TITLE_TOO_MANY_PARTS"
    // URL / Crawl
    | "MISSING_URL"
    | "EMPTY_URL"
    | "NOT_PARSABLE_URL"
    | "STANDARD_URL_NOT_ENQUEUED"
    | "STANDARD_URL_MISSING"
    // Content extraction
    | "TEXT_EXTRACTION_FAILED"
    | "TEXT_EXTRACTION_SKIPPED_TOO_LARGE"
    | "PDF_EXTRACTION_FAILED"
    | "PDF_EMPTY_TEXT"
    | "PDF_NO_TEXT"
    | "PDF_EXTRACTION_SKIPPED_TOO_LARGE"
    | "DOCX_EXTRACTION_SKIPPED_TOO_LARGE"
    | "TEXTRACT_NO_CONTENT"
    | "TEXTRACT_DEPENDENCY_MISSING"
    | "TEXTRACT_EXTRACTION_SKIPPED_TOO_LARGE"
    // PDF Accessibility
    | "PDF_ACCESSIBILITY_AUDIT_FAILED"
    | "PDF_ACCESSIBILITY_NOT_TAGGED"
    | "PDF_ACCESSIBILITY_LINKS_NOT_DETECTED"
    | "PDF_ACCESSIBILITY_BOOKMARKS_MISSING"
    | "PDF_ACCESSIBILITY_PROBABLY_SCANNED"
    | "PDF_ACCESSIBILITY_NO_EXTRACTABLE_TEXT"
    | "PDF_ACCESSIBILITY_LANGUAGE_MISSING"
    | "PDF_ACCESSIBILITY_TITLE_MISSING"
    // Download / Files
    | "MIME_UNKNOWN"
    | "DOWNLOAD_FAILED"
    | "DOWNLOADED_FILE_CLEANUP_FAILED"
    // Console
    | "CONSOLE_WARNINGS_DETECTED"
    | "CONSOLE_ERRORS_DETECTED"
    // Security Headers
    | "SECURITY_HEADERS_SCORE"
    | "COOKIE_SAMESITE_NONE_WITHOUT_SECURE"
    | "COOKIE_INVALID_SAMESITE"
    | "COOKIE_MISSING_SAMESITE"
    | "COOKIE_MISSING_HTTPONLY"
    | "COOKIE_MISSING_SECURE"
    | "MISSING_CORP"
    | "MISSING_COOP"
    | "MISSING_PERMISSIONS_POLICY"
    | "WEAK_REFERRER_POLICY"
    | "INVALID_REFERRER_POLICY"
    | "MISSING_REFERRER_POLICY"
    | "INVALID_X_CONTENT_TYPE_OPTIONS"
    | "MISSING_X_CONTENT_TYPE_OPTIONS"
    | "WEAK_X_FRAME_OPTIONS"
    | "MISSING_CLICKJACKING_PROTECTION"
    | "MISSING_CSP"
    | "CSP_REPORT_ONLY_ONLY"
    | "WEAK_CSP"
    | "MISSING_HSTS"
    | "WEAK_HSTS_MAX_AGE"
    | "INVALID_HSTS"
    | "HSTS_NOT_APPLICABLE"
    | "SECURITY_HEADERS_NOT_AUDITED"
    // TLS & Certificate
    | "TLS_CERTIFICATE_SHORT_CHAIN"
    | "TLS_CERTIFICATE_WEAK_CIPHER"
    | "TLS_CERTIFICATE_OLD_TLS_VERSION"
    | "TLS_CERTIFICATE_NO_SAN"
    | "TLS_CERTIFICATE_SELF_SIGNED"
    | "TLS_CERTIFICATE_EXPIRING_SOON"
    | "TLS_CERTIFICATE_EXPIRED"
    | "TLS_CERTIFICATE_INVALID"
    | "TLS_CERTIFICATE_SCORE"
    | "TLS_CERTIFICATE_AUDIT_FAILED"
    | "TLS_CERTIFICATE_DETAILS"
    | "TLS_CERTIFICATE_NOT_APPLICABLE"
    | "TLS_CERTIFICATE_INVALID_URL"
    | "TLS_CERTIFICATE_NOT_AUDITED"
    // Network & IP
    | "IPV6_UNREACHABLE"
    | "IPV4_UNREACHABLE"
    | "IPV6_MISSING"
    | "IPV4_MISSING"
    | "IP_SUPPORT_DETAILS"
    | "IP_SUPPORT_INVALID_URL"
    | "IP_SUPPORT_NOT_AUDITED"
    // Performances
    | "LARGE_RESOURCES_DETECTED"
    | "SLOW_RESOURCES_DETECTED"
    | "FAILED_RESOURCES_DETECTED"
    | "LARGE_TOTAL_TRANSFER_SIZE"
    | "HIGH_RESOURCE_COUNT"
    | "SLOW_PAGE_LOAD"
    | "SLOW_DOM_CONTENT_LOADED"
    | "PERFORMANCE_MEASURED";

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

export type ReportItem = {
    key: string;
    label: string;
    value: string | number | boolean;
};

export type Report = {
    plugin: string;
    label: string;
    items: ReportItem[];
};

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
    getReport?(engineState: EngineState): Report;
}
