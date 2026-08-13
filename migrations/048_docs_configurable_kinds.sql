-- Version: 048
-- Migration: Allow user-defined spec types as doc kinds.
--
-- Spec types are now configurable via [spec.types.*] in .tx/config.toml, so a
-- project can define its own (e.g. `rfc`) alongside the built-ins. The docs
-- table still carried a CHECK (kind IN (...)) allow-list from migrations 041/046,
-- which rejected any custom kind at insert time. Membership is now validated
-- against the resolved spec-type registry in the doc service instead.
--
-- IMPORTANT: this rebuild follows the pattern established by migration 046 —
-- foreign keys are disabled for the whole rebuild (so DROP TABLE docs cannot
-- cascade-delete child rows), and the self-reference is written with the FINAL
-- table name (`REFERENCES docs(id)`), not the temporary one. SQLite only
-- rewrites a renamed table's own foreign-key references when foreign_keys = ON
-- at rename time; writing the final name keeps the self-FK resolvable either
-- way. Deviating from this reintroduces the "no such table: docs_new" bug that
-- migration 046 exists to repair.

PRAGMA foreign_keys = OFF;

CREATE TABLE docs_open_kind (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL,
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

INSERT INTO docs_open_kind (
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
ALTER TABLE docs_open_kind RENAME TO docs;

CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_kind_name_version ON docs(kind, name, version);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON docs(kind);
CREATE INDEX IF NOT EXISTS idx_docs_doc_id ON docs(doc_id) WHERE doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_doc_id_version ON docs(doc_id, version) WHERE doc_id IS NOT NULL;

PRAGMA foreign_keys = ON;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (48, datetime('now'));
