/**
 * Decision repository — DB operations for decisions.
 */
import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { rowToDecision } from "../mappers/decision.js"
import { readNumberField } from "../utils/db-result.js"
import { DatabaseError } from "../errors.js"
import type { Decision, DecisionRow } from "@jamesaphoenix/tx-types"

export class DecisionRepository extends Context.Tag("DecisionRepository")<
  DecisionRepository,
  {
    insert: (input: {
      id: string
      content: string
      question?: string | null
      status?: string
      source?: string
      commitSha?: string | null
      runId?: string | null
      taskId?: string | null
      docId?: number | null
      contentHash: string
    }) => Effect.Effect<Decision, DatabaseError>
    findById: (id: string) => Effect.Effect<Decision | null, DatabaseError>
    findByContentHash: (hash: string) => Effect.Effect<Decision | null, DatabaseError>
    findAll: (filter?: {
      status?: string
      source?: string
      limit?: number
    }) => Effect.Effect<Decision[], DatabaseError>
    updateStatus: (
      id: string,
      status: string,
      fields?: {
        reviewedBy?: string
        reviewNote?: string
        editedContent?: string
        reviewedAt?: string
        invariantId?: string
        supersededBy?: string
        syncedToDoc?: boolean
      }
    ) => Effect.Effect<Decision | null, DatabaseError>
    countByStatus: (status: string) => Effect.Effect<number, DatabaseError>
    /** Atomically insert new decision and mark old as superseded. */
    supersedeAtomic: (
      oldId: string,
      newInput: {
        id: string
        content: string
        question?: string | null
        source?: string
        commitSha?: string | null
        runId?: string | null
        taskId?: string | null
        docId?: number | null
        contentHash: string
      }
    ) => Effect.Effect<{ old: Decision; new: Decision }, DatabaseError>
  }
>() {}

export const DecisionRepositoryLive = Layer.effect(
  DecisionRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () =>
              db.prepare(
                `INSERT INTO decisions (id, content, question, status, source, commit_sha, run_id, task_id, doc_id, content_hash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                input.id,
                input.content,
                input.question ?? null,
                input.status ?? "pending",
                input.source ?? "manual",
                input.commitSha ?? null,
                input.runId ?? null,
                input.taskId ?? null,
                input.docId ?? null,
                input.contentHash
              ),
            catch: (cause) => new DatabaseError({ cause }),
          })
          const row = yield* Effect.try({
            try: () =>
              db
                .prepare<DecisionRow>("SELECT * FROM decisions WHERE id = ?")
                .get(input.id),
            catch: (cause) => new DatabaseError({ cause }),
          })
          if (!row) {
            return yield* Effect.fail(
              new DatabaseError({ cause: `Failed to fetch decision after insert: ${input.id}` })
            )
          }
          return rowToDecision(row)
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DecisionRow>("SELECT * FROM decisions WHERE id = ?")
              .get(id)
            return row ? rowToDecision(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findByContentHash: (hash) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DecisionRow>("SELECT * FROM decisions WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1")
              .get(hash)
            return row ? rowToDecision(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findAll: (filter) =>
        Effect.try({
          try: () => {
            const conditions: string[] = []
            const params: unknown[] = []

            if (filter?.status) {
              conditions.push("status = ?")
              params.push(filter.status)
            }
            if (filter?.source) {
              conditions.push("source = ?")
              params.push(filter.source)
            }

            const where =
              conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
            const limit = filter?.limit ?? 100
            const rows = db
              .prepare<DecisionRow>(
                `SELECT * FROM decisions ${where} ORDER BY created_at DESC LIMIT ?`
              )
              .all(...params, limit)
            return rows.map(rowToDecision)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      updateStatus: (id, status, fields) =>
        Effect.try({
          try: () => {
            const sets: string[] = ["status = ?", "updated_at = datetime('now')"]
            const params: unknown[] = [status]

            if (fields?.reviewedBy !== undefined) {
              sets.push("reviewed_by = ?")
              params.push(fields.reviewedBy)
            }
            if (fields?.reviewNote !== undefined) {
              sets.push("review_note = ?")
              params.push(fields.reviewNote)
            }
            if (fields?.editedContent !== undefined) {
              sets.push("edited_content = ?")
              params.push(fields.editedContent)
            }
            if (fields?.reviewedAt !== undefined) {
              sets.push("reviewed_at = ?")
              params.push(fields.reviewedAt)
            }
            if (fields?.invariantId !== undefined) {
              sets.push("invariant_id = ?")
              params.push(fields.invariantId)
            }
            if (fields?.supersededBy !== undefined) {
              sets.push("superseded_by = ?")
              params.push(fields.supersededBy)
            }
            if (fields?.syncedToDoc !== undefined) {
              sets.push("synced_to_doc = ?")
              params.push(fields.syncedToDoc ? 1 : 0)
            }

            params.push(id)
            db.prepare(
              `UPDATE decisions SET ${sets.join(", ")} WHERE id = ?`
            ).run(...params)

            const row = db
              .prepare<DecisionRow>("SELECT * FROM decisions WHERE id = ?")
              .get(id)
            return row ? rowToDecision(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      countByStatus: (status) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare(
                "SELECT COUNT(*) as cnt FROM decisions WHERE status = ?"
              )
              .get(status)
            return readNumberField(row, "cnt", "countByStatus")
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      supersedeAtomic: (oldId, newInput) =>
        Effect.gen(function* () {
          // Run insert + update + reads in a single BEGIN/COMMIT transaction
          yield* Effect.try({
            try: () => db.exec("BEGIN IMMEDIATE"),
            catch: (cause) => new DatabaseError({ cause }),
          })
          const result = yield* Effect.try({
            try: () => {
              // Insert new decision
              db.prepare(
                `INSERT INTO decisions (id, content, question, status, source, commit_sha, run_id, task_id, doc_id, content_hash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                newInput.id,
                newInput.content,
                newInput.question ?? null,
                "pending",
                newInput.source ?? "manual",
                newInput.commitSha ?? null,
                newInput.runId ?? null,
                newInput.taskId ?? null,
                newInput.docId ?? null,
                newInput.contentHash
              )
              // Mark old as superseded
              db.prepare(
                `UPDATE decisions SET status = 'superseded', superseded_by = ?, updated_at = datetime('now') WHERE id = ?`
              ).run(newInput.id, oldId)
              // Read both back
              const newRow = db
                .prepare<DecisionRow>("SELECT * FROM decisions WHERE id = ?")
                .get(newInput.id)
              const oldRow = db
                .prepare<DecisionRow>("SELECT * FROM decisions WHERE id = ?")
                .get(oldId)
              if (!oldRow || !newRow) {
                db.exec("ROLLBACK")
                return null
              }
              db.exec("COMMIT")
              return { old: rowToDecision(oldRow), new: rowToDecision(newRow) }
            },
            catch: (cause) => {
              try { db.exec("ROLLBACK") } catch { /* already rolled back */ }
              return new DatabaseError({ cause })
            },
          })
          if (!result) {
            return yield* Effect.fail(
              new DatabaseError({ cause: `Failed to read decisions after supersede: old=${oldId}, new=${newInput.id}` })
            )
          }
          return result
        }),
    }
  })
)
