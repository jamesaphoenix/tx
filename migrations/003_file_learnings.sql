-- Version: 003
-- Migration: File learnings table for path-based knowledge

-- File learnings table (path-based knowledge storage)
CREATE TABLE IF NOT EXISTS file_learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_pattern TEXT NOT NULL,
    note TEXT NOT NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

-- Index for file pattern lookups
CREATE INDEX IF NOT EXISTS idx_file_learnings_pattern ON file_learnings(file_pattern);
CREATE INDEX IF NOT EXISTS idx_file_learnings_created ON file_learnings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_learnings_task ON file_learnings(task_id);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (3, datetime('now'));
