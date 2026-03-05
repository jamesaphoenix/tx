import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, DependencyNotFoundError, UnexpectedRowCountError } from "../errors.js"
import { rowToDependency } from "../mappers/task.js"
import { DEFAULT_QUERY_LIMIT } from "../utils/sql.js"
import type { TaskId, TaskDependency, DependencyRow } from "@jamesaphoenix/tx-types"
import { coerceDbResult } from "../utils/db-result.js"

// Shared frozen empty array to avoid allocating new arrays for IDs with no dependencies
const EMPTY_TASK_IDS: readonly TaskId[] = Object.freeze([])
const MAX_SQL_VARIABLES = 900

const chunkBySqlLimit = <T>(values: readonly T[], chunkSize: number = MAX_SQL_VARIABLES): ReadonlyArray<ReadonlyArray<T>> => {
  if (values.length === 0) {
    return []
  }
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(coerceDbResult<T[]>(values.slice(i, i + chunkSize)))
  }
  return chunks
}

/**
 * Maximum recursion depth for dependency graph traversal.
 * Prevents unbounded recursive CTEs from hitting SQLite's internal
 * 1000-level recursion limit on deep dependency chains.
 */
const MAX_DEPENDENCY_DEPTH = 100

/**
 * Result of atomic cycle-check-and-insert operation.
 */
