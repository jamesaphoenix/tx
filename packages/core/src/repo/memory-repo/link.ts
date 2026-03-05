import { Effect } from "effect"
import type { SqliteDatabase } from "../../db.js"
import { DatabaseError } from "../../errors.js"
import { rowToMemoryLink } from "../../mappers/memory.js"
import type { MemoryLinkRow } from "@jamesaphoenix/tx-types"
import type { MemoryLinkRepositoryService } from "../memory-repo.js"
import { runImmediateTransaction } from "./shared.js"

export const createMemoryLinkRepository = (
  db: SqliteDatabase
): MemoryLinkRepositoryService => ({
  insertLinks: (links) =>
    Effect.gen(function* () {
      if (links.length === 0) return
      const transaction = runImmediateTransaction(db, () => {
        const stmt = db.prepare(
          "INSERT OR IGNORE INTO memory_links (source_doc_id, target_ref, link_type, created_at) VALUES (?, ?, ?, ?)"
        )
        const now = new Date().toISOString()
        for (const link of links) {
          stmt.run(link.sourceDocId, link.targetRef, link.linkType, now)
        }
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
    }),

  findOutgoing: (docId) =>
    Effect.try({
      try: () => {
        const rows = db.prepare<MemoryLinkRow>(
          "SELECT * FROM memory_links WHERE source_doc_id = ? ORDER BY id"
        ).all(docId)
        return rows.map(rowToMemoryLink)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findIncoming: (docId) =>
    Effect.try({
      try: () => {
        const rows = db.prepare<MemoryLinkRow>(
          "SELECT * FROM memory_links WHERE target_doc_id = ? ORDER BY id"
        ).all(docId)
        return rows.map(rowToMemoryLink)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  deleteBySource: (docId) =>
    Effect.gen(function* () {
      const transaction = runImmediateTransaction(db, () => {
        db.prepare("DELETE FROM memory_links WHERE source_doc_id = ?").run(docId)
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
    }),

  resolveTargets: () =>
    Effect.gen(function* () {
      // Resolve unresolved target_refs by exact title match or file path match.
      // Two-step approach: SELECT unresolved links, then UPDATE each with best match.
      // Both steps inside one transaction to prevent TOCTOU races.
      const transaction = runImmediateTransaction(db, () => {
        const unresolved = db.prepare<{ id: number; source_doc_id: string; target_ref: string }>(
          "SELECT id, source_doc_id, target_ref FROM memory_links WHERE target_doc_id IS NULL"
        ).all()

        if (unresolved.length === 0) {
          return 0
        }

        // For each unresolved link, find the best matching document
        // Priority: exact file_path > file_path + .md > title match
        // Tiebreaker: indexed_at ASC then id ASC for deterministic resolution
        // Case-insensitive matching: wikilinks like [[my doc]] must resolve
        // to titles like "My Doc" or file paths like "My Doc.md"
        const findBest = db.prepare<{ id: string }>(`
              SELECT d.id FROM memory_documents d
              WHERE LOWER(d.file_path) = LOWER(?) OR LOWER(d.file_path) = LOWER(? || '.md') OR LOWER(d.title) = LOWER(?)
              ORDER BY
                CASE
                  WHEN LOWER(d.file_path) = LOWER(?) THEN 0
                  WHEN LOWER(d.file_path) = LOWER(? || '.md') THEN 1
                  ELSE 2
                END,
                d.indexed_at ASC,
                d.id ASC
              LIMIT 1
            `)

        const updateStmt = db.prepare(
          "UPDATE memory_links SET target_doc_id = ? WHERE id = ? AND target_doc_id IS NULL"
        )

        let resolved = 0
        for (const link of unresolved) {
          const match = findBest.get(
            link.target_ref, link.target_ref, link.target_ref,
            link.target_ref, link.target_ref
          )
          // Skip self-links: a document should not link to itself
          if (match && match.id !== link.source_doc_id) {
            updateStmt.run(match.id, link.id)
            resolved++
          }
        }
        return resolved
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
      return transaction.value
    }),

  insertExplicit: (sourceId, targetRef) =>
    Effect.gen(function* () {
      // Wrap INSERT + resolution UPDATE in a transaction to prevent
      // partial failure leaving a permanently-unresolved link row.
      const transaction = runImmediateTransaction(db, () => {
        const now = new Date().toISOString()
        db.prepare(
          "INSERT OR IGNORE INTO memory_links (source_doc_id, target_ref, link_type, created_at) VALUES (?, ?, 'explicit', ?)"
        ).run(sourceId, targetRef, now)
        // Attempt immediate resolution so explicit links work without a full index() run
        // Case-insensitive matching (same as resolveTargets)
        const match = db.prepare<{ id: string }>(`
              SELECT d.id FROM memory_documents d
              WHERE LOWER(d.file_path) = LOWER(?) OR LOWER(d.file_path) = LOWER(? || '.md') OR LOWER(d.title) = LOWER(?)
              ORDER BY
                CASE
                  WHEN LOWER(d.file_path) = LOWER(?) THEN 0
                  WHEN LOWER(d.file_path) = LOWER(? || '.md') THEN 1
                  ELSE 2
                END,
                d.indexed_at ASC, d.id ASC
              LIMIT 1
            `).get(targetRef, targetRef, targetRef, targetRef, targetRef)
        if (match && match.id !== sourceId) {
          db.prepare(
            "UPDATE memory_links SET target_doc_id = ? WHERE source_doc_id = ? AND target_ref = ? AND link_type = 'explicit'"
          ).run(match.id, sourceId, targetRef)
        }
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
    }),

  count: () =>
    Effect.try({
      try: () => {
        const result = db.prepare<{ cnt: number }>("SELECT COUNT(*) as cnt FROM memory_links").get()
        if (!result) return 0
        return result.cnt
      },
      catch: (cause) => new DatabaseError({ cause })
    }),
})
