import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToTask } from "../mappers/task.js"
import type { Task, TaskId, TaskFilter, TaskRow } from "@tx/types"

export class TaskRepository extends Context.Tag("TaskRepository")<
  TaskRepository,
  {
    readonly findById: (id: string) => Effect.Effect<Task | null, DatabaseError>
    readonly findByIds: (ids: readonly string[]) => Effect.Effect<readonly Task[], DatabaseError>
    readonly findAll: (filter?: TaskFilter) => Effect.Effect<readonly Task[], DatabaseError>
    readonly findByParent: (parentId: string | null) => Effect.Effect<readonly Task[], DatabaseError>
    readonly getChildIds: (id: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getChildIdsForMany: (ids: readonly string[]) => Effect.Effect<Map<string, readonly TaskId[]>, DatabaseError>
    readonly insert: (task: Task) => Effect.Effect<void, DatabaseError>
    readonly update: (task: Task) => Effect.Effect<void, DatabaseError>
    readonly remove: (id: string) => Effect.Effect<void, DatabaseError>
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

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
            const limit = filter?.limit ? `LIMIT ${filter.limit}` : ""
            const sql = `SELECT * FROM tasks ${where} ORDER BY score DESC, created_at ASC ${limit}`
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
            const result = new Map<string, readonly TaskId[]>()
            if (ids.length === 0) return result

            const placeholders = ids.map(() => "?").join(",")
            const rows = db.prepare(
              `SELECT id, parent_id FROM tasks WHERE parent_id IN (${placeholders})`
            ).all(...ids) as Array<{ id: string; parent_id: string }>

            // Initialize all requested IDs with empty arrays
            for (const id of ids) {
              result.set(id, [])
            }

            // Group by parent_id
            for (const row of rows) {
              const existing = result.get(row.parent_id) ?? []
              result.set(row.parent_id, [...existing, row.id as TaskId])
            }

            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insert: (task) =>
        Effect.try({
          try: () => {
            db.prepare(
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
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (task) =>
        Effect.try({
          try: () => {
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
            )
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (id) =>
        Effect.try({
          try: () => {
            db.prepare("DELETE FROM tasks WHERE id = ?").run(id)
          },
          catch: (cause) => new DatabaseError({ cause })
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

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
            const result = db.prepare(`SELECT COUNT(*) as cnt FROM tasks ${where}`).get(...params) as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
