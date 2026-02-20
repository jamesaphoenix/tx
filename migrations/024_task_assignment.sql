-- Migration 024: Task assignment columns with legacy backfill
-- Tables: tasks (alter)

ALTER TABLE tasks ADD COLUMN assignee_type TEXT
  CHECK (assignee_type IN ('human', 'agent'));

ALTER TABLE tasks ADD COLUMN assignee_id TEXT;

ALTER TABLE tasks ADD COLUMN assigned_at TEXT;

ALTER TABLE tasks ADD COLUMN assigned_by TEXT;

UPDATE tasks
SET assignee_type = 'agent',
    assignee_id = NULL,
    assigned_at = datetime('now'),
    assigned_by = 'migration:024_task_assignment'
WHERE assignee_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_type
  ON tasks(assignee_type);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_type_id
  ON tasks(assignee_type, assignee_id);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (24, datetime('now'));
