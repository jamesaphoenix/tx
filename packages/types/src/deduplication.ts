/**
 * Deduplication types for tx
 *
 * Type definitions for JSONL line deduplication and file progress tracking.
 * Used by the telemetry daemon to avoid re-processing already-seen content.
 * Zero runtime dependencies - pure TypeScript types only.
 */

/**
 * Processed hash ID (auto-incremented integer).
 */
export type ProcessedHashId = number;

/**
 * A processed JSONL line hash record.
 * Tracks unique content by SHA256 hash for deduplication.
 */
export interface ProcessedHash {
  readonly id: ProcessedHashId;
  readonly contentHash: string;       // SHA256 of the line content
  readonly sourceFile: string;        // First file where this line was seen
  readonly sourceLine: number;        // Line number in source file (1-indexed)
  readonly processedAt: Date;
}

/**
 * Input for recording a processed hash.
 */
export interface CreateProcessedHashInput {
  readonly contentHash: string;
  readonly sourceFile: string;
  readonly sourceLine: number;
}

/**
 * Database row type for processed_hashes (snake_case from SQLite).
 */
export interface ProcessedHashRow {
  id: number;
  content_hash: string;
  source_file: string;
  source_line: number;
  processed_at: string;
}

/**
 * File progress ID (auto-incremented integer).
 */
export type FileProgressId = number;

/**
 * File processing progress record.
 * Tracks how far we've processed a JSONL file for incremental processing.
 */
export interface FileProgress {
  readonly id: FileProgressId;
  readonly filePath: string;           // Absolute path to the JSONL file
  readonly lastLineProcessed: number;  // Last line number processed (1-indexed)
  readonly lastByteOffset: number;     // Byte offset for streaming resume
  readonly fileSize: number | null;    // Size at last processing time
  readonly fileChecksum: string | null; // SHA256 of file content at last processing
  readonly lastProcessedAt: Date;
}

/**
 * Input for creating/updating file progress.
 */
export interface UpsertFileProgressInput {
  readonly filePath: string;
  readonly lastLineProcessed: number;
  readonly lastByteOffset: number;
  readonly fileSize?: number;
  readonly fileChecksum?: string;
}

/**
 * Database row type for file_progress (snake_case from SQLite).
 */
export interface FileProgressRow {
  id: number;
  file_path: string;
  last_line_processed: number;
  last_byte_offset: number;
  file_size: number | null;
  file_checksum: string | null;
  last_processed_at: string;
}

/**
 * Result of checking if a hash exists.
 */
export interface HashCheckResult {
  readonly exists: boolean;
  readonly hash: string;
}

/**
 * Result of processing a JSONL line.
 */
export interface LineProcessResult {
  readonly hash: string;
  readonly isNew: boolean;              // True if this is a newly seen line
  readonly lineNumber: number;
  readonly content: string;
}

/**
 * Result of processing a file.
 */
export interface FileProcessResult {
  readonly filePath: string;
  readonly totalLines: number;
  readonly newLines: number;            // Lines not seen before
  readonly skippedLines: number;        // Lines already processed (hash exists)
  readonly startLine: number;           // First line processed (for incremental)
  readonly endLine: number;             // Last line processed
  readonly duration: number;            // Processing time in ms
}

/**
 * Options for deduplication processing.
 */
export interface DeduplicationOptions {
  readonly batchSize?: number;          // Number of hashes to check per batch (default: 100)
  readonly startLine?: number;          // Start from specific line (for incremental)
  readonly maxLines?: number;           // Maximum lines to process (for rate limiting)
}
