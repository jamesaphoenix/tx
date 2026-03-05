import { Effect } from "effect"
import type { SqliteDatabase } from "../../db.js"
import { DatabaseError, TaskNotFoundError, UnexpectedRowCountError, StaleDataError } from "../../errors.js"
import type { TaskRepositoryService } from "../task-repo.js"
import { runImmediateTransaction } from "./shared.js"

type TaskRepositoryWriteService = Pick<
  TaskRepositoryService,
  | "insert"
  | "update"
  | "updateMany"
  | "setGroupContext"
  | "clearGroupContext"
  | "remove"
  | "recoverTaskStatus"
  | "updateVerifyCmd"
>

export const createTaskRepositoryWriteService = (
  db: SqliteDatabase
): TaskRepositoryWriteService => ({
  insert: (task) =>
    Effect.try({
      try: () => {
        const result = db.prepare(
          `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at,
                                  assignee_type, assignee_id, assigned_at, assigned_by, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          task.assigneeType,
          task.assigneeId,
          task.assignedAt?.toISOString() ?? null,
          task.assignedBy,
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

  update: (task, expectedUpdatedAt) =>
    Effect.gen(function* () {
      if (expectedUpdatedAt) {
        // Optimistic locking: include updated_at in WHERE clause
        const result = yield* Effect.try({
          try: () =>
            db.prepare(
              `UPDATE tasks SET
                    title = ?, description = ?, status = ?, parent_id = ?,
                    score = ?, updated_at = ?, completed_at = ?,
                    assignee_type = ?, assignee_id = ?, assigned_at = ?, assigned_by = ?,
                    metadata = ?
                   WHERE id = ? AND updated_at = ?`
            ).run(
              task.title,
              task.description,
              task.status,
              task.parentId,
              task.score,
              task.updatedAt.toISOString(),
              task.completedAt?.toISOString() ?? null,
              task.assigneeType,
              task.assigneeId,
              task.assignedAt?.toISOString() ?? null,
              task.assignedBy,
              JSON.stringify(task.metadata),
              task.id,
              expectedUpdatedAt.toISOString()
            ),
          catch: (cause) => new DatabaseError({ cause })
        })
        if (result.changes === 0) {
          // Distinguish not-found from stale: re-read the row
          const current = yield* Effect.try({
            try: () =>
              db.prepare<{ updated_at: string }>("SELECT updated_at FROM tasks WHERE id = ?").get(task.id),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (!current) {
            yield* Effect.fail(new TaskNotFoundError({ id: task.id }))
          } else {
            yield* Effect.fail(new StaleDataError({
              taskId: task.id,
              expectedUpdatedAt: expectedUpdatedAt.toISOString(),
              actualUpdatedAt: current.updated_at
            }))
          }
        }
      } else {
        // No optimistic locking (backward compatible)
        const result = yield* Effect.try({
          try: () =>
            db.prepare(
              `UPDATE tasks SET
                    title = ?, description = ?, status = ?, parent_id = ?,
                    score = ?, updated_at = ?, completed_at = ?,
                    assignee_type = ?, assignee_id = ?, assigned_at = ?, assigned_by = ?,
                    metadata = ?
                   WHERE id = ?`
            ).run(
              task.title,
              task.description,
              task.status,
              task.parentId,
              task.score,
              task.updatedAt.toISOString(),
              task.completedAt?.toISOString() ?? null,
              task.assigneeType,
              task.assigneeId,
              task.assignedAt?.toISOString() ?? null,
              task.assignedBy,
              JSON.stringify(task.metadata),
              task.id
            ),
          catch: (cause) => new DatabaseError({ cause })
        })
        if (result.changes === 0) {
          yield* Effect.fail(new TaskNotFoundError({ id: task.id }))
        }
      }
    }),

  updateMany: (tasks) =>
    Effect.gen(function* () {
      if (tasks.length === 0) return
      type UpdateManyErrorInfo =
        | { type: "not_found"; id: string }
        | { type: "stale"; id: string; expected: string; actual: string }

      const updateStmt = db.prepare(
        `UPDATE tasks SET
              title = ?, description = ?, status = ?, parent_id = ?,
              score = ?, updated_at = ?, completed_at = ?,
              assignee_type = ?, assignee_id = ?, assigned_at = ?, assigned_by = ?,
              metadata = ?
             WHERE id = ?`
      )

      const selectStmt = db.prepare<{ updated_at: string }>(
        `SELECT updated_at FROM tasks WHERE id = ?`
      )

      // Use a transaction for atomicity with optimistic locking
      // Re-read updated_at inside transaction to detect stale data
      const transaction = runImmediateTransaction<UpdateManyErrorInfo | null>(db, () => {
        for (const task of tasks) {
          // Check for stale data by comparing updated_at
          const current = selectStmt.get(task.id)
          if (!current) {
            return { type: "not_found", id: task.id }
          }

          const currentUpdatedAt = new Date(current.updated_at)
          // If the database has a newer version, the data being written is stale
          if (currentUpdatedAt > task.updatedAt) {
            return {
              type: "stale",
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
            task.assigneeType,
            task.assigneeId,
            task.assignedAt?.toISOString() ?? null,
            task.assignedBy,
            JSON.stringify(task.metadata),
            task.id
          )
          if (result.changes === 0) {
            return { type: "not_found", id: task.id }
          }
        }
        return null // All tasks updated successfully
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
      const errorInfo = transaction.value

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

  setGroupContext: (taskId, context) =>
    Effect.gen(function* () {
      const now = new Date().toISOString()
      const result = yield* Effect.try({
        try: () =>
          db.prepare(
            `UPDATE tasks
                 SET group_context = ?, updated_at = ?
                 WHERE id = ?`
          ).run(context, now, taskId),
        catch: (cause) => new DatabaseError({ cause })
      })
      if (result.changes === 0) {
        yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
      }
    }),

  clearGroupContext: (taskId) =>
    Effect.gen(function* () {
      const now = new Date().toISOString()
      const result = yield* Effect.try({
        try: () =>
          db.prepare(
            `UPDATE tasks
                 SET group_context = NULL, updated_at = ?
                 WHERE id = ?`
          ).run(now, taskId),
        catch: (cause) => new DatabaseError({ cause })
      })
      if (result.changes === 0) {
        yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
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

  recoverTaskStatus: (taskId, expectedStatus) =>
    Effect.try({
      try: () => {
        const now = new Date().toISOString()
        const result = db.prepare(`
              UPDATE tasks SET
                status = CASE
                  WHEN NOT EXISTS (
                    SELECT 1 FROM task_dependencies d
                    JOIN tasks blocker ON blocker.id = d.blocker_id
                    WHERE d.blocked_id = ? AND blocker.status != 'done'
                  ) THEN 'ready'
                  ELSE 'blocked'
                END,
                updated_at = ?
              WHERE id = ? AND status = ?
            `).run(taskId, now, taskId, expectedStatus)
        return result.changes > 0
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  updateVerifyCmd: (taskId, cmd, schema) =>
    Effect.gen(function* () {
      const result = yield* Effect.try({
        try: () => db.prepare(
          "UPDATE tasks SET verify_cmd = ?, verify_schema = ?, updated_at = ? WHERE id = ?"
        ).run(cmd, schema, new Date().toISOString(), taskId),
        catch: (cause) => new DatabaseError({ cause })
      })
      if (result.changes === 0) {
        return yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
      }
    }),
})
