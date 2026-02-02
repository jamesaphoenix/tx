import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToCandidate } from "../mappers/candidate.js"
import type {
  LearningCandidate,
  CandidateRow,
  CreateCandidateInput,
  UpdateCandidateInput,
  CandidateFilter,
  CandidateStatus
} from "@tx/types"

export class CandidateRepository extends Context.Tag("CandidateRepository")<
  CandidateRepository,
  {
    readonly insert: (input: CreateCandidateInput) => Effect.Effect<LearningCandidate, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<LearningCandidate | null, DatabaseError>
    readonly findByFilter: (filter: CandidateFilter) => Effect.Effect<readonly LearningCandidate[], DatabaseError>
    readonly update: (id: number, input: UpdateCandidateInput) => Effect.Effect<LearningCandidate | null, DatabaseError>
    readonly updateStatus: (id: number, status: CandidateStatus) => Effect.Effect<LearningCandidate | null, DatabaseError>
  }
>() {}

export const CandidateRepositoryLive = Layer.effect(
  CandidateRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db.prepare(
              `INSERT INTO learning_candidates
               (content, confidence, category, source_file, source_run_id, source_task_id, extracted_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
            ).run(
              input.content,
              input.confidence,
              input.category ?? null,
              input.sourceFile,
              input.sourceRunId ?? null,
              input.sourceTaskId ?? null,
              now
            )
            const row = db.prepare(
              "SELECT * FROM learning_candidates WHERE id = ?"
            ).get(result.lastInsertRowid) as CandidateRow
            return rowToCandidate(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM learning_candidates WHERE id = ?"
            ).get(id) as CandidateRow | undefined
            return row ? rowToCandidate(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByFilter: (filter) =>
        Effect.try({
          try: () => {
            const conditions: string[] = []
            const values: unknown[] = []

            // Status filter (supports single or array)
            if (filter.status !== undefined) {
              const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
              if (statuses.length > 0) {
                conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`)
                values.push(...statuses)
              }
            }

            // Confidence filter (supports single or array)
            if (filter.confidence !== undefined) {
              const confidences = Array.isArray(filter.confidence) ? filter.confidence : [filter.confidence]
              if (confidences.length > 0) {
                conditions.push(`confidence IN (${confidences.map(() => "?").join(", ")})`)
                values.push(...confidences)
              }
            }

            // Category filter (supports single or array)
            if (filter.category !== undefined) {
              const categories = Array.isArray(filter.category) ? filter.category : [filter.category]
              if (categories.length > 0) {
                conditions.push(`category IN (${categories.map(() => "?").join(", ")})`)
                values.push(...categories)
              }
            }

            // Source file filter
            if (filter.sourceFile !== undefined) {
              conditions.push("source_file = ?")
              values.push(filter.sourceFile)
            }

            // Source run ID filter
            if (filter.sourceRunId !== undefined) {
              conditions.push("source_run_id = ?")
              values.push(filter.sourceRunId)
            }

            // Source task ID filter
            if (filter.sourceTaskId !== undefined) {
              conditions.push("source_task_id = ?")
              values.push(filter.sourceTaskId)
            }

            // Build query
            let sql = "SELECT * FROM learning_candidates"
            if (conditions.length > 0) {
              sql += ` WHERE ${conditions.join(" AND ")}`
            }
            sql += " ORDER BY extracted_at DESC"

            // Limit and offset
            if (filter.limit !== undefined) {
              sql += " LIMIT ?"
              values.push(filter.limit)

              if (filter.offset !== undefined) {
                sql += " OFFSET ?"
                values.push(filter.offset)
              }
            }

            const rows = db.prepare(sql).all(...values) as CandidateRow[]
            return rows.map(rowToCandidate)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (id, input) =>
        Effect.try({
          try: () => {
            const updates: string[] = []
            const values: unknown[] = []

            if (input.status !== undefined) {
              updates.push("status = ?")
              values.push(input.status)
            }
            if (input.reviewedAt !== undefined) {
              updates.push("reviewed_at = ?")
              values.push(input.reviewedAt.toISOString())
            }
            if (input.reviewedBy !== undefined) {
              updates.push("reviewed_by = ?")
              values.push(input.reviewedBy)
            }
            if (input.promotedLearningId !== undefined) {
              updates.push("promoted_learning_id = ?")
              values.push(input.promotedLearningId)
            }
            if (input.rejectionReason !== undefined) {
              updates.push("rejection_reason = ?")
              values.push(input.rejectionReason)
            }

            if (updates.length === 0) {
              // No updates, just return the current row
              const row = db.prepare(
                "SELECT * FROM learning_candidates WHERE id = ?"
              ).get(id) as CandidateRow | undefined
              return row ? rowToCandidate(row) : null
            }

            values.push(id)
            const result = db.prepare(
              `UPDATE learning_candidates SET ${updates.join(", ")} WHERE id = ?`
            ).run(...values)

            if (result.changes === 0) {
              return null
            }

            const row = db.prepare(
              "SELECT * FROM learning_candidates WHERE id = ?"
            ).get(id) as CandidateRow
            return rowToCandidate(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      updateStatus: (id, status) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE learning_candidates SET status = ? WHERE id = ?"
            ).run(status, id)

            if (result.changes === 0) {
              return null
            }

            const row = db.prepare(
              "SELECT * FROM learning_candidates WHERE id = ?"
            ).get(id) as CandidateRow
            return rowToCandidate(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
