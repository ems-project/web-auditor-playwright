CREATE TABLE IF NOT EXISTS plugin_state (
    run_id INTEGER NOT NULL,
    state_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, state_key),
    FOREIGN KEY (run_id) REFERENCES crawl_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_state_run
    ON plugin_state(run_id);
