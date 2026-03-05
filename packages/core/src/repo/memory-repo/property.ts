import { Effect } from "effect"
import type { SqliteDatabase } from "../../db.js"
import { DatabaseError } from "../../errors.js"
import { rowToMemoryProperty } from "../../mappers/memory.js"
import type { MemoryPropertyRow } from "@jamesaphoenix/tx-types"
import type { MemoryPropertyRepositoryService } from "../memory-repo.js"
import { runImmediateTransaction } from "./shared.js"

export const createMemoryPropertyRepository = (
  db: SqliteDatabase
): MemoryPropertyRepositoryService => ({
  setProperty: (docId, key, value) =>
    Effect.try({
      try: () => {
        db.prepare(
          "INSERT INTO memory_properties (doc_id, key, value) VALUES (?, ?, ?) ON CONFLICT(doc_id, key) DO UPDATE SET value = excluded.value"
        ).run(docId, key, value)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getProperty: (docId, key) =>
    Effect.try({
      try: () => {
        const row = db.prepare<MemoryPropertyRow>(
          "SELECT * FROM memory_properties WHERE doc_id = ? AND key = ?"
        ).get(docId, key)
        return row ? rowToMemoryProperty(row) : null
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getProperties: (docId) =>
    Effect.try({
      try: () => {
        const rows = db.prepare<MemoryPropertyRow>(
          "SELECT * FROM memory_properties WHERE doc_id = ? ORDER BY key"
        ).all(docId)
        return rows.map(rowToMemoryProperty)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  deleteProperty: (docId, key) =>
    Effect.try({
      try: () => {
        db.prepare(
          "DELETE FROM memory_properties WHERE doc_id = ? AND key = ?"
        ).run(docId, key)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  syncFromFrontmatter: (docId, properties) =>
    Effect.gen(function* () {
      const transaction = runImmediateTransaction(db, () => {
        // Delete existing properties for this doc
        db.prepare("DELETE FROM memory_properties WHERE doc_id = ?").run(docId)
        // Insert new ones
        const stmt = db.prepare(
          "INSERT INTO memory_properties (doc_id, key, value) VALUES (?, ?, ?)"
        )
        for (const [key, value] of Object.entries(properties)) {
          stmt.run(docId, key, String(value))
        }
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
    }),

  findByProperty: (key, value) =>
    Effect.try({
      try: () => {
        const rows = value !== undefined
          ? db.prepare<{ doc_id: string }>(
              "SELECT doc_id FROM memory_properties WHERE key = ? AND value = ?"
            ).all(key, value)
          : db.prepare<{ doc_id: string }>(
              "SELECT doc_id FROM memory_properties WHERE key = ?"
            ).all(key)
        return rows.map(r => r.doc_id)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),
})
