/**
 * AnchorVerificationService - Periodic anchor verification for PRD-017
 *
 * Verifies anchors by checking actual file system state:
 * - glob: Check if glob pattern still matches files
 * - hash: Compute content hash and compare
 * - symbol: Grep-based check for symbol presence
 * - line_range: Verify file exists and has enough lines
 *
 * Updates anchor status (valid/drifted/invalid) and logs all changes
 * to invalidation_log via AnchorRepository.
 *
 * @see docs/prd/PRD-017-invalidation-maintenance.md
 * @see docs/design/DD-017-invalidation-maintenance.md
 */

import { Config, Context, Effect, Layer } from "effect"
import * as fs from "node:fs/promises"
import * as crypto from "node:crypto"
import * as path from "node:path"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { DatabaseError } from "../errors.js"
import { matchesGlob } from "../utils/glob.js"
import type { Anchor, AnchorStatus, InvalidationSource } from "@jamesaphoenix/tx-types"

// =============================================================================
// Types
// =============================================================================

/** Result of verifying a single anchor */
export interface VerificationResult {
  readonly anchorId: number
  readonly previousStatus: AnchorStatus
  readonly newStatus: AnchorStatus
  readonly action: "unchanged" | "self_healed" | "drifted" | "invalidated"
  readonly reason?: string
  readonly similarity?: number
  readonly oldContentHash?: string | null
  readonly newContentHash?: string | null
}

/** Summary of batch verification */
export interface VerificationSummary {
  readonly total: number
  readonly unchanged: number
  readonly selfHealed: number
  readonly drifted: number
  readonly invalid: number
  readonly errors: number
  readonly duration: number
}

/** Options for verification */
export interface VerifyOptions {
  /** Detection source for audit logging */
  readonly detectedBy?: InvalidationSource
  /** Skip pinned anchors (default: true) */
  readonly skipPinned?: boolean
  /** Base directory for relative file paths */
  readonly baseDir?: string
}

// =============================================================================
// Service Definition
// =============================================================================

export class AnchorVerificationService extends Context.Tag("AnchorVerificationService")<
  AnchorVerificationService,
  {
    /**
     * Verify a single anchor against the file system.
     * Checks file existence, content hash, symbol presence, etc.
     */
    readonly verify: (
      anchorId: number,
      options?: VerifyOptions
    ) => Effect.Effect<VerificationResult, DatabaseError>

    /**
     * Verify all anchors.
     * Returns summary of verification results.
     */
    readonly verifyAll: (
      options?: VerifyOptions
    ) => Effect.Effect<VerificationSummary, DatabaseError>

    /**
     * Verify all anchors for a specific file.
     */
    readonly verifyFile: (
      filePath: string,
      options?: VerifyOptions
    ) => Effect.Effect<VerificationSummary, DatabaseError>

    /**
     * Verify anchors matching a glob pattern.
     */
    readonly verifyGlob: (
      globPattern: string,
      options?: VerifyOptions
    ) => Effect.Effect<VerificationSummary, DatabaseError>
  }
>() {}

// =============================================================================
// Configuration
// =============================================================================

/** Default anchor cache TTL in seconds (1 hour) */
export const DEFAULT_ANCHOR_CACHE_TTL = 3600

/**
 * Get the anchor cache TTL from TX_ANCHOR_CACHE_TTL env var.
 * Used by lazy verification to determine staleness.
 *
 * @returns Effect yielding TTL in seconds (default: 3600)
 */
export const getAnchorTTL = (): Effect.Effect<number, never> =>
  Config.number("TX_ANCHOR_CACHE_TTL").pipe(
    Config.withDefault(DEFAULT_ANCHOR_CACHE_TTL),
    Effect.catchAll(() => Effect.succeed(DEFAULT_ANCHOR_CACHE_TTL))
  )

