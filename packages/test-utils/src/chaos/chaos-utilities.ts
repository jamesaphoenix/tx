/**
 * Chaos Engineering Utilities Implementation
 *
 * Provides controlled failure injection for testing tx resilience.
 *
 * @module @tx/test-utils/chaos/chaos-utilities
 */

import type { TestDatabase } from "../database/index.js"
import { fixtureId } from "../fixtures/index.js"

// =============================================================================
// crashAfter - Simulate process death mid-operation
// =============================================================================

/**
 * Options for crashAfter utility.
 */
export interface CrashAfterOptions {
  /** Milliseconds before "crash" occurs */
  ms: number
  /** Optional callback to execute before crash */
  beforeCrash?: () => void | Promise<void>
  /** If true, throws instead of returning (default: false) */
  throwOnCrash?: boolean
}

/**
 * Result of crashAfter operation.
 */
export interface CrashAfterResult {
  /** Whether the operation completed before the crash timeout */
  completed: boolean
  /** Time elapsed in milliseconds */
  elapsedMs: number
  /** Error if throwOnCrash was true and crash occurred */
  error?: Error
}

/**
 * Simulate process death mid-operation.
 *
 * Wraps an async operation and "crashes" after specified time.
 * Useful for testing transaction rollback and partial state handling.
 *
 * @example
 * ```typescript
 * // Test that a transaction rolls back on crash
 * const result = await crashAfter({ ms: 100 }, async () => {
 *   await startLongOperation()
 *   await sleep(200) // This won't complete
 * })
 * expect(result.completed).toBe(false)
 * ```
 */
export const crashAfter = async <T>(
  options: CrashAfterOptions,
  operation: () => Promise<T>
): Promise<CrashAfterResult & { value?: T }> => {
  const startTime = Date.now()
  let completed = false
  let value: T | undefined
  let error: Error | undefined

  const crashPromise = sleep(options.ms).then(async () => {
    if (!completed) {
      if (options.beforeCrash) {
        await options.beforeCrash()
      }
      if (options.throwOnCrash) {
        error = new CrashSimulationError(options.ms)
      }
    }
  })

  const operationPromise = (async () => {
    try {
      value = await operation()
      completed = true
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
    }
  })()

  await Promise.race([crashPromise, operationPromise])

  const elapsedMs = Date.now() - startTime

  if (options.throwOnCrash && error) {
    throw error
  }

  return {
    completed,
    elapsedMs,
    value,
    error
  }
}

/**
 * Custom error type for crash simulation.
 */
export class CrashSimulationError extends Error {
  readonly name = "CrashSimulationError"
  readonly crashAfterMs: number

  constructor(ms: number) {
    super(`Simulated crash after ${ms}ms`)
    this.crashAfterMs = ms
  }
}

// =============================================================================
// killHeartbeat - Stop heartbeats to trigger dead worker detection
// =============================================================================

/**
 * Options for killHeartbeat utility.
 */
export interface KillHeartbeatOptions {
  /** The worker ID to kill heartbeat for */
  workerId: string
  /** Test database instance */
  db: TestDatabase
}

/**
 * Controller for managing worker heartbeat state.
 * Allows simulating heartbeat failure and restoration.
 */
export class WorkerHeartbeatController {
  private readonly workerId: string
  private readonly db: TestDatabase
  private originalHeartbeat: Date | null = null
  private killed = false

  constructor(options: KillHeartbeatOptions) {
    this.workerId = options.workerId
    this.db = options.db
  }

  /**
   * Stop the heartbeat by setting last_heartbeat_at to a past time.
   * This will trigger dead worker detection.
   *
   * @param minutesInPast How many minutes in the past to set the heartbeat (default: 60)
   */
  kill(minutesInPast = 60): void {
    if (this.killed) return

    // Store original value for restore
    const worker = this.db.query<{ last_heartbeat_at: string }>(
      "SELECT last_heartbeat_at FROM workers WHERE id = ?",
      [this.workerId]
    )[0]

    if (worker) {
      this.originalHeartbeat = new Date(worker.last_heartbeat_at)
    }

    // Set heartbeat to past time
    const pastTime = new Date(Date.now() - minutesInPast * 60 * 1000)
    this.db.run(
      "UPDATE workers SET last_heartbeat_at = ? WHERE id = ?",
      [pastTime.toISOString(), this.workerId]
    )

    this.killed = true
  }

