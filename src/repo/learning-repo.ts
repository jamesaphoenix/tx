import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import {
  type Learning,
  type LearningRow,
  type LearningRowWithBM25,
  type CreateLearningInput,
  rowToLearning,
  float32ArrayToBuffer
} from "../schemas/learning.js"

/** Scored learning result from BM25 search */
export interface BM25Result {
  learning: Learning
  score: number
}

export class LearningRepository extends Context.Tag("LearningRepository")<
  LearningRepository,
  {
    readonly insert: (input: CreateLearningInput) => Effect.Effect<Learning, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<Learning | null, DatabaseError>
    readonly findAll: () => Effect.Effect<readonly Learning[], DatabaseError>
    readonly findRecent: (limit: number) => Effect.Effect<readonly Learning[], DatabaseError>
    readonly bm25Search: (query: string, limit: number) => Effect.Effect<readonly BM25Result[], DatabaseError>
    readonly incrementUsage: (id: number) => Effect.Effect<void, DatabaseError>
    readonly updateOutcomeScore: (id: number, score: number) => Effect.Effect<void, DatabaseError>
    readonly updateEmbedding: (id: number, embedding: Float32Array) => Effect.Effect<void, DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
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
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db.prepare(
              `INSERT INTO learnings (content, source_type, source_ref, created_at, keywords, category)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(
              input.content,
              input.sourceType ?? "manual",
              input.sourceRef ?? null,
              now,
              input.keywords ? JSON.stringify(input.keywords) : null,
              input.category ?? null
            )
            // Fetch the inserted row
            const row = db.prepare("SELECT * FROM learnings WHERE id = ?").get(result.lastInsertRowid) as LearningRow
            return rowToLearning(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM learnings WHERE id = ?").get(id) as LearningRow | undefined
            return row ? rowToLearning(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findRecent: (limit) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM learnings ORDER BY created_at DESC LIMIT ?`
            ).all(limit) as LearningRow[]
            return rows.map(rowToLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      bm25Search: (query, limit) =>
        Effect.try({
          try: () => {
            const ftsQuery = buildFTS5Query(query)
            if (!ftsQuery) return []

            // FTS5 BM25 returns negative scores; lower (more negative) = better match
            const rows = db.prepare(`
              SELECT l.*, bm25(learnings_fts) as bm25_score
              FROM learnings l
              JOIN learnings_fts ON l.id = learnings_fts.rowid
              WHERE learnings_fts MATCH ?
              ORDER BY bm25_score
              LIMIT ?
            `).all(ftsQuery, limit * 3) as LearningRowWithBM25[]

            if (rows.length === 0) return []

            // Use rank-based scoring: results are already sorted by relevance
            // Best match gets 1.0, decays with rank
            // Formula: score = 1.0 / (1 + rank * 0.1) gives 1.0, 0.91, 0.83, ...
            return rows.map((row, rank) => ({
              learning: rowToLearning(row),
              score: 1.0 / (1 + rank * 0.1)
            }))
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
        Effect.try({
          try: () => {
            db.prepare("DELETE FROM learnings WHERE id = ?").run(id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      count: () =>
        Effect.try({
          try: () => {
            const result = db.prepare("SELECT COUNT(*) as cnt FROM learnings").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getConfig: (key) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT value FROM learnings_config WHERE key = ?").get(key) as { value: string } | undefined
            return row?.value ?? null
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
