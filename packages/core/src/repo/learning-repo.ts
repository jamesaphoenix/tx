import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError, LearningNotFoundError } from "../errors.js"
import { rowToLearning, rowToLearningWithoutEmbedding, float32ArrayToBuffer } from "../mappers/learning.js"
import { DEFAULT_QUERY_LIMIT } from "../utils/sql.js"
import type { Learning, LearningRow, LearningRowWithBM25, CreateLearningInput } from "@jamesaphoenix/tx-types"
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

/**
 * All learning columns EXCEPT embedding.
 * Used by queries where embedding data is discarded (BM25 search, listing, serialization).
 * Avoids loading ~6KB Float32Array per learning that would be immediately GC'd.
 */
const COLS_NO_EMBEDDING = "id, content, source_type, source_ref, created_at, keywords, category, usage_count, last_used_at, outcome_score"

/**
 * Same columns but table-qualified with `l.` prefix.
 * Required for JOINs (e.g., with learnings_fts) where `content`, `keywords`, and
 * `category` are ambiguous since both tables define them.
 */
const COLS_NO_EMBEDDING_QUALIFIED = "l.id, l.content, l.source_type, l.source_ref, l.created_at, l.keywords, l.category, l.usage_count, l.last_used_at, l.outcome_score"

/** Scored learning result from BM25 search */
export type BM25Result = {
  learning: Learning
  score: number
}

