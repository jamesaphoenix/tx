---
name: tx-workflow
description: Guide for working with tx task management. Use when picking up tasks, completing work, or managing dependencies.
---

# tx Workflow

## Picking Up a Task

1. Run `tx ready --limit 1 --json` to get the next unblocked task
2. Run `tx show <id>` to see full details, dependencies, and context
3. Run `tx context <id>` to get relevant learnings for the task

## Working on a Task

1. Understand the task requirements from `tx show`
2. Check for relevant learnings with `tx context <id>` or `tx recall <file-path>`
3. Implement the changes
4. Record anything you learned: `tx learning:add "what you discovered"`

## Completing a Task

1. Run `tx done <id>` to mark the task complete
2. This automatically unblocks any tasks that depended on this one
3. Check `tx ready` to see if new tasks became available

## Creating Sub-tasks

If a task is too large, break it down:

```bash
tx add "Sub-task title" --parent <parent-id> --description "Details"
```

## Managing Dependencies

```bash
# Task B can't start until Task A is done
tx block <task-B-id> <task-A-id>

# Remove a dependency
tx unblock <task-B-id> <task-A-id>
```

## Recording Learnings

```bash
# General learning
tx learning:add "Effect.try catch handler puts errors in the error channel, not success"

# File-specific learning
tx learn "src/auth/*.ts" "Auth tokens expire after 24h, refresh logic is in token-service.ts"

# Recall learnings for a file
tx recall src/auth/token-service.ts
```
