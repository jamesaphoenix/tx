import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, DependencyNotFoundError, UnexpectedRowCountError } from "../errors.js"
import { rowToDependency } from "../mappers/task.js"
import type { TaskId, TaskDependency, DependencyRow } from "@jamesaphoenix/tx-types"

// Shared frozen empty array to avoid allocating new arrays for IDs with no dependencies
const EMPTY_TASK_IDS: readonly TaskId[] = Object.freeze([])

/**
 * Result of atomic cycle-check-and-insert operation.
 */
export type InsertWithCycleCheckResult =
  | { readonly _tag: "inserted" }
  | { readonly _tag: "wouldCycle" }

export class DependencyRepository extends Context.Tag("DependencyRepository")<
  DependencyRepository,
  {
    readonly insert: (blockerId: string, blockedId: string) => Effect.Effect<void, DatabaseError>
    readonly remove: (blockerId: string, blockedId: string) => Effect.Effect<void, DatabaseError | DependencyNotFoundError>
    readonly getBlockerIds: (blockedId: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getBlockingIds: (blockerId: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getBlockerIdsForMany: (blockedIds: readonly string[]) => Effect.Effect<Map<string, readonly TaskId[]>, DatabaseError>
    readonly getBlockingIdsForMany: (blockerIds: readonly string[]) => Effect.Effect<Map<string, readonly TaskId[]>, DatabaseError>
    readonly hasPath: (fromId: string, toId: string) => Effect.Effect<boolean, DatabaseError>
    readonly getAll: () => Effect.Effect<readonly TaskDependency[], DatabaseError>
    /**
     * Atomically check for cycles and insert dependency in a single transaction.
     * This prevents race conditions where two concurrent addBlocker calls could
     * both pass cycle detection before either inserts.
     *
     * Uses BEGIN IMMEDIATE to acquire write lock before cycle check.
     */
    readonly insertWithCycleCheck: (blockerId: string, blockedId: string) => Effect.Effect<InsertWithCycleCheckResult, DatabaseError>
  }
>() {}

export const DependencyRepositoryLive = Layer.effect(
  DependencyRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (blockerId, blockedId) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
            ).run(blockerId, blockedId, new Date().toISOString())
            if (result.changes !== 1) {
              throw new UnexpectedRowCountError({
                operation: "dependency insert",
                expected: 1,
                actual: result.changes
              })
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (blockerId, blockedId) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () =>
              db.prepare(
                "DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?"
              ).run(blockerId, blockedId),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new DependencyNotFoundError({ blockerId, blockedId }))
          }
        }),

      getBlockerIds: (blockedId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?"
            ).all(blockedId) as Array<{ blocker_id: string }>
            return rows.map(r => r.blocker_id as TaskId)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockingIds: (blockerId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?"
            ).all(blockerId) as Array<{ blocked_id: string }>
            return rows.map(r => r.blocked_id as TaskId)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockerIdsForMany: (blockedIds) =>
        Effect.try({
          try: () => {
            const result = new Map<string, readonly TaskId[]>()
            if (blockedIds.length === 0) return result

            const placeholders = blockedIds.map(() => "?").join(",")
            const rows = db.prepare(
              `SELECT blocked_id, blocker_id FROM task_dependencies WHERE blocked_id IN (${placeholders})`
            ).all(...blockedIds) as Array<{ blocked_id: string; blocker_id: string }>

            // Group rows by blocked_id in a temporary mutable map
            const grouped = new Map<string, TaskId[]>()
            for (const row of rows) {
              const existing = grouped.get(row.blocked_id)
              if (existing) {
                existing.push(row.blocker_id as TaskId)
              } else {
                grouped.set(row.blocked_id, [row.blocker_id as TaskId])
              }
            }

            // Populate result: use grouped array or shared empty array
            for (const id of blockedIds) {
              result.set(id, grouped.get(id) ?? EMPTY_TASK_IDS)
            }

            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockingIdsForMany: (blockerIds) =>
        Effect.try({
          try: () => {
            const result = new Map<string, readonly TaskId[]>()
            if (blockerIds.length === 0) return result

            const placeholders = blockerIds.map(() => "?").join(",")
            const rows = db.prepare(
              `SELECT blocker_id, blocked_id FROM task_dependencies WHERE blocker_id IN (${placeholders})`
            ).all(...blockerIds) as Array<{ blocker_id: string; blocked_id: string }>

            // Group rows by blocker_id in a temporary mutable map
            const grouped = new Map<string, TaskId[]>()
            for (const row of rows) {
              const existing = grouped.get(row.blocker_id)
              if (existing) {
                existing.push(row.blocked_id as TaskId)
              } else {
                grouped.set(row.blocker_id, [row.blocked_id as TaskId])
              }
            }

            // Populate result: use grouped array or shared empty array
            for (const id of blockerIds) {
              result.set(id, grouped.get(id) ?? EMPTY_TASK_IDS)
            }

            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      // Cycle detection using recursive CTE: can we reach toId by following blocker chains from fromId?
      // Uses UNION (not UNION ALL) to automatically prevent infinite recursion on existing cycles
      hasPath: (fromId, toId) =>
        Effect.try({
          try: () => {
            // Special case: same ID
            if (fromId === toId) return true

            // Recursive CTE performs BFS in a single query
            // UNION deduplicates visited nodes, preventing infinite loops
            const result = db.prepare(`
              WITH RECURSIVE reachable(id) AS (
                -- Base case: direct blockers of fromId
                SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?
                UNION
                -- Recursive case: follow blocker chain
                SELECT d.blocker_id
                FROM task_dependencies d
                JOIN reachable r ON d.blocked_id = r.id
              )
              SELECT 1 FROM reachable WHERE id = ? LIMIT 1
            `).get(fromId, toId)

            return result != null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT blocker_id, blocked_id, created_at FROM task_dependencies"
            ).all() as DependencyRow[]
            return rows.map(rowToDependency)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertWithCycleCheck: (blockerId, blockedId) =>
        Effect.try({
          try: () => {
            // BEGIN IMMEDIATE acquires write lock immediately, preventing other writers
            // from modifying the dependency graph until we commit/rollback
            db.exec("BEGIN IMMEDIATE")
            try {
              // Special case: same ID always indicates a cycle
              if (blockerId === blockedId) {
                db.exec("ROLLBACK")
                return { _tag: "wouldCycle" } as const
              }

              // Check if adding this dependency would create a cycle
              // Uses recursive CTE to detect if blockedId can already reach blockerId
              const wouldCycle = db.prepare(`
                WITH RECURSIVE reachable(id) AS (
                  SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?
                  UNION
                  SELECT d.blocker_id
                  FROM task_dependencies d
                  JOIN reachable r ON d.blocked_id = r.id
                )
                SELECT 1 FROM reachable WHERE id = ? LIMIT 1
              `).get(blockerId, blockedId)

              if (wouldCycle != null) {
                db.exec("ROLLBACK")
                return { _tag: "wouldCycle" } as const
              }

              // No cycle detected - safe to insert
              const result = db.prepare(
                "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
              ).run(blockerId, blockedId, new Date().toISOString())

              if (result.changes !== 1) {
                db.exec("ROLLBACK")
                throw new UnexpectedRowCountError({
                  operation: "dependency insert (with cycle check)",
                  expected: 1,
                  actual: result.changes
                })
              }

              db.exec("COMMIT")
              return { _tag: "inserted" } as const
            } catch (e) {
              // Ensure rollback on any error
              try {
                db.exec("ROLLBACK")
              } catch {
                // Ignore rollback errors (transaction may already be rolled back)
              }
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
