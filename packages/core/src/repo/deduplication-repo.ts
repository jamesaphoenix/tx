import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToProcessedHash, rowToFileProgress } from "../mappers/deduplication.js"
import type {
  ProcessedHash,
  ProcessedHashRow,
  CreateProcessedHashInput,
  FileProgress,
  FileProgressRow,
  UpsertFileProgressInput
} from "@tx/types"

export class DeduplicationRepository extends Context.Tag("DeduplicationRepository")<
  DeduplicationRepository,
  {
    // --- Processed Hashes ---

    /** Check if a content hash already exists */
    readonly hashExists: (contentHash: string) => Effect.Effect<boolean, DatabaseError>

    /** Check multiple hashes at once (batch operation) */
    readonly hashesExist: (contentHashes: readonly string[]) => Effect.Effect<Set<string>, DatabaseError>

    /** Record a processed hash */
    readonly insertHash: (input: CreateProcessedHashInput) => Effect.Effect<ProcessedHash, DatabaseError>

    /** Record multiple hashes at once (batch operation) */
    readonly insertHashes: (inputs: readonly CreateProcessedHashInput[]) => Effect.Effect<number, DatabaseError>

    /** Find a hash record by content hash */
    readonly findByHash: (contentHash: string) => Effect.Effect<ProcessedHash | null, DatabaseError>

    /** Get total count of processed hashes */
    readonly countHashes: () => Effect.Effect<number, DatabaseError>

    /** Get hashes for a specific file */
    readonly getHashesForFile: (filePath: string) => Effect.Effect<readonly ProcessedHash[], DatabaseError>

    /** Delete all hashes for a file (for reprocessing) */
    readonly deleteHashesForFile: (filePath: string) => Effect.Effect<number, DatabaseError>

    // --- File Progress ---

    /** Get progress for a file */
    readonly getFileProgress: (filePath: string) => Effect.Effect<FileProgress | null, DatabaseError>

    /** Update or create progress for a file */
    readonly upsertFileProgress: (input: UpsertFileProgressInput) => Effect.Effect<FileProgress, DatabaseError>

    /** Delete progress for a file */
    readonly deleteFileProgress: (filePath: string) => Effect.Effect<void, DatabaseError>

    /** Get all tracked files */
    readonly getAllFileProgress: () => Effect.Effect<readonly FileProgress[], DatabaseError>

    /** Count tracked files */
    readonly countFiles: () => Effect.Effect<number, DatabaseError>
  }
>() {}

export const DeduplicationRepositoryLive = Layer.effect(
  DeduplicationRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      // --- Processed Hashes ---

      hashExists: (contentHash) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT 1 FROM processed_hashes WHERE content_hash = ? LIMIT 1"
            ).get(contentHash)
            return row !== undefined
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      hashesExist: (contentHashes) =>
        Effect.try({
          try: () => {
            if (contentHashes.length === 0) return new Set<string>()

            // Use batch query with placeholders
            const placeholders = contentHashes.map(() => "?").join(",")
            const rows = db.prepare(
              `SELECT content_hash FROM processed_hashes WHERE content_hash IN (${placeholders})`
            ).all(...contentHashes) as Array<{ content_hash: string }>

            return new Set(rows.map(r => r.content_hash))
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertHash: (input) =>
        Effect.try({
          try: () => {
            db.prepare(`
              INSERT INTO processed_hashes (content_hash, source_file, source_line)
              VALUES (?, ?, ?)
            `).run(input.contentHash, input.sourceFile, input.sourceLine)

            const row = db.prepare(
              "SELECT * FROM processed_hashes WHERE content_hash = ?"
            ).get(input.contentHash) as ProcessedHashRow

            return rowToProcessedHash(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertHashes: (inputs) =>
        Effect.try({
          try: () => {
            if (inputs.length === 0) return 0

            const stmt = db.prepare(`
              INSERT OR IGNORE INTO processed_hashes (content_hash, source_file, source_line)
              VALUES (?, ?, ?)
            `)

            let inserted = 0
            for (const input of inputs) {
              const result = stmt.run(input.contentHash, input.sourceFile, input.sourceLine)
              if (result.changes > 0) inserted++
            }
            return inserted
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByHash: (contentHash) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM processed_hashes WHERE content_hash = ?"
            ).get(contentHash) as ProcessedHashRow | undefined

            return row ? rowToProcessedHash(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countHashes: () =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT COUNT(*) as count FROM processed_hashes"
            ).get() as { count: number }
            return row.count
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getHashesForFile: (filePath) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM processed_hashes WHERE source_file = ? ORDER BY source_line"
            ).all(filePath) as ProcessedHashRow[]
            return rows.map(rowToProcessedHash)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteHashesForFile: (filePath) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "DELETE FROM processed_hashes WHERE source_file = ?"
            ).run(filePath)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      // --- File Progress ---

      getFileProgress: (filePath) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM file_progress WHERE file_path = ?"
            ).get(filePath) as FileProgressRow | undefined

            return row ? rowToFileProgress(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      upsertFileProgress: (input) =>
        Effect.try({
          try: () => {
            db.prepare(`
              INSERT INTO file_progress (file_path, last_line_processed, last_byte_offset, file_size, file_checksum, last_processed_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(file_path) DO UPDATE SET
                last_line_processed = excluded.last_line_processed,
                last_byte_offset = excluded.last_byte_offset,
                file_size = excluded.file_size,
                file_checksum = excluded.file_checksum,
                last_processed_at = datetime('now')
            `).run(
              input.filePath,
              input.lastLineProcessed,
              input.lastByteOffset,
              input.fileSize ?? null,
              input.fileChecksum ?? null
            )

            const row = db.prepare(
              "SELECT * FROM file_progress WHERE file_path = ?"
            ).get(input.filePath) as FileProgressRow

            return rowToFileProgress(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteFileProgress: (filePath) =>
        Effect.try({
          try: () => {
            db.prepare("DELETE FROM file_progress WHERE file_path = ?").run(filePath)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getAllFileProgress: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM file_progress ORDER BY last_processed_at DESC"
            ).all() as FileProgressRow[]
            return rows.map(rowToFileProgress)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countFiles: () =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT COUNT(*) as count FROM file_progress"
            ).get() as { count: number }
            return row.count
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
