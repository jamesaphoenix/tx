-- Version: 040
-- Migration: Dashboard cycles and cycle-task assignment tables

CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'upcoming', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enforce at most one current cycle at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cycles_single_current
  ON cycles(status)
  WHERE status = 'current';

CREATE INDEX IF NOT EXISTS idx_cycles_start_date
  ON cycles(start_date DESC);

CREATE TABLE IF NOT EXISTS cycle_tasks (
  cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cycle_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_cycle_tasks_task_id
  ON cycle_tasks(task_id);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (40, datetime('now'));
