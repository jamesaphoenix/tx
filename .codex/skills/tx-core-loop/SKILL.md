---
name: "tx-core-loop"
description: "Work the main tx queue: initialize, create tasks, inspect work, claim tasks, and complete them. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Work the main tx queue: initialize, create tasks, inspect work, claim tasks, and complete them."
---

# tx Core Loop

Use when the user is setting up tx or moving normal task work through the queue.

## Quick Start

- `tx ready --limit 1 --json`
- `tx show <task-id>`
- `tx done <task-id>`

## Included Commands

- `tx add`: Create a new task
- `tx bulk`: Batch operations on multiple tasks
- `tx claim`: Claim a task for a worker with a lease
- `tx claim release`: Release a claim on a task
- `tx claim renew`: Renew the lease on a claim
- `tx delete`: Delete a task
- `tx done`: Mark task complete
- `tx help`: Show help
- `tx init`: Initialize task database
- `tx list`: List tasks
- `tx ready`: List ready tasks
- `tx reset`: Reset task to ready status
- `tx show`: Show task details
- `tx update`: Update a task

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
