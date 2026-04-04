-- Version: 045
-- Migration: Design-doc review runs for config-gated review triggers (DD-039)
-- Tracks review lifecycle: pending -> running -> passed/failed/cancelled/superseded

CREATE TABLE IF NOT EXISTS doc_review_runs (
    id TEXT PRIMARY KEY,
    doc_row_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL,
    doc_version INTEGER NOT NULL,
    task_snapshot_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'running', 'passed', 'failed', 'cancelled', 'superseded')
    ),
    runtime TEXT NOT NULL CHECK (runtime IN ('pi', 'custom')),
    transport TEXT NOT NULL CHECK (transport IN ('rpc', 'sdk')),
    template_name TEXT NOT NULL,
    triggered_by_event_id TEXT,
    worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
    started_at TEXT,
    ended_at TEXT,
    result_summary TEXT,
    findings_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}'
);

-- At most one active review run per doc version and task snapshot
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_review_runs_active
    ON doc_review_runs(doc_id, doc_version, task_snapshot_hash)
    WHERE status IN ('pending', 'running');

-- Query by doc version ordered by completion time
CREATE INDEX IF NOT EXISTS idx_doc_review_runs_doc
    ON doc_review_runs(doc_id, doc_version, ended_at DESC);

-- Filter by status for pending review claim queries
CREATE INDEX IF NOT EXISTS idx_doc_review_runs_status
    ON doc_review_runs(status, started_at DESC);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (45, datetime('now'));
