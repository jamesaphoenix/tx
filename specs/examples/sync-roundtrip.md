# Sync Round-Trip Example

This example demonstrates the sync workflow for git-friendly persistence.

## The Golden Path

```
Export → Git Commit → Clone → Import → Verify
```

Sync uses JSONL format for human-readable, git-friendly diffs.

## CLI Example

### Export Tasks

```bash
# Export all tasks to JSONL
tx sync export
# Output: Exported 25 operation(s) to .tx/tasks.jsonl

# Export to custom path
tx sync export --path ./backup/tasks.jsonl
```

### Import Tasks

```bash
# Import from JSONL (new database)
tx sync import
# Output: Imported: 25, Skipped: 0, Conflicts: 0

# Import from custom path
tx sync import --path ./backup/tasks.jsonl
```

### Check Sync Status

```bash
tx sync status
# Output:
# Sync Status:
#   Tasks in database: 25
#   Operations in JSONL: 25
#   Last export: 2025-01-28T10:00:00.000Z
#   Last import: (never)
#   Dirty (unexported changes): no
#   Auto-sync: disabled
```

### Compact JSONL

```bash
# Remove duplicate operations (keeps latest per entity)
tx sync compact
# Output: Compacted: 50 → 25 operations
```

## Git Workflow

```bash
# 1. Work on tasks
tx add "New feature"
tx done tx-abc123

# 2. Export for git
tx sync export
# Creates .tx/tasks.jsonl

# 3. Commit
git add .tx/tasks.jsonl
git commit -m "Update task state"
git push

# 4. On another machine
git pull
tx sync import
# Tasks restored!
```

## JSONL Format

Each line is a single JSON operation:

```json
{"v":1,"op":"upsert","ts":"2025-01-28T10:00:00.000Z","id":"tx-a1b2c3d4","data":{"title":"Task A","description":"","status":"backlog","score":800,"parentId":null,"metadata":{}}}
{"v":1,"op":"upsert","ts":"2025-01-28T10:01:00.000Z","id":"tx-b2c3d4e5","data":{"title":"Task B","description":"","status":"ready","score":600,"parentId":"tx-a1b2c3d4","metadata":{}}}
{"v":1,"op":"dep_add","ts":"2025-01-28T10:02:00.000Z","blockerId":"tx-a1b2c3d4","blockedId":"tx-b2c3d4e5"}
```

Operation types:
- `upsert` - Create or update task
- `delete` - Remove task
- `dep_add` - Add dependency
- `dep_remove` - Remove dependency

## Programmatic Example (TypeScript)

```typescript
import { Effect } from "effect"
import { SyncService, TaskService, makeAppLayer } from "@jamesaphoenix/tx-core"

const syncRoundTrip = Effect.gen(function* () {
  const syncSvc = yield* SyncService
  const taskSvc = yield* TaskService

  // Create some tasks
  yield* taskSvc.create({ title: "Task 1", score: 800 })
  yield* taskSvc.create({ title: "Task 2", score: 600 })

  // Export
  const exportResult = yield* syncSvc.export("./tasks.jsonl")
  console.log(`Exported ${exportResult.opCount} operations`)

  // Check status
  const status = yield* syncSvc.status()
  console.log(`DB has ${status.dbTaskCount} tasks`)
  console.log(`JSONL has ${status.jsonlOpCount} operations`)
  console.log(`Dirty: ${status.isDirty}`)
})

// Import into fresh database
const importTasks = Effect.gen(function* () {
  const syncSvc = yield* SyncService
  const taskSvc = yield* TaskService

  // Import
  const importResult = yield* syncSvc.import("./tasks.jsonl")
  console.log(`Imported: ${importResult.imported}`)
  console.log(`Skipped: ${importResult.skipped}`)
  console.log(`Conflicts: ${importResult.conflicts}`)

  // Verify tasks exist
  const tasks = yield* taskSvc.list()
  for (const task of tasks) {
    console.log(`- ${task.id}: ${task.title}`)
  }
})
```

## Conflict Resolution

When importing:

| Local vs JSONL | Result |
|----------------|--------|
| JSONL newer | Import (update local) |
| Local newer | Conflict (keep local) |
| Same timestamp | Skip |

```bash
# If there's a conflict
tx sync import
# Output: Imported: 10, Skipped: 5, Conflicts: 3
# Local tasks with newer timestamps are preserved
```

## Round-Trip Preservation

The sync system preserves:
- ✅ Task data (title, description, status, score)
- ✅ Parent-child hierarchy
- ✅ Dependencies (blockedBy/blocks)
- ✅ TaskWithDeps info (Rule 1)
- ✅ Timestamps for conflict resolution

## Key Points

1. **JSONL format** - One JSON object per line, git-friendly diffs
2. **Timestamp-based** conflict resolution (newer wins)
3. **Compact** removes superseded operations
4. **Round-trip safe** - All data preserved through export/import
5. **Auto-sync** can be enabled for automatic exports

## Related

- [Task Lifecycle](./task-lifecycle.md) - Create tasks to sync
- [Dependency Chain](./dependency-chain.md) - Dependencies are preserved
