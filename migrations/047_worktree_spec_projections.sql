-- Version: 047
-- Migration: Scope document-derived spec projections by checkout

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS spec_projections (
  projection_key TEXT PRIMARY KEY,
  content_root TEXT NOT NULL,
  git_common_dir TEXT,
  branch TEXT,
  head_sha TEXT,
  dirty INTEGER CHECK (dirty IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO spec_projections (
  projection_key,
  content_root,
  git_common_dir,
  branch,
  head_sha,
  dirty
) VALUES ('legacy', '', NULL, NULL, NULL, NULL);

CREATE TABLE IF NOT EXISTS doc_projection_snapshots (
  projection_key TEXT NOT NULL REFERENCES spec_projections(projection_key) ON DELETE CASCADE,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  head_sha TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (projection_key, doc_id)
);

INSERT OR IGNORE INTO doc_projection_snapshots (
  projection_key,
  doc_id,
  content_hash,
  title,
  file_path,
  head_sha,
  synced_at
)
SELECT 'legacy', id, hash, title, file_path, NULL, created_at
FROM docs;

CREATE TABLE invariants_scoped (
  projection_key TEXT NOT NULL DEFAULT 'legacy' REFERENCES spec_projections(projection_key) ON DELETE CASCADE,
  id TEXT NOT NULL,
  rule TEXT NOT NULL,
  enforcement TEXT NOT NULL CHECK (enforcement IN ('integration_test', 'linter', 'llm_as_judge')),
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  subsystem TEXT,
  test_ref TEXT,
  lint_rule TEXT,
  prompt_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'deprecated')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}',
  source TEXT DEFAULT 'explicit',
  source_ref TEXT,
  pattern TEXT,
  trigger_text TEXT,
  state_text TEXT,
  condition_text TEXT,
  feature TEXT,
  system_name TEXT,
  response TEXT,
  rationale TEXT,
  test_hint TEXT,
  PRIMARY KEY (projection_key, id)
);

INSERT INTO invariants_scoped (
  projection_key, id, rule, enforcement, doc_id, subsystem, test_ref,
  lint_rule, prompt_ref, status, created_at, metadata, source, source_ref,
  pattern, trigger_text, state_text, condition_text, feature, system_name,
  response, rationale, test_hint
)
SELECT
  'legacy', id, rule, enforcement, doc_id, subsystem, test_ref,
  lint_rule, prompt_ref, status, created_at, metadata, source, source_ref,
  pattern, trigger_text, state_text, condition_text, feature, system_name,
  response, rationale, test_hint
FROM invariants;

DROP TABLE invariants;
ALTER TABLE invariants_scoped RENAME TO invariants;

CREATE INDEX idx_invariants_id ON invariants(id);
CREATE INDEX idx_invariants_doc ON invariants(projection_key, doc_id);
CREATE INDEX idx_invariants_source ON invariants(projection_key, source);

CREATE TABLE invariant_checks_scoped (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projection_key TEXT NOT NULL DEFAULT 'legacy',
  invariant_id TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  details TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  FOREIGN KEY (projection_key, invariant_id)
    REFERENCES invariants(projection_key, id) ON DELETE CASCADE
);

INSERT INTO invariant_checks_scoped (
  id, projection_key, invariant_id, passed, details, checked_at, duration_ms
)
SELECT id, 'legacy', invariant_id, passed, details, checked_at, duration_ms
FROM invariant_checks;

DROP TABLE invariant_checks;
ALTER TABLE invariant_checks_scoped RENAME TO invariant_checks;

CREATE INDEX idx_invariant_checks_invariant_id
  ON invariant_checks(projection_key, invariant_id);

CREATE TABLE spec_tests_scoped (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projection_key TEXT NOT NULL DEFAULT 'legacy',
  invariant_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  test_file TEXT NOT NULL,
  test_name TEXT,
  framework TEXT,
  discovery TEXT NOT NULL CHECK (discovery IN ('tag', 'comment', 'manifest', 'manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (projection_key, invariant_id)
    REFERENCES invariants(projection_key, id) ON DELETE CASCADE,
  UNIQUE(projection_key, invariant_id, test_id)
);

INSERT INTO spec_tests_scoped (
  id, projection_key, invariant_id, test_id, test_file, test_name,
  framework, discovery, created_at, updated_at
)
SELECT
  id, 'legacy', invariant_id, test_id, test_file, test_name,
  framework, discovery, created_at, updated_at
FROM spec_tests;

DROP TABLE spec_tests;
ALTER TABLE spec_tests_scoped RENAME TO spec_tests;

CREATE INDEX idx_spec_tests_invariant
  ON spec_tests(projection_key, invariant_id);
CREATE INDEX idx_spec_tests_test
  ON spec_tests(projection_key, test_id);

CREATE TABLE spec_signoffs_scoped (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projection_key TEXT NOT NULL DEFAULT 'legacy' REFERENCES spec_projections(projection_key) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('doc', 'subsystem', 'global')),
  scope_value TEXT,
  signed_off_by TEXT NOT NULL,
  notes TEXT,
  signed_off_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO spec_signoffs_scoped (
  id, projection_key, scope_type, scope_value, signed_off_by, notes, signed_off_at
)
SELECT id, 'legacy', scope_type, scope_value, signed_off_by, notes, signed_off_at
FROM spec_signoffs;

DROP TABLE spec_signoffs;
ALTER TABLE spec_signoffs_scoped RENAME TO spec_signoffs;

CREATE UNIQUE INDEX idx_spec_signoffs_scope_nonnull
  ON spec_signoffs(projection_key, scope_type, scope_value)
  WHERE scope_value IS NOT NULL;

CREATE UNIQUE INDEX idx_spec_signoffs_scope_null
  ON spec_signoffs(projection_key, scope_type)
  WHERE scope_value IS NULL;

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (47, datetime('now'));
