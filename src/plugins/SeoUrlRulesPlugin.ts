import { BasePlugin } from "../engine/BasePlugin.js";
import type { FindingCode, IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type SeoUrlRulesPluginOptions = {
    maxUrlLength?: number;
};

const TECHNICAL_EXTENSIONS = [
    ".asp",
    ".aspx",
    ".cfm",
    ".cgi",
    ".do",
    ".htm",
    ".html",
    ".jsp",
    ".jspx",
    ".php",
    ".shtml",
    ".xhtml",
];

export class SeoUrlRulesPlugin extends BasePlugin implements IPlugin {
    name = "seo-url-rules";
    phases: PluginPhase[] = ["process"];

    private readonly maxUrlLength: number;

    constructor(options: SeoUrlRulesPluginOptions = {}) {
        super();
        this.maxUrlLength = options.maxUrlLength ?? 120;
    }

    applies(ctx: ResourceContext): boolean {
        return typeof ctx.mime === "string" && ctx.mime.includes("text/html");
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const targetUrl = ctx.finalUrl ?? ctx.report.url ?? ctx.url;
        let parsed: URL;

        try {
            parsed = new URL(targetUrl);
        } catch {
            return;
        }

        const pathname = decodeURIComponent(parsed.pathname);
        const normalizedPath = pathname === "/" ? pathname : pathname.replace(/\/$/, "");
        const lastSegment = normalizedPath.split("/").filter(Boolean).at(-1) ?? "";
        const findings: Array<{ code: FindingCode; message: string }> = [];

        if (/--+/.test(pathname)) {
            findings.push({
                code: "URL_CONSECUTIVE_HYPHENS",
                message: "URL contains consecutive hyphens.",
            });
        }

        if (pathname.includes("_")) {
            findings.push({
                code: "URL_UNDERSCORE",
                message: "URL contains an underscore.",
            });
        }

        if (
            TECHNICAL_EXTENSIONS.some((extension) => lastSegment.toLowerCase().endsWith(extension))
        ) {
            findings.push({
                code: "URL_TECHNICAL_EXTENSION",
                message: "URL exposes a technical file extension.",
            });
        }

        if (/[A-Z]/.test(pathname)) {
            findings.push({
                code: "URL_UPPERCASE",
                message: "URL contains uppercase characters.",
            });
        }

        if (targetUrl.length > this.maxUrlLength) {
            findings.push({
                code: "URL_TOO_LONG",
                message: `URL is longer than ${this.maxUrlLength} characters.`,
            });
        }

        if (/\s/.test(pathname)) {
            findings.push({
                code: "URL_SPACE",
                message: "URL contains spaces.",
            });
        }

        if (/[^a-z0-9\-\/._~%]/i.test(pathname) || /[À-ÿ]/.test(pathname)) {
            findings.push({
                code: "URL_SPECIAL_CHARACTERS",
                message: "URL contains special or accented characters.",
            });
        }

        for (const finding of findings) {
            this.registerWarning(ctx, "seo", finding.code, finding.message, {
                url: targetUrl,
                path: pathname,
            });
        }

        if (findings.length === 0) {
            this.register(ctx);
        }
    }
}
