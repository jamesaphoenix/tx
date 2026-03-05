# DD-033: Spec-to-Test Traceability Primitives

## Overview

Implements [PRD-033](../prd/PRD-033-spec-test-traceability.md).

This design adds headless, composable traceability primitives linking invariants to tests, recording run outcomes, and computing scope-level Feature Completion Index (FCI) with explicit HARDEN and COMPLETE gating.

## Design

### Data Model

Add migration `033_spec_test_traceability.sql` (next migration version in sequence):

- `spec_tests`
  - Many-to-many map: `invariant_id` <-> `test_id`
  - Unique constraint `(invariant_id, test_id)`
  - Discovery source enum: `tag|comment|manifest|manual`
- `spec_test_runs`
  - Append-only run outcomes linked to `spec_tests.id`
- `spec_signoffs`
  - Human sign-off by scope type and value (`doc|subsystem|global`)

Indexes:

- `spec_tests(invariant_id)`, `spec_tests(test_id)`
- `spec_test_runs(spec_test_id)`

### Types

Add Effect Schema types in `packages/types/src/spec-trace.ts`:

- `SpecDiscoveryMethodSchema`
- `SpecScopeTypeSchema`
- `SpecPhaseSchema`
- `SpecTestSchema`
- `SpecTestRunSchema`
- `SpecSignoffSchema`
- `DiscoverResultSchema`
- `FciResultSchema`
- `TraceabilityMatrixEntrySchema`
- `TraceabilityMatrixSchema`
- batch payload schemas for generic and framework-adapter inputs

### Repository Layer

Add `SpecTraceRepository` (`packages/core/src/repo/spec-trace-repo.ts`):

- `upsertSpecTest(...)`
- `deleteSpecTest(...)`
- `findSpecTestsByInvariant(...)`
- `findInvariantsByTest(...)`
- `findUncoveredInvariants(...)`
- `insertRun(...)`
- `insertRunsBatch(...)`
- `getLatestRunBySpecTestIds(...)`
- `getMatrix(...)`
- `upsertSignoff(...)`
- `findSignoff(...)`

### Discovery Utility

Add `packages/core/src/utils/spec-discovery.ts` with pure discovery functions:

- scan files by configured glob patterns
- extract refs from:
  - test-name tags: `[INV-...]`, `_INV_...`
  - comment tags: `@spec INV-..., INV-...`
- parse `.tx/spec-tests.yml` mappings
- normalize all results to canonical `test_id`

No AST dependency; raw-text regex only.

### Service Layer

Add `SpecTraceService` (`packages/core/src/services/spec-trace-service.ts`) with methods:

- `discover(options?)`
- `link(...)`
- `unlink(...)`
- `testsForInvariant(id)`
- `invariantsForTest(testId)`
- `uncoveredInvariants(filter?)`
- `recordRun(...)`
- `recordBatchRun(...)`
- `fci(scope?)`
- `matrix(filter?)`
- `complete(scope, signedOffBy, notes?)`
- `status(scope?)`

Computation rules:

- passing invariant: linked tests exist and latest run for all linked tests passed
- failing invariant: linked tests exist and any latest run failed
- untested invariant: linked tests exist and no runs
- uncovered invariant: no linked tests
- `fci = passing / total_active * 100`
- phase:
  - `BUILD` if `fci < 100`
  - `HARDEN` if `fci = 100` and no sign-off
  - `COMPLETE` if `fci = 100` and sign-off exists

### Config

Extend `TxConfig` in `packages/core/src/utils/toml-config.ts`:

- `[spec]`
  - `test_patterns` (comma-separated list in TOML)

Provide sane multi-language defaults and keep user override support.

### CLI

Add `apps/cli/src/commands/spec.ts` and register command `spec`.

Subcommands:

- `discover`
- `link <inv-id> <file> [name]`
- `unlink <inv-id> <test-id>`
- `tests <inv-id>`
- `gaps [--doc D] [--sub S]`
- `fci [--doc D] [--sub S]`
- `matrix [--doc D] [--sub S]`
- `run <test-id> --passed|--failed [--duration N] [--details T]`
- `batch [--from vitest|pytest|go|generic]`
- `complete [--doc D] [--sub S] --by <human> [--notes T]`
- `status [--doc D] [--sub S]`

