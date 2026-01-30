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

    /** Find all attempts for a task */
    readonly findByTaskId: (taskId: string) => Effect.Effect<readonly Attempt[], DatabaseError>

    /** Count attempts, optionally filtered by task */
    readonly count: (taskId?: string) => Effect.Effect<number, DatabaseError>

    /** Remove an attempt by ID */
    readonly remove: (id: AttemptId) => Effect.Effect<void, DatabaseError>
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
        })
    }
  })
)
