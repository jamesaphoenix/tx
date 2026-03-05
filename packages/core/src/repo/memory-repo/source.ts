import { Effect } from "effect"
import type { SqliteDatabase } from "../../db.js"
import { DatabaseError } from "../../errors.js"
import { rowToMemorySource } from "../../mappers/memory.js"
import type { MemorySourceRow } from "@jamesaphoenix/tx-types"
import type { MemorySourceRepositoryService } from "../memory-repo.js"
import { runImmediateTransaction } from "./shared.js"

export const createMemorySourceRepository = (
  db: SqliteDatabase
): MemorySourceRepositoryService => ({
  addSource: (rootDir, label) =>
    Effect.gen(function* () {
      const now = new Date().toISOString()
      const transaction = runImmediateTransaction(db, () => {
        db.prepare(
          "INSERT INTO memory_sources (root_dir, label, created_at) VALUES (?, ?, ?) ON CONFLICT(root_dir) DO UPDATE SET label = excluded.label"
        ).run(rootDir, label ?? null, now)
        const row = db.prepare<MemorySourceRow>(
          "SELECT * FROM memory_sources WHERE root_dir = ?"
        ).get(rootDir)
        if (!row) {
          return new DatabaseError({
            cause: new Error(`addSource: no source found with root_dir=${rootDir}`)
          })
        }
        return rowToMemorySource(row)
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
      if (transaction.value instanceof DatabaseError) {
        return yield* Effect.fail(transaction.value)
      }
      return transaction.value
    }),

  removeSource: (rootDir) =>
    Effect.gen(function* () {
      // Atomic removal: null-out incoming links -> delete outgoing links -> delete documents -> delete source
      // All in one transaction to prevent orphaned rows if index() runs concurrently
      const transaction = runImmediateTransaction(db, () => {
        // Null-out incoming target_doc_id references (other sources linking TO docs in this source)
        db.prepare(
          `UPDATE memory_links SET target_doc_id = NULL
               WHERE target_doc_id IN (SELECT id FROM memory_documents WHERE root_dir = ?)`
        ).run(rootDir)
        // Delete outgoing links FROM docs in this source (prevents phantom backlinks)
        db.prepare(
          `DELETE FROM memory_links
               WHERE source_doc_id IN (SELECT id FROM memory_documents WHERE root_dir = ?)`
        ).run(rootDir)
        db.prepare("DELETE FROM memory_documents WHERE root_dir = ?").run(rootDir)
        db.prepare("DELETE FROM memory_sources WHERE root_dir = ?").run(rootDir)
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
    }),

  listSources: () =>
    Effect.try({
      try: () => {
        const rows = db.prepare<MemorySourceRow>(
          "SELECT * FROM memory_sources ORDER BY created_at"
        ).all()
        return rows.map(rowToMemorySource)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findSource: (rootDir) =>
    Effect.try({
      try: () => {
        const row = db.prepare<MemorySourceRow>(
          "SELECT * FROM memory_sources WHERE root_dir = ?"
        ).get(rootDir)
        return row ? rowToMemorySource(row) : null
      },
      catch: (cause) => new DatabaseError({ cause })
    }),
})
