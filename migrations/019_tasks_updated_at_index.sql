-- Version: 019
-- Migration: Add index on tasks.updated_at for sync dirty detection
--
-- The sync status dirty check scans all tasks to find any updated after
-- the last export. Without an index on updated_at, this is O(n).
-- With the index, a SQL query can find changed tasks in O(log n).

CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (19, datetime('now'));
