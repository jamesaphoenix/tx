import { Effect } from "effect"
import type { SqliteDatabase } from "../../db.js"
import { DatabaseError } from "../../errors.js"
import {
  rowToMemoryDocument,
  rowToMemoryDocumentWithoutEmbedding,
  float32ArrayToBuffer,
} from "../../mappers/memory.js"
import type {
  MemoryDocumentRow,
  MemoryDocumentRowWithBM25,
} from "@jamesaphoenix/tx-types"
import type { MemoryDocumentRepositoryService } from "../memory-repo.js"
import {
  chunkBySqlLimit,
  COLS_NO_EMBEDDING,
  COLS_NO_EMBEDDING_QUALIFIED,
  buildFTS5Query,
  runImmediateTransaction,
} from "./shared.js"

export const createMemoryDocumentRepository = (
  db: SqliteDatabase
): MemoryDocumentRepositoryService => ({
  upsertDocument: (doc) =>
    Effect.gen(function* () {
      // Wrap DELETE + INSERT in a transaction to prevent FTS desync if a crash
      // occurs between the two statements. DELETE fires memory_fts_ad,
      // INSERT fires memory_fts_ai — both must succeed atomically.
      const transaction = runImmediateTransaction(db, () => {
        db.prepare("DELETE FROM memory_documents WHERE file_path = ? AND root_dir = ?").run(doc.filePath, doc.rootDir)
        db.prepare(`
              INSERT INTO memory_documents (id, file_path, root_dir, title, content, frontmatter, tags, file_hash, file_mtime, created_at, indexed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
          doc.id, doc.filePath, doc.rootDir, doc.title, doc.content,
          doc.frontmatter, doc.tags, doc.fileHash, doc.fileMtime,
          doc.createdAt, doc.indexedAt
        )
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
    }),

  findById: (id) =>
    Effect.try({
      try: () => {
        const row = db.prepare<Omit<MemoryDocumentRow, "embedding">>(
          `SELECT ${COLS_NO_EMBEDDING} FROM memory_documents WHERE id = ?`
        ).get(id)
        return row ? rowToMemoryDocumentWithoutEmbedding(row) : null
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findByPath: (filePath, rootDir) =>
    Effect.try({
      try: () => {
        const row = db.prepare<Omit<MemoryDocumentRow, "embedding">>(
          `SELECT ${COLS_NO_EMBEDDING} FROM memory_documents WHERE file_path = ? AND root_dir = ?`
        ).get(filePath, rootDir)
        return row ? rowToMemoryDocumentWithoutEmbedding(row) : null
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findByHash: (hash) =>
    Effect.try({
      try: () => {
        const rows = db.prepare<Omit<MemoryDocumentRow, "embedding">>(
          `SELECT ${COLS_NO_EMBEDDING} FROM memory_documents WHERE file_hash = ?`
        ).all(hash)
        return rows.map(rowToMemoryDocumentWithoutEmbedding)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  searchBM25: (query, limit) =>
    Effect.try({
      try: () => {
        const ftsQuery = buildFTS5Query(query)
        if (!ftsQuery) return []

        // Cap limit to prevent unbounded queries.
        // Callers are responsible for over-fetching (e.g. limit * 3) when needed.
        const safeLimit = Math.min(Math.max(1, limit), 1000)
        const rows = db.prepare<Omit<MemoryDocumentRowWithBM25, "embedding">>(`
              SELECT ${COLS_NO_EMBEDDING_QUALIFIED}, bm25(memory_fts) as bm25_score
              FROM memory_documents d
              JOIN memory_fts ON d.rowid = memory_fts.rowid
              WHERE memory_fts MATCH ?
              ORDER BY bm25_score ASC -- Most negative = most relevant in FTS5
              LIMIT ?
            `).all(ftsQuery, safeLimit)

        if (rows.length === 0) return []

        // FTS5 bm25() returns negative values (more negative = more relevant).
        // Negate to get positive scores, then normalize to [0, 1] range.
        const scores = rows.map(r => -r.bm25_score)
        const maxScore = scores[0]! // First row is most relevant (most negative bm25)
        const normalizer = maxScore > 0 ? maxScore : 1

        return rows.map((row, idx) => ({
          document: rowToMemoryDocumentWithoutEmbedding(row),
          score: Math.max(0, Math.min(1.0, scores[idx]! / normalizer))
        }))
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findWithEmbeddings: (limit) =>
    Effect.try({
      try: () => {
        // ORDER BY id for deterministic results (no recency bias, but stable across calls)
        const rows = db.prepare<MemoryDocumentRow>(
          `SELECT * FROM memory_documents WHERE embedding IS NOT NULL ORDER BY id ASC LIMIT ?`
        ).all(limit)
        return rows.map(rowToMemoryDocument)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  listAll: (filter) =>
    Effect.try({
      try: () => {
        let sql = `SELECT ${COLS_NO_EMBEDDING} FROM memory_documents`
        const params: unknown[] = []
        const conditions: string[] = []

        if (filter?.rootDir) {
          conditions.push("root_dir = ?")
          params.push(filter.rootDir)
        }
        if (filter?.tags && filter.tags.length > 0) {
          // Use json_each for correct tag matching (avoids substring false positives)
          for (const tag of filter.tags) {
            conditions.push(`EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)`)
            params.push(tag)
          }
        }

        if (conditions.length > 0) {
          sql += " WHERE " + conditions.join(" AND ")
        }
        sql += " ORDER BY indexed_at DESC LIMIT 10000"

        const rows = db.prepare<Omit<MemoryDocumentRow, "embedding">>(sql).all(...params)
        return rows.map(rowToMemoryDocumentWithoutEmbedding)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  deleteByRootDir: (rootDir) =>
    Effect.gen(function* () {
      const transaction = runImmediateTransaction(db, () => {
        // Null out target_doc_id for incoming links BEFORE deleting documents
        // (no FK on target_doc_id, so CASCADE won't handle this)
        db.prepare(
          `UPDATE memory_links SET target_doc_id = NULL
               WHERE target_doc_id IN (SELECT id FROM memory_documents WHERE root_dir = ?)`
        ).run(rootDir)
        // Delete outgoing links FROM docs being removed (prevents phantom backlinks)
        db.prepare(
          `DELETE FROM memory_links
               WHERE source_doc_id IN (SELECT id FROM memory_documents WHERE root_dir = ?)`
        ).run(rootDir)
        const result = db.prepare("DELETE FROM memory_documents WHERE root_dir = ?").run(rootDir)
        return result.changes
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
      return transaction.value
    }),

  deleteById: (id) =>
    Effect.gen(function* () {
      const transaction = runImmediateTransaction(db, () => {
        // Null out target_doc_id for incoming links before deleting the document
        db.prepare("UPDATE memory_links SET target_doc_id = NULL WHERE target_doc_id = ?").run(id)
        // Delete outgoing links explicitly (consistent with deleteByRootDir/removeSource)
        db.prepare("DELETE FROM memory_links WHERE source_doc_id = ?").run(id)
        db.prepare("DELETE FROM memory_documents WHERE id = ?").run(id)
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
    }),

  deleteByPaths: (rootDir, paths) =>
    Effect.gen(function* () {
      if (paths.length === 0) return 0
      const transaction = runImmediateTransaction(db, () => {
        let total = 0
        for (const chunk of chunkBySqlLimit(paths)) {
          const placeholders = chunk.map(() => "?").join(", ")
          // Null out target_doc_id for incoming links before deleting documents
          db.prepare(
            `UPDATE memory_links SET target_doc_id = NULL
                 WHERE target_doc_id IN (SELECT id FROM memory_documents WHERE root_dir = ? AND file_path IN (${placeholders}))`
          ).run(rootDir, ...chunk)
          // Delete outgoing links explicitly (consistent with deleteByRootDir/removeSource)
          db.prepare(
            `DELETE FROM memory_links
                 WHERE source_doc_id IN (SELECT id FROM memory_documents WHERE root_dir = ? AND file_path IN (${placeholders}))`
          ).run(rootDir, ...chunk)
          const result = db.prepare(
            `DELETE FROM memory_documents WHERE root_dir = ? AND file_path IN (${placeholders})`
          ).run(rootDir, ...chunk)
          total += result.changes
        }
        return total
      })
      if (!transaction.ok) {
        return yield* Effect.fail(new DatabaseError({ cause: transaction.error }))
      }
      return transaction.value
    }),

  updateFileHash: (id, hash) =>
    Effect.gen(function* () {
      const result = yield* Effect.try({
        try: () => db.prepare(
          "UPDATE memory_documents SET file_hash = ? WHERE id = ?"
        ).run(hash, id),
        catch: (cause) => new DatabaseError({ cause })
      })
      if (result.changes === 0) {
        return yield* Effect.fail(new DatabaseError({
          cause: new Error(`updateFileHash: no document found with id=${id}`)
        }))
      }
    }),

  updateEmbedding: (id, embedding) =>
    Effect.gen(function* () {
      const result = yield* Effect.try({
        try: () => db.prepare(
          "UPDATE memory_documents SET embedding = ? WHERE id = ?"
        ).run(float32ArrayToBuffer(embedding), id),
        catch: (cause) => new DatabaseError({ cause })
      })
      if (result.changes === 0) {
        return yield* Effect.fail(new DatabaseError({
          cause: new Error(`updateEmbedding: no document found with id=${id}`)
        }))
      }
    }),

  count: () =>
    Effect.try({
      try: () => {
        const result = db.prepare<{ cnt: number }>("SELECT COUNT(*) as cnt FROM memory_documents").get()
        if (!result) return 0
        return result.cnt
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  countWithEmbeddings: () =>
    Effect.try({
      try: () => {
        const result = db.prepare<{ cnt: number }>("SELECT COUNT(*) as cnt FROM memory_documents WHERE embedding IS NOT NULL").get()
        if (!result) return 0
        return result.cnt
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  listPathsByRootDir: (rootDir) =>
    Effect.try({
      try: () => {
        const rows = db.prepare<{ file_path: string }>(
          "SELECT file_path FROM memory_documents WHERE root_dir = ?"
        ).all(rootDir)
        return rows.map(r => r.file_path)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),
})
