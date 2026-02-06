import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, DependencyNotFoundError, UnexpectedRowCountError } from "../errors.js"
import { rowToDependency } from "../mappers/task.js"
import { DEFAULT_QUERY_LIMIT } from "../utils/sql.js"
import type { TaskId, TaskDependency, DependencyRow } from "@jamesaphoenix/tx-types"

// Shared frozen empty array to avoid allocating new arrays for IDs with no dependencies
const EMPTY_TASK_IDS: readonly TaskId[] = Object.freeze([])

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
              db.prepare(`
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
              `).get(fromId, MAX_DEPENDENCY_DEPTH, toId) as { found: number | null; max_depth: number | null } | undefined,
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
            const rows = db.prepare(
              "SELECT blocker_id, blocked_id, created_at FROM task_dependencies LIMIT ?"
            ).all(limit ?? DEFAULT_QUERY_LIMIT) as DependencyRow[]
            return rows.map(rowToDependency)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      removeByTaskIds: (taskIds) =>
        Effect.try({
          try: () => {
            if (taskIds.length === 0) return
            const placeholders = taskIds.map(() => "?").join(",")
            db.prepare(
              `DELETE FROM task_dependencies WHERE blocker_id IN (${placeholders}) OR blocked_id IN (${placeholders})`
            ).run(...taskIds, ...taskIds)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertWithCycleCheck: (blockerId, blockedId) =>
        Effect.gen(function* () {
          const txResult = yield* Effect.try({
            try: () => {
              // BEGIN IMMEDIATE acquires write lock immediately, preventing other writers
              // from modifying the dependency graph until we commit/rollback
              db.exec("BEGIN IMMEDIATE")
              try {
                // Special case: same ID always indicates a cycle
                if (blockerId === blockedId) {
                  db.exec("ROLLBACK")
                  return { _tag: "wouldCycle", depthLimitHit: false } as const
                }

                // Check if dependency already exists (idempotent)
                const existing = db.prepare(
                  "SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ? LIMIT 1"
                ).get(blockerId, blockedId)

                if (existing != null) {
                  db.exec("ROLLBACK")
                  return { _tag: "alreadyExists", depthLimitHit: false } as const
                }

                // Check if adding this dependency would create a cycle
                // Uses depth-limited recursive CTE to detect if blockedId can already reach blockerId
                const cycleCheck = db.prepare(`
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
                `).get(blockerId, MAX_DEPENDENCY_DEPTH, blockedId) as { found: number | null; max_depth: number | null } | undefined

                const depthLimitHit = cycleCheck?.max_depth != null && cycleCheck.max_depth >= MAX_DEPENDENCY_DEPTH

                if (cycleCheck?.found === 1) {
                  db.exec("ROLLBACK")
                  return { _tag: "wouldCycle", depthLimitHit } as const
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
                return { _tag: "inserted", depthLimitHit } as const
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

          if (txResult.depthLimitHit) {
            yield* Effect.logWarning(
              `Dependency depth limit (${MAX_DEPENDENCY_DEPTH}) reached during cycle check for ${blockerId} → ${blockedId}. Insert proceeded but deeper cycles may exist.`
            )
          }

          return { _tag: txResult._tag } as InsertWithCycleCheckResult
        })
    }
  })
)
