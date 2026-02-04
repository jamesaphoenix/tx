import { Context, Effect, Layer } from "effect"
import { DeduplicationRepository } from "../repo/deduplication-repo.js"
import { hashContent } from "../mappers/deduplication.js"
import { BatchProcessingError, DatabaseError } from "../errors.js"
import type {
  FileProgress,
  LineProcessResult,
  FileProcessResult,
  DeduplicationOptions
} from "@jamesaphoenix/tx-types"

/**
 * Default batch size for hash checking operations.
 * Balances between query efficiency and memory usage.
 */
const DEFAULT_BATCH_SIZE = 100

/**
 * DeduplicationService handles JSONL line deduplication via SHA256 hashing.
 * Tracks processed content hashes to skip already-seen lines.
 * Supports incremental processing by tracking file progress.
 */
export class DeduplicationService extends Context.Tag("DeduplicationService")<
  DeduplicationService,
  {
    /**
     * Process a single JSONL line and return deduplication result.
     * Returns isNew=true if this is a newly seen line (hash recorded).
     * Returns isNew=false if we've already processed this content.
     */
    readonly processLine: (
      content: string,
      filePath: string,
      lineNumber: number
    ) => Effect.Effect<LineProcessResult, DatabaseError>

    /**
     * Process multiple JSONL lines with batch hash checking.
     * More efficient than calling processLine repeatedly.
     * Returns BatchProcessingError with partial results if a batch fails.
     */
    readonly processLines: (
      lines: readonly { content: string; lineNumber: number }[],
      filePath: string,
      options?: DeduplicationOptions
    ) => Effect.Effect<FileProcessResult, DatabaseError | BatchProcessingError<FileProcessResult>>

    /**
     * Check if a content hash has already been processed.
     */
    readonly isProcessed: (content: string) => Effect.Effect<boolean, DatabaseError>

    /**
     * Check multiple content strings at once with batch processing.
     * Returns the set of content strings that have been processed.
     * Returns BatchProcessingError with partial results if a batch fails.
     */
    readonly filterProcessed: (
      contents: readonly string[],
      options?: { batchSize?: number }
    ) => Effect.Effect<Set<string>, DatabaseError | BatchProcessingError<Set<string>>>

    /**
     * Get processing progress for a file.
     * Returns null if file has never been processed.
     */
    readonly getProgress: (filePath: string) => Effect.Effect<FileProgress | null, DatabaseError>

    /**
     * Update processing progress for a file.
     */
    readonly updateProgress: (
      filePath: string,
      lastLineProcessed: number,
      lastByteOffset: number,
      fileSize?: number,
      fileChecksum?: string
    ) => Effect.Effect<FileProgress, DatabaseError>

    /**
     * Reset progress for a file (for reprocessing).
     * Also clears all recorded hashes from this file.
     */
    readonly resetFile: (filePath: string) => Effect.Effect<{ hashesDeleted: number }, DatabaseError>

    /**
     * Get statistics about processed content.
     */
    readonly getStats: () => Effect.Effect<{
      totalHashes: number
      trackedFiles: number
    }, DatabaseError>

    /**
     * Compute SHA256 hash of content.
     * Exposed for use by callers who need to pre-compute hashes.
     */
    readonly computeHash: (content: string) => string
  }
>() {}

