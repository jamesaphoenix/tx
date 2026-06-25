-- Version: 046
-- Migration: Repair the docs self-referencing foreign key left dangling by the
-- table-rebuild migrations (036, 041).
--
-- Those migrations rebuilt the docs table with the standard
-- "CREATE docs_new ...; DROP docs; ALTER docs_new RENAME TO docs" pattern, and
-- wrote the self-reference as `parent_doc_id INTEGER REFERENCES docs_new(id)`.
-- SQLite only rewrites a renamed table's own foreign-key references when
-- `foreign_keys = ON` at rename time. The migration runner now (correctly)
-- disables foreign keys for the whole rebuild so that `DROP TABLE docs` cannot
-- cascade-delete child rows, which means the `docs_new` self-reference is NOT
-- rewritten and survives into the final schema as
-- `parent_doc_id REFERENCES docs_new(id)`. At runtime (foreign_keys = ON) every
-- insert into docs then fails with "no such table: docs_new", breaking
-- `tx doc add` and anything that creates docs.
--
-- Fix: rebuild docs once more, but write the self-reference using the FINAL
-- table name (`REFERENCES docs(id)`). SQLite resolves foreign-key target tables
-- by name at check time, so a self-reference written with the final name
-- resolves correctly after the rename even with foreign keys disabled.

PRAGMA foreign_keys = OFF;

CREATE TABLE docs_fixed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('overview', 'prd', 'design', 'requirement', 'system_design', 'runbook', 'decision')),
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

INSERT INTO docs_fixed (
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
FROM docs;

DROP TABLE docs;
ALTER TABLE docs_fixed RENAME TO docs;

CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_kind_name_version ON docs(kind, name, version);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON docs(kind);
CREATE INDEX IF NOT EXISTS idx_docs_doc_id ON docs(doc_id) WHERE doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_doc_id_version ON docs(doc_id, version) WHERE doc_id IS NOT NULL;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (46, datetime('now'));
