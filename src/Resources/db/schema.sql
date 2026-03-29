PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS crawl_runs (
                                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                                          website_id TEXT NOT NULL,
                                          start_url TEXT NOT NULL,
                                          started_at TEXT NOT NULL,
                                          finished_at TEXT,
                                          status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS urls (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    run_id INTEGER NOT NULL,
                                    url TEXT NOT NULL,
                                    normalized_url TEXT NOT NULL,
                                    depth INTEGER NOT NULL DEFAULT 0,
                                    discovered_at TEXT NOT NULL,
                                    queued_at TEXT,
                                    visited_at TEXT,
                                    status TEXT NOT NULL DEFAULT 'discovered', -- discovered|queued|processing|done|failed|skipped
                                    http_status INTEGER,
                                    content_type TEXT,
                                    page_title TEXT,
                                    error_message TEXT,
                                    source_url TEXT,
                                    UNIQUE(run_id, normalized_url),
    FOREIGN KEY (run_id) REFERENCES crawl_runs(id)
    );

CREATE INDEX IF NOT EXISTS idx_urls_run_status
    ON urls(run_id, status);

CREATE INDEX IF NOT EXISTS idx_urls_run_depth
    ON urls(run_id, depth);

CREATE TABLE IF NOT EXISTS links (
                                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                                     run_id INTEGER NOT NULL,
                                     from_url_id INTEGER NOT NULL,
                                     to_url TEXT NOT NULL,
                                     normalized_to_url TEXT NOT NULL,
                                     link_text TEXT,
                                     nofollow INTEGER NOT NULL DEFAULT 0,
                                     is_internal INTEGER NOT NULL DEFAULT 1,
                                     discovered_at TEXT NOT NULL,
                                     FOREIGN KEY (run_id) REFERENCES crawl_runs(id),
    FOREIGN KEY (from_url_id) REFERENCES urls(id)
    );

CREATE INDEX IF NOT EXISTS idx_links_run_from
    ON links(run_id, from_url_id);

CREATE INDEX IF NOT EXISTS idx_links_run_to
    ON links(run_id, normalized_to_url);

CREATE TABLE IF NOT EXISTS findings (
                                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                                        run_id INTEGER NOT NULL,
                                        url_id INTEGER,
                                        plugin TEXT NOT NULL,
                                        category TEXT,
                                        code TEXT NOT NULL,
                                        severity TEXT NOT NULL,
                                        message TEXT NOT NULL,
                                        resource_url TEXT,
                                        payload_json TEXT,
                                        created_at TEXT NOT NULL,
                                        FOREIGN KEY (run_id) REFERENCES crawl_runs(id),
    FOREIGN KEY (url_id) REFERENCES urls(id)
    );

CREATE INDEX IF NOT EXISTS idx_findings_run_url
    ON findings(run_id, url_id);

CREATE INDEX IF NOT EXISTS idx_findings_run_code
    ON findings(run_id, code);

CREATE INDEX IF NOT EXISTS idx_findings_run_plugin
    ON findings(run_id, plugin);