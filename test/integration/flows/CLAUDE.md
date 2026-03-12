# Flow Fixtures

This directory contains end-to-end backend flow tests for the docs -> code -> spec detection loop.

## What These Files Are For

Use this area for very small synthetic programs that verify the complete traceability path:

- docs declare invariants,
- code and tests represent implementation,
- `tx spec discover` refreshes doc-derived invariants and finds coverage,
- `tx spec gaps`, `tx spec run`, `tx spec status`, and `tx spec complete` validate the full workflow.

The goal is to prove system behavior across the whole pipeline, not just one service in isolation.

## Expected Program Size

- Target 5 to 10 files per synthetic program.
- Typical shape:
  - a few source files,
  - a few test files,
  - one or two docs,
  - optionally a manifest file for spec mappings.
- Keep fixtures small enough to understand at a glance.

## Guidance

- Prefer deterministic business logic like validation, pricing, routing, parsing, or simple calculations.
- Use these flows to model realistic backend slices, but avoid unnecessary complexity.
- Keep failures easy to read by using explicit invariant IDs, doc names, and test titles.
- Favor temp workspaces created by the test itself so each flow is isolated and self-contained.
- Add new files only when they help exercise a real stage in the docs -> code -> spec pipeline.

## Avoid

- Large example applications
- Network access or external services
- UI/browser concerns
- Fixtures that are hard to reason about or maintain
