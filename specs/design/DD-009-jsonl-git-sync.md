# DD-009: JSONL Git Sync Implementation

## Overview

This document describes the implementation of bidirectional JSONL sync for git-based task distribution across machines and teams.

## File Format Specification

### JSONL Structure

Each line is a complete, self-contained JSON object with a trailing newline:

```typescript
// Base operation type
interface SyncOperation {
  v: 1                    // Schema version
  op: "upsert" | "delete" | "dep_add" | "dep_remove"
  ts: string              // ISO 8601 timestamp
}

// Task upsert operation
interface TaskUpsertOp extends SyncOperation {
  op: "upsert"
  id: string              // Task ID (tx-xxxxxx)
  data: {
    title: string
    description: string
    status: TaskStatus
    score: number
    parentId: string | null
    metadata: Record<string, unknown>
  }
}

// Task delete operation (tombstone)
interface TaskDeleteOp extends SyncOperation {
  op: "delete"
  id: string
}

// Dependency add operation
interface DepAddOp extends SyncOperation {
  op: "dep_add"
  blockerId: string
  blockedId: string
}

// Dependency remove operation
interface DepRemoveOp extends SyncOperation {
  op: "dep_remove"
  blockerId: string
  blockedId: string
}

type AnyOp = TaskUpsertOp | TaskDeleteOp | DepAddOp | DepRemoveOp
```

### Effect Schema Definitions

```typescript
// src/schemas/sync.ts
import { Schema } from "effect"
import { TaskStatus, TaskId } from "./task"

export const SyncVersion = Schema.Literal(1)

export const TaskUpsertOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("upsert"),
  ts: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}T/)),
  id: TaskId,
  data: Schema.Struct({
    title: Schema.String,
    description: Schema.String,
    status: TaskStatus,
    score: Schema.Int,
    parentId: Schema.NullOr(TaskId),
    metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
  })
})

export const TaskDeleteOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("delete"),
  ts: Schema.String,
  id: TaskId
})

export const DepAddOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("dep_add"),
  ts: Schema.String,
  blockerId: TaskId,
  blockedId: TaskId
})

export const DepRemoveOp = Schema.Struct({
  v: SyncVersion,
  op: Schema.Literal("dep_remove"),
  ts: Schema.String,
  blockerId: TaskId,
  blockedId: TaskId
})

export const SyncOperation = Schema.Union(
  TaskUpsertOp,
  TaskDeleteOp,
  DepAddOp,
  DepRemoveOp
)
export type SyncOperation = Schema.Schema.Type<typeof SyncOperation>
```

## Service Layer

### SyncService

