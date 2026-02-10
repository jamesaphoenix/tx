-- Migration 022: Docs as Primitives (DD-023)
-- Tables: docs, doc_links, task_doc_links, invariants, invariant_checks

CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('overview', 'prd', 'design')),
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('changing', 'locked')) DEFAULT 'changing',
  file_path TEXT NOT NULL,
  parent_doc_id INTEGER REFERENCES docs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT,
  metadata TEXT DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_name_version ON docs(name, version);

CREATE TABLE IF NOT EXISTS doc_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  to_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('overview_to_prd', 'overview_to_design', 'prd_to_design', 'design_patch')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_doc_id, to_doc_id),
  CHECK(from_doc_id != to_doc_id)
);

CREATE TABLE IF NOT EXISTS task_doc_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('implements', 'references')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, doc_id)
);

CREATE TABLE IF NOT EXISTS invariants (
  id TEXT PRIMARY KEY,
  rule TEXT NOT NULL,
  enforcement TEXT NOT NULL CHECK (enforcement IN ('integration_test', 'linter', 'llm_as_judge')),
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  subsystem TEXT,
  test_ref TEXT,
  lint_rule TEXT,
  prompt_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'deprecated')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS invariant_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invariant_id TEXT NOT NULL REFERENCES invariants(id) ON DELETE CASCADE,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  details TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_invariant_checks_invariant_id ON invariant_checks(invariant_id);
