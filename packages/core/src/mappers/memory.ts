/**
 * Memory mappers - convert database rows to domain objects
 */

import { Schema } from "effect"
import type {
  MemoryDocument,
  MemoryDocumentId,
  MemoryLink,
  MemoryLinkType,
  MemorySource,
  MemoryProperty,
  MemoryDocumentRow,
  MemoryLinkRow,
  MemorySourceRow,
  MemoryPropertyRow,
} from "@jamesaphoenix/tx-types"
import { MEMORY_LINK_TYPES } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"

/**
 * Schema for tags - an array of strings.
 */
const TagsSchema = Schema.Array(Schema.String)

/**
 * Safely parse and validate tags JSON string.
 */
const parseTags = (tagsJson: string | null): string[] => {
  if (!tagsJson) return []
  try {
    const parsed: unknown = JSON.parse(tagsJson)
    const result = Schema.decodeUnknownSync(TagsSchema)(parsed)
    return [...result]
  } catch {
    return []
  }
}

/**
 * Check if a string is a valid MemoryLinkType.
 */
export const isValidLinkType = (s: string): s is MemoryLinkType => {
  const types: readonly string[] = MEMORY_LINK_TYPES
  return types.includes(s)
}

/**
 * Convert a SQLite BLOB (Buffer) to Float32Array.
 */
const bufferToFloat32Array = (buffer: Buffer): Float32Array => {
  // Always copy to a new ArrayBuffer to prevent aliasing with Node.js pooled buffers.
  // Without this, the returned Float32Array could share memory with unrelated data.
  const copy = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(copy).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  return new Float32Array(copy)
}

/**
 * Convert Float32Array to Buffer for SQLite storage.
 */
export const float32ArrayToBuffer = (arr: Float32Array): Buffer => {
  // Defensive copy — mirrors the read path's copy to prevent aliasing
  // if the caller reuses the Float32Array after insertion.
  const copy = Buffer.allocUnsafe(arr.byteLength)
  copy.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
  return copy
}

/**
 * Convert a database row to a MemoryDocument domain object.
 */
export const rowToMemoryDocument = (row: MemoryDocumentRow): MemoryDocument => {
  return {
    id: row.id as MemoryDocumentId,
    filePath: row.file_path,
    rootDir: row.root_dir,
    title: row.title,
    content: row.content,
    frontmatter: row.frontmatter,
    tags: parseTags(row.tags),
    fileHash: row.file_hash,
    fileMtime: row.file_mtime,
    embedding: row.embedding ? bufferToFloat32Array(row.embedding) as Float32Array<ArrayBuffer> : null,
    createdAt: row.created_at,
    indexedAt: row.indexed_at,
  }
}

/**
 * Convert a database row to a MemoryDocument WITHOUT deserializing the embedding.
 */
export const rowToMemoryDocumentWithoutEmbedding = (row: Omit<MemoryDocumentRow, "embedding">): MemoryDocument => {
  return {
    id: row.id as MemoryDocumentId,
    filePath: row.file_path,
    rootDir: row.root_dir,
    title: row.title,
    content: row.content,
    frontmatter: row.frontmatter,
    tags: parseTags(row.tags),
    fileHash: row.file_hash,
    fileMtime: row.file_mtime,
    embedding: null,
    createdAt: row.created_at,
    indexedAt: row.indexed_at,
  }
}

/**
 * Convert a database row to a MemoryLink domain object.
 * Validates link_type at runtime (consistent with learning-repo pattern).
 */
export const rowToMemoryLink = (row: MemoryLinkRow): MemoryLink => {
  if (!isValidLinkType(row.link_type)) {
    throw new InvalidStatusError({
      entity: "MemoryLink",
      status: row.link_type,
      validStatuses: MEMORY_LINK_TYPES,
      rowId: row.id,
    })
  }
  return {
    id: row.id,
    sourceDocId: row.source_doc_id as MemoryDocumentId,
    targetDocId: row.target_doc_id ? row.target_doc_id as MemoryDocumentId : null,
    targetRef: row.target_ref,
    linkType: row.link_type,
    createdAt: row.created_at,
  }
}

/**
 * Convert a database row to a MemorySource domain object.
 */
export const rowToMemorySource = (row: MemorySourceRow): MemorySource => {
  return {
    id: row.id,
    rootDir: row.root_dir,
    label: row.label,
    createdAt: row.created_at,
  }
}

/**
 * Convert a database row to a MemoryProperty domain object.
 */
export const rowToMemoryProperty = (row: MemoryPropertyRow): MemoryProperty => {
  return {
    id: row.id,
    docId: row.doc_id as MemoryDocumentId,
    key: row.key,
    value: row.value,
  }
}
