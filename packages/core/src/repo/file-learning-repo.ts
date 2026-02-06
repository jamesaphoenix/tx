import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError, FileLearningNotFoundError } from "../errors.js"
import { rowToFileLearning, matchesPattern } from "../mappers/file-learning.js"
import { DEFAULT_QUERY_LIMIT } from "../utils/sql.js"
import type { FileLearning, FileLearningRow, CreateFileLearningInput } from "@jamesaphoenix/tx-types"

export class FileLearningRepository extends Context.Tag("FileLearningRepository")<
  FileLearningRepository,
  {
    readonly insert: (input: CreateFileLearningInput) => Effect.Effect<FileLearning, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<FileLearning | null, DatabaseError>
    readonly findAll: (limit?: number) => Effect.Effect<readonly FileLearning[], DatabaseError>
    readonly findByPath: (path: string) => Effect.Effect<readonly FileLearning[], DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, DatabaseError | FileLearningNotFoundError>
    readonly count: () => Effect.Effect<number, DatabaseError>
  }
>() {}

export const FileLearningRepositoryLive = Layer.effect(
  FileLearningRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db.prepare(
              `INSERT INTO file_learnings (file_pattern, note, task_id, created_at)
               VALUES (?, ?, ?, ?)`
            ).run(
              input.filePattern,
              input.note,
              input.taskId ?? null,
              now
            )
            // Fetch the inserted row
            const row = db.prepare("SELECT * FROM file_learnings WHERE id = ?").get(result.lastInsertRowid) as FileLearningRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "file_learning",
                id: result.lastInsertRowid as number,
                operation: "insert"
              })
            }
            return rowToFileLearning(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM file_learnings WHERE id = ?").get(id) as FileLearningRow | undefined
            return row ? rowToFileLearning(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: (limit) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM file_learnings ORDER BY created_at DESC LIMIT ?`
            ).all(limit ?? DEFAULT_QUERY_LIMIT) as FileLearningRow[]
            return rows.map(rowToFileLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByPath: (path) =>
        Effect.try({
          try: () => {
            // Get all file learnings and filter by pattern matching
            const rows = db.prepare(
              `SELECT * FROM file_learnings ORDER BY created_at DESC`
            ).all() as FileLearningRow[]

            return rows
              .filter(row => matchesPattern(row.file_pattern, path))
              .map(rowToFileLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () => db.prepare("DELETE FROM file_learnings WHERE id = ?").run(id),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new FileLearningNotFoundError({ id }))
          }
        }),

      count: () =>
        Effect.try({
          try: () => {
            const result = db.prepare("SELECT COUNT(*) as cnt FROM file_learnings").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
