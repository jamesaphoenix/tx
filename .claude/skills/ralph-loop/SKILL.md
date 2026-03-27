---
name: ralph-loop
description: Run Ralph against either the full repo queue or tasks linked to one design doc, with injected task/spec/queue context for Codex or Claude runtimes.
argument-hint: "[--all-tasks | --design-doc <name>] [--runtime codex|claude]"
---

# Ralph Loop

Use when the user wants to dispatch work through `scripts/ralph.sh` and needs to choose between the global queue and a single design-doc slice.

## Modes

- Global queue: `./scripts/ralph.sh --all-tasks`
- Design-doc scope: `./scripts/ralph.sh --design-doc <name>`

If neither flag is passed, Ralph defaults to the global queue. Use `--design-doc <name>` when the user wants the current task selection and injected queue snapshot limited to tasks linked to that design doc.

## What Ralph Injects

For every dispatched task, Ralph writes and injects:

- current task JSON
- linked design-doc markdown for the current task
- all tasks in the current Ralph scope

In `--all-tasks` mode, that queue snapshot is the repo-wide task list.
In `--design-doc <name>` mode, that queue snapshot is filtered to tasks whose `linkedDocs` include that design doc.

## Required Setup

Attach specs to tasks explicitly before running Ralph in design-doc mode:

```bash
tx doc attach <task-id> <prd-doc> --type implements
tx doc attach <task-id> <design-doc> --type references
```

Ralph scopes by the linked design doc name, not by filename guesses.

## Practical Commands

Run against the full queue:

```bash
./scripts/ralph.sh --runtime codex --all-tasks
./scripts/ralph.sh --runtime claude --all-tasks
```

Run against one design doc:

```bash
./scripts/ralph.sh --runtime codex --design-doc auth-flow-design
./scripts/ralph.sh --runtime claude --design-doc auth-flow-design
```

## Expectations During Execution

- Ralph may create follow-up tasks with `tx add` and subtasks with `tx add ... --parent <task-id>`.
- Ralph may reorder work with `tx update <id> --score <n>` or `tx bulk score <n> <id...>`.
- If a non-trivial task is missing its paired PRD/design docs, create docs follow-up work or block the task before large implementation proceeds.

## Verification

After changing Ralph behavior, prefer these tests:

```bash
bunx --bun vitest run test/integration/ralph-script.test.ts test/integration/ralph-context-bundle-e2e.test.ts
```
