---
kind: spec
spec_type: prd
name: PRD-038-spec-driven-decompose-command
title: "PRD-038: Spec-Driven Decompose Command"
status: draft
version: 1
owners:
  - core
summary: Add shared spec-driven decomposition so a design doc can be turned into an explicit tx task graph through the CLI, API, MCP server, and agent SDK, while bundling a dedicated Claude/Codex skill.
domain: orchestration
tags:
  - cli
  - api
  - mcp
  - sdk
  - docs
  - tasks
  - skills
  - runtimes
depends_on:
  - DD-005-mcp-agent-sdk-integration
  - DD-023-docs-as-primitives
supersedes: []
implements: null
last_reviewed_at: 2026-03-27
---

# Summary

tx can already store specs, attach docs to tasks, and let agents create
subtasks ad hoc. What it lacks is a first-class, shared capability that takes a
design spec and materializes a planned task graph in tx regardless of entry
point.

`tx decompose` should be implemented once and exposed consistently through the
CLI, REST API, MCP server, and agent SDK. It should accept a design doc, run a
selected runtime (`claude`, `codex`, or `auto`) against that spec, validate the
returned graph, and persist an explicit root task, subtasks, and dependency
edges in tx. Claude Code and Codex should also get a dedicated bundled skill
that teaches this exact workflow, and the docs site should document the command
and its companion surfaces.

Implements via: [DD-038](../design/DD-038-spec-driven-decompose-command.md)

## Problem

Current decomposition is implicit and opportunistic:

- Ralph may route a large task to `tx-decomposer`, but that starts from a task,
  not directly from a design spec.
- There is no shared public primitive for "take this design doc and create the
  task graph."
- There is no deterministic contract for how a spec-backed decomposition should
  attach docs, create a root task, or encode dependency edges.
- CLI, API, MCP, and SDK consumers cannot rely on one canonical response shape
  or one canonical implementation path for decomposition.
- Claude/Codex scaffolds do not ship a focused skill for explicit
  spec-to-graph decomposition.
- Published docs do not explain how to create a task graph from a design spec
  across the available form factors.

This leaves a gap between docs-first planning and executable task management.

## Solution

Introduce a shared decomposition capability, then expose it everywhere:

- A shared decomposition service resolves a design doc and runs a selected
  runtime with a structured decomposition schema.
- `tx decompose <design-doc-ref>` becomes the CLI entry point for that service.
- A REST endpoint, MCP tool, and agent SDK namespace expose the same behavior
  and result schema.
- The shared service validates the returned graph and persists it into tx as:
  - one root implementation task, unless a parent task is supplied
  - subtasks with parent-child relationships
  - dependency edges between generated tasks
  - parent/root blockers pointing at the top-level generated tasks
- The shared service attaches the design doc to the root as `implements` and to
  child tasks as `references`.
- `dryRun` returns the graph without writing it.
- Codex and Claude scaffolds include a `decompose-spec` skill that teaches the
  explicit workflow once a spec exists.
- The docs site and surface READMEs explain the CLI, API, MCP, and SDK paths.

## Requirements

```yaml
ears_requirements:
  - id: EARS-DECOMPOSE-001
    kind: event-driven
    statement: when any decompose interface is invoked with a doc reference, the system shall resolve the referenced doc and reject non-design docs
    priority: must
  - id: EARS-DECOMPOSE-002
    kind: event-driven
    statement: when a valid design doc is provided, the system shall run the selected runtime against the spec and require a structured task-graph response
    priority: must
  - id: EARS-DECOMPOSE-003
    kind: event-driven
    statement: when the runtime returns a valid graph, the system shall create tx tasks, hierarchy edges, and dependency edges that match the returned structure
    priority: must
  - id: EARS-DECOMPOSE-004
    kind: event-driven
    statement: when a parent task id is provided, the system shall reuse that task as the graph root instead of creating a duplicate root task
    priority: must
  - id: EARS-DECOMPOSE-005
    kind: event-driven
    statement: when a graph is materialized, the system shall attach the design doc to the root as `implements` and to generated child tasks as `references`
    priority: must
  - id: EARS-DECOMPOSE-006
    kind: event-driven
    statement: when dry-run mode is provided, the system shall emit the validated decomposition result without writing tasks or dependencies
    priority: must
  - id: EARS-DECOMPOSE-007
    kind: event-driven
    statement: when Claude Code or Codex onboarding assets are installed, the system shall bundle a dedicated skill for spec-driven decomposition using `tx decompose`
    priority: must
  - id: EARS-DECOMPOSE-008
    kind: event-driven
    statement: when the decompose capability is accessed through the CLI, API, MCP server, or agent SDK, the system shall return a shared result contract describing the doc, previewed root, generated plan, and materialized task graph
    priority: must
  - id: EARS-DECOMPOSE-009
    kind: event-driven
    statement: when the feature is documented, the docs site and surface READMEs shall explain how to decompose a design spec through the CLI, API, MCP server, and agent SDK
    priority: must
  - id: EARS-DECOMPOSE-010
    kind: unwanted
    statement: if the runtime returns duplicate local IDs, self-dependencies, unknown references, or a graph exceeding command limits, then the system shall fail before partial graph creation
    priority: must
```

## Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-DECOMPOSE-001
    statement: CLI, API, MCP, and SDK decomposition requests reject missing docs and docs whose kind is not `design`
  - id: AC-DECOMPOSE-002
    statement: a successful decomposition creates a root task, subtasks, and dependency edges visible through normal `tx show`, `tx dep tree`, and `tx ready` behavior
  - id: AC-DECOMPOSE-003
    statement: when a parent task is supplied, the existing parent is reused and top-level generated tasks block that parent
  - id: AC-DECOMPOSE-004
    statement: dry-run responses return the validated decomposition plan without creating tasks
  - id: AC-DECOMPOSE-005
    statement: generated tasks include design-doc links so later agent work can recover the originating spec
  - id: AC-DECOMPOSE-006
    statement: CLI, API, MCP, and SDK responses share one documented decompose result contract
  - id: AC-DECOMPOSE-007
    statement: Codex and Claude scaffolds both include a dedicated decomposition skill after generation/init
  - id: AC-DECOMPOSE-008
    statement: apps/docs and the relevant form-factor READMEs document how to use the feature
  - id: AC-DECOMPOSE-009
    statement: targeted tests cover shared service validation, CLI wiring, API/MCP/SDK surface behavior, and scaffolded skill availability
```

# Non-goals

- Executing the generated tasks after decomposition.
- Inferring decomposition from PRDs, overview docs, or arbitrary markdown in
  this first slice.
- Automatically deduplicating, repairing, or diffing pre-existing graphs for
  the same spec.
- Triggering background decomposition implicitly from watchers or queue loops
  without an explicit user or agent request.
