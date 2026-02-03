import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToAnchor, rowToInvalidationLog } from "../mappers/anchor.js"
import type { Anchor, AnchorRow, CreateAnchorInput, UpdateAnchorInput, AnchorStatus, InvalidationLog, InvalidationLogRow, InvalidationSource } from "@jamesaphoenix/tx-types"

/** Input for logging an invalidation event */
export interface LogInvalidationInput {
  readonly anchorId: number
  readonly oldStatus: AnchorStatus
  readonly newStatus: AnchorStatus
  readonly reason: string
  readonly detectedBy: InvalidationSource
  readonly oldContentHash?: string | null
  readonly newContentHash?: string | null
  readonly similarityScore?: number | null
}

export class AnchorRepository extends Context.Tag("AnchorRepository")<
  AnchorRepository,
  {
    readonly create: (input: CreateAnchorInput) => Effect.Effect<Anchor, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<Anchor | null, DatabaseError>
    readonly findByLearningId: (learningId: number) => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly findByFilePath: (filePath: string) => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly update: (id: number, input: UpdateAnchorInput) => Effect.Effect<Anchor | null, DatabaseError>
    readonly delete: (id: number) => Effect.Effect<boolean, DatabaseError>
    readonly findDrifted: () => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly findInvalid: () => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly updateStatus: (id: number, status: AnchorStatus) => Effect.Effect<boolean, DatabaseError>
    readonly updateVerifiedAt: (id: number) => Effect.Effect<boolean, DatabaseError>
    /** Find all anchors */
    readonly findAll: () => Effect.Effect<readonly Anchor[], DatabaseError>
    /** Find all valid anchors (for verification) */
    readonly findAllValid: () => Effect.Effect<readonly Anchor[], DatabaseError>
    /** Set pinned status */
    readonly setPinned: (id: number, pinned: boolean) => Effect.Effect<boolean, DatabaseError>
    /** Delete old invalid anchors */
    readonly deleteOldInvalid: (olderThanDays: number) => Effect.Effect<number, DatabaseError>
    /** Log an invalidation event */
    readonly logInvalidation: (input: LogInvalidationInput) => Effect.Effect<InvalidationLog, DatabaseError>
    /** Get invalidation logs for an anchor */
    readonly getInvalidationLogs: (anchorId?: number) => Effect.Effect<readonly InvalidationLog[], DatabaseError>
    /** Get anchor status summary */
    readonly getStatusSummary: () => Effect.Effect<{ valid: number; drifted: number; invalid: number; pinned: number; total: number }, DatabaseError>
  }
>() {}

