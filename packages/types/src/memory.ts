/**
 * Memory types for tx
 *
 * Type definitions for the filesystem-backed memory system.
 * Memory indexes markdown files from any directory, providing
 * BM25 + vector + graph search over .md documents.
 *
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Valid memory link types.
 * - wikilink: Parsed from [[page]] syntax in markdown
 * - frontmatter: From frontmatter.related field
 * - explicit: Programmatically created via tx memory link
 */
export const MEMORY_LINK_TYPES = ["wikilink", "frontmatter", "explicit"] as const

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Memory link type - how two documents are connected. */
export const MemoryLinkTypeSchema = Schema.Literal(...MEMORY_LINK_TYPES)
export type MemoryLinkType = typeof MemoryLinkTypeSchema.Type

/** Memory document ID - string like "mem-a7f3bc120042" (12 hex chars from SHA256). */
export const MemoryDocumentIdSchema = Schema.String.pipe(
  Schema.pattern(/^mem-[a-f0-9]{12}$/),
  Schema.brand("MemoryDocumentId")
)
export type MemoryDocumentId = typeof MemoryDocumentIdSchema.Type

/** Core memory document entity (indexed from .md file). */
export const MemoryDocumentSchema = Schema.Struct({
  id: MemoryDocumentIdSchema,
  filePath: Schema.String,
  rootDir: Schema.String,
  title: Schema.String,
  content: Schema.String,
  /** JSON-encoded frontmatter object (parsed from YAML), or null if no frontmatter. */
  frontmatter: Schema.NullOr(Schema.String),
  tags: Schema.Array(Schema.String),
  fileHash: Schema.String,
  fileMtime: Schema.String,
  embedding: Schema.NullOr(Schema.instanceOf(Float32Array)),
  createdAt: Schema.String,
  indexedAt: Schema.String,
})
export type MemoryDocument = typeof MemoryDocumentSchema.Type

/** Memory document with relevance scoring from search results. */
export const MemoryDocumentWithScoreSchema = Schema.Struct({
  ...MemoryDocumentSchema.fields,
  relevanceScore: Schema.Number,
  bm25Score: Schema.Number,
  vectorScore: Schema.Number,
  rrfScore: Schema.Number,
  recencyScore: Schema.Number,
  bm25Rank: Schema.Number.pipe(Schema.int()),
  vectorRank: Schema.Number.pipe(Schema.int()),
  expansionHops: Schema.optional(Schema.Number.pipe(Schema.int())),
})
export type MemoryDocumentWithScore = typeof MemoryDocumentWithScoreSchema.Type

/** Link between two memory documents. */
export const MemoryLinkSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  sourceDocId: MemoryDocumentIdSchema,
  targetDocId: Schema.NullOr(MemoryDocumentIdSchema),
  targetRef: Schema.String,
  linkType: MemoryLinkTypeSchema,
  createdAt: Schema.String,
})
export type MemoryLink = typeof MemoryLinkSchema.Type

/** Registered source directory for indexing. */
export const MemorySourceSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  rootDir: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})
export type MemorySource = typeof MemorySourceSchema.Type

/** Key-value property on a memory document. */
export const MemoryPropertySchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  docId: MemoryDocumentIdSchema,
  key: Schema.String,
  value: Schema.String,
})
export type MemoryProperty = typeof MemoryPropertySchema.Type

/** Search options for memory queries. */
export const MemorySearchOptionsSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number.pipe(Schema.int())),
  minScore: Schema.optional(Schema.Number),
  semantic: Schema.optional(Schema.Boolean),
  expand: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  props: Schema.optional(Schema.Array(Schema.String)),
})
export type MemorySearchOptions = typeof MemorySearchOptionsSchema.Type

/** Status of the memory index. */
export const MemoryIndexStatusSchema = Schema.Struct({
  totalFiles: Schema.Number.pipe(Schema.int()),
  indexed: Schema.Number.pipe(Schema.int()),
  stale: Schema.Number.pipe(Schema.int()),
  embedded: Schema.Number.pipe(Schema.int()),
  links: Schema.Number.pipe(Schema.int()),
  sources: Schema.Number.pipe(Schema.int()),
})
export type MemoryIndexStatus = typeof MemoryIndexStatusSchema.Type

/** Input for creating a new memory document. */
export const CreateMemoryDocumentInputSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  properties: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  dir: Schema.optional(Schema.String),
})
export type CreateMemoryDocumentInput = typeof CreateMemoryDocumentInputSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for memory_documents (snake_case from SQLite). */
export interface MemoryDocumentRow {
  id: string
  file_path: string
  root_dir: string
  title: string
  content: string
  frontmatter: string | null
  tags: string | null
  file_hash: string
  file_mtime: string
  embedding: Buffer | null
  created_at: string
  indexed_at: string
}

/** Memory document row with BM25 score from FTS5 query. */
export interface MemoryDocumentRowWithBM25 extends MemoryDocumentRow {
  bm25_score: number
}

/** Database row type for memory_links. */
export interface MemoryLinkRow {
  id: number
  source_doc_id: string
  target_doc_id: string | null
  target_ref: string
  link_type: string
  created_at: string
}

/** Database row type for memory_sources. */
export interface MemorySourceRow {
  id: number
  root_dir: string
  label: string | null
  created_at: string
}

/** Database row type for memory_properties. */
export interface MemoryPropertyRow {
  id: number
  doc_id: string
  key: string
  value: string
}
