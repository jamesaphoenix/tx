# PRD-033: Spec-to-Test Traceability Primitives

## Problem

tx has invariant extraction and task-level verification, but no first-class way to answer:

- Which tests cover which specs?
- Which specs are uncovered or failing?
- What percent of a feature scope has passing tests?
- When a scope is ready to move from implementation to hardening and final completion?

## Solution

Add composable spec traceability primitives that bridge:

- docs/invariants -> discovered tests,
- test outcomes -> invariant status,
- invariant status -> scope-level Feature Completion Index (FCI) and lifecycle phase.

The system remains headless: tx does not run tests; tx stores mappings and ingests results.

-> [REQ-033](../requirements/REQ-033-spec-test-traceability.md)
-> [SD-003](../system-design/SD-003-spec-traceability-architecture.md)
-> [DD-033](../design/DD-033-spec-test-traceability.md)

## Requirements

- [ ] Add many-to-many invariant/test mapping with authoritative storage.
- [ ] Add immutable per-link run history.
- [ ] Add human sign-off records by scope.
- [ ] Implement multi-language discovery from configured glob patterns.
- [ ] Support annotations in test names and comments.
- [ ] Support `.tx/spec-tests.yml` manifest overrides.
- [ ] Provide `tx spec` subcommands for discovery, linking, gaps, matrix, FCI, run ingestion, completion.
- [ ] Compute FCI and phase (`BUILD`, `HARDEN`, `COMPLETE`) by doc/subsystem/global scope.
- [ ] Reject completion attempts when phase is `BUILD`.
- [ ] Expose equivalent primitives via REST and MCP.

## Acceptance Criteria

1. `tx spec discover` upserts links from source annotations and manifest entries.
2. `tx spec gaps` lists active invariants with zero linked tests in the selected scope.
3. `tx spec batch` accepts generic JSON and framework-adapter modes (`vitest`, `pytest`, `go`).
4. `tx spec fci` returns deterministic counts and phase for global/doc/subsystem scopes.
5. FCI transitions:
   - `< 100` => `BUILD`
   - `100` without sign-off => `HARDEN`
   - `100` with sign-off => `COMPLETE`
6. `tx spec complete` succeeds only from HARDEN and persists signer metadata.
7. REST and MCP surfaces provide corresponding operations with equivalent behavior.
8. Integration tests cover CRUD, discovery, scoring, phase transitions, edge cases, and cascade behavior.

## Out of Scope

- Running test binaries from tx.
- Dashboard UI for traceability.
- AST-based parsers.
- Mutation testing orchestration.

## References

- -> [REQ-033](../requirements/REQ-033-spec-test-traceability.md)
- -> [SD-003](../system-design/SD-003-spec-traceability-architecture.md)
- -> [DD-033](../design/DD-033-spec-test-traceability.md)
