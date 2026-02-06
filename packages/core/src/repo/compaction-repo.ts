import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"

/**
 * Compaction log entry from database.
 */
export interface CompactionLogEntry {
  readonly id: number
  readonly compactedAt: Date
  readonly taskCount: number
  readonly summary: string
  readonly taskIds: readonly string[]
  readonly learningsExportedTo: string | null
  readonly learnings: string | null
}

/**
 * Input for creating a new compaction log entry.
 */
export interface CreateCompactionLogInput {
  readonly taskCount: number
  readonly summary: string
  readonly taskIds: readonly string[]
  readonly learningsExportedTo?: string | null
  readonly learnings: string
}

/**
 * Database row type for compaction_log (snake_case from SQLite).
 */
interface CompactionLogRow {
  id: number
  compacted_at: string
  task_count: number
  summary: string
  task_ids: string // JSON string array
  learnings_exported_to: string | null
  learnings: string | null
}

/**
 * Safely parse a JSON array of task ID strings, returning empty array on failure.
 */
const safeParseTaskIds = (json: string | null | undefined): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(json || "[]")
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

/**
 * Map database row to domain entity.
 */
const rowToCompactionLogEntry = (row: CompactionLogRow): CompactionLogEntry => ({
  id: row.id,
  compactedAt: new Date(row.compacted_at),
  taskCount: row.task_count,
  summary: row.summary,
  taskIds: safeParseTaskIds(row.task_ids),
  learningsExportedTo: row.learnings_exported_to,
  learnings: row.learnings
})

/**
 * Repository for compaction_log table operations.
 * Handles storage of compaction history and summaries.
 */
export class CompactionRepository extends Context.Tag("CompactionRepository")<
  CompactionRepository,
  {
    readonly insert: (input: CreateCompactionLogInput) => Effect.Effect<CompactionLogEntry, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<CompactionLogEntry | null, DatabaseError>
    readonly findAll: () => Effect.Effect<readonly CompactionLogEntry[], DatabaseError>
    readonly findRecent: (limit: number) => Effect.Effect<readonly CompactionLogEntry[], DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
  }
>() {}

export const CompactionRepositoryLive = Layer.effect(
  CompactionRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db.prepare(
              `INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to, learnings)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(
              now,
              input.taskCount,
              input.summary,
              JSON.stringify(input.taskIds),
              input.learningsExportedTo ?? null,
              input.learnings
            )
            const row = db.prepare("SELECT * FROM compaction_log WHERE id = ?").get(result.lastInsertRowid) as CompactionLogRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "compaction_log",
                id: result.lastInsertRowid as number,
                operation: "insert"
              })
            }
            return rowToCompactionLogEntry(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM compaction_log WHERE id = ?").get(id) as CompactionLogRow | undefined
            return row ? rowToCompactionLogEntry(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM compaction_log ORDER BY compacted_at DESC`
            ).all() as CompactionLogRow[]
            return rows.map(rowToCompactionLogEntry)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findRecent: (limit) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM compaction_log ORDER BY compacted_at DESC LIMIT ?`
            ).all(limit) as CompactionLogRow[]
            return rows.map(rowToCompactionLogEntry)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      count: () =>
        Effect.try({
          try: () => {
            const result = db.prepare("SELECT COUNT(*) as cnt FROM compaction_log").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
