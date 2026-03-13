# DD-033: Spec-to-Test Traceability

**Kind**: design
**Status**: changing
**Version**: 1

## Problem Definition

The platform needs a deterministic, auditable way to measure how much of a
documented feature is covered by passing tests. Existing invariant and verify
primitives are useful but disconnected for spec-level completion scoring.

## Goals

- Introduce authoritative invariant-to-test mappings.
- Support language-agnostic discovery and framework-agnostic run ingestion.
- Compute deterministic Feature Completion Index (FCI) and lifecycle phase.
- Keep the architecture headless and composable with existing tx primitives.
- Expose equivalent capabilities via CLI, MCP, and REST.

## Architecture

## Flow
1. Docs produce invariants via tx invariant sync.
2. Discovery maps invariants to tests via source annotations or manifest.
3. Test outcomes are ingested as run records.
4. FCI aggregates invariant state (passing/failing/untested/uncovered).
5. Human sign-off upgrades HARDEN scopes to COMPLETE.

## Boundaries
- tx does not run tests.
- tx stores links + outcomes and computes completion state.
- CI or local tooling owns actual test execution.

## Data Model

## Migration 034_spec_test_traceability.sql

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

CREATE TABLE IF NOT EXISTS spec_test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_test_id INTEGER NOT NULL REFERENCES spec_tests(id) ON DELETE CASCADE,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  duration_ms INTEGER,
  details TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spec_test_runs_spec_test ON spec_test_runs(spec_test_id);

CREATE TABLE IF NOT EXISTS spec_signoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('doc', 'subsystem', 'global')),
  scope_value TEXT,
  signed_off_by TEXT NOT NULL,
  notes TEXT,
  signed_off_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope_type, scope_value)
);

## Canonical test identity
test_id = "{relative_file}::{test_name}"

## Failure Modes

| ID | Description | Mitigation |
|-----|-------------|------------|
| - | Discovery scans no files due to misconfigured patterns. | - |
| - | Batch parser receives malformed framework output. | - |
| - | Sign-off requested while scope is still BUILD. | - |
| - | Stale sign-off after regressions if policy is not enforced. | - |

## Edge Cases

| ID | Description |
|-----|-------------|
| - | Invariant has links but no runs (untested). |
| - | One test covers multiple invariants. |
| - | Duplicate annotation lines in the same file. |
| - | Invariant deleted after mappings exist (cascade cleanup). |

## Work Breakdown

- Phase 0: Documentation chain (REQ-033, SD-003, PRD-033, DD-033)
- Phase 1: Migration + types + mappers + repository
- Phase 2: Discovery utility + SpecTraceService + layer wiring
- Phase 3: CLI command surface (tx spec)
- Phase 4: MCP and REST adapters
- Phase 5: Integration + unit tests
- Phase 6: Published docs update

## Retention

- spec_tests links persist until invariant or link deletion.
- spec_test_runs are append-only historical evidence.
- spec_signoffs persist as audit trail of human completion decisions.

## Testing Strategy

## Requirement Traceability
| Requirement | Test Type | Test Name | Assertions | File Path |
|-------------|-----------|-----------|------------|-----------|
| EARS-SPEC-001 | integration | stores_many_to_many_links | same test linked to multiple invariants and reverse lookup works | test/integration/spec-trace.test.ts |
| EARS-SPEC-002 | unit+integration | discovers_annotations_and_manifest | tag/comment/manifest links created with canonical test_id | test/unit/spec-discovery.test.ts, test/integration/spec-trace.test.ts |
| EARS-SPEC-003 | integration | records_runs_single_and_batch | run rows append and latest-run rollup updates | test/integration/spec-trace.test.ts |
| EARS-SPEC-004 | integration | classifies_invariant_states | passing/failing/untested/uncovered counts are deterministic | test/integration/spec-trace.test.ts |
| EARS-SPEC-005 | integration | phase_is_build_below_100 | fci < 100 implies BUILD | test/integration/spec-trace.test.ts |
| EARS-SPEC-006 | integration | phase_is_harden_at_100_without_signoff | fci = 100 and no signoff implies HARDEN | test/integration/spec-trace.test.ts |
| EARS-SPEC-007 | integration | complete_moves_to_complete | signoff persisted and phase COMPLETE returned | test/integration/spec-trace.test.ts |
| EARS-SPEC-008 | integration | complete_rejected_in_build | completion fails with typed validation error | test/integration/spec-trace.test.ts |
| EARS-SPEC-009 | unit+integration | manifest_fallback_mapping | manifest entries are ingested as discovery=manifest | test/unit/spec-discovery.test.ts, test/integration/spec-trace.test.ts |
| EARS-SPEC-010 | unit | scanner_is_language_agnostic | ts/py/go samples all produce invariant refs | test/unit/spec-discovery.test.ts |
| EARS-SPEC-011 | integration | framework_batch_adapters | vitest/pytest/go/generic normalize and persist runs | test/integration/spec-trace.test.ts |
| EARS-SPEC-012 | integration | api_mcp_parity | equivalent fci/gaps/matrix semantics across interfaces | test/integration/api-spec-trace.test.ts, test/integration/mcp-spec-trace.test.ts |

## Unit Tests
- File: test/unit/spec-discovery.test.ts
- Validate regex extraction for [INV-*], _INV_*, and @spec comment forms.
- Validate file-pattern filtering and manifest parsing.
- Validate malformed annotation handling does not throw.

## Integration Tests (REQUIRED)
- Test layer: getSharedTestLayer()
- Deterministic IDs: fixtureId(name) where task fixtures are needed

Scenarios:
  1. Setup: synced invariants, no discovered tests. Action: fci(). Assert: uncovered=total, fci=0, phase=BUILD.
  2. Setup: discover partial links. Action: gaps(). Assert: uncovered reflects unlinked invariants.
  3. Setup: linked tests, no runs. Action: fci(). Assert: untested count increments.
  4. Setup: all linked tests pass. Action: fci(). Assert: fci=100, phase=HARDEN.
  5. Setup: one latest run fails. Action: fci(). Assert: failing>0, phase=BUILD.
  6. Setup: one test linked to two invariants. Action: record fail then pass. Assert: both invariants track shared latest state.
  7. Setup: HARDEN scope. Action: complete(scope, by). Assert: signoff stored and phase=COMPLETE.
  8. Setup: BUILD scope. Action: complete(scope, by). Assert: typed validation failure.
  9. Setup: delete/deprecate source invariant. Action: query spec tables. Assert: cascaded link/run cleanup.
  10. Setup: ingest vitest/pytest/go/generic batches. Action: recordBatchRun. Assert: normalized inserts and latest rollup integrity.

## Failure Injection
- Malformed JSON batch payload fails validation without partial writes.
- Malformed manifest file returns diagnostics and continues scanning file annotations.
- Foreign key violations surface as typed DatabaseError.

## Edge Cases
- Linked invariant with null test_name from manifest-only mapping.
- Duplicate discovery events deduplicated by (invariant_id, test_id).
- Global scope with zero active invariants returns fci=0 and BUILD.

## Performance (if applicable)
- Discovery target: <2s for 5k files under default patterns in local runs.
- FCI query target: <150ms for 2k invariants and 10k links.
- Avoid per-row N+1 queries in matrix and FCI aggregation paths.
