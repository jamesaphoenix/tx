# SD-003: Spec Traceability Architecture

## Overview

Implements requirements from [REQ-033](../requirements/REQ-033-spec-test-traceability.md).

This architecture introduces headless traceability primitives layered on existing docs/invariants infrastructure:

1. Spec source: docs -> invariants (already present via `DocService.syncInvariants`).
2. Coverage map: invariants <-> discovered tests (`spec_tests`).
3. Outcome stream: immutable per-link run records (`spec_test_runs`).
4. Completion state: FCI + phase (`BUILD|HARDEN|COMPLETE`) plus human sign-off (`spec_signoffs`).

## Design Goals

- Composable CLI primitives that chain with existing `tx doc` and `tx invariant` commands.
- Framework and language agnostic discovery + run ingestion.
- Deterministic and auditable scoring from persisted data.
- Explicit human gate for final completion.

## Layered Flow

1. `tx invariant sync` ensures invariants are in DB.
2. `tx spec discover` scans files/manifests and upserts mappings.
3. `tx spec batch` / `tx spec run` records run outcomes.
4. `tx spec fci` computes status for selected scope.
5. `tx spec complete` records human sign-off for HARDEN scopes.

## Components

### Storage

- `spec_tests`: authoritative many-to-many relationship.
- `spec_test_runs`: append-only outcome history.
- `spec_signoffs`: one sign-off record per scope.

### Discovery Engine

- Reads `spec.test_patterns` from `.tx/config.toml`.
- Scans matching files as plain text.
- Extracts invariant references via shared regex conventions.
- Supports supplemental `.tx/spec-tests.yml` mappings.

### Core Service

`SpecTraceService` orchestrates:
- discovery upsert,
- manual link management,
- run ingestion,
- FCI aggregation,
- matrix/gap queries,
- sign-off transitions.

### Interface Adapters

- CLI: `tx spec ...`
- REST: `/api/spec/*`
- MCP: `tx_spec_*` tools

All adapters delegate to shared service operations.

## Data Contracts

- Canonical test identity: `{relative_file}::{test_name}`.
- Discovery provenance: `tag|comment|manifest|manual`.
- FCI payload:
  - `total`, `covered`, `uncovered`, `passing`, `failing`, `untested`, `fci`, `phase`.

## Failure Boundaries

- Malformed annotations are ignored, not fatal.
- Invalid manifest entries are skipped with diagnostics.
- Batch parser failures return typed errors with safe details.
- Telemetry/reporting failures do not mutate link state.

## Compatibility

- Existing invariant workflows remain valid.
- `invariants.test_ref` stays available as legacy hint.
- Existing verify/per-task command workflow remains independent.

## Security and Performance

- Discovery reads only configured patterns and project-relative files.
- No shell execution in discovery.
- Query paths indexed for invariant and test lookups.
- Most recent-run selection uses SQL grouping/joins.

## References

- -> [REQ-033](../requirements/REQ-033-spec-test-traceability.md)
- -> [PRD-033](../prd/PRD-033-spec-test-traceability.md)
- -> [DD-033](../design/DD-033-spec-test-traceability.md)
