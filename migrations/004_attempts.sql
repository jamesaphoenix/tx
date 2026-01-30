-- Version: 004
-- Migration: Attempts table for tracking task attempt outcomes

-- Attempts table (track failed/succeeded approaches per task)
CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    approach TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('failed', 'succeeded')),
    reason TEXT,
    created_at TEXT NOT NULL
);

-- Index for task_id lookups
CREATE INDEX IF NOT EXISTS idx_attempts_task_id ON attempts(task_id);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (4, datetime('now'));
