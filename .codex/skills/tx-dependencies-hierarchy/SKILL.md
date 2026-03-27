---
name: "tx-dependencies-hierarchy"
description: "Model blockers, parent-child relationships, and shared group context. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Model blockers, parent-child relationships, and shared group context."
---

# tx Dependencies And Hierarchy

Use when tasks need ordering, tree inspection, or inherited rollout context.

## Quick Start

- `tx dep block <task-id> <blocker-id>`
- `tx dep tree <task-id>`
- `tx group-context set <task-id> "shared context"`

## Included Commands

- `tx block`: Add blocking dependency
- `tx children`: List child tasks
- `tx dep`: Dependencies & hierarchy
- `tx dep block`: Add blocking dependency
- `tx dep children`: List child tasks
- `tx dep tree`: Show task subtree
- `tx dep unblock`: Remove blocking dependency
- `tx group-context clear`: Clear task-group context on a task
- `tx group-context set`: Set task-group context on a task
- `tx tree`: Show task subtree
- `tx unblock`: Remove blocking dependency

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
