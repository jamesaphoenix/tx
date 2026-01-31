import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import {
  type Attempt,
  type AttemptId,
  type AttemptRow,
  type CreateAttemptInput,
  rowToAttempt
} from "../schemas/attempt.js"

export class AttemptRepository extends Context.Tag("AttemptRepository")<
  AttemptRepository,
  {
    /** Insert a new attempt record */
    readonly insert: (input: CreateAttemptInput) => Effect.Effect<Attempt, DatabaseError>

    /** Find an attempt by ID */
    readonly findById: (id: AttemptId) => Effect.Effect<Attempt | null, DatabaseError>

    /** Find all attempts */
    readonly findAll: () => Effect.Effect<readonly Attempt[], DatabaseError>

    /** Find all attempts for a task */
    readonly findByTaskId: (taskId: string) => Effect.Effect<readonly Attempt[], DatabaseError>

    /** Count attempts, optionally filtered by task */
    readonly count: (taskId?: string) => Effect.Effect<number, DatabaseError>

    /** Remove an attempt by ID */
    readonly remove: (id: AttemptId) => Effect.Effect<void, DatabaseError>

    /** Get failed attempt counts for multiple tasks in a single query */
    readonly getFailedCountsForTasks: (taskIds: readonly string[]) => Effect.Effect<Map<string, number>, DatabaseError>
  }
>() {}

export const AttemptRepositoryLive = Layer.effect(
  AttemptRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db.prepare(
              `INSERT INTO attempts (task_id, approach, outcome, reason, created_at)
               VALUES (?, ?, ?, ?, ?)`
            ).run(
              input.taskId,
              input.approach,
              input.outcome,
              input.reason ?? null,
              now
            )
            // Fetch the inserted row
            const row = db.prepare("SELECT * FROM attempts WHERE id = ?").get(result.lastInsertRowid) as AttemptRow
            return rowToAttempt(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as AttemptRow | undefined
            return row ? rowToAttempt(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM attempts ORDER BY created_at ASC"
            ).all() as AttemptRow[]
            return rows.map(rowToAttempt)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByTaskId: (taskId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM attempts WHERE task_id = ? ORDER BY created_at DESC"
            ).all(taskId) as AttemptRow[]
            return rows.map(rowToAttempt)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      count: (taskId) =>
        Effect.try({
          try: () => {
            if (taskId) {
              const result = db.prepare(
                "SELECT COUNT(*) as cnt FROM attempts WHERE task_id = ?"
              ).get(taskId) as { cnt: number }
              return result.cnt
            }
            const result = db.prepare("SELECT COUNT(*) as cnt FROM attempts").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (id) =>
        Effect.try({
          try: () => {
            db.prepare("DELETE FROM attempts WHERE id = ?").run(id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getFailedCountsForTasks: (taskIds) =>
        Effect.try({
          try: () => {
            if (taskIds.length === 0) {
              return new Map<string, number>()
            }
            const placeholders = taskIds.map(() => "?").join(", ")
            const rows = db.prepare(
              `SELECT task_id, COUNT(*) as cnt FROM attempts
               WHERE task_id IN (${placeholders}) AND outcome = 'failed'
               GROUP BY task_id`
            ).all(...taskIds) as Array<{ task_id: string; cnt: number }>
            const result = new Map<string, number>()
            for (const row of rows) {
              result.set(row.task_id, row.cnt)
            }
            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
