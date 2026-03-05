import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToProcessedHash, rowToFileProgress } from "../mappers/deduplication.js"
import type {
  ProcessedHash,
  ProcessedHashRow,
  CreateProcessedHashInput,
  FileProgress,
  FileProgressRow,
  UpsertFileProgressInput
} from "@jamesaphoenix/tx-types"
import { coerceDbResult } from "../utils/db-result.js"

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

    /**
     * Atomically try to insert a hash, returning whether it was actually inserted.
     * Uses INSERT OR IGNORE to handle race conditions safely.
     * Returns { inserted: true } if this was a new hash, { inserted: false } if it already existed.
     */
    readonly tryInsertHash: (input: CreateProcessedHashInput) => Effect.Effect<{ inserted: boolean }, DatabaseError>

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
    readonly deleteFileProgress: (filePath: string) => Effect.Effect<number, DatabaseError>

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
            return row != null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      hashesExist: (contentHashes) =>
        Effect.try({
          try: () => {
            if (contentHashes.length === 0) return new Set<string>()

            // Use batch query with placeholders
            const placeholders = contentHashes.map(() => "?").join(",")
            const rows = coerceDbResult<Array<{ content_hash: string }>>(db.prepare(
              `SELECT content_hash FROM processed_hashes WHERE content_hash IN (${placeholders})`
            ).all(...contentHashes))

            return new Set(rows.map(r => r.content_hash))
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertHash: (input) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () => {
              db.prepare(`
                INSERT INTO processed_hashes (content_hash, source_file, source_line)
                VALUES (?, ?, ?)
              `).run(input.contentHash, input.sourceFile, input.sourceLine)
            },
            catch: (cause) => new DatabaseError({ cause })
          })

          const row = yield* Effect.try({
            try: () => coerceDbResult<ProcessedHashRow | undefined>(db.prepare(
              "SELECT * FROM processed_hashes WHERE content_hash = ?"
            ).get(input.contentHash)),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (!row) {
            return yield* Effect.fail(new DatabaseError({
              cause: new EntityFetchError({
                entity: "processed_hash",
                id: input.contentHash,
                operation: "insert"
              })
            }))
          }

          return rowToProcessedHash(row)
        }),

      tryInsertHash: (input) =>
        Effect.try({
          try: () => {
            // Use INSERT OR IGNORE to atomically handle duplicates
            // This is race-condition safe: if two processes try to insert
            // the same hash concurrently, one succeeds and the other gets changes=0
            const result = db.prepare(`
              INSERT OR IGNORE INTO processed_hashes (content_hash, source_file, source_line)
              VALUES (?, ?, ?)
            `).run(input.contentHash, input.sourceFile, input.sourceLine)

            return { inserted: result.changes > 0 }
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      insertHashes: (inputs) =>
        Effect.gen(function* () {
          if (inputs.length === 0) return 0

          const stmt = db.prepare(`
            INSERT OR IGNORE INTO processed_hashes (content_hash, source_file, source_line)
            VALUES (?, ?, ?)
          `)

          const runBatchInsert = (batch: readonly CreateProcessedHashInput[]): { ok: true; inserted: number } | { ok: false; error: unknown } => {
            db.exec("BEGIN IMMEDIATE")
            try {
              let inserted = 0
              for (const input of batch) {
                const result = stmt.run(input.contentHash, input.sourceFile, input.sourceLine)
                if (result.changes > 0) inserted++
              }
              db.exec("COMMIT")
              return { ok: true, inserted }
            } catch (error) {
              try {
                db.exec("ROLLBACK")
              } catch {
                // no-op
              }
              return { ok: false, error }
            }
          }

          const result = runBatchInsert(inputs)
          if (!result.ok) {
            return yield* Effect.fail(new DatabaseError({ cause: result.error }))
          }
          return result.inserted
        }),

      findByHash: (contentHash) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<ProcessedHashRow | undefined>(db.prepare(
              "SELECT * FROM processed_hashes WHERE content_hash = ?"
            ).get(contentHash))

            return row ? rowToProcessedHash(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countHashes: () =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<{ count: number }>(db.prepare(
              "SELECT COUNT(*) as count FROM processed_hashes"
            ).get())
            return row.count
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getHashesForFile: (filePath) =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<ProcessedHashRow[]>(db.prepare(
              "SELECT * FROM processed_hashes WHERE source_file = ? ORDER BY source_line"
            ).all(filePath))
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
            const row = coerceDbResult<FileProgressRow | undefined>(db.prepare(
              "SELECT * FROM file_progress WHERE file_path = ?"
            ).get(filePath))

            return row ? rowToFileProgress(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      upsertFileProgress: (input) =>
        Effect.gen(function* () {
          yield* Effect.try({
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
            },
            catch: (cause) => new DatabaseError({ cause })
          })

          const row = yield* Effect.try({
            try: () => coerceDbResult<FileProgressRow | undefined>(db.prepare(
              "SELECT * FROM file_progress WHERE file_path = ?"
            ).get(input.filePath)),
            catch: (cause) => new DatabaseError({ cause })
          })
          if (!row) {
            return yield* Effect.fail(new DatabaseError({
              cause: new EntityFetchError({
                entity: "file_progress",
                id: input.filePath,
                operation: "insert"
              })
            }))
          }

          return rowToFileProgress(row)
        }),

      deleteFileProgress: (filePath) =>
        Effect.try({
          try: () => {
            const result = db.prepare("DELETE FROM file_progress WHERE file_path = ?").run(filePath)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getAllFileProgress: () =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<FileProgressRow[]>(db.prepare(
              "SELECT * FROM file_progress ORDER BY last_processed_at DESC"
            ).all())
            return rows.map(rowToFileProgress)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countFiles: () =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<{ count: number }>(db.prepare(
              "SELECT COUNT(*) as count FROM file_progress"
            ).get())
            return row.count
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
