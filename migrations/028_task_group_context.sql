-- Version: 028
-- Migration: Add task group context storage and source lookup index
--
-- Adds first-class task-group context that can be inherited across parent/child lineage.

ALTER TABLE tasks ADD COLUMN group_context TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_group_context_present
  ON tasks(id, updated_at DESC)
  WHERE group_context IS NOT NULL AND length(trim(group_context)) > 0;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (28, datetime('now'));
