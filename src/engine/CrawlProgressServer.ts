import http from "node:http";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AuditStore } from "./AuditStore.js";
import type { CrawlCompletionSummary } from "./CrawlCompletionSummary.js";
import { renderCrawlCompletionPage } from "./CrawlCompletionPage.js";
import { renderCrawlProgressPage } from "./CrawlProgressPage.js";

type CrawlProgressServerOptions = {
    auditDbPath: string;
    port: number;
    getRunId?: () => number | undefined;
    host?: string;
    staticRootDir?: string;
    onRequestGracefulStop?: () => void;
    onRequestShutdown?: () => void | Promise<void>;
};

export class CrawlProgressServer {
    private readonly host: string;
    private readonly store: AuditStore;
    private server?: http.Server;
    private readonly sockets = new Set<import("node:net").Socket>();
    private completionSummary?: CrawlCompletionSummary;
    private readonly staticRootDir: string | null;

    constructor(private readonly options: CrawlProgressServerOptions) {
        this.host = options.host ?? "127.0.0.1";
        this.store = new AuditStore(options.auditDbPath);
        this.store.initSchema();
        this.staticRootDir = options.staticRootDir ?? null;
    }

    async start(): Promise<void> {
        if (this.server) {
            return;
        }

        this.server = http.createServer((req, res) => {
            res.setHeader("Connection", "close");
            const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

            if (requestUrl.pathname === "/api/status") {
                const snapshot = this.store.getLiveSnapshot(this.options.getRunId?.());
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(snapshot));
                return;
            }

            if (requestUrl.pathname === "/api/completion") {
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(this.completionSummary ?? null));
                return;
            }

            if (requestUrl.pathname === "/api/request-graceful-stop" && req.method === "POST") {
                this.options.onRequestGracefulStop?.();
                res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            if (requestUrl.pathname === "/api/shutdown" && req.method === "POST") {
                void this.handleShutdownRequest(res);
                return;
            }

            if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                res.end(this.renderHtml());
                return;
            }

            if (requestUrl.pathname.startsWith("/artifacts/")) {
                void this.serveArtifact(requestUrl.pathname, res);
                return;
            }

            if (requestUrl.pathname === "/favicon.ico") {
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const filePath = path.join(__dirname, "../resources/assets/icon.png");
                const fileBuffer = readFileSync(filePath);
                res.writeHead(200, {
                    "Content-Type": "image/png",
                    "Cache-Control": "public, max-age=86400",
                });
                res.end(fileBuffer);

                return;
            }

            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Not found");
        });

        this.server.on("connection", (socket) => {
            this.sockets.add(socket);
            socket.on("close", () => this.sockets.delete(socket));
        });

        await new Promise<void>((resolve, reject) => {
            this.server?.once("error", reject);
            this.server?.listen(this.options.port, this.host, () => {
                this.server?.off("error", reject);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        if (!this.server) {
            return;
        }

        for (const socket of this.sockets) {
            socket.destroy();
        }
        this.sockets.clear();

        await new Promise<void>((resolve, reject) => {
            this.server?.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        this.server = undefined;
    }

    setCompletionSummary(summary: CrawlCompletionSummary): void {
        this.completionSummary = summary;
    }

    getUrl(): string {
        return `http://${this.host}:${this.options.port}`;
    }

    private renderHtml(): string {
        if (this.completionSummary) {
            return renderCrawlCompletionPage(this.completionSummary);
        }

        return renderCrawlProgressPage({
            title: "Web Auditor Crawl Monitor",
            statusApiPath: "/api/status",
            refreshIntervalMs: 2000,
            gracefulStopApiPath: "/api/request-graceful-stop",
        });
    }

    private async serveArtifact(pathname: string, res: http.ServerResponse): Promise<void> {
        if (!this.staticRootDir) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
        }

        const relativePath = pathname.replace(/^\/artifacts\//, "");
        const resolvedPath = path.resolve(this.staticRootDir, relativePath);
        const rootPath = path.resolve(this.staticRootDir);

        if (!resolvedPath.startsWith(rootPath + path.sep) && resolvedPath !== rootPath) {
            res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
            res.end("Forbidden");
            return;
        }

        try {
            const fileBuffer = await fs.readFile(resolvedPath);
            res.writeHead(200, {
                "content-type": contentTypeForArtifact(resolvedPath),
                "cache-control": "no-store",
            });
            res.end(fileBuffer);
        } catch {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Not found");
        }
    }

    private async handleShutdownRequest(res: http.ServerResponse): Promise<void> {
        res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));

        try {
            await this.options.onRequestShutdown?.();
        } finally {
            setTimeout(() => {
                void this.stop();
            }, 0);
        }
    }
}

function contentTypeForArtifact(filePath: string): string {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".json")) {
        return "application/json; charset=utf-8";
    }
    if (lower.endsWith(".xlsx")) {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (lower.endsWith(".xml")) {
        return "application/xml; charset=utf-8";
    }
    if (lower.endsWith(".html")) {
        return "text/html; charset=utf-8";
    }
    return "application/octet-stream";
}
