---
kind: spec
spec_type: design
doc_id: doc-02e45a5443a1
name: lean-task-spec-design
title: "Task and specification runtime"
status: draft
version: 1
owners:
  - docs-team
summary: "Shared task and spec runtime with safe historical compatibility and plan hierarchy."
domain: lean-task-spec
tags:
  - design
  - lean
  - task
  - spec
depends_on: []
supersedes: []
implements: lean-task-spec-prd
last_reviewed_at: 2026-10-03
---

# Summary
Retain shared Effect task/document/spec services and remove retired services from
all runtime layers and public interfaces. Historical storage remains dormant.

# Architecture
The CLI dispatches tasks through `task-dispatch.ts`. The REST, MCP and SDK use the
same retained core layer. `getSpecHealth` aggregates docs, invariants and spec
results without success-shaped fallbacks. Dashboard cycles remain simple planning.
Skills contain creation, copying and verification guidance; they launch no agents.
The dashboard uses stored relationships and stable versioned document links.
Its HTTP server is constructed through the same factory used by integration tests,
accepts local browser origins and binds to loopback. Task controls are hidden while
navigation changes identity; description saves are serialised and failed drafts
remain available for an explicit retry. Packaged builds remove stale output before
compilation so deleted runtime modules cannot remain in npm tarballs.
Weekly cycles are opt-in. Auto-add settings persist, including an empty selection;
cycle creation includes all matching tasks in one transaction and never relies on
the first page of the task list. Editing a task cannot create a future cycle.

# Interfaces
```yaml
interfaces:
  - name: tasks
    type: rpc
    semantics: tx task CRUD, dependencies, hierarchy, bulk and labels
  - name: documents
    type: rpc
    semantics: tx doc with built-in plan kind, spec_to_plan edges and task links
  - name: verification
    type: rpc
    semantics: shared Spec Health through CLI, REST, MCP, SDK and dashboard
```

# Data Model
Migration 049 rebuilds only `doc_links` to add `spec_to_plan`, preserving all rows
and restoring foreign keys. Existing retired tables and immutable migrations remain.
Plans use tx frontmatter and otherwise unconstrained Markdown in `specs/plan/`.
An adjacent `.source` symlink records an external original; the committed copy is
self-contained. It is not automatic synchronisation or an execution dependency.

# Invariants
```yaml
invariants:
  - id: INV-LEAN-001
    statement: retired task syntax cannot initialise or mutate storage
    severity: high
    verified_by:
      - test/integration/task-namespace.test.ts
  - id: INV-LEAN-002
    statement: upgrades preserve historical rows and retired controls have no task runtime effects
    severity: high
    verified_by:
      - test/integration/lean-upgrade.test.ts
      - test/integration/sync-stream.test.ts
  - id: INV-LEAN-003
    statement: imports validate all payloads, preserve dormant projections and fail atomically including commit failures
    severity: high
    verified_by:
      - test/integration/sync-stream.test.ts
  - id: INV-LEAN-004
    statement: Spec Health failures remain errors and missing or failing evidence is visible
    severity: high
    verified_by:
      - test/integration/lean-upgrade.test.ts
      - apps/dashboard/src/components/spec-health/__tests__/SpecHealthPage.test.tsx
  - id: INV-LEAN-005
    statement: plans preserve copied text, source provenance and spec-to-plan-to-task links
    severity: high
    verified_by:
      - test/integration/plan-hierarchy.test.ts
```

# Failure Modes
```yaml
failure_modes:
  - condition: an old task command is used
    impact: the requested mutation cannot run
    handling: fail before opening storage and show the canonical replacement
  - condition: a stream payload is malformed, unknown or has mismatched identity
    impact: replay cannot be trusted
    handling: reject without advancing progress
  - condition: a database commit fails
    impact: import changes are not durable
    handling: surface DatabaseError and roll back
  - condition: Spec Health cannot read evidence
    impact: health is unknown
    handling: propagate error and render the dashboard error state
  - condition: an original agent plan is unavailable
    impact: source link cannot be followed
    handling: the committed copy remains readable and usable
```

# Verification
Map invariant IDs beside enforcement sites and meaningful executable assertions.
Run retained root/package suites, lint, types, build and package/binary smoke checks.
Review npm tarball contents for removed artifacts after a clean build.

# Testing Strategy
Retire tests only with their removed features. Preserve distinct task, document,
label, cycle, sync and spec tests. Exercise real SQLite upgrades and commit failure,
plan round-trips and health errors. Exact-head CI is required before release.

# Open Questions
None.
