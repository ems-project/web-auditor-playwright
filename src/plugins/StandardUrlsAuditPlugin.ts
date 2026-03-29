import { BasePlugin } from "../engine/BasePlugin.js";
import { FindingSeverity, IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type StandardUrlSpec = {
    path: string;
    severityIfMissing?: FindingSeverity;
    description?: string;
};

type StandardUrlsAuditPluginOptions = {
    urls?: StandardUrlSpec[];
    onlyFromRoot?: boolean;
};

type StandardUrlsState = {
    enqueued: boolean;
};

const DEFAULT_STANDARD_URLS: StandardUrlSpec[] = [
    { path: "/robots.txt", severityIfMissing: "warning", description: "Robots exclusion file" },
    { path: "/sitemap.xml", severityIfMissing: "warning", description: "XML sitemap" },
    { path: "/favicon.ico", severityIfMissing: "info", description: "Default favicon" },
    {
        path: "/.well-known/security.txt",
        severityIfMissing: "info",
        description: "Security contact policy",
    },
];

export class StandardUrlsAuditPlugin extends BasePlugin implements IPlugin {
    name = "standard-urls-audit";
    phases: PluginPhase[] = ["process", "download", "error"];

    private readonly urls: StandardUrlSpec[];
    private readonly onlyFromRoot: boolean;

    constructor(options: StandardUrlsAuditPluginOptions = {}) {
        super();
        this.urls = options.urls ?? DEFAULT_STANDARD_URLS;
        this.onlyFromRoot = options.onlyFromRoot ?? true;
    }

    applies(): boolean {
        return true;
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const state = this.getState(ctx);

        if (phase === "process" && this.shouldEnqueue(ctx, state)) {
            this.enqueueStandardUrls(ctx, state);
        }
        this.ifStandardUrl(ctx);
    }

    private shouldEnqueue(ctx: ResourceContext, state: StandardUrlsState): boolean {
        if (state.enqueued) {
            return false;
        }

        if (this.onlyFromRoot && ctx.depth !== 0) {
            return false;
        }

        if (!ctx.report.is_web) {
            return false;
        }

        return this.isSameOrigin(ctx, ctx.finalUrl ?? ctx.url);
    }

    private enqueueStandardUrls(ctx: ResourceContext, state: StandardUrlsState): void {
        const origin = ctx.engineState.origin;

        for (const spec of this.urls) {
            const absoluteUrl = new URL(spec.path, origin).href;
            const result = ctx.crawler.enqueueUrl({
                url: absoluteUrl,
                source: this.name,
            });

            if (!result.accepted) {
                this.registerInfo(
                    ctx,
                    "crawl",
                    "STANDARD_URL_NOT_ENQUEUED",
                    `Did not queue standard URL: ${spec.path} (${result.reason ?? "unknown"}).`,
                    {
                        path: spec.path,
                        url: absoluteUrl,
                        reason: result.reason,
                    },
                );
            }
        }

        state.enqueued = true;
    }

    private ifStandardUrl(ctx: ResourceContext): void {
        const currentUrl = ctx.finalUrl ?? ctx.url;
        if (!this.isSameOrigin(ctx, currentUrl)) {
            return;
        }

        const pathname = this.safePathname(currentUrl);
        if (!pathname) {
            return;
        }

        const spec = this.urls.find((item) => item.path === pathname);
        if (!spec) {
            return;
        }
        if (ctx.status !== undefined ? ctx.status < 300 : true) {
            this.register(ctx);
            return;
        }

        this.registerFinding(
            spec.severityIfMissing ?? "warning",
            "best-practices",
            ctx,
            "STANDARD_URL_MISSING",
            `Standard URL missing or not reachable: ${spec.path}.`,
            {
                path: spec.path,
                description: spec.description ?? null,
                expectedUrl: new URL(spec.path, ctx.engineState.origin).href,
                status: ctx.status ?? null,
            },
        );
    }

    private getState(ctx: ResourceContext): StandardUrlsState {
        const key = "standardUrlsAudit";
        const existing = ctx.engineState.any[key];

        if (this.isState(existing)) {
            return existing;
        }

        const created: StandardUrlsState = {
            enqueued: false,
        };

        ctx.engineState.any[key] = created;
        return created;
    }

    private isState(value: unknown): value is StandardUrlsState {
        if (!value || typeof value !== "object") {
            return false;
        }

        const record = value as Record<string, unknown>;
        return typeof record.enqueued === "boolean";
    }

    private isSameOrigin(ctx: ResourceContext, url: string): boolean {
        try {
            return new URL(url).origin === ctx.engineState.origin;
        } catch {
            return false;
        }
    }

    private safePathname(url: string): string | null {
        try {
            return new URL(url).pathname;
        } catch {
            return null;
        }
    }
}