/**
 * Check if an anchor is stale based on its verified_at timestamp and TTL.
 * An anchor is stale if:
 * - verified_at is null (never verified), or
 * - verified_at is older than (now - TTL)
 *
 * @param anchor - The anchor to check
 * @param ttlSeconds - TTL in seconds (from getAnchorTTL)
 * @returns true if anchor is stale and needs verification
 */
export const isStale = (anchor: Anchor, ttlSeconds: number): boolean => {
  if (!anchor.verifiedAt) {
    return true // Never verified = stale
  }

  const verifiedAtMs = anchor.verifiedAt.getTime()
  const ttlMs = ttlSeconds * 1000
  const cutoffMs = Date.now() - ttlMs

  return verifiedAtMs < cutoffMs
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Compute SHA256 hash of content */
const computeContentHash = (content: string): string =>
  crypto.createHash("sha256").update(content).digest("hex")

/** Check if file exists */
const fileExists = (filePath: string): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      await fs.access(filePath)
      return true
    },
    catch: () => false
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

/** Read file content */
const readFile = (filePath: string): Effect.Effect<string | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const content = await fs.readFile(filePath, "utf-8")
      return content
    },
    catch: () => null
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))

/** Read specific line range from file */
const readLineRange = (
  filePath: string,
  lineStart: number,
  lineEnd: number
): Effect.Effect<string | null, never> =>
  Effect.gen(function* () {
    // Validate line numbers are positive (1-indexed)
    if (lineStart < 1 || lineEnd < 1) return null
    // Validate range is valid (end >= start)
    if (lineEnd < lineStart) return null

    const content = yield* readFile(filePath)
    if (!content) return null

    const lines = content.split("\n")
    if (lineStart > lines.length) return null

    const end = Math.min(lineEnd, lines.length)
    return lines.slice(lineStart - 1, end).join("\n")
  })

/** Count lines in file */
const countLines = (filePath: string): Effect.Effect<number, never> =>
  Effect.gen(function* () {
    const content = yield* readFile(filePath)
    if (!content) return 0
    return content.split("\n").length
  })

/** Escape regex special characters in a string */
const escapeRegex = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Check if a symbol exists in file (grep-based) */
const symbolExistsInFile = (
  filePath: string,
  symbolName: string
): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const content = yield* readFile(filePath)
    if (!content) return false

    // Extract just the symbol name from FQName (e.g., "file.ts::ClassName" -> "ClassName")
    const simpleName = symbolName.includes("::")
      ? symbolName.split("::").pop() ?? symbolName
      : symbolName

    // If symbol name is empty or whitespace-only, symbol is not found
    // This prevents false positives where regex would match any declaration
    if (!simpleName || simpleName.trim().length === 0) {
      return false
    }

    // Escape regex special characters to prevent injection and false matches
    const escapedName = escapeRegex(simpleName.trim())

    // Check for common patterns: function, class, const, export, interface, type
    const patterns = [
      new RegExp(`\\b(function|const|let|var)\\s+${escapedName}\\b`),
      new RegExp(`\\bclass\\s+${escapedName}\\b`),
      new RegExp(`\\binterface\\s+${escapedName}\\b`),
      new RegExp(`\\btype\\s+${escapedName}\\b`),
      new RegExp(`\\bexport\\s+(default\\s+)?(function|class|const|let|var|interface|type)\\s+${escapedName}\\b`),
      new RegExp(`\\bexport\\s+\\{[^}]*\\b${escapedName}\\b[^}]*\\}`) // export { Symbol }
    ]

    return patterns.some(p => p.test(content))
  })

// =============================================================================
// Self-Healing Utilities (PRD-017)
// =============================================================================

/** Default threshold for self-healing (80% similarity) */
const SELF_HEAL_THRESHOLD = 0.8

/** Maximum content preview length */
const MAX_PREVIEW_LENGTH = 500

/**
 * Tokenize text for Jaccard similarity computation.
 * Extracts words/identifiers, lowercased, filtering short tokens.
 */
const tokenize = (text: string): Set<string> => {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2)
  )
}

/**
 * Compute Jaccard similarity between two sets of tokens.
 * Returns value between 0 (completely different) and 1 (identical).
 */
