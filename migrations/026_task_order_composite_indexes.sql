-- Version: 026
-- Migration: Add composite task ordering indexes for dashboard task list polling
--
-- Dashboard /api/tasks uses ORDER BY score DESC, id ASC with optional status filter.
-- Existing single-column indexes can trigger temporary sort B-trees under pagination.
-- These composite indexes support index-backed ordering for both query shapes:
--   1) Unfiltered: ORDER BY score DESC, id ASC
--   2) Filtered:   WHERE status IN (...) ORDER BY score DESC, id ASC

CREATE INDEX IF NOT EXISTS idx_tasks_score_id
  ON tasks(score DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_tasks_status_score_id
  ON tasks(status, score DESC, id ASC);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (26, datetime('now'));