export class LearningRepository extends Context.Tag("LearningRepository")<
  LearningRepository,
  {
    readonly insert: (input: CreateLearningInput) => Effect.Effect<Learning, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<Learning | null, DatabaseError>
    readonly findAll: (limit?: number) => Effect.Effect<readonly Learning[], DatabaseError>
    /** Find learnings with pagination (cursor-based using id for stability) */
    readonly findPaginated: (limit: number, afterId?: number) => Effect.Effect<readonly Learning[], DatabaseError>
    /** Find learnings without embeddings with pagination (for batch embedding) */
    readonly findWithoutEmbeddingPaginated: (limit: number, afterId?: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly findRecent: (limit: number) => Effect.Effect<readonly Learning[], DatabaseError>
    /** Find recent learnings without loading embedding data (for listing/serialization) */
    readonly findRecentWithoutEmbedding: (limit: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly bm25Search: (query: string, limit: number) => Effect.Effect<readonly BM25Result[], DatabaseError>
    /** Find learnings that have embeddings (for vector search) */
    readonly findWithEmbeddings: (limit: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly incrementUsage: (id: number) => Effect.Effect<void, DatabaseError>
    readonly incrementUsageMany: (ids: readonly number[]) => Effect.Effect<void, DatabaseError>
    readonly updateOutcomeScore: (id: number, score: number) => Effect.Effect<void, DatabaseError>
    readonly updateEmbedding: (id: number, embedding: Float32Array) => Effect.Effect<void, DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, DatabaseError | LearningNotFoundError>
    readonly count: () => Effect.Effect<number, DatabaseError>
    readonly countWithEmbeddings: () => Effect.Effect<number, DatabaseError>
    readonly countWithoutEmbeddings: () => Effect.Effect<number, DatabaseError>
    readonly getConfig: (key: string) => Effect.Effect<string | null, DatabaseError>
  }
>() {}

/**
 * Build a three-tier FTS5 query for optimal relevance:
 * 1. Exact phrase match (highest priority)
 * 2. Proximity match with NEAR (terms close together)
 * 3. OR match (any term matches)
 *
 * Adapted from qmd search implementation.
 */
const buildFTS5Query = (query: string): string => {
  // Sanitize query: remove special chars except apostrophes
  const sanitized = query.replace(/[^\w\s']/g, "").trim()

  // Extract terms (at least 2 chars)
  const terms = query
    .split(/\s+/)
    .map(t => t.replace(/[^\w']/g, ""))
    .filter(t => t.length >= 2)

  if (terms.length === 0) return ""
  if (terms.length === 1) {
    // Single term: just escape it
    return `"${terms[0]!.replace(/"/g, '""')}"`
  }

  // Quote each term for safety
  const quoted = terms.map(t => `"${t.replace(/"/g, '""')}"`)

  // Three-tier query:
  // 1. Exact phrase (highest relevance)
  const phrase = `"${sanitized.replace(/"/g, '""')}"`

  // 2. NEAR proximity (terms within 10 words)
  const near = `NEAR(${quoted.join(" ")}, 10)`

  // 3. OR match (any term)
  const or = quoted.join(" OR ")

  return `(${phrase}) OR (${near}) OR (${or})`
}

export const LearningRepositoryLive = Layer.effect(
  LearningRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()
          const result = yield* Effect.try({
            try: () =>
              db.prepare(
                `INSERT INTO learnings (content, source_type, source_ref, created_at, keywords, category)
                 VALUES (?, ?, ?, ?, ?, ?)`
              ).run(
                input.content,
                input.sourceType ?? "manual",
                input.sourceRef ?? null,
                now,
                input.keywords ? JSON.stringify(input.keywords) : null,
                input.category ?? null
              ),
            catch: (cause) => new DatabaseError({ cause })
          })
          // Fetch the inserted row
          const row = yield* Effect.try({
            try: () => coerceDbResult<LearningRow | undefined>(db.prepare("SELECT * FROM learnings WHERE id = ?").get(result.lastInsertRowid)),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (!row) {
            return yield* Effect.fail(new DatabaseError({
              cause: new EntityFetchError({
                entity: "learning",
                id: coerceDbResult<number>(result.lastInsertRowid),
                operation: "insert"
              })
            }))
          }
          return rowToLearning(row)
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<LearningRow | undefined>(db.prepare("SELECT * FROM learnings WHERE id = ?").get(id))
            return row ? rowToLearning(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: (limit) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<LearningRow[]>(db.prepare(
              `SELECT * FROM learnings ORDER BY created_at ASC LIMIT ?`
            ).all(limit ?? DEFAULT_QUERY_LIMIT))
            return rows.map(rowToLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findPaginated: (limit, afterId) =>
        Effect.try({
          try: () => {
            const rows = afterId !== undefined
              ? coerceDbResult<LearningRow[]>(db.prepare(
                  `SELECT * FROM learnings WHERE id > ? ORDER BY id ASC LIMIT ?`
                ).all(afterId, limit))
              : coerceDbResult<LearningRow[]>(db.prepare(
                  `SELECT * FROM learnings ORDER BY id ASC LIMIT ?`
                ).all(limit))
            return rows.map(rowToLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findWithoutEmbeddingPaginated: (limit, afterId) =>
        Effect.try({
          try: () => {
            const rows = afterId !== undefined
              ? coerceDbResult<LearningRow[]>(db.prepare(
                  `SELECT * FROM learnings WHERE embedding IS NULL AND id > ? ORDER BY id ASC LIMIT ?`
                ).all(afterId, limit))
              : coerceDbResult<LearningRow[]>(db.prepare(
                  `SELECT * FROM learnings WHERE embedding IS NULL ORDER BY id ASC LIMIT ?`
                ).all(limit))
            return rows.map(rowToLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findRecent: (limit) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<LearningRow[]>(db.prepare(
              `SELECT * FROM learnings ORDER BY created_at DESC LIMIT ?`
            ).all(limit))
            return rows.map(rowToLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findRecentWithoutEmbedding: (limit) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<Omit<LearningRow, "embedding">[]>(db.prepare(
              `SELECT ${COLS_NO_EMBEDDING} FROM learnings ORDER BY created_at DESC LIMIT ?`
            ).all(limit))
            return rows.map(rowToLearningWithoutEmbedding)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      bm25Search: (query, limit) =>
        Effect.try({
          try: () => {
            const ftsQuery = buildFTS5Query(query)
            if (!ftsQuery) return []

            // FTS5 BM25 returns negative scores; lower (more negative) = better match
            // Exclude embedding column — BM25 results never need it, and loading
            // ~6KB Float32Array per row just to discard it wastes memory.
            const rows = coerceDbResult<Omit<LearningRowWithBM25, "embedding">[]>(db.prepare(`
              SELECT ${COLS_NO_EMBEDDING_QUALIFIED}, bm25(learnings_fts) as bm25_score
              FROM learnings l
              JOIN learnings_fts ON l.id = learnings_fts.rowid
              WHERE learnings_fts MATCH ?
              ORDER BY bm25_score
              LIMIT ?
            `).all(ftsQuery, limit * 3))

            if (rows.length === 0) return []

            // Use rank-based scoring: results are already sorted by relevance
            // Best match gets 1.0, decays with rank
            // Formula: score = 1.0 / (1 + rank * 0.1) gives 1.0, 0.91, 0.83, ...
            return rows.map((row, rank) => ({
              learning: rowToLearningWithoutEmbedding(row),
              score: 1.0 / (1 + rank * 0.1)
            }))
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findWithEmbeddings: (limit) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<LearningRow[]>(db.prepare(
              `SELECT * FROM learnings WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT ?`
            ).all(limit))
            return rows.map(rowToLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      incrementUsage: (id) =>
        Effect.try({
          try: () => {
            db.prepare(
              `UPDATE learnings SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?`
            ).run(new Date().toISOString(), id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      incrementUsageMany: (ids) =>
        Effect.try({
          try: () => {
            if (ids.length === 0) return
            const now = new Date().toISOString()
            for (const chunk of chunkBySqlLimit(ids)) {
              const placeholders = chunk.map(() => "?").join(", ")
              db.prepare(
                `UPDATE learnings SET usage_count = usage_count + 1, last_used_at = ? WHERE id IN (${placeholders})`
              ).run(now, ...chunk)
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      updateOutcomeScore: (id, score) =>
        Effect.try({
          try: () => {
            db.prepare(
              `UPDATE learnings SET outcome_score = ? WHERE id = ?`
            ).run(score, id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      updateEmbedding: (id, embedding) =>
        Effect.try({
          try: () => {
            db.prepare(
              `UPDATE learnings SET embedding = ? WHERE id = ?`
            ).run(float32ArrayToBuffer(embedding), id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () => db.prepare("DELETE FROM learnings WHERE id = ?").run(id),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (result.changes === 0) {
            yield* Effect.fail(new LearningNotFoundError({ id }))
          }
        }),

      count: () =>
        Effect.try({
          try: () => {
            const result = coerceDbResult<{ cnt: number }>(db.prepare("SELECT COUNT(*) as cnt FROM learnings").get())
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countWithEmbeddings: () =>
        Effect.try({
          try: () => {
            const result = coerceDbResult<{ cnt: number }>(db.prepare("SELECT COUNT(*) as cnt FROM learnings WHERE embedding IS NOT NULL").get())
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countWithoutEmbeddings: () =>
        Effect.try({
          try: () => {
            const result = coerceDbResult<{ cnt: number }>(db.prepare("SELECT COUNT(*) as cnt FROM learnings WHERE embedding IS NULL").get())
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getConfig: (key) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<{ value: string } | undefined>(db.prepare("SELECT value FROM learnings_config WHERE key = ?").get(key))
            return row?.value ?? null
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
