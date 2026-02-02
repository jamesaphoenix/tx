-- Version: 010
-- Migration: Learning candidates table for telemetry extraction pipeline

-- Learning candidates awaiting promotion to learnings table
-- See PRD-015: JSONL Telemetry Daemon and Knowledge Promotion Pipeline
CREATE TABLE IF NOT EXISTS learning_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    category TEXT,
    source_file TEXT NOT NULL,
    source_run_id TEXT,
    source_task_id TEXT,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'rejected', 'merged')),
    reviewed_at TEXT,
    reviewed_by TEXT,  -- 'auto' or user identifier
    promoted_learning_id INTEGER,
    rejection_reason TEXT,
    FOREIGN KEY (promoted_learning_id) REFERENCES learnings(id) ON DELETE SET NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_learning_candidates_status ON learning_candidates(status);
CREATE INDEX IF NOT EXISTS idx_learning_candidates_confidence ON learning_candidates(confidence);
CREATE INDEX IF NOT EXISTS idx_learning_candidates_source ON learning_candidates(source_file);
CREATE INDEX IF NOT EXISTS idx_learning_candidates_extracted ON learning_candidates(extracted_at);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (10, datetime('now'));
