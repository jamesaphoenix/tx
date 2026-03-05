import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { AttemptNotFoundError, DatabaseError, EntityFetchError } from "../errors.js"
import { rowToAttempt } from "../mappers/attempt.js"
import type { Attempt, AttemptId, AttemptRow, CreateAttemptInput } from "@jamesaphoenix/tx-types"
import { coerceDbResult } from "../utils/db-result.js"

const MAX_SQL_VARIABLES = 900

const chunkBySqlLimit = <T>(
  values: readonly T[],
  chunkSize: number = MAX_SQL_VARIABLES
): ReadonlyArray<ReadonlyArray<T>> => {
  if (values.length === 0) {
    return []
  }
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(coerceDbResult<T[]>(values.slice(i, i + chunkSize)))
  }
  return chunks
}

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
    readonly remove: (id: AttemptId) => Effect.Effect<void, DatabaseError | AttemptNotFoundError>

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
            const row = coerceDbResult<AttemptRow | undefined>(db.prepare("SELECT * FROM attempts WHERE id = ?").get(result.lastInsertRowid))
            if (!row) {
              throw new EntityFetchError({
                entity: "attempt",
                id: coerceDbResult<number>(result.lastInsertRowid),
                operation: "insert"
              })
            }
            return rowToAttempt(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<AttemptRow | undefined>(db.prepare("SELECT * FROM attempts WHERE id = ?").get(id))
            return row ? rowToAttempt(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<AttemptRow[]>(db.prepare(
              "SELECT * FROM attempts ORDER BY created_at ASC"
            ).all())
            return rows.map(rowToAttempt)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByTaskId: (taskId) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<AttemptRow[]>(db.prepare(
              "SELECT * FROM attempts WHERE task_id = ? ORDER BY created_at DESC, id DESC"
            ).all(taskId))
            return rows.map(rowToAttempt)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      count: (taskId) =>
        Effect.try({
          try: () => {
            if (taskId) {
              const result = coerceDbResult<{ cnt: number }>(db.prepare(
                "SELECT COUNT(*) as cnt FROM attempts WHERE task_id = ?"
              ).get(taskId))
              return result.cnt
            }
            const result = coerceDbResult<{ cnt: number }>(db.prepare("SELECT COUNT(*) as cnt FROM attempts").get())
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () => db.prepare("DELETE FROM attempts WHERE id = ?").run(id),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new AttemptNotFoundError({ id }))
          }
        }),

      getFailedCountsForTasks: (taskIds) =>
        Effect.try({
          try: () => {
            if (taskIds.length === 0) {
              return new Map<string, number>()
            }

            const result = new Map<string, number>()
            for (const chunk of chunkBySqlLimit(taskIds)) {
              const placeholders = chunk.map(() => "?").join(", ")
              const rows = coerceDbResult<Array<{ task_id: string; cnt: number }>>(db.prepare(
                `SELECT task_id, COUNT(*) as cnt FROM attempts
                 WHERE task_id IN (${placeholders}) AND outcome = 'failed'
                 GROUP BY task_id`
              ).all(...chunk))
              for (const row of rows) {
                result.set(row.task_id, row.cnt)
              }
            }
            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
