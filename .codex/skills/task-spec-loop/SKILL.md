---
name: task-spec-loop
description: Link tasks to paired PRD/design specs, export all open work to markdown, and keep Ralph-style loops moving by creating tasks, subtasks, and dependency updates through tx primitives.
argument-hint: [task-id-or-doc-name]
---

# Task Spec Loop

Use this skill when the user wants task execution tied to paired specs, especially for file-based loops that inject markdown into Codex or Claude.

## Core Rules

- `tx` remains the source of truth for task state.
- `tx md-export --filter open` is read-only export for loop injection, not a mutation path.
- Linked specs must be attached to tasks with `tx doc attach`, not inferred from filenames alone.
- New work should be captured explicitly with `tx add`, `tx add --parent`, and dependency edits.

## Working Loop

1. Inspect the task and current spec links.

```bash
tx show <task-id>
tx memory context <task-id>
```

`tx show` should surface `linkedDocs` when docs are already attached.

2. Attach the right docs when the task needs a PRD/design pair, runbook, or decision.

```bash
tx doc attach <task-id> <prd-doc> --type implements
tx doc attach <task-id> <design-doc> --type references
tx doc attach <task-id> <supporting-doc> --type references
```

Use `implements` for the main driving PRD. Use `references` for the design doc and any supporting docs.

3. Keep the queue moving through tx primitives.

```bash
tx add "Follow-up task"
tx add "Subtask title" --parent <task-id>
tx dep block <task-id> <blocker-id>
tx dep unblock <task-id> <blocker-id>
tx update <task-id> --status blocked
tx done <task-id>
```

Create new tasks whenever the implementation exposes more work. Update dependencies if the execution order changes.

4. Export the open queue for Ralph-style prompt injection.

```bash
tx md-export --filter open
tx md-export --filter open --path .tx/tasks-open.md
```

This export should contain all non-done tasks plus compact linked-doc references so the loop can inject both work items and the spec handles they depend on.

## Practical Guidance

- Prefer linking a task to a stable PRD/doc slug pair before asking an agent to implement it.
- If a non-trivial task is missing one half of the PRD/design pair, create or find the missing doc first, then attach both docs.
- If implementation discovers new constraints, create follow-up tasks and update dependency edges instead of leaving that work implicit.
- If a blocked task becomes unblocked because a dependency was completed or removed, reflect that with `tx dep unblock` or by completing the blocker in tx.