```typescript
// src/services/SyncService.ts
import { Effect, Context, Layer, Stream } from "effect"
import { FileSystem } from "@effect/platform"
import { SyncOperation, TaskUpsertOp, TaskDeleteOp } from "../schemas/sync"

export interface SyncStatus {
  dbTaskCount: number
  jsonlOpCount: number
  lastExport: Date | null
  lastImport: Date | null
  isDirty: boolean        // DB has changes not in JSONL
  hasConflicts: boolean   // JSONL has ops newer than last import
}

export class SyncService extends Context.Tag("SyncService")<
  SyncService,
  {
    // Core operations
    readonly export: (path?: string) => Effect.Effect<{ opCount: number; path: string }>
    readonly import: (path?: string) => Effect.Effect<{ imported: number; skipped: number; conflicts: number }>
    readonly status: () => Effect.Effect<SyncStatus>
    
    // Auto-sync
    readonly enableAutoSync: () => Effect.Effect<void>
    readonly disableAutoSync: () => Effect.Effect<void>
    readonly isAutoSyncEnabled: () => Effect.Effect<boolean>
    
    // Maintenance
    readonly compact: (path?: string) => Effect.Effect<{ before: number; after: number }>
  }
>() {}

export const SyncServiceLive = Layer.effect(
  SyncService,
  Effect.gen(function* () {
    const taskService = yield* TaskService
    const depService = yield* DependencyService
    const fs = yield* FileSystem.FileSystem
    const config = yield* ConfigService
    
    const defaultPath = ".tx/tasks.jsonl"
    
    return {
      export: (path = defaultPath) =>
        Effect.gen(function* () {
          const tasks = yield* taskService.list()
          const deps = yield* depService.listAll()
          
          const ops: SyncOperation[] = []
          const now = new Date().toISOString()
          
          // Convert tasks to upsert ops
          for (const task of tasks) {
            ops.push({
              v: 1,
              op: "upsert",
              ts: task.updatedAt.toISOString(),
              id: task.id,
              data: {
                title: task.title,
                description: task.description,
                status: task.status,
                score: task.score,
                parentId: task.parentId,
                metadata: task.metadata
              }
            })
          }
          
          // Convert dependencies to dep_add ops
          for (const dep of deps) {
            ops.push({
              v: 1,
              op: "dep_add",
              ts: dep.createdAt.toISOString(),
              blockerId: dep.blockerId,
              blockedId: dep.blockedId
            })
          }
          
          // Sort by timestamp for deterministic output
          ops.sort((a, b) => a.ts.localeCompare(b.ts))
          
          // Write JSONL (atomic write via temp file)
          const content = ops.map(op => JSON.stringify(op)).join("\n") + "\n"
          const tempPath = `${path}.tmp`
          yield* fs.writeFileString(tempPath, content)
          yield* fs.rename(tempPath, path)
          
          // Record export time
          yield* config.set("lastExport", now)
          
          return { opCount: ops.length, path }
        }),
      
      import: (path = defaultPath) =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(path)
          if (!exists) {
            return { imported: 0, skipped: 0, conflicts: 0 }
          }
          
          const content = yield* fs.readFileString(path)
          const lines = content.trim().split("\n").filter(Boolean)
          
          // Parse all operations
          const ops: SyncOperation[] = []
          for (const line of lines) {
            const parsed = JSON.parse(line)
            // Validate against schema
            const op = yield* Schema.decodeUnknown(SyncOperation)(parsed)
            ops.push(op)
          }
          
          // Group by entity and find latest state
          const taskStates = new Map<string, { op: SyncOperation; ts: string }>()
          const depStates = new Map<string, { op: SyncOperation; ts: string }>()
          
          for (const op of ops) {
            if (op.op === "upsert" || op.op === "delete") {
              const existing = taskStates.get(op.id)
              if (!existing || op.ts > existing.ts) {
                taskStates.set(op.id, { op, ts: op.ts })
              }
            } else if (op.op === "dep_add" || op.op === "dep_remove") {
              const key = `${op.blockerId}:${op.blockedId}`
              const existing = depStates.get(key)
              if (!existing || op.ts > existing.ts) {
                depStates.set(key, { op, ts: op.ts })
              }
            }
          }
          
          let imported = 0
          let skipped = 0
          let conflicts = 0
          
          // Apply task operations
          for (const [id, { op }] of taskStates) {
            if (op.op === "upsert") {
              const existing = yield* taskService.get(id).pipe(
                Effect.option
              )
              
              if (existing._tag === "None") {
                // Create new task
                yield* taskService.createWithId(id, op.data)
                imported++
              } else {
                // Update if JSONL is newer
                const existingTs = existing.value.updatedAt.toISOString()
                if (op.ts > existingTs) {
                  yield* taskService.update(id, op.data)
                  imported++
                } else if (op.ts === existingTs) {
                  skipped++
                } else {
                  conflicts++
                }
              }
            } else if (op.op === "delete") {
              const exists = yield* taskService.exists(id)
              if (exists) {
                yield* taskService.delete(id)
                imported++
              }
            }
          }
          
          // Apply dependency operations
          for (const [key, { op }] of depStates) {
            if (op.op === "dep_add") {
              yield* depService.addDependency(op.blockerId, op.blockedId).pipe(
                Effect.catchTag("DependencyExistsError", () => Effect.void)
              )
            } else if (op.op === "dep_remove") {
              yield* depService.removeDependency(op.blockerId, op.blockedId).pipe(
                Effect.catchTag("DependencyNotFoundError", () => Effect.void)
              )
            }
          }
          
          // Record import time
          yield* config.set("lastImport", new Date().toISOString())
          
          return { imported, skipped, conflicts }
        }),
      
      status: () =>
        Effect.gen(function* () {
          const dbTasks = yield* taskService.count()
          const path = defaultPath
          const exists = yield* fs.exists(path)
          
          let jsonlOpCount = 0
          if (exists) {
            const content = yield* fs.readFileString(path)
            jsonlOpCount = content.trim().split("\n").filter(Boolean).length
          }
          
          const lastExport = yield* config.get("lastExport").pipe(
            Effect.map(s => s ? new Date(s) : null),
            Effect.catchAll(() => Effect.succeed(null))
          )
          
          const lastImport = yield* config.get("lastImport").pipe(
            Effect.map(s => s ? new Date(s) : null),
            Effect.catchAll(() => Effect.succeed(null))
          )
          
          // Check if DB has been modified since last export
          const latestTask = yield* taskService.getLatestUpdated().pipe(
            Effect.option
          )
          const isDirty = latestTask._tag === "Some" && 
            (!lastExport || latestTask.value.updatedAt > lastExport)
          
          return {
            dbTaskCount: dbTasks,
            jsonlOpCount,
            lastExport,
            lastImport,
            isDirty,
            hasConflicts: false // Computed during import
          }
        }),
      
      enableAutoSync: () => config.set("autoSync", "true"),
      disableAutoSync: () => config.set("autoSync", "false"),
      isAutoSyncEnabled: () => config.get("autoSync").pipe(
        Effect.map(v => v === "true"),
        Effect.catchAll(() => Effect.succeed(false))
      ),
      
      compact: (path = defaultPath) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(path)
          const lines = content.trim().split("\n").filter(Boolean)
          const before = lines.length
          
          // Parse and dedupe
          const taskStates = new Map<string, SyncOperation>()
          const depStates = new Map<string, SyncOperation>()
          
          for (const line of lines) {
            const op = JSON.parse(line) as SyncOperation
            
            if (op.op === "upsert" || op.op === "delete") {
              const existing = taskStates.get(op.id)
              if (!existing || op.ts > (existing as any).ts) {
                taskStates.set(op.id, op)
              }
            } else {
              const key = `${op.blockerId}:${op.blockedId}`
              const existing = depStates.get(key)
              if (!existing || op.ts > (existing as any).ts) {
                depStates.set(key, op)
              }
            }
          }
          
          // Rebuild compacted JSONL
          const compacted = [
            ...taskStates.values(),
            ...depStates.values()
          ].sort((a, b) => a.ts.localeCompare(b.ts))
          
          const newContent = compacted.map(op => JSON.stringify(op)).join("\n") + "\n"
          yield* fs.writeFileString(path, newContent)
          
          return { before, after: compacted.length }
        })
    }
  })
)
```

