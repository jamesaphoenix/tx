# DD-021: Platform Sync (Claude Code, Codex)

## Overview

One-way sync from tx's SQLite database to external agent platform task directories. The initial implementation targets Claude Code's file-based task system. The architecture is extensible to other platforms (Codex, etc.) via platform-specific writer functions.

## Design

### Architecture

```
tx database (.tx/tasks.db)
    │
    │  buildClaudeTaskFiles() — pure function
    ▼
ClaudeTaskFile[] — platform-specific format
    │
    │  File I/O — write {id}.json + .highwatermark
    ▼
~/.claude/tasks/{team-name}/  — Claude Code reads these
```

The core logic is a **pure function** (`buildClaudeTaskFiles`) that transforms `TaskWithDeps[]` into an array of `ClaudeTaskFile` objects. File I/O is handled by the CLI command layer. This separation enables testing without filesystem side effects and reuse across CLI, MCP, and SDK interfaces.

### Claude Code Task File Format

Discovered by inspecting existing `~/.claude/tasks/` directories:

```
~/.claude/tasks/{team-name}/
  .lock              # Empty file, filesystem lock
  .highwatermark     # Next available numeric ID (e.g., "17")
  1.json             # Individual task files
  2.json
  ...
```

Each `{id}.json`:
```json
{
  "id": "1",
  "subject": "Task title",
  "description": "Detailed description with tx metadata",
  "activeForm": "Working on tx-abc123: Task title",
  "status": "pending",
  "blocks": ["3", "4"],
  "blockedBy": ["2"]
}
```

### Data Model

```typescript
// Schema-based types (Doctrine Rule 10)
const ClaudeTaskFileSchema = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  description: Schema.String,
  activeForm: Schema.String,
  status: Schema.Literal("pending", "in_progress", "completed"),
  blocks: Schema.Array(Schema.String),
  blockedBy: Schema.Array(Schema.String),
})
```

### ID Mapping

tx uses hash-based IDs (`tx-a1b2c3d4`), Claude Code uses sequential numeric IDs (`"1"`, `"2"`, ...). The writer:

1. Filters out done tasks
2. Sorts by readiness (ready first) then score (highest first)
3. Assigns sequential numeric IDs starting from 1
4. Builds a `Map<txId, numericId>` for dependency translation
5. Translates `blockedBy`/`blocks` arrays using the map
6. Deps referencing excluded (done) tasks are silently dropped

### Status Mapping

| tx status | Claude Code status | Rationale |
|-----------|-------------------|-----------|
| `done` | excluded | Not synced |
| `active`, `review`, `human_needs_to_review` | `in_progress` | Work underway |
| `backlog`, `ready`, `planning`, `blocked` | `pending` | Not started |

### Description Enrichment

Each task's description is enriched with tx metadata and instructions:

```markdown
{original task description}

---
**tx ID**: tx-abc123 | **Priority**: 800 | **Status**: ready
**Blocked by**: tx-def456, tx-ghi789

Run `tx context tx-abc123` for relevant learnings before starting.
Run `tx done tx-abc123` when complete.
```

### CLI Interface

```bash
tx sync claude --team <name>    # Writes to ~/.claude/tasks/<name>/
tx sync claude --dir <path>     # Writes to arbitrary directory
tx sync claude --team <name> --json  # JSON output with stats
```

### Service Layer

No new Effect service. The writer is a pure function in `packages/core/src/sync/claude-task-writer.ts`. The CLI command (`syncClaude`) uses `TaskService.listWithDeps()` to fetch data, then calls the pure function, then writes files.

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 1 | `packages/core/src/sync/claude-task-writer.ts` | New: pure builder function + Schema types |
| 1 | `packages/core/src/index.ts` | Export new module |
| 2 | `apps/cli/src/commands/sync-platform.ts` | New: `syncClaude`, `syncCodex` CLI handlers |
| 2 | `apps/cli/src/commands/sync.ts` | Add claude/codex subcommand dispatch |
| 2 | `apps/cli/src/help.ts` | Add help text for sync claude/codex |
| 3 | `apps/mcp-server/src/tools/sync.ts` | Add `tx_sync_claude` MCP tool |
| 4 | `test/integration/sync-claude.test.ts` | Integration tests |

## Testing Strategy

Integration tests using `createSharedTestLayer()`:
- Empty state produces empty directory
- Done tasks excluded
- Sequential ID assignment
- Dependency mapping with numeric IDs
- Deps to done tasks filtered
- Status mapping verification
- Sort order (ready first, highest score first)
- Description content validation
- File write to temp directory produces valid JSON

## Extensibility

To add a new platform (e.g., Codex):

1. Create `packages/core/src/sync/codex-task-writer.ts` with `buildCodexTaskFiles()`
2. Add `syncCodex` implementation in `apps/cli/src/commands/sync-platform.ts`
3. The subcommand dispatch in `sync.ts` already routes `codex`

Each platform gets its own writer function — no shared abstraction until patterns emerge across 2+ implementations.

-> [PRD-021](../prd/PRD-021-platform-sync.md)