### MCP

Add `apps/mcp-server/src/tools/spec-trace.ts`:

- `tx_spec_discover`
- `tx_spec_link`
- `tx_spec_gaps`
- `tx_spec_fci`
- `tx_spec_matrix`
- `tx_spec_record_run`
- `tx_spec_batch_run`

### REST API

Add `SpecTraceGroup` in `apps/api-server/src/api.ts` and route handlers in `apps/api-server/src/routes/spec-trace.ts`:

- `POST /api/spec/discover`
- `GET /api/spec/tests/:invariantId`
- `GET /api/spec/gaps`
- `GET /api/spec/fci`
- `GET /api/spec/matrix`
- `POST /api/spec/link`
- `POST /api/spec/run`
- `POST /api/spec/batch`

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 0 | `docs/requirements/REQ-033-*.md`, `docs/system-design/SD-003-*.md`, `docs/prd/PRD-033-*.md`, `docs/design/DD-033-*.md`, `docs/index.md` | Documentation chain |
| 1 | `migrations/034_spec_test_traceability.sql`, `packages/types/src/spec-trace.ts`, `packages/core/src/mappers/spec-trace.ts`, `packages/core/src/repo/spec-trace-repo.ts` | Data foundation |
| 2 | `packages/core/src/utils/spec-discovery.ts`, `packages/core/src/services/spec-trace-service.ts`, `packages/core/src/layer.ts`, exports | Core logic |
| 3 | `apps/cli/src/commands/spec.ts`, `apps/cli/src/cli.ts`, `apps/cli/src/help.ts` | CLI surface |
| 4 | `apps/mcp-server/src/tools/spec-trace.ts`, `apps/mcp-server/src/server.ts`, `apps/mcp-server/src/tools/index.ts`, `apps/api-server/src/api.ts`, `apps/api-server/src/routes/spec-trace.ts`, `apps/api-server/src/server-lib.ts` | Multi-interface integration |
| 5 | `test/integration/spec-trace.test.ts`, `test/integration/api-spec-trace.test.ts`, `test/integration/mcp-spec-trace.test.ts`, `test/unit/spec-discovery.test.ts` | Integration and unit tests |
| 6 | `apps/docs/content/docs/primitives/spec-trace.mdx` | Published docs |

## Testing Strategy

### Requirement Traceability Matrix

| Requirement | Test Type | Test Name | Assertions | File Path |
|-------------|-----------|-----------|------------|-----------|
| EARS-SPEC-001 mapping persistence | Integration | stores many-to-many mappings | same test linked to multiple invariants and vice versa | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-002 discovery upsert | Unit + Integration | discovers tags/comments/manifest | expected links inserted with canonical ids | `test/unit/spec-discovery.test.ts`, `test/integration/spec-trace.test.ts` |
| EARS-SPEC-003 run recording | Integration | records single and batch runs | run rows appended and latest-run state reflects writes | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-004 classification | Integration | classifies passing/failing/untested/uncovered | counts and classes match seeded data | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-005 BUILD phase | Integration | returns BUILD below 100 | `fci < 100` and phase BUILD | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-006 HARDEN phase | Integration | returns HARDEN at 100 without signoff | `fci = 100` and no signoff | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-007 COMPLETE phase | Integration | complete transitions to COMPLETE | signoff row stored and phase COMPLETE | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-008 reject premature complete | Integration | complete fails in BUILD | typed validation failure when `fci < 100` | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-009 manifest support | Unit + Integration | reads `.tx/spec-tests.yml` | expected manifest entries imported | `test/unit/spec-discovery.test.ts`, `test/integration/spec-trace.test.ts` |
| EARS-SPEC-010 language agnostic scanner | Unit | scans ts/py/go fixtures | refs discovered across file types | `test/unit/spec-discovery.test.ts` |
| EARS-SPEC-011 batch framework adapters | Integration | parses vitest/pytest/go/generic | normalized run inserts for each adapter | `test/integration/spec-trace.test.ts` |
| EARS-SPEC-012 interface parity | Integration | API and MCP parity | equivalent outputs for fci/gaps/matrix operations | `test/integration/api-spec-trace.test.ts`, `test/integration/mcp-spec-trace.test.ts` |