  /**
   * Restore the original heartbeat timestamp.
   */
  restore(): void {
    if (!this.killed || !this.originalHeartbeat) return

    this.db.run(
      "UPDATE workers SET last_heartbeat_at = ? WHERE id = ?",
      [this.originalHeartbeat.toISOString(), this.workerId]
    )

    this.killed = false
  }

  /**
   * Update heartbeat to current time (simulate alive worker).
   */
  revive(): void {
    this.db.run(
      "UPDATE workers SET last_heartbeat_at = ? WHERE id = ?",
      [new Date().toISOString(), this.workerId]
    )
    this.killed = false
  }

  /**
   * Check if heartbeat is currently killed.
   */
  isKilled(): boolean {
    return this.killed
  }
}

/**
 * Kill a worker's heartbeat to trigger dead worker detection.
 *
 * @example
 * ```typescript
 * const controller = killHeartbeat({ workerId: 'worker-123', db: testDb })
 * controller.kill(30) // Set heartbeat to 30 minutes ago
 *
 * // Worker should now be detected as dead
 * const deadWorkers = await findDeadWorkers()
 * expect(deadWorkers).toContain('worker-123')
 *
 * controller.restore() // Restore original heartbeat
 * ```
 */
export const killHeartbeat = (options: KillHeartbeatOptions): WorkerHeartbeatController => {
  return new WorkerHeartbeatController(options)
}

// =============================================================================
// raceWorkers - Spawn n workers claiming same task
// =============================================================================

/**
 * Options for raceWorkers utility.
 */
export interface RaceWorkersOptions {
  /** Number of workers to spawn */
  count: number
  /** Task ID to claim */
  taskId: string
  /** Test database instance */
  db: TestDatabase
  /** Optional delay between worker attempts (ms) */
  delayBetweenMs?: number
  /** Optional lease duration in minutes */
  leaseDurationMinutes?: number
}

/**
 * Result of raceWorkers operation.
 */
export interface RaceWorkersResult {
  /** Worker ID that won the race (or null if none) */
  winner: string | null
  /** All worker IDs that participated */
  workers: string[]
  /** Workers that failed to claim */
  losers: string[]
  /** Number of successful claims (should be 1 or 0) */
  successfulClaims: number
  /** Any errors that occurred */
  errors: Array<{ workerId: string; error: string }>
}

/**
 * Spawn n workers that all attempt to claim the same task.
 * Tests claim atomicity and race condition handling.
 *
 * @example
 * ```typescript
 * const result = await raceWorkers({
 *   count: 5,
 *   taskId: 'tx-abc123',
 *   db: testDb
 * })
 *
 * expect(result.successfulClaims).toBe(1) // Only one winner
 * expect(result.losers.length).toBe(4)
 * ```
 */
export const raceWorkers = async (
  options: RaceWorkersOptions
): Promise<RaceWorkersResult> => {
  const { count, taskId, db, delayBetweenMs = 0, leaseDurationMinutes = 30 } = options

  const workers: string[] = []
  const losers: string[] = []
  const errors: Array<{ workerId: string; error: string }> = []
  let winner: string | null = null
  let successfulClaims = 0

  // Create worker IDs
  for (let i = 0; i < count; i++) {
    workers.push(fixtureId(`race-worker-${i}`))
  }

  // Register all workers first
  const now = new Date()
  for (const workerId of workers) {
    db.run(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [workerId, `Worker ${workerId}`, "test-host", process.pid, "idle", now.toISOString(), now.toISOString(), "[]", "{}"]
    )
  }

  // Race to claim using atomic INSERT ... WHERE NOT EXISTS
  // This matches the production ClaimService.claim implementation
  const claimPromises = workers.map(async (workerId, index) => {
    if (delayBetweenMs > 0 && index > 0) {
      await sleep(delayBetweenMs * index)
    }

    try {
      // Use atomic INSERT ... WHERE NOT EXISTS to prevent race conditions
      // This is the same pattern used in ClaimRepository.tryInsertAtomic
      const leaseExpiresAt = new Date(Date.now() + leaseDurationMinutes * 60 * 1000)
      const result = db.run(
        `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM task_claims
           WHERE task_id = ? AND status = 'active'
         )`,
        [taskId, workerId, now.toISOString(), leaseExpiresAt.toISOString(), 0, "active", taskId]
      )

      if (result.changes > 0) {
        // We won the race
        if (winner === null) {
          winner = workerId
          successfulClaims++
        } else {
          // This should never happen with atomic inserts
          errors.push({ workerId, error: "Duplicate successful claim - atomic insert failed!" })
        }
      } else {
        // Another worker already claimed
        losers.push(workerId)
      }
    } catch (e) {
      losers.push(workerId)
      errors.push({ workerId, error: e instanceof Error ? e.message : String(e) })
    }
  })

  await Promise.all(claimPromises)

  return {
    winner,
    workers,
    losers,
    successfulClaims,
    errors
  }
}

