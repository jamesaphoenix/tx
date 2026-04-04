---
name: "tx-workers-runtime"
description: "Operate workers, daemons, coordinators, cycle scans, and hook installation paths. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Operate workers, daemons, coordinators, cycle scans, and hook installation paths."
---

# tx Workers And Runtime

Use when the user is orchestrating background workers, cycle scans, or long-running runtime processes.

## Quick Start

- `tx worker status`
- `tx coordinator status`
- `tx cycle --help`

## Included Commands

- `tx coordinator`: Worker coordination primitives
- `tx coordinator reconcile`: Force reconciliation pass
- `tx coordinator start`: Start the coordinator
- `tx coordinator status`: Show coordinator status
- `tx coordinator stop`: Stop the coordinator
- `tx cycle`: Cycle-based issue discovery with sub-agent swarms
- `tx daemon`: Background daemon for learning extraction
- `tx daemon list`: List tracked projects
- `tx daemon process`: Process JSONL files for learning candidates
- `tx daemon promote`: Promote a candidate to learning
- `tx daemon reject`: Reject a learning candidate
- `tx daemon review`: List pending learning candidates
- `tx daemon start`: Start the background daemon
- `tx daemon status`: Show daemon status
- `tx daemon stop`: Stop the background daemon
- `tx daemon track`: Track a project for learning extraction
- `tx daemon untrack`: Stop tracking a project
- `tx hooks:install`: Install post-commit hook
- `tx hooks:status`: Show git hook status
- `tx hooks:uninstall`: Remove post-commit hook
- `tx worker`: Worker process management
- `tx worker list`: List all workers
- `tx worker start`: Start a worker process
- `tx worker status`: Show worker status
- `tx worker stop`: Stop a worker process

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
