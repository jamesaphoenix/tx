/**
 * Memory repositories - CRUD + FTS5 search for memory documents
 *
 * Follows the Context.Tag + Layer.effect pattern from learning-repo.ts.
 * Stores indexed data derived from .md files on disk.
 */

import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import {
  rowToMemoryDocument,
  rowToMemoryDocumentWithoutEmbedding,
  rowToMemoryLink,
  rowToMemorySource,
  rowToMemoryProperty,
  float32ArrayToBuffer,
} from "../mappers/memory.js"
import type {
  MemoryDocument,
  MemoryLink,
  MemorySource,
  MemoryProperty,
  MemoryDocumentRow,
  MemoryDocumentRowWithBM25,
  MemoryLinkRow,
  MemorySourceRow,
  MemoryPropertyRow,
} from "@jamesaphoenix/tx-types"

/**
 * Max SQL bind variables per statement (SQLite default limit is 999).
 * Use 900 to leave headroom for other parameters in the query.
 */
const MAX_SQL_VARIABLES = 900

/**
 * Chunk an array into batches that fit within SQLite's variable limit.
 */
const chunkBySqlLimit = <T>(items: readonly T[], maxPerChunk = MAX_SQL_VARIABLES): T[][] => {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxPerChunk) {
    chunks.push(items.slice(i, i + maxPerChunk) as T[])
  }
  return chunks
}

/**
 * All memory document columns EXCEPT embedding.
 * Avoids loading ~6KB Float32Array per doc for listing/search operations.
 */
const COLS_NO_EMBEDDING = "id, file_path, root_dir, title, content, frontmatter, tags, file_hash, file_mtime, created_at, indexed_at"

/**
 * Same columns but table-qualified with `d.` prefix for JOINs.
 */
const COLS_NO_EMBEDDING_QUALIFIED = "d.id, d.file_path, d.root_dir, d.title, d.content, d.frontmatter, d.tags, d.file_hash, d.file_mtime, d.created_at, d.indexed_at"

/** Scored memory document result from BM25 search */
export interface MemoryBM25Result {
  document: MemoryDocument
  score: number
}

/**
 * Build a three-tier FTS5 query for optimal relevance.
 * Reuses the same pattern from learning-repo.ts.
 * Uses Unicode property escapes (\p{L}, \p{N}) so diacritics, CJK, etc. are preserved.
 */
