import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, TaskNotFoundError, UnexpectedRowCountError, StaleDataError } from "../errors.js"
import { rowToTask } from "../mappers/task.js"
import type { Task, TaskId, TaskFilter, TaskRow } from "@jamesaphoenix/tx-types"
import { escapeLikePattern } from "../utils/sql.js"

export class TaskRepository extends Context.Tag("TaskRepository")<
  TaskRepository,
  {
    readonly findById: (id: string) => Effect.Effect<Task | null, DatabaseError>
    readonly findByIds: (ids: readonly string[]) => Effect.Effect<readonly Task[], DatabaseError>
    readonly findAll: (filter?: TaskFilter) => Effect.Effect<readonly Task[], DatabaseError>
    readonly findByParent: (parentId: string | null) => Effect.Effect<readonly Task[], DatabaseError>
    readonly getChildIds: (id: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getChildIdsForMany: (ids: readonly string[]) => Effect.Effect<Map<string, readonly TaskId[]>, DatabaseError>
    readonly getAncestorChain: (id: string) => Effect.Effect<readonly Task[], DatabaseError>
    readonly getDescendants: (id: string, maxDepth?: number) => Effect.Effect<readonly Task[], DatabaseError>
    readonly insert: (task: Task) => Effect.Effect<void, DatabaseError>
    readonly update: (task: Task) => Effect.Effect<void, DatabaseError | TaskNotFoundError>
    readonly updateMany: (tasks: readonly Task[]) => Effect.Effect<void, DatabaseError | TaskNotFoundError | StaleDataError>
    readonly remove: (id: string) => Effect.Effect<void, DatabaseError | TaskNotFoundError>
    readonly count: (filter?: TaskFilter) => Effect.Effect<number, DatabaseError>
  }
>() {}

export const TaskRepositoryLive = Layer.effect(
  TaskRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
            return row ? rowToTask(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByIds: (ids) =>
        Effect.try({
          try: () => {
            if (ids.length === 0) return []
            const placeholders = ids.map(() => "?").join(",")
            const rows = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids) as TaskRow[]
            return rows.map(rowToTask)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: (filter) =>
        Effect.try({
          try: () => {
            const conditions: string[] = []
            const params: unknown[] = []

            if (filter?.status) {
              if (Array.isArray(filter.status)) {
                const placeholders = filter.status.map(() => "?").join(",")
                conditions.push(`status IN (${placeholders})`)
                params.push(...filter.status)
              } else {
                conditions.push("status = ?")
                params.push(filter.status)
              }
            }

            if (filter?.parentId !== undefined) {
              if (filter.parentId === null) {
                conditions.push("parent_id IS NULL")
              } else {
                conditions.push("parent_id = ?")
                params.push(filter.parentId)
              }
            }

            // Search filter: case-insensitive search in title and description
            if (filter?.search) {
              const searchPattern = `%${escapeLikePattern(filter.search)}%`
              conditions.push("(title LIKE ? ESCAPE '\\' COLLATE NOCASE OR description LIKE ? ESCAPE '\\' COLLATE NOCASE)")
              params.push(searchPattern, searchPattern)
            }

            // Cursor-based pagination: fetch tasks after the cursor position
            // Order is score DESC, id ASC, so "after cursor" means:
            // (score < cursor.score) OR (score = cursor.score AND id > cursor.id)
            if (filter?.cursor) {
              conditions.push("(score < ? OR (score = ? AND id > ?))")
              params.push(filter.cursor.score, filter.cursor.score, filter.cursor.id)
            }

            // Exclude tasks with active claims (thundering herd prevention)
            // Uses idx_claims_active_task partial index for efficient lookup
            if (filter?.excludeClaimed) {
              conditions.push("NOT EXISTS (SELECT 1 FROM task_claims WHERE task_id = tasks.id AND status = 'active')")
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
            // Use parameterized query for LIMIT to prevent SQL injection
            let limitClause = ""
            if (filter?.limit != null && filter.limit > 0) {
              limitClause = "LIMIT ?"
              params.push(Math.floor(filter.limit))
            }
            const sql = `SELECT * FROM tasks ${where} ORDER BY score DESC, id ASC ${limitClause}`
            const rows = db.prepare(sql).all(...params) as TaskRow[]
            return rows.map(rowToTask)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByParent: (parentId) =>
        Effect.try({
          try: () => {
            const rows = parentId === null
              ? db.prepare("SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY score DESC").all() as TaskRow[]
              : db.prepare("SELECT * FROM tasks WHERE parent_id = ? ORDER BY score DESC").all(parentId) as TaskRow[]
            return rows.map(rowToTask)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getChildIds: (id) =>
        Effect.try({
          try: () => {
            const rows = db.prepare("SELECT id FROM tasks WHERE parent_id = ?").all(id) as Array<{ id: string }>
            return rows.map(r => r.id as TaskId)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getChildIdsForMany: (ids) =>
        Effect.try({
          try: () => {
            const result = new Map<string, TaskId[]>()
            if (ids.length === 0) return result as Map<string, readonly TaskId[]>

            const placeholders = ids.map(() => "?").join(",")
            const rows = db.prepare(
              `SELECT id, parent_id FROM tasks WHERE parent_id IN (${placeholders})`
            ).all(...ids) as Array<{ id: string; parent_id: string }>

            // Initialize all requested IDs with empty arrays
            for (const id of ids) {
              result.set(id, [])
            }

            // Group by parent_id - use push() for O(1) insertion instead of spread for O(n)
            for (const row of rows) {
              const existing = result.get(row.parent_id)
              if (existing) {
                existing.push(row.id as TaskId)
              }
            }

            return result as Map<string, readonly TaskId[]>
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getAncestorChain: (id) =>
        Effect.try({
          try: () => {
            // Use recursive CTE to get the task and all its ancestors in one query
            // Returns from the given task to root (depth-first ordering)
            const rows = db.prepare(`
              WITH RECURSIVE ancestors AS (
                SELECT t.*, 1 as depth FROM tasks t WHERE t.id = ?
                UNION ALL
                SELECT t.*, a.depth + 1 FROM tasks t
                JOIN ancestors a ON t.id = a.parent_id
                WHERE a.depth < 100 AND t.id != ?
              )
              SELECT * FROM ancestors ORDER BY depth ASC
            `).all(id, id) as TaskRow[]
            return rows.map(rowToTask)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getDescendants: (id, maxDepth = 10) =>
        Effect.try({
          try: () => {
            // Use recursive CTE to get the task and all its descendants in one query
            // Returns the root task first, then all descendants ordered by depth
            // maxDepth limits recursion to prevent unbounded traversal
            const rows = db.prepare(`
              WITH RECURSIVE descendants AS (
                SELECT t.*, 1 as depth FROM tasks t WHERE t.id = ?
                UNION ALL
                SELECT t.*, d.depth + 1 FROM tasks t
                JOIN descendants d ON t.parent_id = d.id
                WHERE d.depth < ?
              )
              SELECT * FROM descendants ORDER BY depth ASC
            `).all(id, maxDepth) as TaskRow[]
            return rows.map(rowToTask)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insert: (task) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              task.id,
              task.title,
              task.description,
              task.status,
              task.parentId,
              task.score,
              task.createdAt.toISOString(),
              task.updatedAt.toISOString(),
              task.completedAt?.toISOString() ?? null,
              JSON.stringify(task.metadata)
            )
            if (result.changes !== 1) {
              throw new UnexpectedRowCountError({
                operation: "task insert",
                expected: 1,
                actual: result.changes
              })
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (task) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () =>
              db.prepare(
                `UPDATE tasks SET
                  title = ?, description = ?, status = ?, parent_id = ?,
                  score = ?, updated_at = ?, completed_at = ?, metadata = ?
                 WHERE id = ?`
              ).run(
                task.title,
                task.description,
                task.status,
                task.parentId,
                task.score,
                task.updatedAt.toISOString(),
                task.completedAt?.toISOString() ?? null,
                JSON.stringify(task.metadata),
                task.id
              ),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new TaskNotFoundError({ id: task.id }))
          }
        }),

      updateMany: (tasks) =>
        Effect.gen(function* () {
          if (tasks.length === 0) return

          const updateStmt = db.prepare(
            `UPDATE tasks SET
              title = ?, description = ?, status = ?, parent_id = ?,
              score = ?, updated_at = ?, completed_at = ?, metadata = ?
             WHERE id = ?`
          )

          const selectStmt = db.prepare(
            `SELECT updated_at FROM tasks WHERE id = ?`
          )

          // Use a transaction for atomicity with optimistic locking
          // Re-read updated_at inside transaction to detect stale data
          const errorInfo = yield* Effect.try({
            try: () => {
              db.exec("BEGIN IMMEDIATE")
              try {
                for (const task of tasks) {
                  // Check for stale data by comparing updated_at
                  const current = selectStmt.get(task.id) as { updated_at: string } | undefined
                  if (!current) {
                    db.exec("ROLLBACK")
                    return { type: "not_found" as const, id: task.id }
                  }

                  const currentUpdatedAt = new Date(current.updated_at)
                  // If the database has a newer version, the data being written is stale
                  if (currentUpdatedAt > task.updatedAt) {
                    db.exec("ROLLBACK")
                    return {
                      type: "stale" as const,
                      id: task.id,
                      expected: task.updatedAt.toISOString(),
                      actual: current.updated_at
                    }
                  }

                  const result = updateStmt.run(
                    task.title,
                    task.description,
                    task.status,
                    task.parentId,
                    task.score,
                    task.updatedAt.toISOString(),
                    task.completedAt?.toISOString() ?? null,
                    JSON.stringify(task.metadata),
                    task.id
                  )
                  if (result.changes === 0) {
                    db.exec("ROLLBACK")
                    return { type: "not_found" as const, id: task.id }
                  }
                }
                db.exec("COMMIT")
                return null // All tasks updated successfully
              } catch (e) {
                db.exec("ROLLBACK")
                throw e
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })

          if (errorInfo !== null) {
            if (errorInfo.type === "not_found") {
              yield* Effect.fail(new TaskNotFoundError({ id: errorInfo.id }))
            } else {
              yield* Effect.fail(new StaleDataError({
                taskId: errorInfo.id,
                expectedUpdatedAt: errorInfo.expected,
                actualUpdatedAt: errorInfo.actual
              }))
            }
          }
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () => db.prepare("DELETE FROM tasks WHERE id = ?").run(id),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new TaskNotFoundError({ id }))
          }
        }),

      count: (filter) =>
        Effect.try({
          try: () => {
            const conditions: string[] = []
            const params: unknown[] = []

            if (filter?.status) {
              if (Array.isArray(filter.status)) {
                const placeholders = filter.status.map(() => "?").join(",")
                conditions.push(`status IN (${placeholders})`)
                params.push(...filter.status)
              } else {
                conditions.push("status = ?")
                params.push(filter.status)
              }
            }

            if (filter?.parentId !== undefined) {
              if (filter.parentId === null) {
                conditions.push("parent_id IS NULL")
              } else {
                conditions.push("parent_id = ?")
                params.push(filter.parentId)
              }
            }

            // Search filter for count (same as findAll)
            if (filter?.search) {
              const searchPattern = `%${escapeLikePattern(filter.search)}%`
              conditions.push("(title LIKE ? ESCAPE '\\' COLLATE NOCASE OR description LIKE ? ESCAPE '\\' COLLATE NOCASE)")
              params.push(searchPattern, searchPattern)
            }

            // Note: cursor is intentionally not included in count - we want total matching records

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
            const result = db.prepare(`SELECT COUNT(*) as cnt FROM tasks ${where}`).get(...params) as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
