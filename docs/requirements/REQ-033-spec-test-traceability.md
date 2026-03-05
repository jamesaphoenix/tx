# REQ-033: Spec-to-Test Traceability

## Purpose

Define the requirements for traceability primitives that connect docs/invariants to test coverage and execution outcomes, enabling objective feature completion scoring and phase gating.

This requirement set is designed to be composable with existing tx doc/invariant primitives and Unix-style command chaining.

## Actors

- Feature implementer: writes tests and links them to invariants.
- Reviewer/auditor: evaluates coverage and readiness before sign-off.
- CI orchestrator: imports machine test results as batch run records.
- Human approver: records final HARDEN -> COMPLETE sign-off.

## Use Cases

1. Discover linked tests from source annotations and manifests across multiple languages.
2. Query gaps: which active invariants have no linked tests.
3. Record run outcomes per linked test and compute FCI by scope.
4. View matrix relationships between invariants and tests.
5. Mark scope complete only after HARDEN phase and human approval.

## EARS Requirements

- `EARS-SPEC-001` (ubiquitous): The system shall maintain a many-to-many mapping between active invariants and discovered tests.
- `EARS-SPEC-002` (event-driven): When `tx spec discover` is executed, the system shall scan configured test patterns, parse annotations/manifests, and upsert normalized links.
- `EARS-SPEC-003` (event-driven): When a test run result is recorded, the system shall append an immutable run record linked to the mapped spec test entry.
- `EARS-SPEC-004` (state-driven): While computing FCI for a scope, the system shall classify each active invariant as passing, failing, untested, or uncovered.
- `EARS-SPEC-005` (state-driven): While FCI is below 100, the scope phase shall be `BUILD`.
- `EARS-SPEC-006` (state-driven): While FCI equals 100 and no sign-off exists, the scope phase shall be `HARDEN`.
- `EARS-SPEC-007` (event-driven): When a human records sign-off for a HARDEN scope, the scope phase shall transition to `COMPLETE`.
- `EARS-SPEC-008` (unwanted): If sign-off is requested while scope phase is `BUILD`, the system shall reject with a typed validation error.
- `EARS-SPEC-009` (optional): Where source annotations cannot be added, the system shall accept declarative mappings via `.tx/spec-tests.yml`.
- `EARS-SPEC-010` (ubiquitous): The system shall remain language-agnostic by using text scanning and shared annotation conventions instead of language-specific parsers.
- `EARS-SPEC-011` (event-driven): When `tx spec batch` receives framework output, the system shall normalize it into generic test-result records.
- `EARS-SPEC-012` (ubiquitous): The system shall expose identical traceability primitives across CLI, REST, and MCP interfaces.

## Functional Requirements

- Add persistent tables for spec links, test runs, and sign-offs.
- Support discovery modes: `tag`, `comment`, `manifest`, `manual`.
- Support manual link/unlink operations.
- Support lookup by invariant and reverse lookup by test.
- Support scope filters by doc and subsystem.
- Provide FCI metrics with counts and phase.
- Provide matrix output for auditing and review.

## Non-Functional Requirements

- Multi-language support from day one without AST parsing.
- Deterministic `test_id` canonicalization (`{relative_file}::{test_name}`).
- Idempotent discovery and batch ingestion.
- No dependency on a specific test framework.
- Commands and APIs must be script-friendly for CI pipelines.

## Constraints

- Reuse existing `invariants` as source-of-truth spec catalog.
- Keep `invariants.test_ref` as non-authoritative hint for backward compatibility.
- Maintain Effect-TS service/repository patterns and typed errors.

## Out of Scope

- Running test frameworks directly from tx.
- Language-specific AST implementations.
- Automated code mutation tooling execution.
- Dashboard UX implementation in this milestone.

## References

- -> [SD-003](../system-design/SD-003-spec-traceability-architecture.md)
- -> [PRD-033](../prd/PRD-033-spec-test-traceability.md)
- -> [DD-033](../design/DD-033-spec-test-traceability.md)
