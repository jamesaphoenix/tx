# PRD-009: JSONL Git-Backed Sync

## Problem Statement

SQLite is excellent for local performance but creates challenges for:

1. **Multi-machine sync**: Developers work across multiple machines; SQLite doesn't merge
2. **Audit trail**: Git history provides versioned, diffable task history
3. **Recovery**: Human-readable backup if SQLite corrupts
4. **Team collaboration**: Multiple humans/agents sharing tasks need conflict resolution

We need **bidirectional JSONL sync** that:
- Exports tasks to git-trackable JSONL files
- Imports changes from git into SQLite
- Handles merge conflicts gracefully
- Preserves full task history

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐
│   SQLite DB     │◄───────►│   .tx/tasks.jsonl │
│ (source of truth│  sync   │  (git-tracked)    │
│  during runtime)│         │                   │
└─────────────────┘         └──────────────────┘
         │                           │
         │                           │
    Local ops                   Git push/pull
    (fast)                      (distributed)
```

### Sync Strategy: Last-Write-Wins with Tombstones

1. **Export**: `tx sync export` writes all tasks to `.tx/tasks.jsonl`
2. **Import**: `tx sync import` reads JSONL and reconciles with DB
3. **Auto-sync**: Optional hook on `tx done`, `tx add`, etc.

## JSONL Format

Each line is a self-contained JSON object:

```jsonl
{"v":1,"op":"upsert","id":"tx-a1b2c3","ts":"2024-01-15T10:00:00Z","data":{"title":"Implement auth","status":"active","score":800,"parentId":null}}
{"v":1,"op":"upsert","id":"tx-d4e5f6","ts":"2024-01-15T11:00:00Z","data":{"title":"Add login","status":"ready","score":700,"parentId":"tx-a1b2c3"}}
{"v":1,"op":"dep_add","ts":"2024-01-15T12:00:00Z","blockerId":"tx-a1b2c3","blockedId":"tx-d4e5f6"}
{"v":1,"op":"delete","id":"tx-g7h8i9","ts":"2024-01-15T13:00:00Z"}
```

### Operation Types

| Op | Description | Required Fields |
|----|-------------|-----------------|
| `upsert` | Create or update task | `id`, `ts`, `data` |
| `delete` | Soft-delete task (tombstone) | `id`, `ts` |
| `dep_add` | Add blocking dependency | `ts`, `blockerId`, `blockedId` |
| `dep_remove` | Remove blocking dependency | `ts`, `blockerId`, `blockedId` |

### Conflict Resolution

When the same task is modified in multiple places:
1. **Timestamp wins**: Later `ts` overwrites earlier
2. **Tombstones are final**: Delete at T2 beats update at T1
3. **Dependencies merge**: Both additions are kept (set union)

## Use Cases

### Case 1: Multi-Machine Sync
```bash
# On laptop
tx add "Fix bug" --score 800
tx sync export
git add .tx/tasks.jsonl && git commit -m "Add bug fix task"
git push

# On desktop
git pull
tx sync import  # Now has the "Fix bug" task
```

### Case 2: Team Collaboration
```bash
# Alice adds task
tx add "Design API" && tx sync export
git commit -am "Alice: design task" && git push

# Bob adds task (concurrent)
tx add "Write tests" && tx sync export
git commit -am "Bob: test task" && git push
# Git merge conflict in .tx/tasks.jsonl

# Resolve: both tasks kept (JSONL is append-only per session)
git pull --rebase  # JSONL lines from both are preserved
tx sync import     # Both tasks now in DB
```

### Case 3: Recovery from Corruption
```bash
# SQLite corrupted
rm .tx/tasks.db

# Rebuild from JSONL
tx init
tx sync import  # Replays all operations from JSONL
```

## Requirements

### Sync Operations
- [ ] `tx sync export` - Write all tasks to JSONL
- [ ] `tx sync import` - Read JSONL and reconcile to DB
- [ ] `tx sync status` - Show sync state (dirty/clean/conflicts)
- [ ] `tx sync auto --enable|--disable` - Toggle auto-export on mutations

### JSONL File Management
- [ ] Location: `.tx/tasks.jsonl` (git-tracked by default)
- [ ] Append-only during a session (no rewriting)
- [ ] Compact on `tx sync compact` (dedupe, remove superseded ops)
- [ ] Schema version in each line (`v:1`)

### Conflict Handling
- [ ] Timestamp-based resolution (last write wins)
- [ ] Tombstone records for deletes
- [ ] No data loss on merge (both versions kept if timestamps equal)
- [ ] Warn on potential conflicts during import

### Git Integration
- [ ] `.tx/tasks.jsonl` NOT in `.gitignore`
- [ ] `.tx/tasks.db` REMAINS in `.gitignore`
- [ ] Pre-commit hook option for auto-export
- [ ] Post-merge hook option for auto-import

## Constraints

- JSONL is append-only during a session (atomic writes)
- Compaction is explicit, not automatic (preserves history)
- Import is idempotent (can run multiple times safely)
- Export includes all tasks, not incremental (simple, reliable)

## Migration Path

1. **Phase 1**: Manual sync (`tx sync export`, `tx sync import`)
2. **Phase 2**: Auto-sync hooks (opt-in)
3. **Phase 3**: Git hooks for seamless integration

## Non-Goals (v1)

- Real-time sync (use git for distribution)
- Partial exports (always full dump)
- Binary formats (JSONL is human-readable priority)
- CRDTs (timestamp resolution is sufficient)
