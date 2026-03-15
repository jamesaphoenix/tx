-- Version: 039
-- Migration: Rename legacy "needs review" task status to needs_review
--
-- Keeps display label/color unchanged ("Needs Review", pink).
-- Existing rows are normalized during table copy.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE tasks_new (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog'
        CHECK (status IN (
            'backlog', 'ready', 'planning', 'active',
            'blocked', 'review', 'needs_review', 'done'
        )),
    parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    metadata TEXT DEFAULT '{}',
    assignee_type TEXT CHECK (assignee_type IN ('human', 'agent')),
    assignee_id TEXT,
    assigned_at TEXT,
    assigned_by TEXT,
    group_context TEXT,
    verify_cmd TEXT,
    verify_schema TEXT
);

INSERT INTO tasks_new (
    id,
    title,
    description,
    status,
    parent_id,
    score,
    created_at,
    updated_at,
    completed_at,
    metadata,
    assignee_type,
    assignee_id,
    assigned_at,
    assigned_by,
    group_context,
    verify_cmd,
    verify_schema
)
SELECT
    id,
    title,
    description,
    CASE
        WHEN status = 'human_' || 'needs_to_review' THEN 'needs_review'
        ELSE status
    END,
    parent_id,
    score,
    created_at,
    updated_at,
    completed_at,
    metadata,
    assignee_type,
    assignee_id,
    assigned_at,
    assigned_by,
    group_context,
    verify_cmd,
    verify_schema
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_score ON tasks(score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_type ON tasks(assignee_type);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_type_id ON tasks(assignee_type, assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_score_id ON tasks(score DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_status_score_id ON tasks(status, score DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_group_context_present
  ON tasks(id, updated_at DESC)
  WHERE group_context IS NOT NULL AND length(trim(group_context)) > 0;

CREATE TRIGGER IF NOT EXISTS validate_task_id_insert
BEFORE INSERT ON tasks
FOR EACH ROW
WHEN NEW.id NOT GLOB 'tx-[a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'Task ID must match format: tx-[a-z0-9]{6,}');
END;

CREATE TRIGGER IF NOT EXISTS validate_task_id_update
BEFORE UPDATE OF id ON tasks
FOR EACH ROW
WHEN NEW.id NOT GLOB 'tx-[a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'Task ID must match format: tx-[a-z0-9]{6,}');
END;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (39, datetime('now'));
