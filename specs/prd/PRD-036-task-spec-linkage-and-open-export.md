---
kind: spec
spec_type: prd
name: PRD-036-task-spec-linkage-and-open-export
title: "PRD-036: Task-Spec Linkage And Open Task Export"
status: draft
version: 1
owners:
  - core
summary: Expose linked specs on tasks, export all non-done work as Ralph-ready markdown, and bundle the workflow as reusable Claude/Codex skills.
domain: orchestration
tags:
  - tasks
  - docs
  - skills
  - ralph
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-27
---

# Summary

tx already stores task-to-doc relationships via `task_doc_links` and supports
`tx doc attach`, but that capability is not operationally useful enough for
agents. Task payloads do not expose linked specs, `tx md-export` cannot produce
"all open work" with spec context for prompt injection, and the default
Claude/Codex onboarding surfaces do not teach agents how to use these
primitives together.

tx should make task-spec linkage first-class in agent-facing task views and
markdown exports, and it should bundle that workflow as reusable agent skills
for Claude Code and Codex.

Implements via: [DD-036](../design/DD-036-task-spec-linkage-and-open-export.md)

## Problem

The current state is split across three layers:

- Storage exists: `task_doc_links` supports many-to-many task/doc attachment.
- Mutation exists: `tx doc attach <task-id> <doc-name>` writes those links.
- Consumption is weak:
  - `tx show`, `tx ready`, API, MCP, and agent SDK task payloads do not return
    linked docs.
  - `tx md-export` supports `ready`, `all`, or a single status, but not the
    practical "all tasks that are not done" view needed for Ralph-style prompt
    injection.
  - Ralph prompts mention subtasks and blocking, but not attaching specs,
    creating follow-up tasks, or updating dependency edges.
  - Workflow guidance lives mostly in top-level context files instead of being
    bundled as targeted agent skills.

This means task/spec linking is technically present but practically invisible to
the agents that need it.

## Solution

Make task-spec linkage visible and actionable everywhere agents work.

- Extend task-facing payloads to include all linked docs with link semantics.
- Add an "open work" markdown export mode that renders all non-done tasks plus
  linked spec references suitable for prompt injection.
- Keep markdown export read-only; agents mutate state by calling tx commands.
- Ship a bundled shared skill for Claude Code and Codex that teaches the
  task/spec workflow:
  - inspect task plus linked docs
  - attach missing specs when creating them
  - create follow-up tasks or subtasks when decomposition is needed
  - add or remove dependency edges when the task graph is wrong
  - mark tasks blocked when external work is required
- Update Ralph guidance so agents are explicitly allowed to reshape the task
  graph within bounded rules.

## Requirements

```yaml
ears_requirements:
  - id: EARS-TASKSPEC-001
    kind: ubiquitous
    statement: the system shall expose all linked docs for a task through the same task payload returned by CLI, API, MCP, and SDK task inspection surfaces
    priority: must
  - id: EARS-TASKSPEC-002
    kind: event-driven
    statement: when a task has one or more linked docs, the system shall include doc identity, kind, link type, and file path in the rendered task view
    priority: must
  - id: EARS-TASKSPEC-003
    kind: event-driven
    statement: when `tx md-export --filter open` is requested, the system shall export every task whose status is not `done`
    priority: must
  - id: EARS-TASKSPEC-004
    kind: event-driven
    statement: when an exported task has linked docs, the system shall render compact doc references suitable for prompt injection without requiring agents to query the database separately
    priority: must
  - id: EARS-TASKSPEC-005
    kind: ubiquitous
    statement: the markdown export shall remain a read-only projection and shall not become the source of truth for task mutations
    priority: must
  - id: EARS-TASKSPEC-006
    kind: event-driven
    statement: when Claude Code or Codex onboarding assets are installed, the system shall bundle a reusable skill that teaches task-spec linkage, open-work export, and safe task-graph mutation
    priority: must
  - id: EARS-TASKSPEC-007
    kind: event-driven
    statement: when a Ralph-style loop dispatches an agent on a task, the bundled workflow guidance shall permit creating follow-up tasks, subtasks, and dependency edges through tx commands
    priority: must
  - id: EARS-TASKSPEC-008
    kind: unwanted
    statement: if task-spec linkage exists only in storage but is absent from task inspection and export surfaces, then validation and integration coverage shall fail
    priority: should
```

## Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-TASKSPEC-001
    statement: `tx show <id> --json`, `tx ready --json`, REST task endpoints, MCP task tools, and the agent SDK all return linked doc references for attached tasks
  - id: AC-TASKSPEC-002
    statement: a task linked to multiple docs returns all links rather than a single best-effort doc
  - id: AC-TASKSPEC-003
    statement: `tx md-export --filter open` produces markdown containing every non-done task and excludes done tasks from the main open-work section
  - id: AC-TASKSPEC-004
    statement: exported tasks with linked docs render compact doc references including name, kind, link type, and file path
  - id: AC-TASKSPEC-005
    statement: Claude and Codex scaffolds include a bundled skill for task-spec workflow and no longer rely solely on monolithic top-level instructions for this behavior
  - id: AC-TASKSPEC-006
    statement: Ralph guidance explicitly tells agents they may create subtasks, create follow-up tasks, attach docs, and update dependency edges through tx commands while keeping tx canonical
  - id: AC-TASKSPEC-007
    statement: integration tests cover task payload enrichment, multi-doc attachment visibility, open-task export rendering, and scaffolded skill availability
```

# Non-goals

- Making markdown export writable or round-trippable back into task state.
- Embedding full PRD or design-doc bodies in task payloads by default.
- Replacing `tx doc attach` with a different storage model.
- Blocking task completion on spec linkage in this slice.
- Requiring the full generated-skills migration from PRD-035 before this
  feature can ship.
