-- Version: 025
-- Migration: Add run heartbeat state table for transcript-progress monitoring

CREATE TABLE IF NOT EXISTS run_heartbeat_state (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    last_check_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    stdout_bytes INTEGER NOT NULL DEFAULT 0 CHECK (stdout_bytes >= 0),
    stderr_bytes INTEGER NOT NULL DEFAULT 0 CHECK (stderr_bytes >= 0),
    transcript_bytes INTEGER NOT NULL DEFAULT 0 CHECK (transcript_bytes >= 0),
    last_delta_bytes INTEGER NOT NULL DEFAULT 0 CHECK (last_delta_bytes >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_run_heartbeat_check_at
ON run_heartbeat_state(last_check_at);

CREATE INDEX IF NOT EXISTS idx_run_heartbeat_activity_at
ON run_heartbeat_state(last_activity_at);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (25, datetime('now'));
