import {
    FindingCategory,
    FindingCode,
    FindingSeverity,
    IPlugin,
    PluginPhase,
    ResourceContext,
    ResourceReportLink,
} from "../engine/types.js";
import { BasePlugin } from "../engine/BasePlugin.js";
import { TitleAnalyzer } from "../utils/TitleAnalyzer.js";

type HtmlProcessorPluginOptions = {
    maxLinksPerPage?: number;
};

type InlineJavaScriptDetections = {
    inlineScriptTags: string[];
    javascriptUrls: string[];
    inlineEventHandlers: Array<{ tag: string; attribute: string }>;
};

type DomFinding = {
    type: FindingSeverity;
    category: FindingCategory;
    code: FindingCode;
    message: string;
    data?: Record<string, unknown>;
};

export class HtmlProcessorPlugin extends BasePlugin implements IPlugin {
    name = "html-processor";
    phases: PluginPhase[] = ["process", "error"];

    private readonly maxLinksPerPage: number | null;

    constructor(options: HtmlProcessorPluginOptions = {}) {
        super();
        this.maxLinksPerPage = options.maxLinksPerPage ?? null;
    }

    applies(ctx: ResourceContext): boolean {
        return undefined !== ctx.mime && ctx.mime.includes("text/html");
    }

    async run(_phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        const extracted = await this.extractFromDom(ctx);
        const titleAnalyzer = new TitleAnalyzer();
        const titleAnalysis = titleAnalyzer.analyze(extracted.title);

        const mailOrTelLinks = extracted.links.filter(
            (l) => l.url.startsWith("mailto:") || l.url.startsWith("tel:"),
        );
        if (mailOrTelLinks.length > 0) {
            this.registerInfo(
                ctx,
                "links",
                "MAIL_OR_TEL_LINK",
                `Contains ${mailOrTelLinks.length} mailto or tel link(s).`,
                {
                    links: mailOrTelLinks,
                },
            );
        }

        for (const link of mailOrTelLinks) {
            const invalidHref = this.validateSpecialHref(link.url);
            if (!invalidHref) {
                continue;
            }

            this.registerWarning(ctx, "links", invalidHref.code, invalidHref.message, {
                type: link.type,
                text: link.text,
                href: link.url,
            });
        }

        for (const issue of titleAnalysis.issues) {
            this.registerFinding(issue.severity, "seo", ctx, issue.code, issue.message, {
                title: titleAnalysis.normalized,
                length: titleAnalysis.length,
                brand: titleAnalysis.brand,
                mainTitle: titleAnalysis.mainTitle,
            });
        }

        const wordCount = extracted.content.split(/\s+/).length;
        if (wordCount < 100) {
            this.registerWarning(
                ctx,
                "content",
                "LOW_CONTENT",
                `Low content page (${wordCount} words).`,
            );
        }

        ctx.report.is_web = true;
        ctx.report.meta_title = extracted.title;
        ctx.report.locale = extracted.lang;
        ctx.report.description = extracted.description;
        ctx.report.content = extracted.content;
        ctx.report.title = extracted.h1s.length > 0 ? extracted.h1s[0] : null;

        for (const link of extracted.links) {
            const enqueueResult = ctx.crawler.enqueueUrl({
                url: link.url,
                source: this.name,
            });
            link.enqueueResult = enqueueResult.reason;
        }

        ctx.report.links = this.maxLinksPerPage
            ? extracted.links.slice(0, this.maxLinksPerPage)
            : extracted.links;
        this.register(ctx);
    }

    private validateSpecialHref(href: string): { code: FindingCode; message: string } | null {
        if (href.startsWith("mailto:")) {
            return this.isValidMailtoHref(href)
                ? null
                : {
                      code: "INVALID_MAILTO_HREF",
                      message: `Invalid mailto href format: ${href}`,
                  };
        }

        if (href.startsWith("tel:")) {
            return this.validateTelHref(href);
        }

        return null;
    }

