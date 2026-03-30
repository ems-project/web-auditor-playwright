import http from "node:http";

import { AuditStore } from "./AuditStore.js";
import type { CrawlCompletionSummary } from "./CrawlCompletionSummary.js";
import { renderCrawlCompletionPage } from "./CrawlCompletionPage.js";
import { renderCrawlProgressPage } from "./CrawlProgressPage.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CrawlProgressServerOptions = {
    auditDbPath: string;
    port: number;
    getRunId?: () => number | undefined;
    host?: string;
};

export class CrawlProgressServer {
    private readonly host: string;
    private readonly store: AuditStore;
    private server?: http.Server;
    private readonly sockets = new Set<import("node:net").Socket>();
    private completionSummary?: CrawlCompletionSummary;

    constructor(private readonly options: CrawlProgressServerOptions) {
        this.host = options.host ?? "127.0.0.1";
        this.store = new AuditStore(options.auditDbPath);
        this.store.initSchema();
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

            if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                res.end(this.renderHtml());
                return;
            }

            if (requestUrl.pathname === "/favicon.ico") {
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const filePath = path.join(__dirname, "../resources/assets/logo.png");
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
        });
    }
}
