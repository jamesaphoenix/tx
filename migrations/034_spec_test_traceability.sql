-- Version: 034
-- Migration: Spec-to-test traceability primitives

-- Many-to-many mapping between invariants and discovered tests
CREATE TABLE IF NOT EXISTS spec_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invariant_id TEXT NOT NULL REFERENCES invariants(id) ON DELETE CASCADE,
  test_id TEXT NOT NULL,
  test_file TEXT NOT NULL,
  test_name TEXT,
  framework TEXT,
  discovery TEXT NOT NULL CHECK (discovery IN ('tag', 'comment', 'manifest', 'manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(invariant_id, test_id)
);

CREATE INDEX IF NOT EXISTS idx_spec_tests_invariant ON spec_tests(invariant_id);
CREATE INDEX IF NOT EXISTS idx_spec_tests_test ON spec_tests(test_id);

-- Run history for mapped spec tests
CREATE TABLE IF NOT EXISTS spec_test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_test_id INTEGER NOT NULL REFERENCES spec_tests(id) ON DELETE CASCADE,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  duration_ms INTEGER,
  details TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spec_test_runs_spec_test ON spec_test_runs(spec_test_id);

-- Human sign-off for HARDEN -> COMPLETE transitions
CREATE TABLE IF NOT EXISTS spec_signoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('doc', 'subsystem', 'global')),
  scope_value TEXT,
  signed_off_by TEXT NOT NULL,
  notes TEXT,
  signed_off_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spec_signoffs_scope_nonnull
  ON spec_signoffs(scope_type, scope_value)
  WHERE scope_value IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spec_signoffs_scope_null
  ON spec_signoffs(scope_type)
  WHERE scope_value IS NULL;

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (34, datetime('now'));