    private isValidMailtoHref(href: string): boolean {
        const match = /^mailto:([^?]*)(?:\?.*)?$/i.exec(href);
        if (!match) {
            return false;
        }

        try {
            const recipients = decodeURIComponent(match[1])
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);

            if (recipients.length === 0) {
                return false;
            }

            return recipients.every((recipient) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient));
        } catch {
            return false;
        }
    }

    private validateTelHref(href: string): { code: FindingCode; message: string } | null {
        const match = /^tel:(.*)$/i.exec(href);
        if (!match || match[1].length === 0) {
            return {
                code: "INVALID_TEL_HREF",
                message: `Invalid tel href format: ${href}`,
            };
        }

        if (!match[1].startsWith("+")) {
            return {
                code: "INVALID_TEL_HREF",
                message: `Invalid tel href format: ${href}. Telephone links must start with "+".`,
            };
        }

        if (!/^\+\d+$/.test(match[1])) {
            return {
                code: "INVALID_TEL_HREF",
                message: `Invalid tel href format: ${href}. Telephone links must contain only digits after "+".`,
            };
        }

        return null;
    }

    private buildInlineJavaScriptFindings(detections: InlineJavaScriptDetections): DomFinding[] {
        const findings: DomFinding[] = [];

        if (detections.inlineScriptTags.length > 0) {
            findings.push({
                type: "warning",
                category: "html",
                code: "INLINE_SCRIPT_TAG",
                message: `Contains ${detections.inlineScriptTags.length} inline <script> tag(s).`,
                data: {
                    examples: detections.inlineScriptTags,
                },
            });
        }

        if (detections.javascriptUrls.length > 0) {
            findings.push({
                type: "warning",
                category: "links",
                code: "JAVASCRIPT_URL",
                message: `Contains ${detections.javascriptUrls.length} javascript: URL(s).`,
                data: {
                    examples: detections.javascriptUrls,
                },
            });
        }

        if (detections.inlineEventHandlers.length > 0) {
            findings.push({
                type: "warning",
                category: "html",
                code: "INLINE_EVENT_HANDLER",
                message: `Contains ${detections.inlineEventHandlers.length} inline event handler attribute(s).`,
                data: {
                    examples: detections.inlineEventHandlers,
                },
            });
        }

        return findings;
    }

    private async extractFromDom(ctx: ResourceContext) {
        const result = await ctx.page.evaluate(() => {
            const title = document.querySelector("title")?.textContent ?? null;
            const lang = document.documentElement.getAttribute("lang") ?? null;

            const h1s = Array.from(document.querySelectorAll("h1"))
                .map((el) => el.textContent?.trim() ?? "")
                .filter((t) => t.length > 0);

            const getMeta = (selector: string) =>
                document.querySelector(selector)?.getAttribute("content") ?? null;
            const description =
                getMeta('meta[name="description"]') ||
                getMeta('meta[property="og:description"]') ||
                getMeta('meta[name="twitter:description"]');

            const elements = Array.from(document.querySelectorAll("[href], [src]"));
            const links: ResourceReportLink[] = [];
            const findings: DomFinding[] = [];
            const javascriptUrls: string[] = [];

            for (const el of elements) {
                let url: string | null = null;

                if (el.hasAttribute("href")) {
                    url = el.getAttribute("href");
                } else if (el.hasAttribute("src")) {
                    url = el.getAttribute("src");
                }

                if (!url) {
                    findings.push({
                        type: "warning",
                        category: "html",
                        code: "MISSING_URL",
                        message: `Tag ${el.tagName.toLowerCase()} with missing link attribute (href or src).`,
                    });
                    continue;
                }

                url = url.trim();

                if (url === "") {
                    findings.push({
                        type: "warning",
                        category: "links",
                        code: "EMPTY_URL",
                        message: `Tag ${el.tagName.toLowerCase()} with an empty link attribute (href or src).`,
                    });
                    continue;
                }

                if (/^javascript:/i.test(url)) {
                    javascriptUrls.push(url);
                }

                let absoluteUrl = url;
                try {
                    absoluteUrl = new URL(url, document.baseURI).href;
                } catch {
                    findings.push({
                        type: "error",
                        category: "links",
                        code: "NOT_PARSABLE_URL",
                        message: `URL ${url} is not parsable.`,
                    });
                }

                links.push({
                    type: el.tagName.toLowerCase(),
                    tag: el.tagName.toLowerCase(),
                    target: el.getAttribute("target"),
                    url: absoluteUrl,
                    text: el.textContent?.trim() ?? null,
                });
            }

            const inlineScriptTags = Array.from(document.querySelectorAll("script:not([src])"))
                .map((script) => script.textContent?.trim() ?? "")
                .filter((content) => content.length > 0)
                .slice(0, 10);

            const inlineEventHandlers = Array.from(document.querySelectorAll("*"))
                .flatMap((element) =>
                    element
                        .getAttributeNames()
                        .filter((attribute) => /^on/i.test(attribute))
                        .map((attribute) => ({
                            tag: element.tagName.toLowerCase(),
                            attribute,
                        })),
                )
                .slice(0, 20);

            const clone = document.body.cloneNode(true) as HTMLElement;
            const selectors = ["script", "style", "noscript", "header", "footer", "nav", "aside"];
            selectors.forEach((selector) => {
                clone.querySelectorAll(selector).forEach((el) => el.remove());
            });
            const content = (clone.innerText || "").replace(/\s+/g, " ").trim();

            return {
                title,
                h1s,
                description,
                links,
                lang,
                content,
                findings,
                inlineJavaScript: {
                    inlineScriptTags,
                    javascriptUrls: javascriptUrls.slice(0, 20),
                    inlineEventHandlers,
                },
            };
        });

        for (const finding of [
            ...result.findings,
            ...this.buildInlineJavaScriptFindings(result.inlineJavaScript),
        ]) {
            this.registerFinding(
                finding.type,
                finding.category,
                ctx,
                finding.code,
                finding.message,
                finding.data,
            );
        }

        return {
            title: result.title,
            h1s: result.h1s,
            description: result.description,
            links: result.links,
            lang: result.lang,
            content: result.content,
        };
    }
}
