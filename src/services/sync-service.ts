import { Context, Effect, Layer, Schema } from "effect"
import { writeFileSync, renameSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseError, ValidationError } from "../errors.js"
import { TaskService } from "./task-service.js"
import { TaskRepository } from "../repo/task-repo.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import type { Task, TaskDependency, TaskId, TaskStatus } from "../schema.js"
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
    readonly import: (path?: string) => Effect.Effect<ImportResult, ValidationError | DatabaseError>

    /**
     * Get current sync status.
     */
    readonly status: () => Effect.Effect<SyncStatus, DatabaseError>
  }
>() {}

const DEFAULT_JSONL_PATH = ".tx/tasks.jsonl"

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
    const taskRepo = yield* TaskRepository
    const depRepo = yield* DependencyRepository

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

          return {
            opCount: allOps.length,
            path: filePath
          }
        }),

      import: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_JSONL_PATH)

          // Check if file exists
          if (!existsSync(filePath)) {
            return { imported: 0, skipped: 0, conflicts: 0 }
          }

          // Read and parse JSONL file
          const content = yield* Effect.try({
            try: () => readFileSync(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const lines = content.trim().split("\n").filter(Boolean)
          if (lines.length === 0) {
            return { imported: 0, skipped: 0, conflicts: 0 }
          }

          // Parse all operations with Schema validation
          const ops: SyncOperation[] = []
          for (const line of lines) {
            const parsed = yield* Effect.try({
              try: () => JSON.parse(line),
              catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            })

            const op = yield* Schema.decodeUnknown(SyncOperationSchema)(parsed).pipe(
              Effect.mapError((cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` }))
            )
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

          let imported = 0
          let skipped = 0
          let conflicts = 0

          // Apply task operations
          for (const [id, { op }] of taskStates) {
            if (op.op === "upsert") {
              const existing = yield* taskRepo.findById(id)

              if (!existing) {
                // Create new task with the specified ID
                const now = new Date()
                const task: Task = {
                  id: id as TaskId,
                  title: op.data.title,
                  description: op.data.description,
                  status: op.data.status as TaskStatus,
                  parentId: op.data.parentId as TaskId | null,
                  score: op.data.score,
                  createdAt: new Date(op.ts),
                  updatedAt: new Date(op.ts),
                  completedAt: op.data.status === "done" ? now : null,
                  metadata: op.data.metadata as Record<string, unknown>
                }
                yield* taskRepo.insert(task)
                imported++
              } else {
                // Update if JSONL timestamp is newer than existing
                const existingTs = existing.updatedAt.toISOString()
                if (op.ts > existingTs) {
                  const updated: Task = {
                    ...existing,
                    title: op.data.title,
                    description: op.data.description,
                    status: op.data.status as TaskStatus,
                    parentId: op.data.parentId as TaskId | null,
                    score: op.data.score,
                    updatedAt: new Date(op.ts),
                    completedAt: op.data.status === "done" ? (existing.completedAt ?? new Date()) : null,
                    metadata: op.data.metadata as Record<string, unknown>
                  }
                  yield* taskRepo.update(updated)
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
              const existing = yield* taskRepo.findById(id)
              if (existing) {
                yield* taskRepo.remove(id)
                imported++
              }
            }
          }

          // Apply dependency operations
          for (const [_key, { op }] of depStates) {
            if (op.op === "dep_add") {
              // Add dependency, ignore if already exists
              yield* depRepo.insert(op.blockerId, op.blockedId).pipe(
                Effect.catchAll(() => Effect.void)
              )
            } else if (op.op === "dep_remove") {
              // Remove dependency, ignore if doesn't exist
              yield* depRepo.remove(op.blockerId, op.blockedId).pipe(
                Effect.catchAll(() => Effect.void)
              )
            }
          }

          return { imported, skipped, conflicts }
        }),

      status: () =>
        Effect.gen(function* () {
          // TODO: Implement in future task
          return yield* Effect.succeed({
            dbTaskCount: 0,
            jsonlOpCount: 0,
            lastExport: null,
            lastImport: null,
            isDirty: false
          })
        })
    }
  })
)
