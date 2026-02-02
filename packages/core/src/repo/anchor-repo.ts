import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToAnchor } from "../mappers/anchor.js"
import type { Anchor, AnchorRow, CreateAnchorInput, UpdateAnchorInput, AnchorStatus } from "@tx/types"

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
               (learning_id, anchor_type, anchor_value, file_path, symbol_fqname, line_start, line_end, content_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              input.learningId,
              input.anchorType,
              input.anchorValue,
              input.filePath,
              input.symbolFqname ?? null,
              input.lineStart ?? null,
              input.lineEnd ?? null,
              input.contentHash ?? null
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
        })
    }
  })
)
