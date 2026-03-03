-- Version: 031
-- Migration: Task creation guards — lightweight limits enforced at create time

CREATE TABLE IF NOT EXISTS task_guards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL UNIQUE,  -- 'global', 'parent:<task_id>'
  max_pending INTEGER,         -- max non-done tasks at any time
  max_children INTEGER,        -- max direct children per parent
  max_depth INTEGER,           -- max hierarchy nesting depth
  enforce INTEGER NOT NULL DEFAULT 0,  -- 0=advisory, 1=hard block
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (31, datetime('now'));
