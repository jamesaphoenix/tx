-- Migration 036: Unified invariants with provenance and EARS fields.
-- Also extends docs + doc_links tables to support requirement/system_design kinds.

-- SQLite cannot ALTER CHECK constraints, so we recreate tables.
-- Disable FK enforcement during table recreation to avoid self-referential FK issues.
PRAGMA foreign_keys = OFF;

-- 1. Recreate docs table with expanded kind CHECK
CREATE TABLE docs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('overview', 'prd', 'design', 'requirement', 'system_design')),
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('changing', 'locked')) DEFAULT 'changing',
  file_path TEXT NOT NULL,
  parent_doc_id INTEGER REFERENCES docs_new(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT,
  metadata TEXT DEFAULT '{}'
);

INSERT INTO docs_new SELECT * FROM docs;
DROP TABLE docs;
ALTER TABLE docs_new RENAME TO docs;

CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_name_version ON docs(name, version);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON docs(kind);

-- 2. Recreate doc_links table with expanded link_type CHECK
CREATE TABLE doc_links_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  to_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN (
    'overview_to_prd', 'overview_to_design', 'prd_to_design', 'design_patch',
    'requirement_to_prd', 'requirement_to_design',
    'system_design_to_design', 'system_design_to_prd'
  )),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_doc_id, to_doc_id),
  CHECK(from_doc_id != to_doc_id)
);

INSERT INTO doc_links_new SELECT * FROM doc_links;
DROP TABLE doc_links;
ALTER TABLE doc_links_new RENAME TO doc_links;

-- 3. Invariant provenance columns
ALTER TABLE invariants ADD COLUMN source TEXT DEFAULT 'explicit';
ALTER TABLE invariants ADD COLUMN source_ref TEXT;

-- 4. EARS fields (for behavioral invariants)
ALTER TABLE invariants ADD COLUMN pattern TEXT;
ALTER TABLE invariants ADD COLUMN trigger_text TEXT;
ALTER TABLE invariants ADD COLUMN state_text TEXT;
ALTER TABLE invariants ADD COLUMN condition_text TEXT;
ALTER TABLE invariants ADD COLUMN feature TEXT;
ALTER TABLE invariants ADD COLUMN system_name TEXT;
ALTER TABLE invariants ADD COLUMN response TEXT;
ALTER TABLE invariants ADD COLUMN rationale TEXT;
ALTER TABLE invariants ADD COLUMN test_hint TEXT;

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_invariants_source ON invariants(source);

-- Re-enable FK enforcement
PRAGMA foreign_keys = ON;

-- Record migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (36, datetime('now'));
