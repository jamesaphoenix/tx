/**
 * Deduplication types for tx
 *
 * Type definitions for JSONL line deduplication and file progress tracking.
 * Used by the telemetry daemon to avoid re-processing already-seen content.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Processed hash ID (auto-incremented integer). */
export type ProcessedHashId = number;

/** A processed JSONL line hash record. */
export const ProcessedHashSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  contentHash: Schema.String,
  sourceFile: Schema.String,
  sourceLine: Schema.Number.pipe(Schema.int()),
  processedAt: Schema.DateFromSelf,
})
export type ProcessedHash = typeof ProcessedHashSchema.Type

/** Input for recording a processed hash. */
export const CreateProcessedHashInputSchema = Schema.Struct({
  contentHash: Schema.String,
  sourceFile: Schema.String,
  sourceLine: Schema.Number.pipe(Schema.int()),
})
export type CreateProcessedHashInput = typeof CreateProcessedHashInputSchema.Type

/** File progress ID (auto-incremented integer). */
export type FileProgressId = number;

/** File processing progress record. */
export const FileProgressSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  filePath: Schema.String,
  lastLineProcessed: Schema.Number.pipe(Schema.int()),
  lastByteOffset: Schema.Number.pipe(Schema.int()),
  fileSize: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  fileChecksum: Schema.NullOr(Schema.String),
  lastProcessedAt: Schema.DateFromSelf,
})
export type FileProgress = typeof FileProgressSchema.Type

/** Input for creating/updating file progress. */
export const UpsertFileProgressInputSchema = Schema.Struct({
  filePath: Schema.String,
  lastLineProcessed: Schema.Number.pipe(Schema.int()),
  lastByteOffset: Schema.Number.pipe(Schema.int()),
  fileSize: Schema.optional(Schema.Number.pipe(Schema.int())),
  fileChecksum: Schema.optional(Schema.String),
})
export type UpsertFileProgressInput = typeof UpsertFileProgressInputSchema.Type

/** Result of checking if a hash exists. */
export const HashCheckResultSchema = Schema.Struct({
  exists: Schema.Boolean,
  hash: Schema.String,
})
export type HashCheckResult = typeof HashCheckResultSchema.Type

/** Result of processing a JSONL line. */
export const LineProcessResultSchema = Schema.Struct({
  hash: Schema.String,
  isNew: Schema.Boolean,
  lineNumber: Schema.Number.pipe(Schema.int()),
  content: Schema.String,
})
export type LineProcessResult = typeof LineProcessResultSchema.Type

/** Result of processing a file. */
export const FileProcessResultSchema = Schema.Struct({
  filePath: Schema.String,
  totalLines: Schema.Number.pipe(Schema.int()),
  newLines: Schema.Number.pipe(Schema.int()),
  skippedLines: Schema.Number.pipe(Schema.int()),
  startLine: Schema.Number.pipe(Schema.int()),
  endLine: Schema.Number.pipe(Schema.int()),
  duration: Schema.Number,
})
export type FileProcessResult = typeof FileProcessResultSchema.Type

/** Options for deduplication processing. */
export const DeduplicationOptionsSchema = Schema.Struct({
  batchSize: Schema.optional(Schema.Number.pipe(Schema.int())),
  startLine: Schema.optional(Schema.Number.pipe(Schema.int())),
  maxLines: Schema.optional(Schema.Number.pipe(Schema.int())),
})
export type DeduplicationOptions = typeof DeduplicationOptionsSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for processed_hashes (snake_case from SQLite). */
export interface ProcessedHashRow {
  id: number;
  content_hash: string;
  source_file: string;
  source_line: number;
  processed_at: string;
}

/** Database row type for file_progress (snake_case from SQLite). */
export interface FileProgressRow {
  id: number;
  file_path: string;
  last_line_processed: number;
  last_byte_offset: number;
  file_size: number | null;
  file_checksum: string | null;
  last_processed_at: string;
}
