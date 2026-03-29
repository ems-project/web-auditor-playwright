import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { BasePlugin } from "../engine/BasePlugin.js";
import type { IPlugin, PluginPhase, ResourceContext } from "../engine/types.js";

type SiteDumpPluginOptions = {
    outputDir: string;
};

export class SiteDumpPlugin extends BasePlugin implements IPlugin {
    name = "site-dump";
    phases: PluginPhase[] = ["process", "download"];

    constructor(private readonly options: SiteDumpPluginOptions) {
        super();
    }

    applies(ctx: ResourceContext): boolean {
        if (typeof ctx.status === "number" && ctx.status >= 400) {
            return false;
        }

        if (ctx.report.is_web) {
            return typeof ctx.mime === "string" && ctx.mime.includes("text/html");
        }

        return Boolean(ctx.downloaded?.savedPath);
    }

    async run(phase: PluginPhase, ctx: ResourceContext): Promise<void> {
        await fs.mkdir(this.options.outputDir, { recursive: true });

        if (phase === "process" && ctx.report.is_web) {
            await this.dumpHtmlPage(ctx);
            this.register(ctx);
            return;
        }

        if (phase === "download" && ctx.downloaded?.savedPath) {
            await this.dumpDownloadedFile(ctx);
            this.register(ctx);
        }
    }

    private async dumpHtmlPage(ctx: ResourceContext): Promise<void> {
        const targetUrl = ctx.report.url ?? ctx.finalUrl ?? ctx.url;
        const html = await ctx.page.evaluate((currentUrl: string) => {
            const isSameOriginHttpUrl = (value: string, origin: string): boolean => {
                try {
                    const parsed = new URL(value, currentUrl);
                    return (
                        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
                        parsed.origin === origin
                    );
                } catch {
                    return false;
                }
            };

            const toLocalPath = (absoluteUrl: string): string => {
                const parsed = new URL(absoluteUrl);
                const pathname = parsed.pathname || "/";
                const hasTrailingSlash = pathname.endsWith("/");
                const filename = pathname.split("/").filter(Boolean).at(-1) ?? "";
                const hasExtension = /\.[a-z0-9]{1,8}$/i.test(filename);
                let localPath = pathname;

                if (pathname === "/") {
                    localPath = "/index.html";
                } else if (hasTrailingSlash) {
                    localPath = `${pathname}index.html`;
                } else if (!hasExtension) {
                    localPath = `${pathname}/index.html`;
                }

                if (parsed.search) {
                    const hash = absoluteUrl
                        .split("")
                        .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7)
                        .toString(16);
                    const extensionMatch = /\.[a-z0-9]{1,8}$/i.exec(localPath);
                    if (extensionMatch) {
                        localPath = localPath.replace(
                            extensionMatch[0],
                            `-${hash}${extensionMatch[0]}`,
                        );
                    } else {
                        localPath = `${localPath}-${hash}`;
                    }
                }

                return localPath;
            };

            const toRelativePath = (fromUrl: string, toUrl: string): string => {
                const fromPath = toLocalPath(fromUrl);
                const toPath = toLocalPath(toUrl);
                const fromParts = fromPath.split("/").filter(Boolean);
                const toParts = toPath.split("/").filter(Boolean);

                if (fromParts.length > 0) {
                    fromParts.pop();
                }

                while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
                    fromParts.shift();
                    toParts.shift();
                }

                const upward = fromParts.map(() => "..");
                const relativeParts = [...upward, ...toParts];
                return relativeParts.length > 0 ? relativeParts.join("/") : "index.html";
            };

            const current = new URL(currentUrl);
            const attrs = ["href", "src"];

            for (const attr of attrs) {
                document.querySelectorAll(`[${attr}]`).forEach((element: Element) => {
                    const value = element.getAttribute(attr);
                    if (!value) {
                        return;
                    }
                    if (!isSameOriginHttpUrl(value, current.origin)) {
                        return;
                    }

                    const absoluteUrl = new URL(value, currentUrl).href;
                    element.setAttribute(attr, toRelativePath(currentUrl, absoluteUrl));
                });
            }

            return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
        }, targetUrl);

        const filePath = this.resolveDumpPath(targetUrl, "text/html");
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, html, "utf-8");
    }

    private async dumpDownloadedFile(ctx: ResourceContext): Promise<void> {
        const sourcePath = ctx.downloaded?.savedPath;
        const targetUrl = ctx.report.url ?? ctx.finalUrl ?? ctx.url;
        const mime = ctx.downloaded?.mime ?? ctx.report.mimetype ?? ctx.mime ?? undefined;

        if (!sourcePath) {
            return;
        }

        const filePath = this.resolveDumpPath(targetUrl, mime);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.copyFile(sourcePath, filePath);
    }

    private resolveDumpPath(targetUrl: string, mime: string | undefined): string {
        const parsed = new URL(targetUrl);
        const normalizedPath = this.normalizeUrlPath(parsed.pathname, mime, parsed.search);
        return path.join(this.options.outputDir, normalizedPath.replace(/^\//, ""));
    }

    private normalizeUrlPath(pathname: string, mime: string | undefined, search: string): string {
        const cleanPath = pathname || "/";
        const hasTrailingSlash = cleanPath.endsWith("/");
        const filename = cleanPath.split("/").filter(Boolean).at(-1) ?? "";
        const hasExtension = /\.[a-z0-9]{1,8}$/i.test(filename);
        let outputPath = cleanPath;

        if (cleanPath === "/") {
            outputPath = "/index.html";
        } else if (this.isHtmlMime(mime) && hasTrailingSlash) {
            outputPath = `${cleanPath}index.html`;
        } else if (this.isHtmlMime(mime) && !hasExtension) {
            outputPath = `${cleanPath}/index.html`;
        }

        if (search) {
            const suffix = this.shortHash(`${cleanPath}?${search}`);
            const extension = path.posix.extname(outputPath);
            if (extension) {
                outputPath = outputPath.slice(0, -extension.length) + `-${suffix}` + extension;
            } else {
                outputPath = `${outputPath}-${suffix}`;
            }
        }

        return outputPath;
    }

    private isHtmlMime(mime: string | undefined): boolean {
        return typeof mime === "string" && mime.includes("text/html");
    }

    private shortHash(value: string): string {
        return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
    }

    isAuditPlugin(): boolean {
        return false;
    }
}
