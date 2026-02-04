import { Context, Effect, Layer, Schema } from "effect"
import { writeFileSync, renameSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseError, TaskNotFoundError, ValidationError } from "../errors.js"
import { SqliteClient } from "../db.js"
import { TaskService } from "./task-service.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import type { Task, TaskDependency } from "@jamesaphoenix/tx-types"
import {
  type TaskUpsertOp,
  type TaskDeleteOp,
  type DepAddOp,
  type DepRemoveOp,
  SyncOperation as SyncOperationSchema,
  type SyncOperation
} from "../schemas/sync.js"

/**
 * Result of an export operation.
 */
export interface ExportResult {
  readonly opCount: number
  readonly path: string
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  readonly imported: number
  readonly skipped: number
  readonly conflicts: number
}

/**
 * Status of the sync system.
 */
export interface SyncStatus {
  readonly dbTaskCount: number
  readonly jsonlOpCount: number
  readonly lastExport: Date | null
  readonly lastImport: Date | null
  readonly isDirty: boolean
  readonly autoSyncEnabled: boolean
}

/**
 * Result of a compact operation.
 */
export interface CompactResult {
  readonly before: number
  readonly after: number
}

/**
 * Options for export operations.
 */
export interface ExportOptions {
  readonly learnings?: boolean
  readonly fileLearnings?: boolean
  readonly attempts?: boolean
}

/**
 * Result of an exportAll operation.
 */
export interface ExportAllResult {
  readonly tasks: ExportResult
  readonly learnings?: ExportResult
  readonly fileLearnings?: ExportResult
  readonly attempts?: ExportResult
}

/**
 * Result of an importAll operation.
 */
export interface ImportAllResult {
  readonly tasks: ImportResult
  readonly learnings?: ImportResult
  readonly fileLearnings?: ImportResult
  readonly attempts?: ImportResult
}

/**
 * SyncService provides JSONL-based export/import for git-tracked task syncing.
 * See DD-009 for full specification.
 */
export class SyncService extends Context.Tag("SyncService")<
  SyncService,
  {
    /**
     * Export all tasks and dependencies to JSONL file.
     * @param path Optional path (default: .tx/tasks.jsonl)
     */
    readonly export: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import tasks and dependencies from JSONL file.
     * Uses timestamp-based conflict resolution (later wins).
     * @param path Optional path (default: .tx/tasks.jsonl)
     */
    readonly import: (path?: string) => Effect.Effect<ImportResult, ValidationError | DatabaseError | TaskNotFoundError>

    /**
     * Get current sync status.
     */
    readonly status: () => Effect.Effect<SyncStatus, DatabaseError>

    /**
     * Enable auto-sync mode.
     */
    readonly enableAutoSync: () => Effect.Effect<void, DatabaseError>

    /**
     * Disable auto-sync mode.
     */
    readonly disableAutoSync: () => Effect.Effect<void, DatabaseError>

    /**
     * Check if auto-sync is enabled.
     */
    readonly isAutoSyncEnabled: () => Effect.Effect<boolean, DatabaseError>

    /**
     * Compact the JSONL file by deduplicating operations.
     */
    readonly compact: (path?: string) => Effect.Effect<CompactResult, DatabaseError | ValidationError>

    /**
     * Set last export timestamp in config.
     */
    readonly setLastExport: (timestamp: Date) => Effect.Effect<void, DatabaseError>

    /**
     * Set last import timestamp in config.
     */
    readonly setLastImport: (timestamp: Date) => Effect.Effect<void, DatabaseError>
  }
>() {}

const DEFAULT_JSONL_PATH = ".tx/tasks.jsonl"

/**
 * Topologically sort task operations so parents are processed before children.
 * This ensures foreign key constraints are satisfied during import.
 *
 * Uses Kahn's algorithm:
 * 1. Find all tasks with no parent (or parent not in import set) - these have no deps
 * 2. Process them and mark as "done"
 * 3. For remaining tasks, if their parent is "done", add them to the queue
 * 4. Repeat until all tasks are processed
 *
 * @param entries Array of [taskId, { op, ts }] entries from taskStates Map
 * @returns Sorted array with parents before children
 */