const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  const intersection = new Set([...a].filter(x => b.has(x)))
  const union = new Set([...a, ...b])

  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Compute Jaccard similarity between two text strings.
 */
const computeSimilarity = (oldContent: string, newContent: string): number => {
  const oldTokens = tokenize(oldContent)
  const newTokens = tokenize(newContent)
  return jaccardSimilarity(oldTokens, newTokens)
}

/**
 * Create a content preview (truncated content for storage/comparison).
 */
const createContentPreview = (content: string): string => {
  if (content.length <= MAX_PREVIEW_LENGTH) return content
  return content.slice(0, MAX_PREVIEW_LENGTH)
}

/** Self-healing result */
interface SelfHealResult {
  readonly healed: boolean
  readonly similarity: number
  readonly newHash?: string
  readonly newPreview?: string
}

/**
 * Try to self-heal a drifted anchor by comparing content similarity.
 * If the new content is similar enough (>= 0.8 Jaccard), update the anchor
 * with the new hash and preview.
 */
const trySelfHeal = (
  anchor: Anchor,
  newContent: string,
  newHash: string,
  anchorRepo: Context.Tag.Service<typeof AnchorRepository>
): Effect.Effect<SelfHealResult, DatabaseError> =>
  Effect.gen(function* () {
    // If no content preview stored, we can't compare - can't self-heal
    if (!anchor.contentPreview) {
      return { healed: false, similarity: 0 }
    }

    // Compute similarity between old preview and new content
    const similarity = computeSimilarity(anchor.contentPreview, newContent)

    // If similarity is above threshold, self-heal
    if (similarity >= SELF_HEAL_THRESHOLD) {
      const newPreview = createContentPreview(newContent)

      // Update anchor with new hash and preview
      yield* anchorRepo.update(anchor.id, {
        contentHash: newHash,
        contentPreview: newPreview,
        verifiedAt: new Date()
      })

      return {
        healed: true,
        similarity,
        newHash,
        newPreview
      }
    }

    // Similarity too low - can't self-heal
    return { healed: false, similarity }
  })

// =============================================================================
// Service Implementation
// =============================================================================