### Unit Tests

- `test/unit/spec-discovery.test.ts`
  - parse `[INV-*]` tags in JS/TS test names
  - parse `_INV_*` function-name markers
  - parse `@spec` comments with one and many invariant ids
  - ignore non-matching files based on pattern list
  - parse manifest file and canonicalize `test_id`
  - malformed annotations do not throw

### Integration Tests

All integration tests must use singleton DB pattern:

- `getSharedTestLayer()` from `@jamesaphoenix/tx-test-utils`
- deterministic IDs where task fixtures are needed via `fixtureId(name)`

Scenarios (minimum 8):

1. Setup: create doc + sync invariants. Action: run discover with no matching annotations. Assert: all invariants uncovered; FCI 0 BUILD.
2. Setup: annotate tests for half invariants. Action: discover. Assert: covered/uncovered counts reflect partial linkage.
3. Setup: linked tests exist, no runs. Action: query FCI. Assert: invariants classified untested, FCI unchanged.
4. Setup: record passing runs for all linked tests. Action: query FCI. Assert: 100 HARDEN.
5. Setup: one linked test latest run fails. Action: query FCI. Assert: invariant failing, FCI drops below 100 BUILD.
6. Setup: one test linked to multiple invariants. Action: record pass/fail transitions. Assert: both invariants reflect latest shared test state.
7. Setup: HARDEN scope. Action: `complete(by)` call. Assert: signoff persisted and phase COMPLETE.
8. Setup: BUILD scope. Action: `complete(by)` call. Assert: operation fails with typed validation error.
9. Setup: invariant deleted via docs sync/deletion. Action: query tables. Assert: cascading delete removes spec_tests and runs.
10. Setup: import batch payloads from vitest/pytest/go/generic fixtures. Action: recordBatchRun. Assert: normalized inserts and correct latest-run rollup.

### Edge Cases

- invariant has links but `test_name` null (file-only mapping from manifest).
- duplicate discovery entries deduplicate by unique key.
- non-existent invariant in manual link is rejected.
- unknown test id in `run` rejects safely.
- global scope with zero active invariants returns `fci = 0`, phase BUILD.

### Failure Injection

- malformed JSON on `batch` input returns validation error without partial DB writes.
- malformed YAML manifest does not crash discovery; returns parse diagnostics.
- simulated DB constraint violations (duplicate/foreign key) are surfaced as typed database errors.

### Performance

- Discovery scan target: < 2s for 5k test files on default patterns in local dev.
- FCI query target: < 150ms for 2k invariants / 10k mappings.
- Memory: discovery should process files streaming-friendly and avoid loading large corpus into a single string.

### Minimum Quality Bar

- Every requirement row above maps to at least one executable test.
- No untyped Promise-based service logic.
- API/MCP adapters must only orchestrate serialization and delegate business rules to core service.

## Open Questions

- [ ] Should scope include explicit doc-id filtering in addition to doc name?
- [ ] Should COMPLETE sign-off support multi-approver quorum in future?
- [ ] Should sign-off invalidation occur automatically if FCI later drops below 100?

## Migration

- Additive schema migration only.
- No existing table/column mutation required.
- Backward compatible with current invariant and verify workflows.

## References

- PRD: [PRD-033](../prd/PRD-033-spec-test-traceability.md)
- REQ: [REQ-033](../requirements/REQ-033-spec-test-traceability.md)
- SD: [SD-003](../system-design/SD-003-spec-traceability-architecture.md)
- Doctrine: DD-002 (Effect patterns), DD-007 (integration testing), DD-005/PRD-007 (multi-interface parity)