// =============================================================================
// corruptState - Inject invalid data
// =============================================================================

/**
 * Types of corruption that can be injected.
 */
export type CorruptionType =
  | "null_required_field"
  | "invalid_status"
  | "invalid_json"
  | "truncated_string"
  | "future_timestamp"
  | "negative_score"
  | "orphaned_dependency"
  | "self_reference"

/**
 * Options for corruptState utility.
 */
export interface CorruptStateOptions {
  /** Table to corrupt */
  table: "tasks" | "task_claims" | "task_dependencies" | "workers" | "learnings"
  /** Type of corruption to inject */
  type: CorruptionType
  /** Test database instance */
  db: TestDatabase
  /** Specific row ID to corrupt (optional - will create new row if not provided) */
  rowId?: string
  /** Field to corrupt (for specific field corruption) */
  field?: string
}

/**
 * Inject invalid data into the database for testing validation and recovery.
 *
 * @example
 * ```typescript
 * // Inject an invalid status
 * const result = corruptState({
 *   table: 'tasks',
 *   type: 'invalid_status',
 *   db: testDb,
 *   rowId: 'tx-abc123'
 * })
 *
 * // Test that validation catches it
 * await expect(taskService.get('tx-abc123')).rejects.toThrow()
 * ```
 */
export const corruptState = (options: CorruptStateOptions): { rowId: string; corrupted: boolean } => {
  const { table, type, db, rowId, field } = options

  let targetId = rowId ?? fixtureId(`corrupted-${table}-${type}`)
  let corrupted = false

  switch (type) {
    case "null_required_field":
      if (table === "tasks") {
        if (rowId) {
          db.run(`UPDATE tasks SET title = NULL WHERE id = ?`, [rowId])
        } else {
          // Insert with null title (bypassing constraint)
          db.exec(`PRAGMA foreign_keys = OFF`)
          db.run(
            `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
             VALUES (?, NULL, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')`,
            [targetId]
          )
          db.exec(`PRAGMA foreign_keys = ON`)
        }
        corrupted = true
      }
      break

    case "invalid_status":
      if (table === "tasks") {
        // Use PRAGMA ignore_check_constraints to bypass CHECK constraint on status
        // The pragma is connection-level so it applies to parameterized queries too
        db.exec(`PRAGMA foreign_keys = OFF`)
        db.exec(`PRAGMA ignore_check_constraints = ON`)
        if (rowId) {
          // Get existing row data
          const existing = db.query<{
            title: string
            description: string
            score: number
            parent_id: string | null
            created_at: string
            updated_at: string
            completed_at: string | null
            metadata: string
          }>("SELECT * FROM tasks WHERE id = ?", [rowId])[0]
          if (existing) {
            db.run(`DELETE FROM tasks WHERE id = ?`, [rowId])
            db.run(
              `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
               VALUES (?, ?, ?, 'INVALID_STATUS', ?, ?, ?, datetime('now'), ?, ?)`,
              [rowId, existing.title, existing.description, existing.score, existing.parent_id, existing.created_at, existing.completed_at, existing.metadata]
            )
          }
        } else {
          db.run(
            `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
             VALUES (?, 'Corrupted Task', '', 'INVALID_STATUS', 0, datetime('now'), datetime('now'), '{}')`,
            [targetId]
          )
        }
        db.exec(`PRAGMA ignore_check_constraints = OFF`)
        db.exec(`PRAGMA foreign_keys = ON`)
        corrupted = true
      }
      break

    case "invalid_json":
      if (table === "tasks") {
        if (rowId) {
          db.run(`UPDATE tasks SET metadata = 'not valid json {' WHERE id = ?`, [rowId])
        } else {
          db.run(
            `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
             VALUES (?, 'Task with bad JSON', '', 'backlog', 0, datetime('now'), datetime('now'), 'not valid json {')`,
            [targetId]
          )
        }
        corrupted = true
      }
      break

    case "truncated_string":
      if (table === "tasks" && field === "title") {
        const truncated = "A" // Single character truncated title
        if (rowId) {
          db.run(`UPDATE tasks SET title = ? WHERE id = ?`, [truncated, rowId])
        }
        corrupted = true
      }
      break

    case "future_timestamp":
      if (table === "tasks") {
        const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year in future
        if (rowId) {
          db.run(`UPDATE tasks SET created_at = ? WHERE id = ?`, [futureDate, rowId])
        } else {
          db.run(
            `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
             VALUES (?, 'Future Task', '', 'backlog', 0, ?, ?, '{}')`,
            [targetId, futureDate, futureDate]
          )
        }
        corrupted = true
      }
      break

    case "negative_score":
      if (table === "tasks") {
        if (rowId) {
          db.run(`UPDATE tasks SET score = -1000 WHERE id = ?`, [rowId])
        } else {
          db.run(
            `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
             VALUES (?, 'Negative Score Task', '', 'backlog', -1000, datetime('now'), datetime('now'), '{}')`,
            [targetId]
          )
        }
        corrupted = true
      }
      break

    case "orphaned_dependency":
      if (table === "task_dependencies") {
        const nonExistentId = fixtureId("non-existent-task")
        db.exec(`PRAGMA foreign_keys = OFF`)
        db.run(
          `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at)
           VALUES (?, ?, datetime('now'))`,
          [nonExistentId, targetId]
        )
        db.exec(`PRAGMA foreign_keys = ON`)
        corrupted = true
      }
      break

    case "self_reference":
      if (table === "tasks") {
        if (rowId) {
          db.exec(`PRAGMA foreign_keys = OFF`)
          db.run(`UPDATE tasks SET parent_id = ? WHERE id = ?`, [rowId, rowId])
          db.exec(`PRAGMA foreign_keys = ON`)
        } else {
          db.exec(`PRAGMA foreign_keys = OFF`)
          db.run(
            `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, metadata)
             VALUES (?, 'Self-referencing Task', '', 'backlog', 0, ?, datetime('now'), datetime('now'), '{}')`,
            [targetId, targetId]
          )
          db.exec(`PRAGMA foreign_keys = ON`)
        }
        corrupted = true
      }
      break
  }

  return { rowId: targetId, corrupted }
}

