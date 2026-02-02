/**
 * Deduplication mappers - convert database rows to domain objects
 */

import { createHash } from "crypto"
import type {
  ProcessedHash,
  ProcessedHashRow,
  FileProgress,
  FileProgressRow
} from "@tx/types"

/**
 * Compute SHA256 hash of content.
 */
export const hashContent = (content: string): string =>
  createHash("sha256").update(content).digest("hex")

/**
 * Convert a database row to a ProcessedHash domain object.
 */
export const rowToProcessedHash = (row: ProcessedHashRow): ProcessedHash => ({
  id: row.id,
  contentHash: row.content_hash,
  sourceFile: row.source_file,
  sourceLine: row.source_line,
  processedAt: new Date(row.processed_at)
})

/**
 * Serialize ProcessedHash for JSON output.
 */
export const serializeProcessedHash = (hash: ProcessedHash) => ({
  id: hash.id,
  contentHash: hash.contentHash,
  sourceFile: hash.sourceFile,
  sourceLine: hash.sourceLine,
  processedAt: hash.processedAt.toISOString()
})

/**
 * Convert a database row to a FileProgress domain object.
 */
export const rowToFileProgress = (row: FileProgressRow): FileProgress => ({
  id: row.id,
  filePath: row.file_path,
  lastLineProcessed: row.last_line_processed,
  lastByteOffset: row.last_byte_offset,
  fileSize: row.file_size,
  fileChecksum: row.file_checksum,
  lastProcessedAt: new Date(row.last_processed_at)
})

/**
 * Serialize FileProgress for JSON output.
 */
export const serializeFileProgress = (progress: FileProgress) => ({
  id: progress.id,
  filePath: progress.filePath,
  lastLineProcessed: progress.lastLineProcessed,
  lastByteOffset: progress.lastByteOffset,
  fileSize: progress.fileSize,
  fileChecksum: progress.fileChecksum,
  lastProcessedAt: progress.lastProcessedAt.toISOString()
})
