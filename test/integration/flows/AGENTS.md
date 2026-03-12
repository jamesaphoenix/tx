# Flow Fixtures

This directory holds backend end-to-end flow tests for docs -> code -> spec detection.

## Purpose

These tests should model tiny, synthetic programs that exercise the full traceability pipeline:

1. docs define invariants,
2. code and tests implement behavior,
3. `tx spec discover` refreshes doc-derived invariants and links tests back to the spec,
4. `tx spec gaps`, `tx spec run`, `tx spec status`, and `tx spec complete` prove end-to-end behavior.

This is not the place for isolated unit coverage. Each flow should behave like a miniature project slice that proves the whole backend loop works.

## Fixture Shape

- Each synthetic program should usually be between 5 and 10 files.
- Prefer a small vertical slice:
  - 1 to 3 source files
  - 1 to 3 test files
  - 1 to 2 doc files
  - optional `.tx/spec-tests.yml` manifest when manifest discovery matters
- Keep the logic simple and deterministic: string processing, arithmetic, validation, or tiny state transitions.
- Avoid large fixtures, generated content, external services, network calls, or heavy dependencies.

## Authoring Rules

- Favor realistic backend behavior over toy assertions, but keep the programs intentionally small.
- Each flow should make it obvious which part of the pipeline it is proving: tag discovery, comment discovery, manifest discovery, gap detection, scoped status, doc-first drift, or completion/sign-off.
- Prefer temp workspaces created inside the test rather than checked-in fixture projects unless a shared fixture becomes clearly necessary.
- Keep names explicit. Invariant IDs, doc names, and test names should make failures easy to diagnose.
- When possible, test both scoped behavior (`--doc`) and aggregate/global behavior.

## Non-Goals

- Do not turn these into broad product demos or UI tests.
- Do not add large sample apps here.
- Do not depend on unpublished implementation quirks unless the test is explicitly locking one down.
