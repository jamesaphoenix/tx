-- Version: 020
-- Migration: Add database-level task ID format validation
--
-- Problem: tasks.id has no format constraint. ID validation (tx-[a-z0-9]{6,})
-- only exists in the app layer. JSONL import and direct SQL can insert malformed IDs.
--
-- Approach: Use BEFORE INSERT/UPDATE triggers instead of CHECK constraint because
-- SQLite does not support ALTER TABLE ADD CONSTRAINT, and recreating the tasks table
-- would cascade-delete all data in referencing tables (task_dependencies, attempts,
-- runs, events, task_claims, workers, file_learnings) when foreign_keys is ON.
-- Triggers provide identical database-level enforcement without table recreation.

-- Validate task ID format on INSERT
CREATE TRIGGER IF NOT EXISTS validate_task_id_insert
BEFORE INSERT ON tasks
FOR EACH ROW
WHEN NEW.id NOT GLOB 'tx-[a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'Task ID must match format: tx-[a-z0-9]{6,}');
END;

-- Validate task ID format on UPDATE (prevents changing id to malformed value)
CREATE TRIGGER IF NOT EXISTS validate_task_id_update
BEFORE UPDATE OF id ON tasks
FOR EACH ROW
WHEN NEW.id NOT GLOB 'tx-[a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'Task ID must match format: tx-[a-z0-9]{6,}');
END;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (20, datetime('now'));
