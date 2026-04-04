---
name: "tx-sync-data"
description: "Export, import, migrate, hydrate, and compact task state and sync artifacts. Use when working in Claude Code and the user needs tx commands from this area."
metadata:
  short-description: "Export, import, migrate, hydrate, and compact task state and sync artifacts."
---

# tx Sync And Data

Use when data needs to move between SQLite, JSONL, Codex, Claude, or migration layers.

## Quick Start

- `tx sync export`
- `tx sync status`
- `tx sync compact`

## Included Commands

- `tx compact`: Compact completed tasks and export learnings
- `tx history`: View compaction history
- `tx migrate`: Manage database schema migrations
- `tx migrate status`: Show migration status
- `tx sync`: Sync, data management, and migrations
- `tx sync auto`: Manage automatic sync
- `tx sync claude`: Write tasks to Claude Code team directory
- `tx sync codex`: Write tasks to Codex (coming soon)
- `tx sync compact`: Compact completed tasks and export learnings
- `tx sync export`: Export stream events
- `tx sync history`: View compaction history
- `tx sync hydrate`: Full rebuild from stream event logs
- `tx sync import`: Import from stream events
- `tx sync migrate`: Show database migration status
- `tx sync status`: Show sync status
- `tx sync stream`: Show stream identity and sequence state

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Claude Code, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