export const AnchorRepositoryLive = Layer.effect(
  AnchorRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      create: (input) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO learning_anchors
               (learning_id, anchor_type, anchor_value, file_path, symbol_fqname, line_start, line_end, content_hash, content_preview)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              input.learningId,
              input.anchorType,
              input.anchorValue,
              input.filePath,
              input.symbolFqname ?? null,
              input.lineStart ?? null,
              input.lineEnd ?? null,
              input.contentHash ?? null,
              input.contentPreview ?? null
            )
            const row = db.prepare("SELECT * FROM learning_anchors WHERE id = ?").get(result.lastInsertRowid) as AnchorRow
            return rowToAnchor(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM learning_anchors WHERE id = ?").get(id) as AnchorRow | undefined
            return row ? rowToAnchor(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByLearningId: (learningId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_anchors WHERE learning_id = ? ORDER BY created_at ASC"
            ).all(learningId) as AnchorRow[]
            return rows.map(rowToAnchor)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByFilePath: (filePath) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_anchors WHERE file_path = ? ORDER BY created_at ASC"
            ).all(filePath) as AnchorRow[]
            return rows.map(rowToAnchor)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (id, input) =>
        Effect.try({
          try: () => {
            const updates: string[] = []
            const values: unknown[] = []

            if (input.anchorValue !== undefined) {
              updates.push("anchor_value = ?")
              values.push(input.anchorValue)
            }
            if (input.filePath !== undefined) {
              updates.push("file_path = ?")
              values.push(input.filePath)
            }
            if (input.symbolFqname !== undefined) {
              updates.push("symbol_fqname = ?")
              values.push(input.symbolFqname)
            }
            if (input.lineStart !== undefined) {
              updates.push("line_start = ?")
              values.push(input.lineStart)
            }
            if (input.lineEnd !== undefined) {
              updates.push("line_end = ?")
              values.push(input.lineEnd)
            }
            if (input.contentHash !== undefined) {
              updates.push("content_hash = ?")
              values.push(input.contentHash)
            }
            if (input.contentPreview !== undefined) {
              updates.push("content_preview = ?")
              values.push(input.contentPreview)
            }
            if (input.status !== undefined) {
              updates.push("status = ?")
              values.push(input.status)
            }
            if (input.verifiedAt !== undefined) {
              updates.push("verified_at = ?")
              values.push(input.verifiedAt ? input.verifiedAt.toISOString() : null)
            }

            if (updates.length === 0) {
              const row = db.prepare("SELECT * FROM learning_anchors WHERE id = ?").get(id) as AnchorRow | undefined
              return row ? rowToAnchor(row) : null
            }

            values.push(id)
            const result = db.prepare(
              `UPDATE learning_anchors SET ${updates.join(", ")} WHERE id = ?`
            ).run(...values)

            if (result.changes === 0) {
              return null
            }

            const row = db.prepare("SELECT * FROM learning_anchors WHERE id = ?").get(id) as AnchorRow
            return rowToAnchor(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      delete: (id) =>
        Effect.try({
          try: () => {
            const result = db.prepare("DELETE FROM learning_anchors WHERE id = ?").run(id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findDrifted: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_anchors WHERE status = 'drifted' ORDER BY created_at ASC"
            ).all() as AnchorRow[]
            return rows.map(rowToAnchor)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findInvalid: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_anchors WHERE status = 'invalid' ORDER BY created_at ASC"
            ).all() as AnchorRow[]
            return rows.map(rowToAnchor)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      updateStatus: (id, status) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE learning_anchors SET status = ? WHERE id = ?"
            ).run(status, id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      updateVerifiedAt: (id) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE learning_anchors SET verified_at = datetime('now') WHERE id = ?"
            ).run(id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_anchors ORDER BY created_at DESC"
            ).all() as AnchorRow[]
            return rows.map(rowToAnchor)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAllValid: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_anchors WHERE status = 'valid' ORDER BY created_at DESC"
            ).all() as AnchorRow[]
            return rows.map(rowToAnchor)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      setPinned: (id, pinned) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE learning_anchors SET pinned = ? WHERE id = ?"
            ).run(pinned ? 1 : 0, id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteOldInvalid: (olderThanDays) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `DELETE FROM learning_anchors
               WHERE status = 'invalid'
               AND created_at < datetime('now', '-' || ? || ' days')`
            ).run(olderThanDays)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      logInvalidation: (input) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO invalidation_log
               (anchor_id, old_status, new_status, reason, detected_by, old_content_hash, new_content_hash, similarity_score)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              input.anchorId,
              input.oldStatus,
              input.newStatus,
              input.reason,
              input.detectedBy,
              input.oldContentHash ?? null,
              input.newContentHash ?? null,
              input.similarityScore ?? null
            )
            const row = db.prepare("SELECT * FROM invalidation_log WHERE id = ?").get(result.lastInsertRowid) as InvalidationLogRow
            return rowToInvalidationLog(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getInvalidationLogs: (anchorId) =>
        Effect.try({
          try: () => {
            if (anchorId !== undefined) {
              const rows = db.prepare(
                "SELECT * FROM invalidation_log WHERE anchor_id = ? ORDER BY invalidated_at DESC, id DESC"
              ).all(anchorId) as InvalidationLogRow[]
              return rows.map(rowToInvalidationLog)
            }
            const rows = db.prepare(
              "SELECT * FROM invalidation_log ORDER BY invalidated_at DESC, id DESC LIMIT 100"
            ).all() as InvalidationLogRow[]
            return rows.map(rowToInvalidationLog)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getStatusSummary: () =>
        Effect.try({
          try: () => {
            const result = db.prepare(`
              SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END) as valid,
                SUM(CASE WHEN status = 'drifted' THEN 1 ELSE 0 END) as drifted,
                SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) as invalid,
                SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) as pinned
              FROM learning_anchors
            `).get() as { total: number; valid: number; drifted: number; invalid: number; pinned: number }
            return {
              total: result.total ?? 0,
              valid: result.valid ?? 0,
              drifted: result.drifted ?? 0,
              invalid: result.invalid ?? 0,
              pinned: result.pinned ?? 0
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
