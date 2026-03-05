import type { SqliteDatabase } from "../../db.js"

/**
 * Max SQL bind variables per statement (SQLite default limit is 999).
 * Use 900 to leave headroom for other parameters in the query.
 */
const MAX_SQL_VARIABLES = 900

/**
 * Chunk an array into batches that fit within SQLite's variable limit.
 */
export const chunkBySqlLimit = <T>(items: readonly T[], maxPerChunk = MAX_SQL_VARIABLES): T[][] => {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxPerChunk) {
    chunks.push(items.slice(i, i + maxPerChunk))
  }
  return chunks
}

/**
 * All memory document columns EXCEPT embedding.
 * Avoids loading ~6KB Float32Array per doc for listing/search operations.
 */
export const COLS_NO_EMBEDDING = "id, file_path, root_dir, title, content, frontmatter, tags, file_hash, file_mtime, created_at, indexed_at"

/**
 * Same columns but table-qualified with `d.` prefix for JOINs.
 */
export const COLS_NO_EMBEDDING_QUALIFIED = "d.id, d.file_path, d.root_dir, d.title, d.content, d.frontmatter, d.tags, d.file_hash, d.file_mtime, d.created_at, d.indexed_at"

/**
 * Build a three-tier FTS5 query for optimal relevance.
 * Reuses the same pattern from learning-repo.ts.
 * Uses Unicode property escapes (\p{L}, \p{N}) so diacritics, CJK, etc. are preserved.
 */
export const buildFTS5Query = (query: string): string => {
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

export const runImmediateTransaction = <T>(
  db: SqliteDatabase,
  body: () => T
): { ok: true; value: T } | { ok: false; error: unknown } => {
  db.exec("BEGIN IMMEDIATE")
  try {
    const value = body()
    db.exec("COMMIT")
    return { ok: true, value }
  } catch (error) {
    try {
      db.exec("ROLLBACK")
    } catch {
      // no-op
    }
    return { ok: false, error }
  }
}