## CLI Commands

```typescript
// src/cli/commands/sync.ts
import { Command, Options } from "@effect/cli"

const exportCmd = Command.make(
  "export",
  {
    path: Options.text("path").pipe(
      Options.withDescription("Output path (default: .tx/tasks.jsonl)"),
      Options.optional
    )
  },
  ({ path }) =>
    Effect.gen(function* () {
      const sync = yield* SyncService
      const result = yield* sync.export(path ?? undefined)
      yield* Console.log(`Exported ${result.opCount} operations to ${result.path}`)
    })
)

const importCmd = Command.make(
  "import",
  {
    path: Options.text("path").pipe(
      Options.withDescription("Input path (default: .tx/tasks.jsonl)"),
      Options.optional
    )
  },
  ({ path }) =>
    Effect.gen(function* () {
      const sync = yield* SyncService
      const result = yield* sync.import(path ?? undefined)
      yield* Console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}, Conflicts: ${result.conflicts}`)
    })
)

const statusCmd = Command.make(
  "status",
  {},
  () =>
    Effect.gen(function* () {
      const sync = yield* SyncService
      const status = yield* sync.status()
      
      yield* Console.log(`Sync Status:`)
      yield* Console.log(`  DB tasks: ${status.dbTaskCount}`)
      yield* Console.log(`  JSONL ops: ${status.jsonlOpCount}`)
      yield* Console.log(`  Last export: ${status.lastExport?.toISOString() ?? "never"}`)
      yield* Console.log(`  Last import: ${status.lastImport?.toISOString() ?? "never"}`)
      yield* Console.log(`  Dirty: ${status.isDirty ? "yes (export needed)" : "no"}`)
    })
)

const autoCmd = Command.make(
  "auto",
  {
    enable: Options.boolean("enable").pipe(Options.optional),
    disable: Options.boolean("disable").pipe(Options.optional)
  },
  ({ enable, disable }) =>
    Effect.gen(function* () {
      const sync = yield* SyncService
      
      if (enable) {
        yield* sync.enableAutoSync()
        yield* Console.log("Auto-sync enabled")
      } else if (disable) {
        yield* sync.disableAutoSync()
        yield* Console.log("Auto-sync disabled")
      } else {
        const enabled = yield* sync.isAutoSyncEnabled()
        yield* Console.log(`Auto-sync: ${enabled ? "enabled" : "disabled"}`)
      }
    })
)

const compactCmd = Command.make(
  "compact",
  {
    path: Options.text("path").pipe(Options.optional)
  },
  ({ path }) =>
    Effect.gen(function* () {
      const sync = yield* SyncService
      const result = yield* sync.compact(path ?? undefined)
      yield* Console.log(`Compacted: ${result.before} → ${result.after} operations`)
    })
)