export type InsertWithCycleCheckResult =
  | { readonly _tag: "inserted" }
  | { readonly _tag: "wouldCycle" }
  | { readonly _tag: "alreadyExists" }

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
    readonly getAll: (limit?: number) => Effect.Effect<readonly TaskDependency[], DatabaseError>
    /**
     * Remove all dependency edges where any of the given task IDs appear
     * as either blocker_id or blocked_id. Used during cascade delete to
     * explicitly clean up edges rather than relying solely on FK CASCADE.
     */
    readonly removeByTaskIds: (taskIds: readonly string[]) => Effect.Effect<void, DatabaseError>
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
    const runImmediateTransaction = <T>(body: () => T): { ok: true; value: T } | { ok: false; error: unknown } => {
      db.exec("BEGIN IMMEDIATE")
      try {
        const value = body()
        db.exec("COMMIT")
        return { ok: true, value }
      } catch (error) {
        try {
          db.exec("ROLLBACK")
        } catch {
          // no-op
        }
        return { ok: false, error }
      }
    }

    return {
      insert: (blockerId, blockedId) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () =>
              db.prepare(
                "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
              ).run(blockerId, blockedId, new Date().toISOString()),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes !== 1) {
            return yield* Effect.fail(new DatabaseError({
              cause: new UnexpectedRowCountError({
                operation: "dependency insert",
                expected: 1,
                actual: result.changes
              })
            }))
          }
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
            const rows = coerceDbResult<Array<{ blocker_id: string }>>(db.prepare(
              "SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?"
            ).all(blockedId))
            return rows.map(r => coerceDbResult<TaskId>(r.blocker_id))
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockingIds: (blockerId) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<Array<{ blocked_id: string }>>(db.prepare(
              "SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?"
            ).all(blockerId))
            return rows.map(r => coerceDbResult<TaskId>(r.blocked_id))
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockerIdsForMany: (blockedIds) =>
        Effect.try({
          try: () => {
            const result = new Map<string, readonly TaskId[]>()
            if (blockedIds.length === 0) return result

            // Group rows by blocked_id in a temporary mutable map
            const grouped = new Map<string, TaskId[]>()
            for (const chunk of chunkBySqlLimit(blockedIds)) {
              const placeholders = chunk.map(() => "?").join(",")
              const rows = coerceDbResult<Array<{ blocked_id: string; blocker_id: string }>>(db.prepare(
                `SELECT blocked_id, blocker_id FROM task_dependencies WHERE blocked_id IN (${placeholders})`
              ).all(...chunk))

              for (const row of rows) {
                const existing = grouped.get(row.blocked_id)
                if (existing) {
                  existing.push(coerceDbResult<TaskId>(row.blocker_id))
                } else {
                  grouped.set(row.blocked_id, [coerceDbResult<TaskId>(row.blocker_id)])
                }
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

            // Group rows by blocker_id in a temporary mutable map
            const grouped = new Map<string, TaskId[]>()
            for (const chunk of chunkBySqlLimit(blockerIds)) {
              const placeholders = chunk.map(() => "?").join(",")
              const rows = coerceDbResult<Array<{ blocker_id: string; blocked_id: string }>>(db.prepare(
                `SELECT blocker_id, blocked_id FROM task_dependencies WHERE blocker_id IN (${placeholders})`
              ).all(...chunk))

              for (const row of rows) {
                const existing = grouped.get(row.blocker_id)
                if (existing) {
                  existing.push(coerceDbResult<TaskId>(row.blocked_id))
                } else {
                  grouped.set(row.blocker_id, [coerceDbResult<TaskId>(row.blocked_id)])
                }
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
      // Depth-limited to MAX_DEPENDENCY_DEPTH to prevent hitting SQLite's internal 1000-level limit
      hasPath: (fromId, toId) =>
        Effect.gen(function* () {
          // Special case: same ID
          if (fromId === toId) return true

          // Recursive CTE performs BFS in a single query
          // UNION deduplicates visited nodes, preventing infinite loops
          // depth tracking prevents unbounded recursion on deep chains
          const result = yield* Effect.try({
            try: () =>
              coerceDbResult<{ found: number | null; max_depth: number | null } | undefined>(db.prepare(`
                WITH RECURSIVE reachable(id, depth) AS (
                  -- Base case: direct blockers of fromId (depth 1)
                  SELECT blocker_id, 1 FROM task_dependencies WHERE blocked_id = ?
                  UNION
                  -- Recursive case: follow blocker chain, bounded by depth limit
                  SELECT d.blocker_id, r.depth + 1
                  FROM task_dependencies d
                  JOIN reachable r ON d.blocked_id = r.id
                  WHERE r.depth < ?
                )
                SELECT
                  MAX(CASE WHEN id = ? THEN 1 ELSE 0 END) AS found,
                  MAX(depth) AS max_depth
                FROM reachable
              `).get(fromId, MAX_DEPENDENCY_DEPTH, toId)),
            catch: (cause) => new DatabaseError({ cause })
          })

          const pathFound = result?.found === 1
          const depthLimitHit = result?.max_depth != null && result.max_depth >= MAX_DEPENDENCY_DEPTH

          if (depthLimitHit) {
            yield* Effect.logWarning(
              `Dependency depth limit (${MAX_DEPENDENCY_DEPTH}) reached checking path from ${fromId} to ${toId}. Graph may have unexplored deeper chains.`
            )
          }

          return pathFound
        }),

      getAll: (limit) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<DependencyRow[]>(db.prepare(
              "SELECT blocker_id, blocked_id, created_at FROM task_dependencies LIMIT ?"
            ).all(limit ?? DEFAULT_QUERY_LIMIT))
            return rows.map(rowToDependency)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      removeByTaskIds: (taskIds) =>
        Effect.try({
          try: () => {
            if (taskIds.length === 0) return
            for (const chunk of chunkBySqlLimit(taskIds, Math.floor(MAX_SQL_VARIABLES / 2))) {
              const placeholders = chunk.map(() => "?").join(",")
              db.prepare(
                `DELETE FROM task_dependencies WHERE blocker_id IN (${placeholders}) OR blocked_id IN (${placeholders})`
              ).run(...chunk, ...chunk)
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertWithCycleCheck: (blockerId, blockedId) =>
        Effect.gen(function* () {
          type CycleCheckTxResult =
            | { readonly status: "inserted" | "wouldCycle" | "alreadyExists"; readonly depthLimitHit: boolean }
            | { readonly status: "failed"; readonly depthLimitHit: boolean; readonly error: UnexpectedRowCountError }

          const txResult = runImmediateTransaction((): CycleCheckTxResult => {
            if (blockerId === blockedId) {
              return { status: "wouldCycle", depthLimitHit: false }
            }

            const existing = db.prepare(
              "SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ? LIMIT 1"
            ).get(blockerId, blockedId)

            if (existing != null) {
              return { status: "alreadyExists", depthLimitHit: false }
            }

            const cycleCheck = coerceDbResult<{ found: number | null; max_depth: number | null } | undefined>(db.prepare(`
              WITH RECURSIVE reachable(id, depth) AS (
                SELECT blocker_id, 1 FROM task_dependencies WHERE blocked_id = ?
                UNION
                SELECT d.blocker_id, r.depth + 1
                FROM task_dependencies d
                JOIN reachable r ON d.blocked_id = r.id
                WHERE r.depth < ?
              )
              SELECT
                MAX(CASE WHEN id = ? THEN 1 ELSE 0 END) AS found,
                MAX(depth) AS max_depth
              FROM reachable
            `).get(blockerId, MAX_DEPENDENCY_DEPTH, blockedId))

            const depthLimitHit = cycleCheck?.max_depth != null && cycleCheck.max_depth >= MAX_DEPENDENCY_DEPTH

            if (cycleCheck?.found === 1) {
              return { status: "wouldCycle", depthLimitHit }
            }

            const result = db.prepare(
              "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
            ).run(blockerId, blockedId, new Date().toISOString())

            if (result.changes !== 1) {
              return {
                status: "failed",
                depthLimitHit,
                error: new UnexpectedRowCountError({
                  operation: "dependency insert (with cycle check)",
                  expected: 1,
                  actual: result.changes
                })
              }
            }

            return { status: "inserted", depthLimitHit }
          })
          if (!txResult.ok) {
            return yield* Effect.fail(new DatabaseError({ cause: txResult.error }))
          }

          if (txResult.value.status === "failed") {
            return yield* Effect.fail(new DatabaseError({ cause: txResult.value.error }))
          }

          if (txResult.value.depthLimitHit) {
            yield* Effect.logWarning(
              `Dependency depth limit (${MAX_DEPENDENCY_DEPTH}) reached during cycle check for ${blockerId} → ${blockedId}. Insert proceeded but deeper cycles may exist.`
            )
          }

          return coerceDbResult<InsertWithCycleCheckResult>({ _tag: txResult.value.status })
        })
    }
  })
)