export const DeduplicationServiceLive = Layer.effect(
  DeduplicationService,
  Effect.gen(function* () {
    const repo = yield* DeduplicationRepository

    return {
      processLine: (content, filePath, lineNumber) =>
        Effect.gen(function* () {
          const hash = hashContent(content)
          const exists = yield* repo.hashExists(hash)

          if (exists) {
            return {
              hash,
              isNew: false,
              lineNumber,
              content
            }
          }

          // Record the new hash
          yield* repo.insertHash({
            contentHash: hash,
            sourceFile: filePath,
            sourceLine: lineNumber
          })

          return {
            hash,
            isNew: true,
            lineNumber,
            content
          }
        }),

      processLines: (lines, filePath, options = {}) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
          const startLine = options.startLine ?? 1
          const maxLines = options.maxLines

          // Filter to lines we should process
          let linesToProcess = lines.filter(l => l.lineNumber >= startLine)
          if (maxLines !== undefined) {
            linesToProcess = linesToProcess.slice(0, maxLines)
          }

          if (linesToProcess.length === 0) {
            return {
              filePath,
              totalLines: lines.length,
              newLines: 0,
              skippedLines: 0,
              startLine,
              endLine: startLine - 1,
              duration: Date.now() - startTime
            }
          }

          // Compute hashes for all lines
          const lineHashes = linesToProcess.map(l => ({
            ...l,
            hash: hashContent(l.content)
          }))

          // Check existing hashes in batches with error handling
          let existingHashes = new Set<string>()
          const totalBatches = Math.ceil(lineHashes.length / batchSize)

          for (let i = 0; i < lineHashes.length; i += batchSize) {
            const batchIndex = Math.floor(i / batchSize)
            const batch = lineHashes.slice(i, i + batchSize)
            const batchHashes = batch.map(l => l.hash)

            const batchResult = yield* repo.hashesExist(batchHashes).pipe(
              Effect.mapError((cause) => {
                // Calculate partial results up to this point
                const checkedLines = lineHashes.slice(0, i)
                const newLinesPartial = checkedLines.filter(l => !existingHashes.has(l.hash))
                const skippedLinesPartial = checkedLines.filter(l => existingHashes.has(l.hash))
                const lastCheckedLine = checkedLines[checkedLines.length - 1]

                return new BatchProcessingError({
                  operation: "hashesExist",
                  batchIndex,
                  totalBatches,
                  partialResult: {
                    filePath,
                    totalLines: lines.length,
                    newLines: newLinesPartial.length,
                    skippedLines: skippedLinesPartial.length,
                    startLine,
                    endLine: lastCheckedLine?.lineNumber ?? startLine - 1,
                    duration: Date.now() - startTime
                  },
                  cause
                })
              })
            )

            existingHashes = new Set([...existingHashes, ...batchResult])
          }

          // Separate new and existing lines
          const newLines = lineHashes.filter(l => !existingHashes.has(l.hash))
          const skippedLines = lineHashes.filter(l => existingHashes.has(l.hash))

          // Insert new hashes with error handling
          if (newLines.length > 0) {
            const hashInputs = newLines.map(l => ({
              contentHash: l.hash,
              sourceFile: filePath,
              sourceLine: l.lineNumber
            }))

            yield* repo.insertHashes(hashInputs).pipe(
              Effect.mapError((cause) => {
                // All hash checks completed, but insert failed
                // Return partial result with check phase complete but no inserts
                return new BatchProcessingError({
                  operation: "insertHashes",
                  batchIndex: 0,
                  totalBatches: 1,
                  partialResult: {
                    filePath,
                    totalLines: lines.length,
                    newLines: 0, // None were inserted
                    skippedLines: skippedLines.length,
                    startLine,
                    endLine: lineHashes[lineHashes.length - 1]?.lineNumber ?? startLine - 1,
                    duration: Date.now() - startTime
                  },
                  cause
                })
              })
            )
          }

          // Calculate end line
          const lastLine = linesToProcess[linesToProcess.length - 1]
          const endLine = lastLine?.lineNumber ?? startLine - 1

          return {
            filePath,
            totalLines: lines.length,
            newLines: newLines.length,
            skippedLines: skippedLines.length,
            startLine,
            endLine,
            duration: Date.now() - startTime
          }
        }),

      isProcessed: (content) =>
        Effect.gen(function* () {
          const hash = hashContent(content)
          return yield* repo.hashExists(hash)
        }),

      filterProcessed: (contents, options = {}) =>
        Effect.gen(function* () {
          if (contents.length === 0) return new Set<string>()

          const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE

          // Compute hashes and build content-to-hash mapping
          const contentHashMap = new Map<string, string>()
          for (const content of contents) {
            contentHashMap.set(hashContent(content), content)
          }

          const allHashes = [...contentHashMap.keys()]
          const totalBatches = Math.ceil(allHashes.length / batchSize)
          const processedContents = new Set<string>()

          // Check hashes in batches with error handling
          for (let i = 0; i < allHashes.length; i += batchSize) {
            const batchIndex = Math.floor(i / batchSize)
            const batchHashes = allHashes.slice(i, i + batchSize)

            const existingHashes = yield* repo.hashesExist(batchHashes).pipe(
              Effect.mapError((cause) => {
                // Return partial results collected so far
                return new BatchProcessingError({
                  operation: "filterProcessed",
                  batchIndex,
                  totalBatches,
                  partialResult: new Set(processedContents),
                  cause
                })
              })
            )

            // Add found content strings to the result set
            for (const hash of existingHashes) {
              const content = contentHashMap.get(hash)
              if (content) processedContents.add(content)
            }
          }

          return processedContents
        }),

      getProgress: (filePath) => repo.getFileProgress(filePath),

      updateProgress: (filePath, lastLineProcessed, lastByteOffset, fileSize, fileChecksum) =>
        repo.upsertFileProgress({
          filePath,
          lastLineProcessed,
          lastByteOffset,
          fileSize,
          fileChecksum
        }),

      resetFile: (filePath) =>
        Effect.gen(function* () {
          const hashesDeleted = yield* repo.deleteHashesForFile(filePath)
          yield* repo.deleteFileProgress(filePath)
          return { hashesDeleted }
        }),

      getStats: () =>
        Effect.gen(function* () {
          const totalHashes = yield* repo.countHashes()
          const trackedFiles = yield* repo.countFiles()
          return { totalHashes, trackedFiles }
        }),

      computeHash: hashContent
    }
  })
)
