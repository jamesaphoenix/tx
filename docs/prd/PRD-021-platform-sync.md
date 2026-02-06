# PRD-021: Platform Sync (Claude Code, Codex)

## Problem

tx manages tasks in SQLite, but agent teams in Claude Code (and future platforms like Codex) have their own native task systems. When orchestrating a team of agents, the team lead currently must manually create tasks one-by-one via the platform's API. There's no way to push tx's task state into a platform's coordination layer as a batch operation.

This creates friction: tx is the source of truth for tasks, but the team's native task tools can't see them.

## Solution

Add `tx sync claude` (and extensible `tx sync codex`) that writes all non-done tx tasks directly to the target platform's on-disk task directory. This is a **one-way sync**: tx is the source of truth, platform tasks are an ephemeral coordination layer. Teammates write back to tx via `tx done <txId>`.

For Claude Code specifically, this means writing individual JSON files to `~/.claude/tasks/{team-name}/` in Claude Code's native format — tasks appear immediately in `TaskList` without going through the `TaskCreate` API.

## Requirements

- [x] `tx sync claude --team <name>` writes all non-done tasks to `~/.claude/tasks/<name>/`
- [x] `tx sync claude --dir <path>` writes to an arbitrary directory (escape hatch)
- [x] Task files match Claude Code's exact JSON format (`id`, `subject`, `description`, `activeForm`, `status`, `blocks`, `blockedBy`)
- [x] tx task IDs mapped to sequential numeric IDs for Claude Code compatibility
- [x] Dependencies (`blockedBy`/`blocks`) translated using the ID mapping
- [x] Done tasks excluded; deps referencing done tasks filtered out
- [x] Status mapping: active/review/human_needs_to_review -> `in_progress`, all others -> `pending`
- [x] `.highwatermark` file updated for Claude Code's ID auto-increment
- [x] Task descriptions include `tx context <id>` and `tx done <id>` instructions
- [ ] `tx sync codex` stub (not yet implemented, extensible pattern)
- [ ] MCP tool `tx_sync_claude` for programmatic access

## Acceptance Criteria

1. After running `tx sync claude --team my-team`, `TaskList` in a Claude Code team shows all non-done tx tasks
2. Dependencies are correctly wired (blocked tasks show `blockedBy`)
3. Teammates can run `tx done <txId>` to close the loop back to tx
4. Running sync multiple times overwrites cleanly (idempotent for the set of non-done tasks)

## Out of Scope

- Two-way sync (Claude Code -> tx)
- Automatic re-sync on tx mutations
- Team creation (user must call `Teammate.spawnTeam` first)
- Codex implementation (stub only)

-> [DD-021](../design/DD-021-platform-sync.md)