// =============================================================================
// replayJSONL - Deterministic replay of sync logs
// =============================================================================

/**
 * Options for replayJSONL utility.
 */
export interface ReplayJSONLOptions {
  /** Test database instance */
  db: TestDatabase
  /** JSONL content to replay (string or array of operations) */
  content: string | readonly SyncOperation[]
  /** If true, clear existing data before replay (default: false) */
  clearFirst?: boolean
  /** Optional timestamp to use as "now" for conflict resolution */
  asOfTimestamp?: Date
}

/**
 * Sync operation structure (matches tx sync format).
 */
export interface SyncOperation {
  v: number
  op: "upsert" | "delete" | "dep_add" | "dep_remove"
  ts: string
  id?: string
  blockerId?: string
  blockedId?: string
  data?: {
    title?: string
    description?: string
    status?: string
    score?: number
    parentId?: string | null
    metadata?: Record<string, unknown>
  }
}

/**
 * Result of replayJSONL operation.
 */
export interface ReplayJSONLResult {
  /** Number of operations replayed */
  opsReplayed: number
  /** Number of tasks created */
  tasksCreated: number
  /** Number of tasks updated */
  tasksUpdated: number
  /** Number of tasks deleted */
  tasksDeleted: number
  /** Number of dependencies added */
  depsAdded: number
  /** Number of dependencies removed */
  depsRemoved: number
  /** Any errors encountered */
  errors: string[]
}

/**
 * Deterministically replay a JSONL sync log against the database.
 * Useful for testing sync conflict resolution and data migration.
 *
 * @example
 * ```typescript
 * const jsonl = `
 *   {"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"tx-abc123","data":{"title":"Task 1","status":"backlog","score":500}}
 *   {"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"tx-abc123","data":{"title":"Task 1 Updated","status":"active","score":600}}
 * `
 *
 * const result = await replayJSONL({ db: testDb, content: jsonl })
 * expect(result.tasksUpdated).toBe(1)
 * ```
 */
