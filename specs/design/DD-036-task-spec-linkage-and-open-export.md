---
kind: spec
spec_type: design
name: DD-036-task-spec-linkage-and-open-export
title: "DD-036: Task-Spec Linkage And Open Task Export Design"
status: draft
version: 1
owners:
  - core
summary: Surface linked docs in task payloads, add open-work markdown export, and bundle the workflow as shared Claude/Codex skills plus Ralph prompt guidance.
domain: orchestration
tags:
  - tasks
  - docs
  - skills
  - ralph
depends_on:
  - PRD-036-task-spec-linkage-and-open-export
supersedes: []
implements: PRD-036-task-spec-linkage-and-open-export
last_reviewed_at: 2026-03-27
---

# Summary

`task_doc_links` already provides the correct relational model for task/spec
attachment. The implementation work is to project that linkage into agent-facing
surfaces, teach the workflow through bundled skills, and update markdown export
and Ralph prompts so agents can use the model without bespoke repo knowledge.

Implements: [PRD-036](../prd/PRD-036-task-spec-linkage-and-open-export.md)

# Architecture

## 1. Task Payload Enrichment

Add linked-doc metadata directly to `TaskWithDeps` instead of forcing callers to
join task and doc surfaces manually.

New shape:

```ts
interface TaskLinkedDocRef {
  docId: number
  name: string
  title: string
  kind: DocKind
  version: number
  status: DocStatus
  filePath: string
  linkType: "implements" | "references"
}
```

Extend:

- `packages/types/src/task.ts`
- `packages/types/src/response.ts`
- agent SDK serialized task types

`TaskWithDeps.linkedDocs` becomes part of the standard external task contract.

## 2. Repository / Service Changes

The current doc repository only supports:

- `createTaskLink(taskId, docId, linkType)`
- `getTaskLinksForDoc(docId)`
- `getDocForTask(taskId)` returning one doc

That is insufficient because task attachment is many-to-many.

Add repository methods:

- `getTaskLinksForTask(taskId)`
- `getTaskLinksForMany(taskIds)`
- `getDocsForTask(taskId)`
- `getDocsForManyTasks(taskIds)`

`getDocForTask` may remain temporarily for compatibility but should stop being
the primary read path.

Inject `DocRepository` into task-service enrichment so:

- `getWithDeps(id)` attaches linked docs
- `getWithDepsBatch(ids)` batch-loads linked docs efficiently
- ready/list/tree/task completion responses automatically inherit the new field

No database migration is required because `task_doc_links` already supports
multiple rows per task via `UNIQUE(task_id, doc_id)`.

## 3. Markdown Export

Extend `tx md-export` with a new filter mode:

- `ready`
- `all`
- `open`
- specific status

`open` expands to every lifecycle status except `done`.

Render change:

- keep summary table
- rename main section title to `Open Tasks` when `--filter open`
- for each task, include a `Linked docs` block when `linkedDocs.length > 0`

Example:

```md
#### Linked Docs
- implements: prd-auth-flow (prd) -> specs/prd/auth-flow.md
- references: DD-004-ready-detection (design) -> specs/design/DD-004-ready-detection.md
```

Do not inline full spec content by default. If richer context is needed later,
add an explicit opt-in flag such as `--include-doc-summaries`.

## 4. Bundled Skills

Add a shared skill template, for example:

- `apps/cli/src/templates/shared-skills/task-spec-loop/SKILL.md`

Responsibilities:

- inspect a task and its linked docs
- use `tx doc attach` when a task creates or adopts a spec
- use `tx add`, `tx dep block`, `tx dep unblock`, `tx update --status blocked`
  when decomposition or graph repair is needed
- prefer `tx md-export --filter open` when a file-based task briefing is needed
- remind the agent that markdown export is read-only and tx is canonical

Delivery targets:

- Claude scaffold installs or references the shared skill
- Codex scaffold installs or references the shared skill
- legacy `CLAUDE.md` / `AGENTS.md` should point to the skill rather than trying
  to duplicate the full workflow

This should be compatible with PRD-035 generated skills but must not wait for
that migration. In the near term, use shared template files plus target shims.

## 5. Ralph Prompt Contract

Update the Ralph template prompt so the agent is explicitly allowed to:

- inspect linked docs via `tx show <id>` and doc references
- create subtasks with `tx add --parent`
- create follow-up tasks without a parent when the work is sibling or later
- add and remove blockers with `tx dep block` / `tx dep unblock`
- attach docs with `tx doc attach`
- set blocked status when waiting on external work

Boundaries:

- tx remains canonical; do not edit exported markdown as state
- do not mark work done without updating tx
- prefer graph repair over silent abandonment when the discovered work differs
  from the original task

# Interfaces

```yaml
interfaces:
  - name: task_payload_linked_docs
    type: cli+http+mcp+sdk
    semantics: all task inspection surfaces return linked doc refs as part of the normal task payload
  - name: tx_md_export_open
    type: cli
    command: tx md-export --filter open [--path <file>]
    semantics: exports every non-done task and linked doc references for prompt injection
  - name: bundled_task_spec_skill
    type: scaffold
    command: tx init --claude | tx init --codex
    semantics: installs or references a bundled skill that teaches task-spec linkage and safe task-graph mutation
  - name: ralph_prompt_contract
    type: script
    command: scripts/ralph.sh
    semantics: dispatched agents are explicitly allowed to create tasks, attach docs, and update dependencies via tx commands
```

# Data Model

No SQLite migration is required.

Type changes:

```ts
type TaskLinkedDocRef = {
  docId: number
  name: string
  title: string
  kind: DocKind
  version: number
  status: DocStatus
  filePath: string
  linkType: TaskDocLinkType
}

interface TaskWithDeps {
  // existing fields...
  linkedDocs: TaskLinkedDocRef[]
}
```

Repository additions:

```ts
getTaskLinksForTask(taskId: string): Effect<readonly TaskDocLink[], DatabaseError>
getTaskLinksForMany(taskIds: readonly string[]): Effect<ReadonlyMap<string, readonly TaskDocLink[]>, DatabaseError>
getDocsForManyTasks(taskIds: readonly string[]): Effect<ReadonlyMap<string, readonly TaskLinkedDocRef[]>, DatabaseError>
```

# Invariants

```yaml
invariants:
  - id: INV-TASKSPEC-001
    statement: a task with one or more task-doc links returns those links through the standard task payload in every external interface
    severity: high
    verified_by:
      - test/integration/api-task-doc-links.test.ts
      - test/integration/mcp-task-doc-links.test.ts
      - test/integration/agent-sdk-task-doc-links.test.ts
  - id: INV-TASKSPEC-002
    statement: open-task markdown export includes every non-done task and excludes done tasks from the main exported work section
    severity: high
    verified_by:
      - test/integration/cli-md-export.test.ts
  - id: INV-TASKSPEC-003
    statement: linked-doc rendering in markdown export remains compact and does not inline full document bodies by default
    severity: medium
    verified_by:
      - test/unit/format-tasks-markdown.test.ts
  - id: INV-TASKSPEC-004
    statement: bundled Claude and Codex workflow skills teach task-spec linkage and task-graph mutation without requiring monolithic top-level instructions
    severity: medium
    verified_by:
      - test/integration/init-onboarding.test.ts
      - test/integration/scaffold.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: task enrichment fetches only a single doc even when multiple links exist
    impact: agents miss relevant specs and make incomplete decisions
    handling: replace single-doc read paths with batched many-to-many retrieval and add multi-link integration coverage
  - condition: `md-export --filter open` accidentally includes done tasks in the open-work section
    impact: Ralph-style loops receive stale or misleading work context
    handling: add explicit filter expansion tests and section-level assertions
  - condition: linked-doc rendering in export becomes too verbose
    impact: prompt injection costs rise and agents receive bloated context
    handling: keep the default export to compact refs only and gate richer summaries behind an explicit flag
  - condition: bundled skills are added only to one target scaffold
    impact: Claude and Codex workflows diverge again
    handling: keep shared skill content in one template and verify both scaffold outputs in integration tests
  - condition: Ralph prompt encourages graph mutation without naming canonical commands
    impact: agents may edit markdown or local notes instead of tx state
    handling: reference exact tx commands and restate that tx is canonical
```