export const syncCmd = Command.make("sync").pipe(
  Command.withSubcommands([exportCmd, importCmd, statusCmd, autoCmd, compactCmd])
)
```

## Auto-Sync Hook

When auto-sync is enabled, mutations trigger export:

```typescript
// src/services/TaskService.ts (modified)

// Wrap mutation methods with auto-sync
const withAutoSync = <T>(effect: Effect.Effect<T>): Effect.Effect<T> =>
  Effect.gen(function* () {
    const result = yield* effect
    
    const sync = yield* SyncService
    const autoEnabled = yield* sync.isAutoSyncEnabled()
    
    if (autoEnabled) {
      yield* sync.export().pipe(
        Effect.catchAll(e => 
          Console.error(`Auto-sync failed: ${e}`).pipe(Effect.as(undefined))
        )
      )
    }
    
    return result
  })

// Usage:
create: (input) => withAutoSync(createImpl(input))
update: (id, input) => withAutoSync(updateImpl(id, input))
delete: (id) => withAutoSync(deleteImpl(id))
```

## Git Integration

### Recommended .gitignore

```gitignore
# SQLite database (runtime only)
.tx/tasks.db
.tx/tasks.db-wal
.tx/tasks.db-shm

# DO NOT ignore: .tx/tasks.jsonl (this is the sync file)
# DO NOT ignore: .tx/config.json (sync settings)
```

### Git Hooks (Optional)

```bash
# .git/hooks/pre-commit
#!/bin/bash
if [ -f .tx/tasks.db ]; then
  tx sync export
  git add .tx/tasks.jsonl
fi

# .git/hooks/post-merge
#!/bin/bash
if [ -f .tx/tasks.jsonl ]; then
  tx sync import
fi
```

## Conflict Scenarios

### Scenario 1: Same Task Modified on Two Machines

```
Machine A: tx update tx-123 --title "Fix bug (urgent)"  # ts: T1
Machine B: tx update tx-123 --title "Fix critical bug"  # ts: T2 (later)

After git merge:
- JSONL has both lines
- Import uses T2 version (later timestamp wins)
```

### Scenario 2: Task Deleted on One Machine, Updated on Another

```
Machine A: tx delete tx-123  # ts: T1
Machine B: tx update tx-123 --score 900  # ts: T2 (later)

Resolution:
- If T2 > T1: Update wins, task is restored
- If T1 > T2: Delete wins, task stays deleted
```

### Scenario 3: Circular Dependency Created

```
Machine A: tx block tx-123 tx-456  # A blocks B
Machine B: tx block tx-456 tx-123  # B blocks A (creates cycle!)

Resolution:
- Import detects cycle during dep_add
- Rejects the later operation
- Logs warning for user review
```

## Testing Strategy

### Unit Tests
- JSONL parsing/serialization
- Timestamp comparison
- Conflict resolution logic

### Integration Tests
```typescript
describe("SyncService", () => {
  it("round-trips all tasks through JSONL", async () => {
    // Create tasks
    await tx.add("Task 1")
    await tx.add("Task 2")
    await tx.block("tx-1", "tx-2")
    
    // Export
    await tx.sync.export()
    
    // Clear DB
    await clearDatabase()
    
    // Import
    const result = await tx.sync.import()
    expect(result.imported).toBe(3) // 2 tasks + 1 dep
    
    // Verify
    const tasks = await tx.list()
    expect(tasks).toHaveLength(2)
  })
  
  it("handles concurrent modifications with timestamps", async () => {
    // Setup: same task, different timestamps
    const t1 = "2024-01-01T10:00:00Z"
    const t2 = "2024-01-01T11:00:00Z"
    
    const jsonl = [
      `{"v":1,"op":"upsert","id":"tx-123","ts":"${t1}","data":{"title":"Old",...}}`,
      `{"v":1,"op":"upsert","id":"tx-123","ts":"${t2}","data":{"title":"New",...}}`
    ].join("\n")
    
    await writeFile(".tx/tasks.jsonl", jsonl)
    await tx.sync.import()
    
    const task = await tx.show("tx-123")
    expect(task.title).toBe("New") // Later timestamp wins
  })
})
```

## Performance Considerations

1. **Export is O(n)**: Full dump every time (simple, reliable)
2. **Import is O(n log n)**: Sort by timestamp, then linear apply
3. **Compaction reduces JSONL size**: Run periodically for large task sets
4. **Auto-sync adds latency**: ~10-50ms per mutation (file write)

For large task sets (>1000), consider:
- Running compaction weekly
- Disabling auto-sync for batch operations
- Using `tx sync export` explicitly after bulk changes