export const replayJSONL = (options: ReplayJSONLOptions): ReplayJSONLResult => {
  const { db, content, clearFirst = false } = options

  const result: ReplayJSONLResult = {
    opsReplayed: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    tasksDeleted: 0,
    depsAdded: 0,
    depsRemoved: 0,
    errors: []
  }

  // Clear if requested
  if (clearFirst) {
    db.exec("DELETE FROM task_dependencies")
    db.exec("DELETE FROM tasks")
  }

  // Parse operations
  let ops: SyncOperation[]
  if (typeof content === "string") {
    const lines = content.trim().split("\n").filter(Boolean)
    ops = lines.map((line, idx) => {
      try {
        return JSON.parse(line) as SyncOperation
      } catch {
        result.errors.push(`Line ${idx + 1}: Invalid JSON`)
        return null
      }
    }).filter((op): op is SyncOperation => op !== null)
  } else {
    ops = [...content]
  }

  // Sort by timestamp for deterministic replay
  ops.sort((a, b) => a.ts.localeCompare(b.ts))

  // Replay each operation
  for (const op of ops) {
    try {
      switch (op.op) {
        case "upsert":
          if (op.id && op.data) {
            const existing = db.query<{ id: string }>(
              "SELECT id FROM tasks WHERE id = ?",
              [op.id]
            )[0]

            if (existing) {
              db.run(
                `UPDATE tasks SET title = ?, description = ?, status = ?, score = ?, parent_id = ?, updated_at = ?, metadata = ? WHERE id = ?`,
                [
                  op.data.title ?? "",
                  op.data.description ?? "",
                  op.data.status ?? "backlog",
                  op.data.score ?? 0,
                  op.data.parentId ?? null,
                  op.ts,
                  JSON.stringify(op.data.metadata ?? {}),
                  op.id
                ]
              )
              result.tasksUpdated++
            } else {
              db.run(
                `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  op.id,
                  op.data.title ?? "",
                  op.data.description ?? "",
                  op.data.status ?? "backlog",
                  op.data.score ?? 0,
                  op.data.parentId ?? null,
                  op.ts,
                  op.ts,
                  JSON.stringify(op.data.metadata ?? {})
                ]
              )
              result.tasksCreated++
            }
          }
          break

        case "delete":
          if (op.id) {
            const deleteResult = db.run("DELETE FROM tasks WHERE id = ?", [op.id])
            if (deleteResult.changes > 0) {
              result.tasksDeleted++
            }
          }
          break

        case "dep_add":
          if (op.blockerId && op.blockedId) {
            try {
              db.run(
                `INSERT OR IGNORE INTO task_dependencies (blocker_id, blocked_id, created_at)
                 VALUES (?, ?, ?)`,
                [op.blockerId, op.blockedId, op.ts]
              )
              result.depsAdded++
            } catch {
              // Ignore constraint violations
            }
          }
          break

        case "dep_remove":
          if (op.blockerId && op.blockedId) {
            const removeResult = db.run(
              "DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?",
              [op.blockerId, op.blockedId]
            )
            if (removeResult.changes > 0) {
              result.depsRemoved++
            }
          }
          break
      }

      result.opsReplayed++
    } catch (e) {
      result.errors.push(`Op ${op.op} ${op.id ?? op.blockerId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// =============================================================================
// doubleComplete - Attempt completing already-done task
// =============================================================================

/**
 * Options for doubleComplete utility.
 */
export interface DoubleCompleteOptions {
  /** Task ID to attempt double completion */
  taskId: string
  /** Test database instance */
  db: TestDatabase
  /** Worker ID attempting the completion */
  workerId?: string
}

/**
 * Result of doubleComplete operation.
 */
export interface DoubleCompleteResult {
  /** Whether the first completion succeeded */
  firstCompleted: boolean
  /** Whether the second completion succeeded (should be false) */
  secondCompleted: boolean
  /** Error from second completion attempt */
  secondError?: string
  /** Original status before any completion */
  originalStatus: string
  /** Final status after both attempts */
  finalStatus: string
}

/**
 * Attempt to complete an already-completed task.
 * Tests idempotency and double-completion handling.
 *
 * @example
 * ```typescript
 * const result = await doubleComplete({
 *   taskId: 'tx-abc123',
 *   db: testDb
 * })
 *
 * expect(result.firstCompleted).toBe(true)
 * expect(result.secondCompleted).toBe(false) // Should be idempotent
 * ```
 */
export const doubleComplete = (options: DoubleCompleteOptions): DoubleCompleteResult => {
  const { taskId, db } = options

  // Get original status
  const task = db.query<{ status: string }>(
    "SELECT status FROM tasks WHERE id = ?",
    [taskId]
  )[0]

  if (!task) {
    return {
      firstCompleted: false,
      secondCompleted: false,
      secondError: "Task not found",
      originalStatus: "unknown",
      finalStatus: "unknown"
    }
  }

  const originalStatus = task.status
  let firstCompleted = false
  let secondCompleted = false
  let secondError: string | undefined

  // First completion
  if (task.status !== "done") {
    db.run(
      "UPDATE tasks SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [taskId]
    )
    firstCompleted = true
  } else {
    firstCompleted = true // Already done counts as completed
  }

  // Second completion attempt
  const afterFirst = db.query<{ status: string; completed_at: string | null }>(
    "SELECT status, completed_at FROM tasks WHERE id = ?",
    [taskId]
  )[0]

  if (afterFirst?.status === "done") {
    // Attempt to complete again (should be idempotent or rejected)
    const originalCompletedAt = afterFirst.completed_at

    db.run(
      "UPDATE tasks SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [taskId]
    )

    const afterSecond = db.query<{ completed_at: string | null }>(
      "SELECT completed_at FROM tasks WHERE id = ?",
      [taskId]
    )[0]

    // If completed_at changed, second completion "worked" (which may be a bug depending on design)
    if (afterSecond?.completed_at !== originalCompletedAt) {
      secondCompleted = true
      secondError = "Warning: completed_at was updated on second completion"
    } else {
      secondCompleted = false
    }
  }

  // Get final status
  const final = db.query<{ status: string }>(
    "SELECT status FROM tasks WHERE id = ?",
    [taskId]
  )[0]

  return {
    firstCompleted,
    secondCompleted,
    secondError,
    originalStatus,
    finalStatus: final?.status ?? "unknown"
  }
}

// =============================================================================
// partialWrite - Simulate interrupted DB write
// =============================================================================

/**
 * Options for partialWrite utility.
 */
export interface PartialWriteOptions {
  /** Table to write to */
  table: "tasks" | "task_claims" | "learnings"
  /** Test database instance */
  db: TestDatabase
  /** Number of rows to write */
  rowCount: number
  /** Row number at which to "fail" (1-indexed) */
  failAtRow: number
  /** If true, wrap in transaction for testing rollback */
  useTransaction?: boolean
}

/**
 * Result of partialWrite operation.
 */
export interface PartialWriteResult {
  /** Number of rows successfully written */
  rowsWritten: number
  /** Number of rows that failed */
  rowsFailed: number
  /** Whether the failure triggered a rollback */
  rolledBack: boolean
  /** IDs of rows that were written */
  writtenIds: string[]
  /** Error that caused the failure */
  error?: string
}

/**
 * Simulate an interrupted database write operation.
 * Tests transaction handling and partial failure recovery.
 *
 * @example
 * ```typescript
 * const result = partialWrite({
 *   table: 'tasks',
 *   db: testDb,
 *   rowCount: 10,
 *   failAtRow: 5,
 *   useTransaction: true
 * })
 *
 * // With transaction, should rollback all
 * expect(result.rolledBack).toBe(true)
 * expect(result.rowsWritten).toBe(0)
 * ```
 */
export const partialWrite = (options: PartialWriteOptions): PartialWriteResult => {
  const { table, db, rowCount, failAtRow, useTransaction = false } = options

  const result: PartialWriteResult = {
    rowsWritten: 0,
    rowsFailed: 0,
    rolledBack: false,
    writtenIds: [],
    error: undefined
  }

  const writeRow = (index: number): string => {
    const id = fixtureId(`partial-write-${table}-${index}`)

    if (index === failAtRow) {
      throw new Error(`Simulated failure at row ${index}`)
    }

    if (table === "tasks") {
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')`,
        [id, `Partial Write Task ${index}`]
      )
    } else if (table === "learnings") {
      db.run(
        `INSERT INTO learnings (id, content, source, confidence, category, created_at, updated_at)
         VALUES (?, ?, 'test', 0.5, 'test', datetime('now'), datetime('now'))`,
        [id, `Learning ${index}`]
      )
    }

    return id
  }

  if (useTransaction) {
    try {
      db.transaction(() => {
        for (let i = 1; i <= rowCount; i++) {
          const id = writeRow(i)
          result.writtenIds.push(id)
          result.rowsWritten++
        }
      })
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e)
      result.rowsFailed = rowCount - result.rowsWritten
      result.rolledBack = true
      result.writtenIds = []
      result.rowsWritten = 0
    }
  } else {
    for (let i = 1; i <= rowCount; i++) {
      try {
        const id = writeRow(i)
        result.writtenIds.push(id)
        result.rowsWritten++
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e)
        result.rowsFailed = rowCount - i + 1
        break
      }
    }
  }

  return result
}

// =============================================================================
// delayedClaim - Slow claim to test race conditions
// =============================================================================

/**
 * Options for delayedClaim utility.
 */
export interface DelayedClaimOptions {
  /** Task ID to claim */
  taskId: string
  /** Worker ID making the claim */
  workerId: string
  /** Test database instance */
  db: TestDatabase
  /** Delay in milliseconds before claiming */
  delayMs: number
  /** If true, check for existing claim before and after delay */
  checkRace?: boolean
}

/**
 * Result of delayedClaim operation.
 */
export interface DelayedClaimResult {
  /** Whether the claim was successful */
  claimed: boolean
  /** Whether a race condition was detected */
  raceDetected: boolean
  /** Worker ID that got the claim (may be different from requested) */
  claimedBy: string | null
  /** Time waited in milliseconds */
  waitedMs: number
}

/**
 * Perform a claim with artificial delay to test race conditions.
 * Useful for testing claim conflict resolution.
 *
 * @example
 * ```typescript
 * // Start a delayed claim
 * const delayedPromise = delayedClaim({
 *   taskId: 'tx-abc123',
 *   workerId: 'slow-worker',
 *   db: testDb,
 *   delayMs: 100,
 *   checkRace: true
 * })
 *
 * // Another worker claims immediately
 * await claimTask('tx-abc123', 'fast-worker')
 *
 * // Delayed claim should detect the race
 * const result = await delayedPromise
 * expect(result.raceDetected).toBe(true)
 * expect(result.claimed).toBe(false)
 * ```
 */
export const delayedClaim = async (
  options: DelayedClaimOptions
): Promise<DelayedClaimResult> => {
  const { taskId, workerId, db, delayMs, checkRace = true } = options
  const startTime = Date.now()

  let claimExistedBefore = false
  if (checkRace) {
    const existing = db.query<{ worker_id: string }>(
      "SELECT worker_id FROM task_claims WHERE task_id = ? AND status = 'active'",
      [taskId]
    )[0]
    claimExistedBefore = !!existing
  }

  // Wait
  await sleep(delayMs)

  // Check if someone else claimed during our delay
  let raceDetected = false
  let claimedBy: string | null = null

  const afterDelay = db.query<{ worker_id: string }>(
    "SELECT worker_id FROM task_claims WHERE task_id = ? AND status = 'active'",
    [taskId]
  )[0]

  if (afterDelay) {
    claimedBy = afterDelay.worker_id
    if (!claimExistedBefore && afterDelay.worker_id !== workerId) {
      raceDetected = true
    }
  }

  // Attempt to claim using atomic INSERT ... WHERE NOT EXISTS
  let claimed = false
  if (!afterDelay) {
    try {
      const leaseExpiresAt = new Date(Date.now() + 30 * 60 * 1000)
      const result = db.run(
        `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
         SELECT ?, ?, datetime('now'), ?, 0, 'active'
         WHERE NOT EXISTS (
           SELECT 1 FROM task_claims
           WHERE task_id = ? AND status = 'active'
         )`,
        [taskId, workerId, leaseExpiresAt.toISOString(), taskId]
      )
      if (result.changes > 0) {
        claimed = true
        claimedBy = workerId
      } else {
        // Another worker claimed during delay
        const finalCheck = db.query<{ worker_id: string }>(
          "SELECT worker_id FROM task_claims WHERE task_id = ? AND status = 'active'",
          [taskId]
        )[0]
        if (finalCheck) {
          claimedBy = finalCheck.worker_id
          raceDetected = finalCheck.worker_id !== workerId
        }
      }
    } catch {
      // Claim failed
      const finalCheck = db.query<{ worker_id: string }>(
        "SELECT worker_id FROM task_claims WHERE task_id = ? AND status = 'active'",
        [taskId]
      )[0]
      if (finalCheck) {
        claimedBy = finalCheck.worker_id
        raceDetected = finalCheck.worker_id !== workerId
      }
    }
  }

  return {
    claimed,
    raceDetected,
    claimedBy,
    waitedMs: Date.now() - startTime
  }
}

// =============================================================================
// stressLoad - Create thousands of tasks quickly
// =============================================================================

/**
 * Options for stressLoad utility.
 */
export interface StressLoadOptions {
  /** Number of tasks to create */
  taskCount: number
  /** Test database instance */
  db: TestDatabase
  /** If true, create with dependencies (slower but more realistic) */
  withDependencies?: boolean
  /** Dependency ratio - what fraction of tasks should have dependencies (0-1) */
  dependencyRatio?: number
  /** Batch size for inserts (default: 1000) */
  batchSize?: number
  /** If true, include various statuses (not just backlog) */
  mixedStatuses?: boolean
}

/**
 * Result of stressLoad operation.
 */
export interface StressLoadResult {
  /** Number of tasks created */
  tasksCreated: number
  /** Number of dependencies created */
  depsCreated: number
  /** Time taken in milliseconds */
  elapsedMs: number
  /** Tasks created per second */
  tasksPerSecond: number
  /** IDs of created tasks */
  taskIds: string[]
}

/**
 * Create a large number of tasks quickly for stress testing.
 * Tests bulk operations and performance under load.
 *
 * @example
 * ```typescript
 * const result = stressLoad({
 *   taskCount: 10000,
 *   db: testDb,
 *   withDependencies: true,
 *   dependencyRatio: 0.3
 * })
 *
 * console.log(`Created ${result.tasksCreated} tasks in ${result.elapsedMs}ms`)
 * console.log(`Rate: ${result.tasksPerSecond.toFixed(0)} tasks/sec`)
 * ```
 */
export const stressLoad = (options: StressLoadOptions): StressLoadResult => {
  const {
    taskCount,
    db,
    withDependencies = false,
    dependencyRatio = 0.2,
    batchSize = 1000,
    mixedStatuses = false
  } = options

  const startTime = Date.now()
  const taskIds: string[] = []
  let depsCreated = 0

  const statuses = mixedStatuses
    ? ["backlog", "ready", "planning", "active", "blocked", "review", "done"]
    : ["backlog"]

  // Create tasks in batches
  for (let batch = 0; batch < Math.ceil(taskCount / batchSize); batch++) {
    const batchStart = batch * batchSize
    const batchEnd = Math.min(batchStart + batchSize, taskCount)

    db.transaction(() => {
      for (let i = batchStart; i < batchEnd; i++) {
        const id = fixtureId(`stress-task-${i}`)
        const status = statuses[i % statuses.length]
        const score = Math.floor(Math.random() * 1000)

        db.run(
          `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, '', ?, ?, datetime('now'), datetime('now'), '{}')`,
          [id, `Stress Task ${i}`, status, score]
        )
        taskIds.push(id)
      }
    })
  }

  // Create dependencies if requested
  if (withDependencies && taskIds.length > 1) {
    const depCount = Math.floor(taskIds.length * dependencyRatio)
    const depCountBefore = db.query<{ count: number }>("SELECT COUNT(*) as count FROM task_dependencies")[0].count

    db.transaction(() => {
      for (let i = 0; i < depCount; i++) {
        // Pick two random different tasks
        const blockerIdx = Math.floor(Math.random() * taskIds.length)
        let blockedIdx = Math.floor(Math.random() * taskIds.length)
        while (blockedIdx === blockerIdx) {
          blockedIdx = Math.floor(Math.random() * taskIds.length)
        }

        try {
          db.run(
            `INSERT OR IGNORE INTO task_dependencies (blocker_id, blocked_id, created_at)
             VALUES (?, ?, datetime('now'))`,
            [taskIds[blockerIdx], taskIds[blockedIdx]]
          )
        } catch {
          // Ignore constraint violations (cycles, duplicates)
        }
      }
    })

    depsCreated = db.query<{ count: number }>("SELECT COUNT(*) as count FROM task_dependencies")[0].count - depCountBefore
  }

  const elapsedMs = Date.now() - startTime

  return {
    tasksCreated: taskIds.length,
    depsCreated,
    elapsedMs,
    tasksPerSecond: taskIds.length / (elapsedMs / 1000),
    taskIds
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sleep for specified milliseconds.
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}