const buildFTS5Query = (query: string): string => {
  const sanitized = query.replace(/[^\p{L}\p{N}\s']/gu, "").trim()
  const terms = sanitized
    .split(/\s+/)
    .filter(t => t.length >= 2)

  if (terms.length === 0) return ""
  if (terms.length === 1) {
    return `"${terms[0]!.replace(/"/g, '""')}"`
  }

  const quoted = terms.map(t => `"${t.replace(/"/g, '""')}"`)
  const phrase = `"${terms.join(" ").replace(/"/g, '""')}"`
  const near = `NEAR(${quoted.join(" ")}, 10)`
  const or = quoted.join(" OR ")
  return `(${phrase}) OR (${near}) OR (${or})`
}

// =============================================================================
// MemoryDocumentRepository
// =============================================================================

export class MemoryDocumentRepository extends Context.Tag("MemoryDocumentRepository")<
  MemoryDocumentRepository,
  {
    readonly upsertDocument: (doc: {
      id: string
      filePath: string
      rootDir: string
      title: string
      content: string
      frontmatter: string | null
      tags: string | null
      fileHash: string
      fileMtime: string
      createdAt: string
      indexedAt: string
    }) => Effect.Effect<void, DatabaseError>
    readonly findById: (id: string) => Effect.Effect<MemoryDocument | null, DatabaseError>
    readonly findByPath: (filePath: string, rootDir: string) => Effect.Effect<MemoryDocument | null, DatabaseError>
    readonly findByHash: (hash: string) => Effect.Effect<readonly MemoryDocument[], DatabaseError>
    readonly searchBM25: (query: string, limit: number) => Effect.Effect<readonly MemoryBM25Result[], DatabaseError>
    readonly findWithEmbeddings: (limit: number) => Effect.Effect<readonly MemoryDocument[], DatabaseError>
    readonly listAll: (filter?: { rootDir?: string; tags?: readonly string[] }) => Effect.Effect<readonly MemoryDocument[], DatabaseError>
    readonly deleteByRootDir: (rootDir: string) => Effect.Effect<number, DatabaseError>
    readonly deleteById: (id: string) => Effect.Effect<void, DatabaseError>
    readonly deleteByPaths: (rootDir: string, paths: readonly string[]) => Effect.Effect<number, DatabaseError>
    readonly updateFileHash: (id: string, hash: string) => Effect.Effect<void, DatabaseError>
    readonly updateEmbedding: (id: string, embedding: Float32Array) => Effect.Effect<void, DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
    readonly countWithEmbeddings: () => Effect.Effect<number, DatabaseError>
    readonly listPathsByRootDir: (rootDir: string) => Effect.Effect<readonly string[], DatabaseError>
  }
>() {}

export const MemoryDocumentRepositoryLive = Layer.effect(
  MemoryDocumentRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      upsertDocument: (doc) =>
        Effect.try({
          try: () => {
            // Wrap DELETE + INSERT in a transaction to prevent FTS desync if a crash
            // occurs between the two statements. DELETE fires memory_fts_ad,
            // INSERT fires memory_fts_ai — both must succeed atomically.
            db.exec("BEGIN IMMEDIATE")
            try {
              db.prepare("DELETE FROM memory_documents WHERE file_path = ? AND root_dir = ?").run(doc.filePath, doc.rootDir)
              db.prepare(`
                INSERT INTO memory_documents (id, file_path, root_dir, title, content, frontmatter, tags, file_hash, file_mtime, created_at, indexed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                doc.id, doc.filePath, doc.rootDir, doc.title, doc.content,
                doc.frontmatter, doc.tags, doc.fileHash, doc.fileMtime,
                doc.createdAt, doc.indexedAt
              )
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              `SELECT ${COLS_NO_EMBEDDING} FROM memory_documents WHERE id = ?`
            ).get(id) as Omit<MemoryDocumentRow, "embedding"> | undefined
            return row ? rowToMemoryDocumentWithoutEmbedding(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByPath: (filePath, rootDir) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              `SELECT ${COLS_NO_EMBEDDING} FROM memory_documents WHERE file_path = ? AND root_dir = ?`
            ).get(filePath, rootDir) as Omit<MemoryDocumentRow, "embedding"> | undefined
            return row ? rowToMemoryDocumentWithoutEmbedding(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByHash: (hash) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT ${COLS_NO_EMBEDDING} FROM memory_documents WHERE file_hash = ?`
            ).all(hash) as Omit<MemoryDocumentRow, "embedding">[]
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
            const rows = db.prepare(`
              SELECT ${COLS_NO_EMBEDDING_QUALIFIED}, bm25(memory_fts) as bm25_score
              FROM memory_documents d
              JOIN memory_fts ON d.rowid = memory_fts.rowid
              WHERE memory_fts MATCH ?
              ORDER BY bm25_score ASC -- Most negative = most relevant in FTS5
              LIMIT ?
            `).all(ftsQuery, safeLimit) as (Omit<MemoryDocumentRowWithBM25, "embedding">)[]

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
            const rows = db.prepare(
              `SELECT * FROM memory_documents WHERE embedding IS NOT NULL ORDER BY id ASC LIMIT ?`
            ).all(limit) as MemoryDocumentRow[]
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

            const rows = db.prepare(sql).all(...params) as Omit<MemoryDocumentRow, "embedding">[]
            return rows.map(rowToMemoryDocumentWithoutEmbedding)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteByRootDir: (rootDir) =>
        Effect.try({
          try: () => {
            db.exec("BEGIN IMMEDIATE")
            try {
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
              db.exec("COMMIT")
              return result.changes
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteById: (id) =>
        Effect.try({
          try: () => {
            db.exec("BEGIN IMMEDIATE")
            try {
              // Null out target_doc_id for incoming links before deleting the document
              db.prepare("UPDATE memory_links SET target_doc_id = NULL WHERE target_doc_id = ?").run(id)
              // Delete outgoing links explicitly (consistent with deleteByRootDir/removeSource)
              db.prepare("DELETE FROM memory_links WHERE source_doc_id = ?").run(id)
              db.prepare("DELETE FROM memory_documents WHERE id = ?").run(id)
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteByPaths: (rootDir, paths) =>
        Effect.try({
          try: () => {
            if (paths.length === 0) return 0
            let total = 0
            db.exec("BEGIN IMMEDIATE")
            try {
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
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
            return total
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      updateFileHash: (id, hash) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE memory_documents SET file_hash = ? WHERE id = ?"
            ).run(hash, id)
            if (result.changes === 0) {
              throw new Error(`updateFileHash: no document found with id=${id}`)
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      updateEmbedding: (id, embedding) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE memory_documents SET embedding = ? WHERE id = ?"
            ).run(float32ArrayToBuffer(embedding), id)
            if (result.changes === 0) {
              throw new Error(`updateEmbedding: no document found with id=${id}`)
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      count: () =>
        Effect.try({
          try: () => {
            const result = db.prepare("SELECT COUNT(*) as cnt FROM memory_documents").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countWithEmbeddings: () =>
        Effect.try({
          try: () => {
            const result = db.prepare("SELECT COUNT(*) as cnt FROM memory_documents WHERE embedding IS NOT NULL").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      listPathsByRootDir: (rootDir) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT file_path FROM memory_documents WHERE root_dir = ?"
            ).all(rootDir) as { file_path: string }[]
            return rows.map(r => r.file_path)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
    }
  })
)

// =============================================================================
// MemoryLinkRepository
// =============================================================================

export class MemoryLinkRepository extends Context.Tag("MemoryLinkRepository")<
  MemoryLinkRepository,
  {
    readonly insertLinks: (links: readonly { sourceDocId: string; targetRef: string; linkType: string }[]) => Effect.Effect<void, DatabaseError>
    readonly findOutgoing: (docId: string) => Effect.Effect<readonly MemoryLink[], DatabaseError>
    readonly findIncoming: (docId: string) => Effect.Effect<readonly MemoryLink[], DatabaseError>
    readonly deleteBySource: (docId: string) => Effect.Effect<void, DatabaseError>
    readonly resolveTargets: () => Effect.Effect<number, DatabaseError>
    readonly insertExplicit: (sourceId: string, targetRef: string) => Effect.Effect<void, DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
  }
>() {}

export const MemoryLinkRepositoryLive = Layer.effect(
  MemoryLinkRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insertLinks: (links) =>
        Effect.try({
          try: () => {
            if (links.length === 0) return
            db.exec("BEGIN IMMEDIATE")
            try {
              const stmt = db.prepare(
                "INSERT OR IGNORE INTO memory_links (source_doc_id, target_ref, link_type, created_at) VALUES (?, ?, ?, ?)"
              )
              const now = new Date().toISOString()
              for (const link of links) {
                stmt.run(link.sourceDocId, link.targetRef, link.linkType, now)
              }
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findOutgoing: (docId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM memory_links WHERE source_doc_id = ? ORDER BY id"
            ).all(docId) as MemoryLinkRow[]
            return rows.map(rowToMemoryLink)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findIncoming: (docId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM memory_links WHERE target_doc_id = ? ORDER BY id"
            ).all(docId) as MemoryLinkRow[]
            return rows.map(rowToMemoryLink)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteBySource: (docId) =>
        Effect.try({
          try: () => {
            db.exec("BEGIN IMMEDIATE")
            try {
              db.prepare("DELETE FROM memory_links WHERE source_doc_id = ?").run(docId)
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      resolveTargets: () =>
        Effect.try({
          try: () => {
            // Resolve unresolved target_refs by exact title match or file path match.
            // Two-step approach: SELECT unresolved links, then UPDATE each with best match.
            // Both steps inside one transaction to prevent TOCTOU races.
            db.exec("BEGIN IMMEDIATE")
            try {
              const unresolved = db.prepare(
                "SELECT id, source_doc_id, target_ref FROM memory_links WHERE target_doc_id IS NULL"
              ).all() as { id: number; source_doc_id: string; target_ref: string }[]

              if (unresolved.length === 0) {
                db.exec("COMMIT")
                return 0
              }

              // For each unresolved link, find the best matching document
              // Priority: exact file_path > file_path + .md > title match
              // Tiebreaker: indexed_at ASC then id ASC for deterministic resolution
              // Case-insensitive matching: wikilinks like [[my doc]] must resolve
              // to titles like "My Doc" or file paths like "My Doc.md"
              const findBest = db.prepare(`
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
                ) as { id: string } | null
                // Skip self-links: a document should not link to itself
                if (match && match.id !== link.source_doc_id) {
                  updateStmt.run(match.id, link.id)
                  resolved++
                }
              }
              db.exec("COMMIT")
              return resolved
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertExplicit: (sourceId, targetRef) =>
        Effect.try({
          try: () => {
            // Wrap INSERT + resolution UPDATE in a transaction to prevent
            // partial failure leaving a permanently-unresolved link row.
            db.exec("BEGIN IMMEDIATE")
            try {
              const now = new Date().toISOString()
              db.prepare(
                "INSERT OR IGNORE INTO memory_links (source_doc_id, target_ref, link_type, created_at) VALUES (?, ?, 'explicit', ?)"
              ).run(sourceId, targetRef, now)
              // Attempt immediate resolution so explicit links work without a full index() run
              // Case-insensitive matching (same as resolveTargets)
              const match = db.prepare(`
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
              `).get(targetRef, targetRef, targetRef, targetRef, targetRef) as { id: string } | null
              if (match && match.id !== sourceId) {
                db.prepare(
                  "UPDATE memory_links SET target_doc_id = ? WHERE source_doc_id = ? AND target_ref = ? AND link_type = 'explicit'"
                ).run(match.id, sourceId, targetRef)
              }
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      count: () =>
        Effect.try({
          try: () => {
            const result = db.prepare("SELECT COUNT(*) as cnt FROM memory_links").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
    }
  })
)

// =============================================================================
// MemoryPropertyRepository
// =============================================================================

export class MemoryPropertyRepository extends Context.Tag("MemoryPropertyRepository")<
  MemoryPropertyRepository,
  {
    readonly setProperty: (docId: string, key: string, value: string) => Effect.Effect<void, DatabaseError>
    readonly getProperty: (docId: string, key: string) => Effect.Effect<MemoryProperty | null, DatabaseError>
    readonly getProperties: (docId: string) => Effect.Effect<readonly MemoryProperty[], DatabaseError>
    readonly deleteProperty: (docId: string, key: string) => Effect.Effect<void, DatabaseError>
    readonly syncFromFrontmatter: (docId: string, properties: Record<string, string>) => Effect.Effect<void, DatabaseError>
    readonly findByProperty: (key: string, value?: string) => Effect.Effect<readonly string[], DatabaseError>
  }
>() {}

export const MemoryPropertyRepositoryLive = Layer.effect(
  MemoryPropertyRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
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
            const row = db.prepare(
              "SELECT * FROM memory_properties WHERE doc_id = ? AND key = ?"
            ).get(docId, key) as MemoryPropertyRow | undefined
            return row ? rowToMemoryProperty(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getProperties: (docId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM memory_properties WHERE doc_id = ? ORDER BY key"
            ).all(docId) as MemoryPropertyRow[]
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
        Effect.try({
          try: () => {
            db.exec("BEGIN IMMEDIATE")
            try {
              // Delete existing properties for this doc
              db.prepare("DELETE FROM memory_properties WHERE doc_id = ?").run(docId)
              // Insert new ones
              const stmt = db.prepare(
                "INSERT INTO memory_properties (doc_id, key, value) VALUES (?, ?, ?)"
              )
              for (const [key, value] of Object.entries(properties)) {
                stmt.run(docId, key, String(value))
              }
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByProperty: (key, value) =>
        Effect.try({
          try: () => {
            const rows = value !== undefined
              ? db.prepare(
                  "SELECT doc_id FROM memory_properties WHERE key = ? AND value = ?"
                ).all(key, value) as { doc_id: string }[]
              : db.prepare(
                  "SELECT doc_id FROM memory_properties WHERE key = ?"
                ).all(key) as { doc_id: string }[]
            return rows.map(r => r.doc_id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
    }
  })
)

// =============================================================================
// MemorySourceRepository
// =============================================================================

export class MemorySourceRepository extends Context.Tag("MemorySourceRepository")<
  MemorySourceRepository,
  {
    readonly addSource: (rootDir: string, label?: string) => Effect.Effect<MemorySource, DatabaseError>
    readonly removeSource: (rootDir: string) => Effect.Effect<void, DatabaseError>
    readonly listSources: () => Effect.Effect<readonly MemorySource[], DatabaseError>
    readonly findSource: (rootDir: string) => Effect.Effect<MemorySource | null, DatabaseError>
  }
>() {}

export const MemorySourceRepositoryLive = Layer.effect(
  MemorySourceRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      addSource: (rootDir, label) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            db.exec("BEGIN IMMEDIATE")
            try {
              db.prepare(
                "INSERT INTO memory_sources (root_dir, label, created_at) VALUES (?, ?, ?) ON CONFLICT(root_dir) DO UPDATE SET label = excluded.label"
              ).run(rootDir, label ?? null, now)
              const row = db.prepare(
                "SELECT * FROM memory_sources WHERE root_dir = ?"
              ).get(rootDir) as MemorySourceRow
              db.exec("COMMIT")
              return rowToMemorySource(row)
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      removeSource: (rootDir) =>
        Effect.try({
          try: () => {
            // Atomic removal: null-out incoming links → delete outgoing links → delete documents → delete source
            // All in one transaction to prevent orphaned rows if index() runs concurrently
            db.exec("BEGIN IMMEDIATE")
            try {
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
              db.exec("COMMIT")
            } catch (e) {
              db.exec("ROLLBACK")
              throw e
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      listSources: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM memory_sources ORDER BY created_at"
            ).all() as MemorySourceRow[]
            return rows.map(rowToMemorySource)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findSource: (rootDir) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM memory_sources WHERE root_dir = ?"
            ).get(rootDir) as MemorySourceRow | undefined
            return row ? rowToMemorySource(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
    }
  })
)