function topologicalSortTasks<T extends { op: { op: string; data?: { parentId?: string | null } } }>(
  entries: Array<[string, T]>
): Array<[string, T]> {
  // Separate upserts from deletes - deletes don't have parent dependencies
  const upsertEntries = entries.filter(([, { op }]) => op.op === "upsert")
  const deleteEntries = entries.filter(([, { op }]) => op.op === "delete")

  // Build set of task IDs being imported
  const importingIds = new Set(upsertEntries.map(([id]) => id))

  // Build parent→children adjacency list
  const children = new Map<string, string[]>()
  for (const [id] of upsertEntries) {
    children.set(id, [])
  }
  for (const [id, { op }] of upsertEntries) {
    const parentId = (op as { data?: { parentId?: string | null } }).data?.parentId
    if (parentId && importingIds.has(parentId)) {
      const parentChildren = children.get(parentId)
      if (parentChildren) {
        parentChildren.push(id)
      }
    }
  }

  // Calculate in-degree (number of parents in import set)
  const inDegree = new Map<string, number>()
  for (const [id, { op }] of upsertEntries) {
    const parentId = (op as { data?: { parentId?: string | null } }).data?.parentId
    // Only count parent as dependency if it's in the import set
    const hasParentInSet = parentId && importingIds.has(parentId)
    inDegree.set(id, hasParentInSet ? 1 : 0)
  }

  // Queue starts with tasks that have no parent in import set (in-degree 0)
  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id)
    }
  }

  // Build sorted result
  const sorted: Array<[string, T]> = []
  const entryMap = new Map(upsertEntries)

  while (queue.length > 0) {
    const id = queue.shift()!
    const entry = entryMap.get(id)
    if (entry) {
      sorted.push([id, entry])
    }

    // Decrement in-degree of children and add to queue if now 0
    const childIds = children.get(id) ?? []
    for (const childId of childIds) {
      const currentDegree = inDegree.get(childId) ?? 0
      const newDegree = currentDegree - 1
      inDegree.set(childId, newDegree)
      if (newDegree === 0) {
        queue.push(childId)
      }
    }
  }

  // If we didn't process all tasks, there's a cycle - fall back to original order
  // (This shouldn't happen with valid data since parent-child can't be circular)
  if (sorted.length < upsertEntries.length) {
    // Return original upsert entries followed by deletes
    return [...upsertEntries, ...deleteEntries]
  }

  // Return sorted upserts followed by deletes
  return [...sorted, ...deleteEntries]
}

/**
 * Convert a Task to a TaskUpsertOp for JSONL export.
 */
