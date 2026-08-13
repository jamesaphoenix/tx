# Documentation Index

**Description**: Search map for subsystem PRDs and design docs. Use this file to find the authoritative spec by feature area, domain term, or implementation concern.

**Search Keywords**: configurable-spec-types-design, Spec Type Registry Design, docs-specs, spec-types, configuration, registry, lint, design-doc-review-runs-design, DD-040: Design Doc Review Runs Design, error-handling, Error Handling, platform, paired-prd-dd-ralph-workflow-design, DD-038: PRD/DD Pair Workflow For RALPH Design, orchestration, design, prd, ralph, workflow, docs, task-graph, ralph-supervision-dashboard-design, DD-039: Ralph Supervision Dashboard Design, dashboard, supervision, terminals, domain-events, pi, configurable-spec-types, Configurable Spec Types and Lint-Only Section Enforcement, design-doc-review-runs-prd, PRD-040: Design Doc Review Runs, paired-prd-dd-ralph-workflow-prd, PRD-038: PRD/DD Pair Workflow For RALPH, ralph-supervision-dashboard-prd, PRD-039: Ralph Supervision Dashboard, events, review, req-test, Req Test, product-area, test-auth-flows, Auth Flows, auth

## Product Requirements Documents

| Name | Title | Description | Search Keywords | Status |
|------|-------|-------------|-----------------|--------|
| [configurable-spec-types](prd/configurable-spec-types.md) | Configurable Spec Types and Lint-Only Section Enforcement | Let projects define their own spec types, required sections, heading descriptions, and lint prompts in .tx/config.toml, enforced by tx spec lint rather than the parser. | docs-specs, spec-types, configuration, lint, docs | changing |
| [design-doc-review-runs-prd](prd/design-doc-review-runs-prd.md) | PRD-040: Design Doc Review Runs |  | - | changing |
| [paired-prd-dd-ralph-workflow-prd](prd/paired-prd-dd-ralph-workflow-prd.md) | PRD-038: PRD/DD Pair Workflow For RALPH | Standardize non-trivial execution work on paired PRD and design docs, with tx tasks as the living implementation plan. | orchestration, prd, ralph, workflow, docs, task-graph | changing |
| [ralph-supervision-dashboard-prd](prd/ralph-supervision-dashboard-prd.md) | PRD-039: Ralph Supervision Dashboard | Add a live Ralph supervision surface with tmux-backed browser terminals, pause and takeover controls, canonical domain events, and optional design-doc completion review loops. | orchestration, ralph, dashboard, supervision, terminals, events, review | changing |
| [req-test](prd/req-test.md) | Req Test | One-line summary of Req Test | product-area, prd | changing |
| [test-auth-flows](prd/test-auth-flows.md) | Auth Flows | Draft coverage of core authentication user flows for testing and review. | auth | changing |

## Design Documents

| Name | Title | Description | Search Keywords | Implements | Status |
|------|-------|-------------|-----------------|------------|--------|
| [configurable-spec-types-design](design/configurable-spec-types-design.md) | Spec Type Registry Design | Resolves a spec-type registry from .tx/config.toml and threads it through the parser, doc service, CLI lint, templates, and generated skills. | docs-specs, spec-types, configuration, registry, lint | - | changing |
| [design-doc-review-runs-design](design/design-doc-review-runs-design.md) | DD-040: Design Doc Review Runs Design |  | - | design-doc-review-runs-prd | changing |
| [error-handling](design/error-handling.md) | Error Handling | Draft system design guidance for consistent error handling across tx services. | platform | - | changing |
| [paired-prd-dd-ralph-workflow-design](design/paired-prd-dd-ralph-workflow-design.md) | DD-038: PRD/DD Pair Workflow For RALPH Design | Update workflow docs, planner guidance, and RALPH prompts so paired PRD/design docs plus tx tasks become the default execution contract. | orchestration, design, prd, ralph, workflow, docs, task-graph | paired-prd-dd-ralph-workflow-prd | changing |
| [ralph-supervision-dashboard-design](design/ralph-supervision-dashboard-design.md) | DD-039: Ralph Supervision Dashboard Design | Implement core-owned Ralph supervision sessions, tmux-backed browser terminals, canonical domain events, and config-gated design-doc review triggers. | orchestration, ralph, dashboard, supervision, terminals, domain-events, pi | - | changing |

## Invariant Summary

**Total invariants**: 23

**By enforcement type**:

- integration_test: 23

**By subsystem**:

- prd: 12
- design: 11

## Document Links

| From | To | Type |
|------|-----|------|
| paired-prd-dd-ralph-workflow-prd | paired-prd-dd-ralph-workflow-design | prd_to_design |
| design-doc-review-runs-prd | design-doc-review-runs-design | prd_to_design |
