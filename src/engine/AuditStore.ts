import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EnqueueUrlInput, NextUrlCandidate, PersistPageResultInput } from "./types.js";

type RunRow = {
    id: number;
    start_url: string;
    started_at: string;
    status: string;
};

type RunSnapshot = {
    startUrl: string;
    startedAt: string;
    normalizedUrls: string[];
    processedCount: number;
    queuedCount: number;
    infoCount: number;
    warningCount: number;
    errorCount: number;
};

type MigrationRow = {
    version: number;
};

type FindingCountByPluginRow = {
    plugin: string;
    severity: string;
    count: number;
};

export class AuditStore {
    private db: Database.Database;

    public constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");
        this.db.pragma("foreign_keys = ON");
    }

    public initSchema(): void {
        this.ensureMigrationsTable();

        for (const migration of this.getPendingMigrations()) {
            const sql = fs.readFileSync(migration.path, "utf-8");
            const apply = this.db.transaction(() => {
                this.db.exec(sql);
                this.db
                    .prepare(
                        `
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `,
                    )
                    .run(migration.version, migration.name, new Date().toISOString());
            });

            apply();
        }
    }

    public createRun(input: { startUrl: string }): number {
        const stmt = this.db.prepare(`
      INSERT INTO crawl_runs (start_url, started_at, status)
      VALUES (?, ?, 'running')
    `);

        const result = stmt.run(input.startUrl, new Date().toISOString());

        return Number(result.lastInsertRowid);
    }

    public getRun(
        runId: number,
    ): { id: number; startUrl: string; startedAt: string; status: string } | null {
        const row = this.db
            .prepare(
                `
      SELECT id, start_url, started_at, status
      FROM crawl_runs
      WHERE id = ?
    `,
            )
            .get(runId) as RunRow | undefined;

        if (!row) {
            return null;
        }

        return {
            id: row.id,
            startUrl: row.start_url,
            startedAt: row.started_at,
            status: row.status,
        };
    }

    public resumeRun(runId: number): void {
        const tx = this.db.transaction(() => {
            this.db
                .prepare(
                    `
      UPDATE crawl_runs
      SET status = 'running', finished_at = NULL
      WHERE id = ?
    `,
                )
                .run(runId);

            this.db
                .prepare(
                    `
      UPDATE urls
      SET status = 'queued'
      WHERE run_id = ? AND status = 'processing' AND visited_at IS NULL
    `,
                )
                .run(runId);
        });

        tx();
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
          tag, target, enqueue_result, nofollow, is_internal, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

            for (const link of input.discoveredLinks) {
                insertLink.run(
                    input.runId,
                    input.urlId,
                    link.toUrl,
                    link.normalizedToUrl,
                    link.linkText ?? null,
                    link.tag ?? null,
                    link.target ?? null,
                    link.enqueueResult ?? null,
                    link.nofollow ? 1 : 0,
                    link.isInternal ? 1 : 0,
                    new Date().toISOString(),
                );
            }
        });

        tx();
    }

    public savePluginState(runId: number, pluginState: Record<string, unknown>): void {
        const tx = this.db.transaction(() => {
            this.db.prepare(`DELETE FROM plugin_state WHERE run_id = ?`).run(runId);

            const insert = this.db.prepare(`
        INSERT INTO plugin_state (run_id, state_key, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
      `);
            const updatedAt = new Date().toISOString();

            for (const [stateKey, payload] of Object.entries(pluginState)) {
                if (payload === undefined) {
                    continue;
                }

                insert.run(runId, stateKey, JSON.stringify(payload), updatedAt);
            }
        });

        tx();
    }

    public loadPluginState(runId: number): Record<string, unknown> {
        const rows = this.db
            .prepare(
                `
      SELECT state_key, payload_json
      FROM plugin_state
      WHERE run_id = ?
      ORDER BY state_key ASC
    `,
            )
            .all(runId) as Array<{ state_key: string; payload_json: string }>;

        const result: Record<string, unknown> = {};
        for (const row of rows) {
            result[row.state_key] = JSON.parse(row.payload_json);
        }

        return result;
    }

    public getRunSnapshot(runId: number): RunSnapshot | null {
        const run = this.getRun(runId);
        if (!run) {
            return null;
        }

        const normalizedUrls = this.db
            .prepare(
                `
      SELECT normalized_url
      FROM urls
      WHERE run_id = ?
      ORDER BY id ASC
    `,
            )
            .all(runId)
            .map((row) => (row as { normalized_url: string }).normalized_url);

        const processedCount = Number(
            (
                this.db
                    .prepare(
                        `
      SELECT COUNT(*) AS count
      FROM urls
      WHERE run_id = ? AND visited_at IS NOT NULL
    `,
                    )
                    .get(runId) as { count: number }
            ).count,
        );

        const queuedCount = Number(
            (
                this.db
                    .prepare(
                        `
      SELECT COUNT(*) AS count
      FROM urls
      WHERE run_id = ? AND status = 'queued'
    `,
                    )
                    .get(runId) as { count: number }
            ).count,
        );

        const severityCounts = this.db
            .prepare(
                `
      SELECT severity, COUNT(DISTINCT url_id) AS count
      FROM findings
      WHERE run_id = ? AND url_id IS NOT NULL
      GROUP BY severity
    `,
            )
            .all(runId) as Array<{ severity: string; count: number }>;

        let infoCount = 0;
        let warningCount = 0;
        let errorCount = 0;
        for (const row of severityCounts) {
            if (row.severity === "info") {
                infoCount = Number(row.count);
            }
            if (row.severity === "warning") {
                warningCount = Number(row.count);
            }
            if (row.severity === "error") {
                errorCount = Number(row.count);
            }
        }

        return {
            startUrl: run.startUrl,
            startedAt: run.startedAt,
            normalizedUrls,
            processedCount,
            queuedCount,
            infoCount,
            warningCount,
            errorCount,
        };
    }

    public getFindings(runId: number): Array<{
        plugin: string;
        type: string;
        category: string;
        code: string;
        message: string;
        url?: string;
        data?: unknown;
    }> {
        const rows = this.db
            .prepare(
                `
      SELECT plugin, severity, category, code, message, resource_url, payload_json
      FROM findings
      WHERE run_id = ?
      ORDER BY id ASC
    `,
            )
            .all(runId) as Array<{
            plugin: string;
            severity: string;
            category: string | null;
            code: string;
            message: string;
            resource_url: string | null;
            payload_json: string | null;
        }>;

        return rows.map((row) => ({
            plugin: row.plugin,
            type: row.severity,
            category: row.category ?? "",
            code: row.code,
            message: row.message,
            url: row.resource_url ?? undefined,
            data: row.payload_json ? JSON.parse(row.payload_json) : undefined,
        }));
    }

    public getFindingCountsByPlugin(
        runId: number,
        excludedCodes: string[] = [],
    ): Record<string, { info: number; warning: number; error: number }> {
        const placeholders = excludedCodes.map(() => "?").join(", ");
        const rows = this.db
            .prepare(
                `
      SELECT plugin, severity, COUNT(*) AS count
      FROM findings
      WHERE run_id = ?
        ${excludedCodes.length > 0 ? `AND code NOT IN (${placeholders})` : ""}
      GROUP BY plugin, severity
    `,
            )
            .all(runId, ...excludedCodes) as FindingCountByPluginRow[];

        const countsByPlugin: Record<string, { info: number; warning: number; error: number }> = {};

        for (const row of rows) {
            const counts = countsByPlugin[row.plugin] ?? {
                info: 0,
                warning: 0,
                error: 0,
            };

            if (row.severity === "info") {
                counts.info = Number(row.count);
            }
            if (row.severity === "warning") {
                counts.warning = Number(row.count);
            }
            if (row.severity === "error") {
                counts.error = Number(row.count);
            }

            countsByPlugin[row.plugin] = counts;
        }

        return countsByPlugin;
    }

    public getInventory(runId: number): Array<{
        depth?: number;
        mime?: string;
        status?: number;
        url: string;
    }> {
        return this.db
            .prepare(
                `
      SELECT depth, content_type, http_status, url
      FROM urls
      WHERE run_id = ? AND visited_at IS NOT NULL
      ORDER BY id ASC
    `,
            )
            .all(runId)
            .map((row) => {
                const inventoryRow = row as {
                    depth: number | null;
                    content_type: string | null;
                    http_status: number | null;
                    url: string;
                };

                return {
                    depth: inventoryRow.depth ?? undefined,
                    mime: inventoryRow.content_type ?? undefined,
                    status: inventoryRow.http_status ?? undefined,
                    url: inventoryRow.url,
                };
            });
    }

    public getLiveSnapshot(runId?: number): {
        run: {
            id: number;
            startUrl: string;
            startedAt: string;
            finishedAt: string | null;
            status: string;
        } | null;
        urlCounts: Record<string, number>;
        findingCounts: Record<string, number>;
        recentUrls: Array<{
            url: string;
            status: string;
            depth: number | null;
            httpStatus: number | null;
        }>;
        recentFindings: Array<{
            severity: string;
            code: string;
            plugin: string;
            message: string;
        }>;
    } {
        const effectiveRunId = runId ?? this.getLatestRunId();
        if (!effectiveRunId) {
            return {
                run: null,
                urlCounts: {},
                findingCounts: { total: 0 },
                recentUrls: [],
                recentFindings: [],
            };
        }

        const runRow = this.db
            .prepare(
                `
      SELECT id, start_url, started_at, finished_at, status
      FROM crawl_runs
      WHERE id = ?
    `,
            )
            .get(effectiveRunId) as
            | {
                  id: number;
                  start_url: string;
                  started_at: string;
                  finished_at: string | null;
                  status: string;
              }
            | undefined;

        if (!runRow) {
            return {
                run: null,
                urlCounts: {},
                findingCounts: { total: 0 },
                recentUrls: [],
                recentFindings: [],
            };
        }

        const urlCounts = Object.fromEntries(
            (
                this.db
                    .prepare(
                        `
      SELECT status, COUNT(*) AS count
      FROM urls
      WHERE run_id = ?
      GROUP BY status
    `,
                    )
                    .all(effectiveRunId) as Array<{ status: string; count: number }>
            ).map((row) => [row.status, Number(row.count)]),
        );

        const findingCounts = Object.fromEntries(
            (
                this.db
                    .prepare(
                        `
      SELECT severity, COUNT(*) AS count
      FROM findings
      WHERE run_id = ?
      GROUP BY severity
    `,
                    )
                    .all(effectiveRunId) as Array<{ severity: string; count: number }>
            ).map((row) => [row.severity, Number(row.count)]),
        ) as Record<string, number>;
        findingCounts.total = Object.values(findingCounts).reduce((sum, value) => sum + value, 0);

        const recentUrls = this.db
            .prepare(
                `
      SELECT url, status, depth, http_status
      FROM urls
      WHERE run_id = ?
      ORDER BY COALESCE(visited_at, queued_at, discovered_at) DESC, id DESC
      LIMIT 20
    `,
            )
            .all(effectiveRunId) as Array<{
            url: string;
            status: string;
            depth: number | null;
            http_status: number | null;
        }>;

        const recentFindings = this.db
            .prepare(
                `
      SELECT severity, code, plugin, message
      FROM findings
      WHERE run_id = ?
      ORDER BY id DESC
      LIMIT 20
    `,
            )
            .all(effectiveRunId) as Array<{
            severity: string;
            code: string;
            plugin: string;
            message: string;
        }>;

        return {
            run: {
                id: runRow.id,
                startUrl: runRow.start_url,
                startedAt: runRow.started_at,
                finishedAt: runRow.finished_at,
                status: runRow.status,
            },
            urlCounts,
            findingCounts,
            recentUrls: recentUrls.map((row) => ({
                url: row.url,
                status: row.status,
                depth: row.depth,
                httpStatus: row.http_status,
            })),
            recentFindings,
        };
    }

    private ensureMigrationsTable(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
      )
    `);
    }

    private getLatestRunId(): number | undefined {
        const row = this.db
            .prepare(
                `
      SELECT id
      FROM crawl_runs
      ORDER BY id DESC
      LIMIT 1
    `,
            )
            .get() as { id: number } | undefined;

        return row?.id;
    }

    private getPendingMigrations(): Array<{ version: number; name: string; path: string }> {
        const appliedVersions = new Set(
            this.db
                .prepare(
                    `
      SELECT version
      FROM schema_migrations
      ORDER BY version ASC
    `,
                )
                .all()
                .map((row) => (row as MigrationRow).version),
        );

        return this.getAvailableMigrations().filter(
            (migration) => !appliedVersions.has(migration.version),
        );
    }

    private getAvailableMigrations(): Array<{ version: number; name: string; path: string }> {
        const migrationsDir = this.getMigrationsDirectory();
        if (!fs.existsSync(migrationsDir)) {
            throw new Error(`Migrations directory not found at ${migrationsDir}`);
        }

        return fs
            .readdirSync(migrationsDir)
            .filter((name) => /^\d+_.+\.sql$/.test(name))
            .sort((left, right) => left.localeCompare(right))
            .map((name) => ({
                version: Number(name.split("_")[0]),
                name,
                path: path.join(migrationsDir, name),
            }));
    }

    private getMigrationsDirectory(): string {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        return path.resolve(__dirname, "../resources/db/migrations");
    }
}