const taskToUpsertOp = (task: Task): TaskUpsertOp => ({
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

/**
 * Convert a TaskDependency to a DepAddOp for JSONL export.
 */
const depToAddOp = (dep: TaskDependency): DepAddOp => ({
  v: 1,
  op: "dep_add",
  ts: dep.createdAt.toISOString(),
  blockerId: dep.blockerId,
  blockedId: dep.blockedId
})

/**
 * Write content to file atomically using temp file + rename.
 */
const atomicWrite = (filePath: string, content: string): void => {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const tempPath = `${filePath}.tmp.${Date.now()}`
  writeFileSync(tempPath, content, "utf-8")
  renameSync(tempPath, filePath)
}

export const SyncServiceLive = Layer.effect(
  SyncService,
  Effect.gen(function* () {
    const taskService = yield* TaskService
    const depRepo = yield* DependencyRepository
    const db = yield* SqliteClient

    // Helper: Get config value from sync_config table
    const getConfig = (key: string): Effect.Effect<string | null, DatabaseError> =>
      Effect.try({
        try: () => {
          const row = db.prepare("SELECT value FROM sync_config WHERE key = ?").get(key) as { value: string } | undefined
          return row?.value ?? null
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    // Helper: Set config value in sync_config table
    const setConfig = (key: string, value: string): Effect.Effect<void, DatabaseError> =>
      Effect.try({
        try: () => {
          db.prepare(
            "INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
          ).run(key, value)
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    return {
      export: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_JSONL_PATH)

          // Get all tasks and dependencies
          const tasks = yield* taskService.list()
          const deps = yield* depRepo.getAll()

          // Convert to sync operations
          const taskOps: SyncOperation[] = tasks.map(taskToUpsertOp)
          const depOps: SyncOperation[] = deps.map(depToAddOp)

          // Combine and sort by timestamp
          const allOps = [...taskOps, ...depOps].sort((a, b) =>
            a.ts.localeCompare(b.ts)
          )

          // Convert to JSONL format (one JSON object per line)
          const jsonl = allOps.map(op => JSON.stringify(op)).join("\n")

          // Write atomically
          yield* Effect.try({
            try: () => atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : "")),
            catch: (cause) => new DatabaseError({ cause })
          })

          // Record export time
          yield* setConfig("last_export", new Date().toISOString())

          return {
            opCount: allOps.length,
            path: filePath
          }
        }),

      import: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_JSONL_PATH)

          // Check if file exists (outside transaction - no DB access)
          if (!existsSync(filePath)) {
            return { imported: 0, skipped: 0, conflicts: 0 }
          }

          // Read and parse JSONL file (outside transaction - no DB access)
          const content = yield* Effect.try({
            try: () => readFileSync(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const lines = content.trim().split("\n").filter(Boolean)
          if (lines.length === 0) {
            return { imported: 0, skipped: 0, conflicts: 0 }
          }

          // Parse all operations with Schema validation (outside transaction - no DB access)
          const ops: SyncOperation[] = []
          for (const line of lines) {
            const parsed = yield* Effect.try({
              try: () => JSON.parse(line),
              catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            })

            const op: SyncOperation = yield* Effect.try({
              try: () => Schema.decodeUnknownSync(SyncOperationSchema)(parsed),
              catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
            })
            ops.push(op)
          }

          // Group by entity and find latest state per entity (timestamp wins)
          const taskStates = new Map<string, { op: TaskUpsertOp | TaskDeleteOp; ts: string }>()
          const depStates = new Map<string, { op: DepAddOp | DepRemoveOp; ts: string }>()

          for (const op of ops) {
            if (op.op === "upsert" || op.op === "delete") {
              const existing = taskStates.get(op.id)
              if (!existing || op.ts > existing.ts) {
                taskStates.set(op.id, { op: op as TaskUpsertOp | TaskDeleteOp, ts: op.ts })
              }
            } else if (op.op === "dep_add" || op.op === "dep_remove") {
              const key = `${op.blockerId}:${op.blockedId}`
              const existing = depStates.get(key)
              if (!existing || op.ts > existing.ts) {
                depStates.set(key, { op: op as DepAddOp | DepRemoveOp, ts: op.ts })
              }
            }
          }

          // Apply task operations in topological order (parents before children)
          // This ensures foreign key constraints are satisfied when importing
          // tasks where child timestamp < parent timestamp
          const sortedTaskEntries = topologicalSortTasks([...taskStates.entries()])

          // ALL database operations inside a single transaction for atomicity
          // If any operation fails, the entire import is rolled back
          return yield* Effect.try({
            try: () => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let imported = 0
                let skipped = 0
                let conflicts = 0

                // Prepare statements for efficiency
                const findTaskStmt = db.prepare("SELECT * FROM tasks WHERE id = ?")
                const insertTaskStmt = db.prepare(
                  `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                const updateTaskStmt = db.prepare(
                  `UPDATE tasks SET title = ?, description = ?, status = ?, parent_id = ?,
                   score = ?, updated_at = ?, completed_at = ?, metadata = ? WHERE id = ?`
                )
                const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = ?")
                const insertDepStmt = db.prepare(
                  "INSERT OR IGNORE INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
                )
                const deleteDepStmt = db.prepare(
                  "DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?"
                )
                const setConfigStmt = db.prepare(
                  "INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
                )

                // Apply task operations
                for (const [id, { op }] of sortedTaskEntries) {
                  if (op.op === "upsert") {
                    const existingRow = findTaskStmt.get(id) as { updated_at: string; completed_at: string | null } | undefined

                    if (!existingRow) {
                      // Create new task with the specified ID
                      const now = new Date()
                      insertTaskStmt.run(
                        id,
                        op.data.title,
                        op.data.description,
                        op.data.status,
                        op.data.parentId,
                        op.data.score,
                        op.ts,
                        op.ts,
                        op.data.status === "done" ? now.toISOString() : null,
                        JSON.stringify(op.data.metadata)
                      )
                      imported++
                    } else {
                      // Update if JSONL timestamp is newer than existing
                      const existingTs = existingRow.updated_at
                      if (op.ts > existingTs) {
                        updateTaskStmt.run(
                          op.data.title,
                          op.data.description,
                          op.data.status,
                          op.data.parentId,
                          op.data.score,
                          op.ts,
                          op.data.status === "done" ? (existingRow.completed_at ?? new Date().toISOString()) : null,
                          JSON.stringify(op.data.metadata),
                          id
                        )
                        imported++
                      } else if (op.ts === existingTs) {
                        // Same timestamp - skip
                        skipped++
                      } else {
                        // Local is newer - conflict
                        conflicts++
                      }
                    }
                  } else if (op.op === "delete") {
                    const existingRow = findTaskStmt.get(id) as { updated_at: string } | undefined
                    if (existingRow) {
                      // Check timestamp - only delete if delete operation is newer
                      // Per DD-009 Scenario 2: delete wins if its timestamp > local update timestamp
                      const existingTs = existingRow.updated_at
                      if (op.ts > existingTs) {
                        deleteTaskStmt.run(id)
                        imported++
                      } else if (op.ts === existingTs) {
                        // Same timestamp - skip (ambiguous state, but safe to keep local)
                        skipped++
                      } else {
                        // Local is newer - conflict (local update wins over older delete)
                        conflicts++
                      }
                    }
                  }
                }

                // Apply dependency operations
                for (const { op } of depStates.values()) {
                  if (op.op === "dep_add") {
                    // Add dependency, ignore if already exists (INSERT OR IGNORE)
                    insertDepStmt.run(op.blockerId, op.blockedId, op.ts)
                  } else if (op.op === "dep_remove") {
                    // Remove dependency, ignore if doesn't exist
                    deleteDepStmt.run(op.blockerId, op.blockedId)
                  }
                }

                // Record import time
                setConfigStmt.run("last_import", new Date().toISOString())

                db.exec("COMMIT")
                return { imported, skipped, conflicts }
              } catch (e) {
                db.exec("ROLLBACK")
                throw e
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })
        }),

      status: () =>
        Effect.gen(function* () {
          const filePath = resolve(DEFAULT_JSONL_PATH)

          // Count tasks in database
          const tasks = yield* taskService.list()
          const dbTaskCount = tasks.length

          // Get all dependencies from database
          const deps = yield* depRepo.getAll()
          const dbDepCount = deps.length

          // Count operations in JSONL file and get file info
          let jsonlOpCount = 0
          let jsonlTaskCount = 0
          let jsonlDepCount = 0
          let lastExport: Date | null = null

          if (existsSync(filePath)) {
            // Get file modification time as lastExport
            const stats = yield* Effect.try({
              try: () => statSync(filePath),
              catch: (cause) => new DatabaseError({ cause })
            })
            lastExport = stats.mtime

            // Count non-empty lines (each line is one operation)
            const content = yield* Effect.try({
              try: () => readFileSync(filePath, "utf-8"),
              catch: (cause) => new DatabaseError({ cause })
            })
            const lines = content.trim().split("\n").filter(Boolean)
            jsonlOpCount = lines.length

            // Parse JSONL to count task upserts and dep_adds separately
            // This allows detecting deletions (DB count < JSONL count)
            for (const line of lines) {
              try {
                const op = JSON.parse(line) as { op: string }
                if (op.op === "upsert") {
                  jsonlTaskCount++
                } else if (op.op === "dep_add") {
                  jsonlDepCount++
                }
                // Note: delete and dep_remove ops are not counted since
                // a clean export only produces upserts and dep_adds
              } catch {
                // Skip malformed lines for counting purposes
              }
            }
          }

          // Get last export/import timestamps from config
          const lastExportConfig = yield* getConfig("last_export")
          const lastImportConfig = yield* getConfig("last_import")
          const lastExportDate = lastExportConfig && lastExportConfig !== "" ? new Date(lastExportConfig) : lastExport
          const lastImportDate = lastImportConfig && lastImportConfig !== "" ? new Date(lastImportConfig) : null

          // Get auto-sync status
          const autoSyncConfig = yield* getConfig("auto_sync")
          const autoSyncEnabled = autoSyncConfig === "true"

          // Determine if dirty: DB has changes not in JSONL
          // Per DD-009: dirty if tasks exist AND (no lastExport OR any task/dep updated after lastExport)
          // Additionally: dirty if counts differ (indicates deletions/removals)
          let isDirty = false
          if (dbTaskCount > 0 && !existsSync(filePath)) {
            // No JSONL file but tasks exist → dirty
            isDirty = true
          } else if (tasks.length > 0 || deps.length > 0) {
            if (lastExportDate === null) {
              // Tasks/deps exist but never exported → dirty
              isDirty = true
            } else {
              // Check if any task was updated after the last export
              const tasksDirty = tasks.some(task => task.updatedAt > lastExportDate)
              // Check if any dependency was created after the last export
              const depsDirty = deps.some(dep => dep.createdAt > lastExportDate)
              // Check if counts differ (indicates deletions occurred since export)
              // DB count < JSONL count means tasks/deps were deleted
              // DB count > JSONL count means tasks/deps were added (also caught by timestamp check)
              const taskCountMismatch = dbTaskCount !== jsonlTaskCount
              const depCountMismatch = dbDepCount !== jsonlDepCount
              isDirty = tasksDirty || depsDirty || taskCountMismatch || depCountMismatch
            }
          }

          return {
            dbTaskCount,
            jsonlOpCount,
            lastExport: lastExportDate,
            lastImport: lastImportDate,
            isDirty,
            autoSyncEnabled
          }
        }),

      enableAutoSync: () => setConfig("auto_sync", "true"),

      disableAutoSync: () => setConfig("auto_sync", "false"),

      isAutoSyncEnabled: () =>
        Effect.gen(function* () {
          const value = yield* getConfig("auto_sync")
          return value === "true"
        }),

      compact: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_JSONL_PATH)

          // Check if file exists
          if (!existsSync(filePath)) {
            return { before: 0, after: 0 }
          }

          // Read and parse JSONL file
          const content = yield* Effect.try({
            try: () => readFileSync(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const lines = content.trim().split("\n").filter(Boolean)
          if (lines.length === 0) {
            return { before: 0, after: 0 }
          }

          const before = lines.length

          // Parse and deduplicate - keep only latest state per entity
          const taskStates = new Map<string, SyncOperation>()
          const depStates = new Map<string, SyncOperation>()

          for (const line of lines) {
            const parsed = yield* Effect.try({
              try: () => JSON.parse(line),
              catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            })

            const op: SyncOperation = yield* Effect.try({
              try: () => Schema.decodeUnknownSync(SyncOperationSchema)(parsed),
              catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
            })

            if (op.op === "upsert" || op.op === "delete") {
              const taskOp = op as TaskUpsertOp | TaskDeleteOp
              const existing = taskStates.get(taskOp.id)
              if (!existing || taskOp.ts > (existing as { ts: string }).ts) {
                taskStates.set(taskOp.id, op)
              }
            } else if (op.op === "dep_add" || op.op === "dep_remove") {
              const depOp = op as DepAddOp | DepRemoveOp
              const key = `${depOp.blockerId}:${depOp.blockedId}`
              const existing = depStates.get(key)
              if (!existing || depOp.ts > (existing as { ts: string }).ts) {
                depStates.set(key, op)
              }
            }
          }

          // Rebuild compacted JSONL, excluding deleted tasks and removed deps
          const compacted: SyncOperation[] = []

          for (const op of taskStates.values()) {
            // Only keep upserts, skip deletes (tombstones)
            if (op.op === "upsert") {
              compacted.push(op)
            }
          }

          for (const op of depStates.values()) {
            // Only keep dep_adds, skip dep_removes
            if (op.op === "dep_add") {
              compacted.push(op)
            }
          }

          // Sort by timestamp for deterministic output
          compacted.sort((a, b) => a.ts.localeCompare(b.ts))

          // Write compacted JSONL atomically
          const newContent = compacted.map(op => JSON.stringify(op)).join("\n")
          yield* Effect.try({
            try: () => atomicWrite(filePath, newContent + (newContent.length > 0 ? "\n" : "")),
            catch: (cause) => new DatabaseError({ cause })
          })

          return { before, after: compacted.length }
        }),

      setLastExport: (timestamp: Date) => setConfig("last_export", timestamp.toISOString()),

      setLastImport: (timestamp: Date) => setConfig("last_import", timestamp.toISOString())
    }
  })
)