# Verification

```yaml
verification:
  - requirement_id: EARS-TASKSPEC-001
    test_type: integration
    target: test/integration/api-task-doc-links.test.ts; test/integration/mcp-task-doc-links.test.ts; test/integration/agent-sdk-task-doc-links.test.ts
  - requirement_id: EARS-TASKSPEC-002
    test_type: integration
    target: test/integration/api-task-doc-links.test.ts; test/integration/mcp-task-doc-links.test.ts
  - requirement_id: EARS-TASKSPEC-003
    test_type: integration
    target: test/integration/cli-md-export.test.ts
  - requirement_id: EARS-TASKSPEC-004
    test_type: unit+integration
    target: test/unit/format-tasks-markdown.test.ts; test/integration/cli-md-export.test.ts
  - requirement_id: EARS-TASKSPEC-005
    test_type: integration
    target: test/integration/cli-md-export.test.ts
  - requirement_id: EARS-TASKSPEC-006
    test_type: integration
    target: test/integration/init-onboarding.test.ts; test/integration/scaffold.test.ts
  - requirement_id: EARS-TASKSPEC-007
    test_type: integration
    target: test/integration/ralph-script.test.ts
```

# Testing Strategy

1. Extend task-surface integration coverage with a fixture that attaches two docs
   of different kinds to a single task and asserts the full linked-doc array
   across CLI/API/MCP/SDK surfaces.
2. Add unit coverage for task serialization so `linkedDocs` survives JSON
   serialization with dates and existing task metadata intact.
3. Extend `test/unit/format-tasks-markdown.test.ts` to assert compact linked-doc
   rendering and to verify that full doc bodies are not emitted.
4. Extend `test/integration/cli-md-export.test.ts` with `--filter open`,
   mixed-status queues, and linked-doc rendering assertions.
5. Add scaffold coverage confirming the new shared skill lands in both Claude and
   Codex outputs and that top-level compatibility files reference the skill.
6. Extend Ralph script coverage to assert the dispatched prompt includes the
   allowed graph-mutation commands.
7. Keep all integration tests on the shared singleton DB pattern from
   `@jamesaphoenix/tx-test-utils`; do not create a new DB per test.

# Open Questions

- [ ] Should `tx show` also render linked-doc summaries in text mode, or only
      names and file paths?
- [ ] Should `tx list` eventually gain a first-class `open` filter alongside
      `md-export`, or is export-only sufficient for the first slice?
- [ ] Should future validation warn on active tasks that have zero implementing
      docs, or is visibility enough for now?

# Migration

No data migration is required.

Existing task-doc links remain valid. Once the new task payload field lands:

1. task consumers automatically receive `linkedDocs`
2. markdown export can begin rendering doc refs immediately for existing linked
   tasks
3. scaffolded skills and Ralph prompts can teach the richer workflow without
   changing stored data

# References

- Plan file: `/Users/jamesaphoenix/.codex/plans/2026-03-27-task-spec-linkage-and-open-export.md`
- Existing docs-as-primitives: [PRD-023](../prd/PRD-023-docs-as-primitives.md)
- Existing docs-as-primitives design: [DD-023](DD-023-docs-as-primitives.md)
- Generated skills direction: [PRD-035](../prd/PRD-035-generated-cli-skills.md)
- Generated skills design: [DD-035](DD-035-generated-cli-skills.md)