export const AnchorVerificationServiceLive = Layer.effect(
  AnchorVerificationService,
  Effect.gen(function* () {
    const anchorRepo = yield* AnchorRepository

    /**
     * Verify a single anchor against the actual file system.
     */
    const verifyAnchor = (
      anchor: Anchor,
      detectedBy: InvalidationSource,
      baseDir: string
    ): Effect.Effect<VerificationResult, DatabaseError> =>
      Effect.gen(function* () {
        const oldStatus = anchor.status

        // Skip pinned anchors
        if (anchor.pinned) {
          return {
            anchorId: anchor.id,
            previousStatus: oldStatus,
            newStatus: oldStatus,
            action: "unchanged" as const
          }
        }

        // Resolve full file path
        const fullPath = path.isAbsolute(anchor.filePath)
          ? anchor.filePath
          : path.join(baseDir, anchor.filePath)

        // Step 1: Check if file exists
        const exists = yield* fileExists(fullPath)
        if (!exists) {
          // File deleted - mark as invalid
          yield* anchorRepo.updateStatus(anchor.id, "invalid")
          yield* anchorRepo.logInvalidation({
            anchorId: anchor.id,
            oldStatus,
            newStatus: "invalid",
            reason: "file_deleted",
            detectedBy
          })

          return {
            anchorId: anchor.id,
            previousStatus: oldStatus,
            newStatus: "invalid" as const,
            action: "invalidated" as const,
            reason: "file_deleted"
          }
        }

        // Step 2: Type-specific verification
        switch (anchor.anchorType) {
          case "glob": {
            // For glob anchors, the file exists and matches - valid
            yield* anchorRepo.updateVerifiedAt(anchor.id)
            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: oldStatus,
              action: "unchanged" as const
            }
          }

          case "hash": {
            // Check content hash
            // Use explicit null checks: 0 is an invalid line number, not "no line range"
            if (anchor.lineStart == null || anchor.lineEnd == null) {
              // No line range specified, read whole file
              const content = yield* readFile(fullPath)
              if (!content) {
                yield* anchorRepo.updateStatus(anchor.id, "invalid")
                yield* anchorRepo.logInvalidation({
                  anchorId: anchor.id,
                  oldStatus,
                  newStatus: "invalid",
                  reason: "content_read_failed",
                  detectedBy
                })
                return {
                  anchorId: anchor.id,
                  previousStatus: oldStatus,
                  newStatus: "invalid" as const,
                  action: "invalidated" as const,
                  reason: "content_read_failed"
                }
              }

              const newHash = computeContentHash(content)

              // If no stored hash, initialize it with current content (can't verify without baseline)
              if (!anchor.contentHash) {
                const newPreview = createContentPreview(content)
                yield* anchorRepo.update(anchor.id, {
                  contentHash: newHash,
                  contentPreview: newPreview,
                  verifiedAt: new Date()
                })
                return {
                  anchorId: anchor.id,
                  previousStatus: oldStatus,
                  newStatus: oldStatus,
                  action: "unchanged" as const
                }
              }

              if (newHash === anchor.contentHash) {
                yield* anchorRepo.updateVerifiedAt(anchor.id)
                return {
                  anchorId: anchor.id,
                  previousStatus: oldStatus,
                  newStatus: oldStatus,
                  action: "unchanged" as const
                }
              }

              // Hash mismatch - try self-healing if we have content preview
              const healResult = yield* trySelfHeal(anchor, content, newHash, anchorRepo)

              if (healResult.healed) {
                // Successfully self-healed - update status to valid
                yield* anchorRepo.updateStatus(anchor.id, "valid")
                yield* anchorRepo.logInvalidation({
                  anchorId: anchor.id,
                  oldStatus,
                  newStatus: "valid",
                  reason: "self_healed",
                  detectedBy,
                  oldContentHash: anchor.contentHash,
                  newContentHash: newHash,
                  similarityScore: healResult.similarity
                })

                return {
                  anchorId: anchor.id,
                  previousStatus: oldStatus,
                  newStatus: "valid" as const,
                  action: "self_healed" as const,
                  reason: "content_similar",
                  similarity: healResult.similarity,
                  oldContentHash: anchor.contentHash,
                  newContentHash: newHash
                }
              }

              // Could not self-heal - mark as drifted
              yield* anchorRepo.updateStatus(anchor.id, "drifted")
              yield* anchorRepo.logInvalidation({
                anchorId: anchor.id,
                oldStatus,
                newStatus: "drifted",
                reason: "hash_mismatch",
                detectedBy,
                oldContentHash: anchor.contentHash,
                newContentHash: newHash,
                similarityScore: healResult.similarity
              })

              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: "drifted" as const,
                action: "drifted" as const,
                reason: "hash_mismatch",
                similarity: healResult.similarity,
                oldContentHash: anchor.contentHash,
                newContentHash: newHash
              }
            }

            // Read line range
            const content = yield* readLineRange(fullPath, anchor.lineStart, anchor.lineEnd)
            if (!content) {
              yield* anchorRepo.updateStatus(anchor.id, "invalid")
              yield* anchorRepo.logInvalidation({
                anchorId: anchor.id,
                oldStatus,
                newStatus: "invalid",
                reason: "line_range_invalid",
                detectedBy
              })
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: "invalid" as const,
                action: "invalidated" as const,
                reason: "line_range_invalid"
              }
            }

            const newHash = computeContentHash(content)

            // If no stored hash, initialize it with current content (can't verify without baseline)
            if (!anchor.contentHash) {
              const newPreview = createContentPreview(content)
              yield* anchorRepo.update(anchor.id, {
                contentHash: newHash,
                contentPreview: newPreview,
                verifiedAt: new Date()
              })
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: oldStatus,
                action: "unchanged" as const
              }
            }

            if (newHash === anchor.contentHash) {
              yield* anchorRepo.updateVerifiedAt(anchor.id)
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: oldStatus,
                action: "unchanged" as const
              }
            }

            // Hash mismatch - try self-healing if we have content preview
            const healResult = yield* trySelfHeal(anchor, content, newHash, anchorRepo)

            if (healResult.healed) {
              // Successfully self-healed - update status to valid
              yield* anchorRepo.updateStatus(anchor.id, "valid")
              yield* anchorRepo.logInvalidation({
                anchorId: anchor.id,
                oldStatus,
                newStatus: "valid",
                reason: "self_healed",
                detectedBy,
                oldContentHash: anchor.contentHash,
                newContentHash: newHash,
                similarityScore: healResult.similarity
              })

              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: "valid" as const,
                action: "self_healed" as const,
                reason: "content_similar",
                similarity: healResult.similarity,
                oldContentHash: anchor.contentHash,
                newContentHash: newHash
              }
            }

            // Could not self-heal - mark as drifted
            yield* anchorRepo.updateStatus(anchor.id, "drifted")
            yield* anchorRepo.logInvalidation({
              anchorId: anchor.id,
              oldStatus,
              newStatus: "drifted",
              reason: "hash_mismatch",
              detectedBy,
              oldContentHash: anchor.contentHash,
              newContentHash: newHash,
              similarityScore: healResult.similarity
            })

            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: "drifted" as const,
              action: "drifted" as const,
              reason: "hash_mismatch",
              similarity: healResult.similarity,
              oldContentHash: anchor.contentHash,
              newContentHash: newHash
            }
          }

          case "symbol": {
            // Check if symbol exists in file
            const symbolName = anchor.symbolFqname ?? anchor.anchorValue

            // If symbol name is empty or invalid, mark as invalid immediately
            // This prevents false positives from regex matching any declaration
            if (!symbolName || symbolName.trim().length === 0) {
              yield* anchorRepo.updateStatus(anchor.id, "invalid")
              yield* anchorRepo.logInvalidation({
                anchorId: anchor.id,
                oldStatus,
                newStatus: "invalid",
                reason: "symbol_name_invalid",
                detectedBy
              })

              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: "invalid" as const,
                action: "invalidated" as const,
                reason: "symbol_name_invalid"
              }
            }

            const symbolExists = yield* symbolExistsInFile(fullPath, symbolName)

            if (symbolExists) {
              yield* anchorRepo.updateVerifiedAt(anchor.id)
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: oldStatus,
                action: "unchanged" as const
              }
            }

            // Symbol not found - mark as invalid
            yield* anchorRepo.updateStatus(anchor.id, "invalid")
            yield* anchorRepo.logInvalidation({
              anchorId: anchor.id,
              oldStatus,
              newStatus: "invalid",
              reason: "symbol_missing",
              detectedBy
            })

            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: "invalid" as const,
              action: "invalidated" as const,
              reason: "symbol_missing"
            }
          }

          case "line_range": {
            // Check if file has enough lines
            const lineCount = yield* countLines(fullPath)
            const requiredLines = anchor.lineEnd ?? anchor.lineStart ?? 1

            if (lineCount >= requiredLines) {
              yield* anchorRepo.updateVerifiedAt(anchor.id)
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: oldStatus,
                action: "unchanged" as const
              }
            }

            // Not enough lines - mark as drifted (file changed but still exists)
            yield* anchorRepo.updateStatus(anchor.id, "drifted")
            yield* anchorRepo.logInvalidation({
              anchorId: anchor.id,
              oldStatus,
              newStatus: "drifted",
              reason: `line_count_insufficient (have ${lineCount}, need ${requiredLines})`,
              detectedBy
            })

            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: "drifted" as const,
              action: "drifted" as const,
              reason: `line_count_insufficient`
            }
          }

          default:
            // Unknown anchor type - keep as is
            yield* anchorRepo.updateVerifiedAt(anchor.id)
            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: oldStatus,
              action: "unchanged" as const
            }
        }
      })

    /**
     * Aggregate verification results into summary
     */
    const aggregateResults = (
      results: VerificationResult[],
      errors: number,
      startTime: number
    ): VerificationSummary => {
      let unchanged = 0
      let selfHealed = 0
      let drifted = 0
      let invalid = 0

      for (const result of results) {
        switch (result.action) {
          case "unchanged":
            unchanged++
            break
          case "self_healed":
            selfHealed++
            break
          case "drifted":
            drifted++
            break
          case "invalidated":
            invalid++
            break
        }
      }

      return {
        total: results.length + errors,
        unchanged,
        selfHealed,
        drifted,
        invalid,
        errors,
        duration: Date.now() - startTime
      }
    }

    return {
      verify: (anchorId, options = {}) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            // Return unchanged result for non-existent anchor
            return {
              anchorId,
              previousStatus: "valid" as const,
              newStatus: "valid" as const,
              action: "unchanged" as const,
              reason: "anchor_not_found"
            }
          }

          const detectedBy = options.detectedBy ?? "lazy"
          const baseDir = options.baseDir ?? process.cwd()

          return yield* verifyAnchor(anchor, detectedBy, baseDir)
        }),

      verifyAll: (options = {}) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const detectedBy = options.detectedBy ?? "periodic"
          const baseDir = options.baseDir ?? process.cwd()
          const skipPinned = options.skipPinned ?? true

          const anchors = yield* anchorRepo.findAllValid()
          const results: VerificationResult[] = []
          let errors = 0

          for (const anchor of anchors) {
            if (skipPinned && anchor.pinned) {
              results.push({
                anchorId: anchor.id,
                previousStatus: anchor.status,
                newStatus: anchor.status,
                action: "unchanged"
              })
              continue
            }

            const result = yield* verifyAnchor(anchor, detectedBy, baseDir).pipe(
              Effect.catchAll(() => {
                errors++
                return Effect.succeed(null)
              })
            )

            if (result) {
              results.push(result)
            }
          }

          return aggregateResults(results, errors, startTime)
        }),

      verifyFile: (filePath, options = {}) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const detectedBy = options.detectedBy ?? "manual"
          const baseDir = options.baseDir ?? process.cwd()
          const skipPinned = options.skipPinned ?? true

          const anchors = yield* anchorRepo.findByFilePath(filePath)
          const results: VerificationResult[] = []
          let errors = 0

          for (const anchor of anchors) {
            if (skipPinned && anchor.pinned) {
              results.push({
                anchorId: anchor.id,
                previousStatus: anchor.status,
                newStatus: anchor.status,
                action: "unchanged"
              })
              continue
            }

            const result = yield* verifyAnchor(anchor, detectedBy, baseDir).pipe(
              Effect.catchAll(() => {
                errors++
                return Effect.succeed(null)
              })
            )

            if (result) {
              results.push(result)
            }
          }

          return aggregateResults(results, errors, startTime)
        }),

      verifyGlob: (globPattern, options = {}) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const detectedBy = options.detectedBy ?? "manual"
          const baseDir = options.baseDir ?? process.cwd()
          const skipPinned = options.skipPinned ?? true

          // Get all anchors and filter by glob pattern
          const allAnchors = yield* anchorRepo.findAll()
          const matchingAnchors = allAnchors.filter(a =>
            matchesGlob(a.filePath, globPattern)
          )

          const results: VerificationResult[] = []
          let errors = 0

          for (const anchor of matchingAnchors) {
            if (skipPinned && anchor.pinned) {
              results.push({
                anchorId: anchor.id,
                previousStatus: anchor.status,
                newStatus: anchor.status,
                action: "unchanged"
              })
              continue
            }

            const result = yield* verifyAnchor(anchor, detectedBy, baseDir).pipe(
              Effect.catchAll(() => {
                errors++
                return Effect.succeed(null)
              })
            )

            if (result) {
              results.push(result)
            }
          }

          return aggregateResults(results, errors, startTime)
        })
    }
  })
)
