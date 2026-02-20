-- Migration 023: Task labels (Linear-style simplified label system)
-- Tables: task_labels, task_label_assignments

CREATE TABLE IF NOT EXISTS task_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_labels_name_ci
  ON task_labels(lower(name));

CREATE TABLE IF NOT EXISTS task_label_assignments (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_task_label_assignments_task
  ON task_label_assignments(task_id);

CREATE INDEX IF NOT EXISTS idx_task_label_assignments_label
  ON task_label_assignments(label_id);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (23, datetime('now'));
