import fsp from "node:fs/promises";

import { BasePlugin } from "../engine/BasePlugin.js";
import type { EngineState, IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type RobotsTxtPluginOptions = {
    requireCrawlDelay?: boolean;
    requireSitemap?: boolean;
};

type RobotsTxtGroup = {
    userAgents: string[];
    crawlDelay: string[];
    allow: string[];
    disallow: string[];
};

type ParsedRobotsTxt = {
    groups: RobotsTxtGroup[];
    sitemaps: string[];
};

type ObservedResourceKind = "css" | "js" | "image";

type ObservedResource = {
    key: string;
    url: string;
    path: string;
    kind: ObservedResourceKind;
};

type RobotsTxtState = {
    parsed: ParsedRobotsTxt | null;
    observedResources: ObservedResource[];
    observedKeys: string[];
    blockedKeys: string[];
    enqueuedSitemaps: string[];
};

export class RobotsTxtPlugin extends BasePlugin implements IPlugin {
    name = "robots-txt";
    phases: PluginPhase[] = ["process", "download"];

    private readonly requireCrawlDelay: boolean;
    private readonly requireSitemap: boolean;

    constructor(options: RobotsTxtPluginOptions = {}) {
        super();
        this.requireCrawlDelay = options.requireCrawlDelay ?? true;
        this.requireSitemap = options.requireSitemap ?? true;
    }

    applies(ctx: ResourceContext): boolean {
        return this.isSameOrigin(ctx, ctx.finalUrl ?? ctx.url);
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const state = this.getState(ctx.engineState);
        const currentUrl = ctx.finalUrl ?? ctx.url;

        if (phase === "process") {
            this.recordObservedResource(ctx, state, currentUrl);
            if (state.parsed) {
                this.reportBlockedCurrentResource(ctx, state, currentUrl);
            }
            return;
        }

        if (!this.isRobotsTxtUrl(ctx, currentUrl)) {
            this.recordObservedResource(ctx, state, currentUrl);
            if (state.parsed) {
                this.reportBlockedCurrentResource(ctx, state, currentUrl);
            }
            return;
        }

        const savedPath = ctx.downloaded?.savedPath;
        if (!savedPath) {
            return;
        }

        const content = await fsp.readFile(savedPath, "utf8");
        const parsed = this.parseRobotsTxt(content);
        state.parsed = parsed;

        const wildcardGroups = parsed.groups.filter((group) =>
            group.userAgents.some((agent) => agent === "*"),
        );

        this.enqueueSitemaps(ctx, state, parsed.sitemaps);

        ctx.report.metas ??= [];
        ctx.report.metas.push({ key: "robots_group_count", value: `${parsed.groups.length}` });
        ctx.report.metas.push({ key: "robots_sitemap_count", value: `${parsed.sitemaps.length}` });

        if (wildcardGroups.length === 0) {
            this.registerWarning(
                ctx,
                "crawl",
                "ROBOTS_TXT_USER_AGENT_MISSING",
                'robots.txt does not define a "User-agent: *" group.',
            );
        }

        if (this.requireSitemap && parsed.sitemaps.length === 0) {
            this.registerWarning(
                ctx,
                "crawl",
                "ROBOTS_TXT_SITEMAP_MISSING",
                "robots.txt does not declare any Sitemap directive.",
            );
        }

        if (this.requireCrawlDelay && wildcardGroups.length > 0) {
            const crawlDelayValues = wildcardGroups.flatMap((group) => group.crawlDelay);
            if (crawlDelayValues.length === 0) {
                this.registerWarning(
                    ctx,
                    "crawl",
                    "ROBOTS_TXT_CRAWL_DELAY_MISSING",
                    'robots.txt does not define "Crawl-delay" for "User-agent: *".',
                );
            } else if (crawlDelayValues.some((value) => !this.isValidCrawlDelay(value))) {
                this.registerWarning(
                    ctx,
                    "crawl",
                    "ROBOTS_TXT_CRAWL_DELAY_INVALID",
                    'robots.txt defines an invalid "Crawl-delay" value for "User-agent: *".',
                    { values: crawlDelayValues },
                );
            }
        }

        if (wildcardGroups.some((group) => this.blocksAllCrawlers(group))) {
            this.registerWarning(
                ctx,
                "crawl",
                "ROBOTS_TXT_BLOCKS_ALL_CRAWLERS",
                'robots.txt blocks all crawlers with "Disallow: /" in the "User-agent: *" group.',
            );
        }

        for (const resource of state.observedResources) {
            this.reportBlockedObservedResource(ctx, state, resource);
        }

        this.register(ctx);
    }

    private enqueueSitemaps(
        ctx: ResourceContext,
        state: RobotsTxtState,
        sitemapUrls: string[],
    ): void {
        for (const sitemapUrl of sitemapUrls) {
            const absoluteUrl = this.toAbsoluteUrl(ctx.engineState.origin, sitemapUrl);
            if (!absoluteUrl || state.enqueuedSitemaps.includes(absoluteUrl)) {
                continue;
            }

            state.enqueuedSitemaps.push(absoluteUrl);
            ctx.crawler.enqueueUrl({
                url: absoluteUrl,
                source: this.name,
            });
        }
    }

    private toAbsoluteUrl(baseUrl: string, candidate: string): string | null {
        try {
            return new URL(candidate, baseUrl).href;
        } catch {
            return null;
        }
    }

    private parseRobotsTxt(content: string): ParsedRobotsTxt {
        const groups: RobotsTxtGroup[] = [];
        const sitemaps: string[] = [];
        let currentGroup: RobotsTxtGroup | null = null;
        let currentGroupHasRules = false;

        for (const rawLine of content.split(/\r?\n/)) {
            const lineWithoutComment = rawLine.replace(/\s+#.*$/, "").trim();
            if (!lineWithoutComment) {
                currentGroup = null;
                currentGroupHasRules = false;
                continue;
            }

            const separatorIndex = lineWithoutComment.indexOf(":");
            if (separatorIndex === -1) {
                continue;
            }

            const field = lineWithoutComment.slice(0, separatorIndex).trim().toLowerCase();
            const value = lineWithoutComment.slice(separatorIndex + 1).trim();

            if (field === "sitemap") {
                if (value) {
                    sitemaps.push(value);
                }
                continue;
            }

            if (field === "user-agent") {
                if (!currentGroup || currentGroupHasRules) {
                    currentGroup = {
                        userAgents: [],
                        crawlDelay: [],
                        allow: [],
                        disallow: [],
                    };
                    groups.push(currentGroup);
                    currentGroupHasRules = false;
                }

                if (value) {
                    currentGroup.userAgents.push(value.toLowerCase());
                }
                continue;
            }

            if (!currentGroup) {
                continue;
            }

            currentGroupHasRules = true;
            if (field === "crawl-delay") {
                currentGroup.crawlDelay.push(value);
            } else if (field === "allow") {
                currentGroup.allow.push(value);
            } else if (field === "disallow") {
                currentGroup.disallow.push(value);
            }
        }

        return { groups, sitemaps };
    }

    private recordObservedResource(
        ctx: ResourceContext,
        state: RobotsTxtState,
        targetUrl: string,
    ): void {
        const resource = this.toObservedResource(ctx, targetUrl);
        if (!resource) {
            return;
        }

        if (state.observedKeys.includes(resource.key)) {
            return;
        }

        state.observedKeys.push(resource.key);
        state.observedResources.push(resource);
    }

    private reportBlockedCurrentResource(
        ctx: ResourceContext,
        state: RobotsTxtState,
        targetUrl: string,
    ): void {
        const resource = this.toObservedResource(ctx, targetUrl);
        if (!resource) {
            return;
        }

        if (!this.isBlockedByWildcardRules(state.parsed, resource.path)) {
            return;
        }

        if (state.blockedKeys.includes(resource.key)) {
            return;
        }

        state.blockedKeys.push(resource.key);
        this.registerWarning(
            ctx,
            "crawl",
            this.getBlockedFindingCode(resource.kind),
            `robots.txt blocks a used ${resource.kind.toUpperCase()} resource: ${resource.url}`,
            {
                url: resource.url,
                path: resource.path,
                resourceType: resource.kind,
            },
        );
    }

    private reportBlockedObservedResource(
        ctx: ResourceContext,
        state: RobotsTxtState,
        resource: ObservedResource,
    ): void {
        if (!this.isBlockedByWildcardRules(state.parsed, resource.path)) {
            return;
        }

        if (state.blockedKeys.includes(resource.key)) {
            return;
        }

        state.blockedKeys.push(resource.key);
        this.registerWarning(
            ctx,
            "crawl",
            this.getBlockedFindingCode(resource.kind),
            `robots.txt blocks a used ${resource.kind.toUpperCase()} resource: ${resource.url}`,
            {
                url: resource.url,
                path: resource.path,
                resourceType: resource.kind,
            },
        );
    }

    private toObservedResource(ctx: ResourceContext, targetUrl: string): ObservedResource | null {
        if (this.isRobotsTxtUrl(ctx, targetUrl)) {
            return null;
        }

        const kind = this.detectResourceKind(ctx, targetUrl);
        if (!kind) {
            return null;
        }

        const parsed = new URL(targetUrl);
        return {
            key: `${kind}|${parsed.href}`,
            url: parsed.href,
            path: `${parsed.pathname}${parsed.search}`,
            kind,
        };
    }

    private detectResourceKind(
        ctx: ResourceContext,
        targetUrl: string,
    ): ObservedResourceKind | null {
        const mime = (ctx.downloaded?.mime ?? ctx.mime ?? "").toLowerCase();
        const pathname = new URL(targetUrl).pathname.toLowerCase();

        if (mime.includes("text/css") || pathname.endsWith(".css")) {
            return "css";
        }

        if (
            mime.includes("javascript") ||
            mime.includes("ecmascript") ||
            pathname.endsWith(".js") ||
            pathname.endsWith(".mjs")
        ) {
            return "js";
        }

        if (
            mime.startsWith("image/") ||
            /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(pathname)
        ) {
            return "image";
        }

        return null;
    }

    private isBlockedByWildcardRules(parsed: ParsedRobotsTxt | null, path: string): boolean {
        if (!parsed) {
            return false;
        }

        const rules = parsed.groups.filter((group) => group.userAgents.includes("*"));
        if (rules.length === 0) {
            return false;
        }

        let bestMatch: { type: "allow" | "disallow"; length: number } | null = null;

        for (const group of rules) {
            for (const allow of group.allow.filter(Boolean)) {
                if (path.startsWith(allow)) {
                    if (!bestMatch || allow.length >= bestMatch.length) {
                        bestMatch = { type: "allow", length: allow.length };
                    }
                }
            }

            for (const disallow of group.disallow.filter(Boolean)) {
                if (path.startsWith(disallow)) {
                    if (!bestMatch || disallow.length >= bestMatch.length) {
                        bestMatch = { type: "disallow", length: disallow.length };
                    }
                }
            }
        }

        return bestMatch?.type === "disallow";
    }

    private getBlockedFindingCode(kind: ObservedResourceKind) {
        switch (kind) {
            case "css":
                return "ROBOTS_TXT_BLOCKS_CSS" as const;
            case "js":
                return "ROBOTS_TXT_BLOCKS_JS" as const;
            case "image":
                return "ROBOTS_TXT_BLOCKS_IMAGE" as const;
        }
    }

    private isValidCrawlDelay(value: string): boolean {
        return /^\d+(\.\d+)?$/.test(value) && Number(value) >= 0;
    }

    private blocksAllCrawlers(group: RobotsTxtGroup): boolean {
        return group.disallow.includes("/");
    }

    private isRobotsTxtUrl(ctx: ResourceContext, targetUrl: string): boolean {
        try {
            const parsed = new URL(targetUrl);
            return parsed.origin === ctx.engineState.origin && parsed.pathname === "/robots.txt";
        } catch {
            return false;
        }
    }

    private isSameOrigin(ctx: ResourceContext, targetUrl: string): boolean {
        try {
            return new URL(targetUrl).origin === ctx.engineState.origin;
        } catch {
            return false;
        }
    }

    private getState(state: EngineState): RobotsTxtState {
        const existing = state.any[this.name];
        if (this.isRobotsTxtState(existing)) {
            return existing;
        }

        const created: RobotsTxtState = {
            parsed: null,
            observedResources: [],
            observedKeys: [],
            blockedKeys: [],
            enqueuedSitemaps: [],
        };
        state.any[this.name] = created;
        return created;
    }

    private isRobotsTxtState(value: unknown): value is RobotsTxtState {
        if (!value || typeof value !== "object") {
            return false;
        }

        const candidate = value as Record<string, unknown>;
        return (
            Array.isArray(candidate.observedResources) &&
            Array.isArray(candidate.observedKeys) &&
            Array.isArray(candidate.blockedKeys) &&
            Array.isArray(candidate.enqueuedSitemaps)
        );
    }
}
