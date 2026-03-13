# PRD-033: Spec-to-Test Traceability

**Kind**: prd
**Status**: changing

## Problem

tx already supports invariant extraction and task-level verification, but there is
no first-class way to map tests to invariants, quantify coverage completeness, or
gate feature lifecycle transitions from implementation to hardening and completion.

## Solution

Add composable spec-traceability primitives that connect docs -> invariants ->
discovered tests -> run outcomes -> Feature Completion Index (FCI). Keep tx
headless: tx stores mappings and ingests test results, but does not run tests.

## Requirements

- Persist many-to-many invariant-to-test mappings as authoritative traceability data.
- Persist append-only run outcomes per mapped test.
- Persist human sign-off metadata for HARDEN -> COMPLETE transitions.
- Support language-agnostic discovery from configurable test file patterns.
- Support annotation discovery from test names and comments.
- Support manifest mapping via .tx/spec-tests.yml for non-annotatable tests.
- Expose tx spec primitives in CLI, MCP, and REST with equivalent behavior.
- Compute scope-level FCI and lifecycle phase (BUILD|HARDEN|COMPLETE).
- Reject completion when FCI is below 100.

## Structured Requirements (EARS)

| ID | Pattern | Requirement | Priority |
|-----|---------|-------------|----------|
| EARS-SPEC-001 | ubiquitous | The tx shall maintain a many-to-many mapping between active invariants and discovered tests. | must |
| EARS-SPEC-002 | event_driven | When tx spec discover is executed, the tx shall scan configured test patterns, parse annotations and manifest mappings, and upsert normalized links. | must |
| EARS-SPEC-003 | event_driven | When a test run result is recorded, the tx shall append a run record linked to the mapped spec-test entry. | must |
| EARS-SPEC-004 | state_driven | While computing FCI for a scope, the tx shall classify each active invariant as passing, failing, untested, or uncovered. | must |
| EARS-SPEC-005 | state_driven | While FCI is below 100, the tx shall report phase BUILD. | must |
| EARS-SPEC-006 | state_driven | While FCI equals 100 and no sign-off exists, the tx shall report phase HARDEN. | must |
| EARS-SPEC-007 | event_driven | When a human records sign-off for a HARDEN scope, the tx shall transition that scope to COMPLETE. | must |
| EARS-SPEC-008 | unwanted | If sign-off is requested while phase is BUILD, then the tx shall reject the request with a typed validation error. | must |
| EARS-SPEC-009 | optional | Where source annotations, the tx shall support declarative fallback mappings via .tx/spec-tests.yml. | should |
| EARS-SPEC-010 | ubiquitous | The tx shall keep discovery language-agnostic via shared text scanning conventions. | must |
| EARS-SPEC-011 | event_driven | When tx spec batch receives framework output, the tx shall normalize records into generic test-result entries. | must |
| EARS-SPEC-012 | ubiquitous | The tx shall expose equivalent spec-trace operations across CLI, REST, and MCP. | must |

## Acceptance Criteria

- tx spec discover upserts links from annotations and manifest entries.
- tx spec gaps lists active invariants with zero linked tests in selected scope.
- tx spec batch accepts generic JSON and framework adapter modes (vitest, pytest, go).
- tx spec fci returns deterministic counters and phase for global/doc/subsystem scopes.
- Phase lifecycle is computed as BUILD (<100), HARDEN (100 + unsigned), COMPLETE (100 + signed).
- tx spec complete succeeds only from HARDEN and persists signer metadata.
- REST and MCP expose equivalent operations and payload semantics.
- Integration tests cover CRUD, discovery, scoring, phase transitions, and cascade behavior.

## Out of Scope

- Running test frameworks from tx.
- Dashboard UX for traceability views.
- AST-based language-specific discovery parsers.
- Mutation test orchestration.
