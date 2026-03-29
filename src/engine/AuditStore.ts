import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { EnqueueUrlInput, NextUrlCandidate, PersistPageResultInput } from "./types.js";
import { fileURLToPath } from "node:url";

export class AuditStore {
    private db: Database.Database;

    public constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");
    }

    public initSchema(): void {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const schemaPath = path.resolve(__dirname, "../resources/db/schema.sql");
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Schema file not found at ${schemaPath}`);
        }
        const sql = fs.readFileSync(schemaPath, "utf-8");

        this.db.exec(sql);
    }

    public createRun(input: { websiteId: string; startUrl: string }): number {
        const stmt = this.db.prepare(`
      INSERT INTO crawl_runs (website_id, start_url, started_at, status)
      VALUES (?, ?, ?, 'running')
    `);

        const result = stmt.run(input.websiteId, input.startUrl, new Date().toISOString());

        return Number(result.lastInsertRowid);
    }

    public finishRun(runId: number, status: "finished" | "failed" = "finished"): void {
        this.db
            .prepare(
                `
      UPDATE crawl_runs
      SET finished_at = ?, status = ?
      WHERE id = ?
    `,
            )
            .run(new Date().toISOString(), status, runId);
    }

    public enqueueUrl(input: EnqueueUrlInput): boolean {
        const now = new Date().toISOString();

        const insert = this.db.prepare(`
      INSERT OR IGNORE INTO urls (
        run_id, url, normalized_url, depth, discovered_at, queued_at, status, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
    `);

        const result = insert.run(
            input.runId,
            input.url,
            input.normalizedUrl,
            input.depth,
            now,
            now,
            input.sourceUrl ?? null,
        );

        return result.changes > 0;
    }

    public claimNextQueuedUrl(runId: number): NextUrlCandidate | null {
        const select = this.db.prepare(`
      SELECT id, url, depth
      FROM urls
      WHERE run_id = ? AND status = 'queued'
      ORDER BY id ASC
      LIMIT 1
    `);

        const row = select.get(runId) as NextUrlCandidate | undefined;
        if (!row) return null;

        const update = this.db.prepare(`
      UPDATE urls
      SET status = 'processing'
      WHERE id = ? AND status = 'queued'
    `);

        const result = update.run(row.id);
        if (result.changes === 0) {
            return null;
        }

        return row;
    }

    public markUrlFailed(runId: number, urlId: number, errorMessage: string): void {
        this.db
            .prepare(
                `
      UPDATE urls
      SET status = 'failed',
          visited_at = ?,
          error_message = ?
      WHERE run_id = ? AND id = ?
    `,
            )
            .run(new Date().toISOString(), errorMessage, runId, urlId);
    }

    public persistPageResult(input: PersistPageResultInput): void {
        const tx = this.db.transaction(() => {
            this.db
                .prepare(
                    `
        UPDATE urls
        SET status = 'done',
            visited_at = ?,
            http_status = ?,
            content_type = ?,
            page_title = ?
        WHERE run_id = ? AND id = ?
      `,
                )
                .run(
                    new Date().toISOString(),
                    input.httpStatus ?? null,
                    input.contentType ?? null,
                    input.pageTitle ?? null,
                    input.runId,
                    input.urlId,
                );

            const insertFinding = this.db.prepare(`
        INSERT INTO findings (
          run_id, url_id, plugin, category, code, severity, message,
          resource_url, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

            for (const finding of input.findings) {
                insertFinding.run(
                    input.runId,
                    input.urlId,
                    finding.plugin,
                    finding.category ?? null,
                    finding.code,
                    finding.severity,
                    finding.message,
                    finding.resourceUrl ?? null,
                    finding.payload !== undefined ? JSON.stringify(finding.payload) : null,
                    new Date().toISOString(),
                );
            }

            const insertLink = this.db.prepare(`
        INSERT INTO links (
          run_id, from_url_id, to_url, normalized_to_url, link_text,
          nofollow, is_internal, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

            for (const link of input.discoveredLinks) {
                insertLink.run(
                    input.runId,
                    input.urlId,
                    link.toUrl,
                    link.normalizedToUrl,
                    link.linkText ?? null,
                    link.nofollow ? 1 : 0,
                    link.isInternal ? 1 : 0,
                    new Date().toISOString(),
                );
            }
        });

        tx();
    }

    public getFindingCounts(runId: number): Array<{
        code: string;
        severity: string;
        count: number;
    }> {
        return this.db
            .prepare(
                `
      SELECT code, severity, COUNT(*) as count
      FROM findings
      WHERE run_id = ?
      GROUP BY code, severity
      ORDER BY count DESC, code ASC
    `,
            )
            .all(runId) as Array<{ code: string; severity: string; count: number }>;
    }
}
