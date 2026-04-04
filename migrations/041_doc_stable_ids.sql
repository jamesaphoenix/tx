-- Version: 041
-- Migration: Add stable external doc IDs and kind-scoped slug uniqueness

PRAGMA foreign_keys = OFF;

CREATE TABLE docs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('overview', 'prd', 'design', 'requirement', 'system_design', 'runbook', 'decision')),
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

INSERT INTO docs_new (
  id,
  doc_id,
  hash,
  kind,
  name,
  title,
  version,
  status,
  file_path,
  parent_doc_id,
  created_at,
  locked_at,
  metadata
)
SELECT
  id,
  NULL,
  hash,
  kind,
  name,
  title,
  version,
  status,
  file_path,
  parent_doc_id,
  created_at,
  locked_at,
  metadata
FROM docs;

DROP TABLE docs;
ALTER TABLE docs_new RENAME TO docs;

DROP INDEX IF EXISTS idx_docs_name_version;
CREATE INDEX IF NOT EXISTS idx_docs_doc_id
  ON docs(doc_id)
  WHERE doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_doc_id_version
  ON docs(doc_id, version)
  WHERE doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_kind_name_version
  ON docs(kind, name, version);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON docs(kind);

PRAGMA foreign_keys = ON;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (41, datetime('now'));
