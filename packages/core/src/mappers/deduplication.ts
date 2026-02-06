/**
 * Deduplication mappers - convert database rows to domain objects
 */

import { createHash } from "crypto"
import type {
  ProcessedHash,
  ProcessedHashRow,
  FileProgress,
  FileProgressRow
} from "@jamesaphoenix/tx-types"
import { parseDate } from "./parse-date.js"

/**
 * Normalize content for deduplication comparison.
 * Handles common semantic equivalences:
 * - Trailing/leading whitespace
 * - Line ending differences (CRLF → LF)
 * - Unicode normalization (NFC canonical form)
 */
export const normalizeContent = (content: string): string =>
  content
    .trim()
    .replace(/\r\n/g, "\n")
    .normalize("NFC")

/**
 * Compute SHA256 hash of content.
 * By default, hashes raw content for backward compatibility with existing data.
 * Pass normalize=true to normalize (trim, CRLF→LF, NFC) before hashing,
 * which catches semantic duplicates but produces different hashes for
 * previously stored content.
 */
export const hashContent = (content: string, normalize = false): string => {
  const input = normalize ? normalizeContent(content) : content
  return createHash("sha256").update(input).digest("hex")
}

/**
 * Convert a database row to a ProcessedHash domain object.
 */
export const rowToProcessedHash = (row: ProcessedHashRow): ProcessedHash => ({
  id: row.id,
  contentHash: row.content_hash,
  sourceFile: row.source_file,
  sourceLine: row.source_line,
  processedAt: parseDate(row.processed_at, "processed_at", row.id)
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
  lastProcessedAt: parseDate(row.last_processed_at, "last_processed_at", row.id)
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
