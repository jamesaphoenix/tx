-- Migration 037: Decisions as first-class artifacts
-- Supports the spec-driven development triangle: code changes → decisions →
-- doc invariants → test coverage.

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  question TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'manual',
  commit_sha TEXT,
  run_id TEXT REFERENCES runs(id),
  task_id TEXT,
  doc_id INTEGER REFERENCES docs(id),
  invariant_id TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  edited_content TEXT,
  reviewed_at TEXT,
  content_hash TEXT NOT NULL,
  superseded_by TEXT,
  synced_to_doc INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_commit_sha ON decisions(commit_sha);
CREATE INDEX IF NOT EXISTS idx_decisions_task_id ON decisions(task_id);
CREATE INDEX IF NOT EXISTS idx_decisions_doc_id ON decisions(doc_id);
CREATE INDEX IF NOT EXISTS idx_decisions_content_hash ON decisions(content_hash);
CREATE INDEX IF NOT EXISTS idx_decisions_source ON decisions(source);

-- Record migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (37, datetime('now'));
