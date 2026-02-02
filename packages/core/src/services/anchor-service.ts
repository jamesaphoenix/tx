import { Context, Effect, Layer } from "effect"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { LearningRepository } from "../repo/learning-repo.js"
import { AnchorNotFoundError, ValidationError, DatabaseError, LearningNotFoundError } from "../errors.js"
import { getAnchorTTL, isStale } from "./anchor-verification.js"
import type { Anchor, AnchorWithFreshness, AnchorStatus, CreateAnchorInput, AnchorType, InvalidationLog, InvalidationSource } from "@tx/types"

/** Verification result for an anchor */
export interface AnchorVerificationResult {
  readonly anchorId: number
  readonly previousStatus: AnchorStatus
  readonly newStatus: AnchorStatus
  readonly verified: boolean
  readonly reason?: string
}

/** Result of batch verification */
export interface BatchVerificationResult {
  readonly total: number
  readonly verified: number
  readonly drifted: number
  readonly invalid: number
}

/** Graph status summary */
export interface GraphStatusResult {
  readonly total: number
  readonly valid: number
  readonly drifted: number
  readonly invalid: number
  readonly pinned: number
  readonly recentInvalidations: readonly InvalidationLog[]
}

/** Prune result */
export interface PruneResult {
  readonly deleted: number
}

/** Anchor input with type-specific validation */
export interface TypedAnchorInput {
  readonly learningId: number
  readonly anchorType: AnchorType
  readonly filePath: string
  /** Value depends on type: glob pattern, content hash, symbol FQName, or line range string */
  readonly value: string
  /** Symbol fully-qualified name (for symbol anchors) */
  readonly symbolFqname?: string
  /** Start line (for line_range anchors) */
  readonly lineStart?: number
  /** End line (for line_range anchors) */
  readonly lineEnd?: number
  /** Content hash for verification */
  readonly contentHash?: string
  /** Content preview for self-healing comparison (max ~500 chars) */
  readonly contentPreview?: string
}

/** Validate anchor types at compile time */
const VALID_ANCHOR_TYPES: readonly AnchorType[] = ["glob", "hash", "symbol", "line_range"]

export class AnchorService extends Context.Tag("AnchorService")<
  AnchorService,
  {
    /**
     * Create an anchor with type-specific validation.
     * Supports: glob, hash, symbol, line_range
     */
    readonly createAnchor: (input: TypedAnchorInput) => Effect.Effect<Anchor, ValidationError | LearningNotFoundError | DatabaseError>

    /**
     * Verify an anchor's validity.
     * Checks if the file/content still matches what the anchor references.
     */
    readonly verifyAnchor: (anchorId: number) => Effect.Effect<AnchorVerificationResult, AnchorNotFoundError | DatabaseError>

    /**
     * Update an anchor's status (valid, drifted, invalid).
     */
    readonly updateAnchorStatus: (anchorId: number, status: AnchorStatus) => Effect.Effect<Anchor, AnchorNotFoundError | ValidationError | DatabaseError>

    /**
     * Find all anchors for a given file path.
     */
    readonly findAnchorsForFile: (filePath: string) => Effect.Effect<readonly Anchor[], DatabaseError>

    /**
     * Find all anchors for a learning.
     */
    readonly findAnchorsForLearning: (learningId: number) => Effect.Effect<readonly Anchor[], DatabaseError>

    /**
     * Get an anchor by ID.
     */
    readonly get: (id: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>

    /**
     * Get an anchor with lazy verification.
     * If anchor is stale (verified_at > now - TTL), runs verification first.
     * Returns anchor with freshness information.
     */
    readonly getWithVerification: (id: number, options?: { baseDir?: string }) => Effect.Effect<AnchorWithFreshness, AnchorNotFoundError | DatabaseError>

    /**
     * Delete an anchor.
     */
    readonly remove: (id: number) => Effect.Effect<void, AnchorNotFoundError | DatabaseError>

    /**
     * Find all drifted anchors.
     */
    readonly findDrifted: () => Effect.Effect<readonly Anchor[], DatabaseError>

    /**
     * Find all invalid anchors.
     */
    readonly findInvalid: () => Effect.Effect<readonly Anchor[], DatabaseError>

    /**
     * Verify all anchors for a file (batch operation).
     */
    readonly verifyAnchorsForFile: (filePath: string) => Effect.Effect<BatchVerificationResult, DatabaseError>

    /**
     * Pin an anchor (prevents auto-invalidation).
     */
    readonly pin: (anchorId: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>

    /**
     * Unpin an anchor.
     */
    readonly unpin: (anchorId: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>

    /**
     * Manually invalidate an anchor with a reason.
     */
    readonly invalidate: (anchorId: number, reason: string, detectedBy?: InvalidationSource) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>

    /**
     * Restore a soft-deleted (invalid) anchor to valid status.
     */
    readonly restore: (anchorId: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>

    /**
     * Hard delete old invalid anchors.
     */
    readonly prune: (olderThanDays: number) => Effect.Effect<PruneResult, DatabaseError>

    /**
     * Get graph status summary.
     */
    readonly getStatus: () => Effect.Effect<GraphStatusResult, DatabaseError>

    /**
     * Verify all anchors (batch operation).
     */
    readonly verifyAll: () => Effect.Effect<BatchVerificationResult, DatabaseError>
  }
>() {}

/**
 * Validate anchor input based on type.
 * Each anchor type has specific requirements.
 */
const validateAnchorInput = (input: TypedAnchorInput): Effect.Effect<CreateAnchorInput, ValidationError> =>
  Effect.gen(function* () {
    // Validate anchor type
    if (!VALID_ANCHOR_TYPES.includes(input.anchorType)) {
      return yield* Effect.fail(new ValidationError({
        reason: `Invalid anchor type: ${input.anchorType}. Valid types: ${VALID_ANCHOR_TYPES.join(", ")}`
      }))
    }

    // Validate file path
    if (!input.filePath || input.filePath.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({
        reason: "File path is required"
      }))
    }

    // Validate value
    if (!input.value || input.value.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({
        reason: "Anchor value is required"
      }))
    }

    // Type-specific validation
    switch (input.anchorType) {
      case "glob":
        // Glob patterns should be valid patterns
        // Basic validation: must contain at least a filename or pattern
        if (input.value.length < 1) {
          return yield* Effect.fail(new ValidationError({
            reason: "Glob pattern cannot be empty"
          }))
        }
        return {
          learningId: input.learningId,
          anchorType: input.anchorType,
          anchorValue: input.value,
          filePath: input.filePath,
          symbolFqname: null,
          lineStart: null,
          lineEnd: null,
          contentHash: input.contentHash ?? null,
          contentPreview: input.contentPreview ?? null
        }

      case "hash":
        // Hash should be a valid SHA256 hash (64 hex characters)
        if (!/^[a-f0-9]{64}$/i.test(input.value)) {
          return yield* Effect.fail(new ValidationError({
            reason: "Hash anchor value must be a valid SHA256 hash (64 hex characters)"
          }))
        }
        return {
          learningId: input.learningId,
          anchorType: input.anchorType,
          anchorValue: input.value,
          filePath: input.filePath,
          symbolFqname: null,
          lineStart: input.lineStart ?? null,
          lineEnd: input.lineEnd ?? null,
          contentHash: input.value,
          contentPreview: input.contentPreview ?? null
        }

      case "symbol":
        // Symbol anchors require a symbol FQName
        if (!input.symbolFqname || input.symbolFqname.trim().length === 0) {
          return yield* Effect.fail(new ValidationError({
            reason: "Symbol anchor requires symbolFqname"
          }))
        }
        // Symbol FQName format: file::symbolName or file::class::method
        if (!input.symbolFqname.includes("::")) {
          return yield* Effect.fail(new ValidationError({
            reason: "Symbol FQName must be in format: file::symbol or file::class::method"
          }))
        }
        return {
          learningId: input.learningId,
          anchorType: input.anchorType,
          anchorValue: input.value,
          filePath: input.filePath,
          symbolFqname: input.symbolFqname,
          lineStart: input.lineStart ?? null,
          lineEnd: input.lineEnd ?? null,
          contentHash: input.contentHash ?? null,
          contentPreview: input.contentPreview ?? null
        }

      case "line_range":
        // Line range anchors require valid line numbers
        if (input.lineStart === undefined || input.lineStart < 1) {
          return yield* Effect.fail(new ValidationError({
            reason: "Line range anchor requires valid lineStart (>= 1)"
          }))
        }
        if (input.lineEnd !== undefined && input.lineEnd < input.lineStart) {
          return yield* Effect.fail(new ValidationError({
            reason: "lineEnd must be >= lineStart"
          }))
        }
        return {
          learningId: input.learningId,
          anchorType: input.anchorType,
          anchorValue: input.value,
          filePath: input.filePath,
          symbolFqname: null,
          lineStart: input.lineStart,
          lineEnd: input.lineEnd ?? input.lineStart,
          contentHash: input.contentHash ?? null,
          contentPreview: input.contentPreview ?? null
        }

      default:
        return yield* Effect.fail(new ValidationError({
          reason: `Unknown anchor type: ${input.anchorType}`
        }))
    }
  })

/**
 * Validate anchor status.
 */
const VALID_STATUSES: readonly AnchorStatus[] = ["valid", "drifted", "invalid"]

const validateStatus = (status: AnchorStatus): Effect.Effect<AnchorStatus, ValidationError> =>
  Effect.gen(function* () {
    if (!VALID_STATUSES.includes(status)) {
      return yield* Effect.fail(new ValidationError({
        reason: `Invalid anchor status: ${status}. Valid statuses: ${VALID_STATUSES.join(", ")}`
      }))
    }
    return status
  })

export const AnchorServiceLive = Layer.effect(
  AnchorService,
  Effect.gen(function* () {
    const anchorRepo = yield* AnchorRepository
    const learningRepo = yield* LearningRepository

    return {
      createAnchor: (input) =>
        Effect.gen(function* () {
          // Validate the input based on anchor type
          const validatedInput = yield* validateAnchorInput(input)

          // Verify the learning exists
          const learning = yield* learningRepo.findById(input.learningId)
          if (!learning) {
            return yield* Effect.fail(new LearningNotFoundError({ id: input.learningId }))
          }

          // Create the anchor
          return yield* anchorRepo.create(validatedInput)
        }),

      verifyAnchor: (anchorId) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }

          const previousStatus = anchor.status

          // Verification logic depends on anchor type
          // For now, we simply update the verified_at timestamp
          // Full verification would check file existence, hash matches, symbol presence, etc.
          // This is a placeholder for future ast-grep integration
          let newStatus: AnchorStatus = "valid"
          let reason: string | undefined

          switch (anchor.anchorType) {
            case "glob":
              // Glob anchors are generally considered valid if file path matches pattern
              // Full implementation would check if files matching the pattern exist
              newStatus = "valid"
              break

            case "hash":
              // Hash anchors would compare stored hash with current file content hash
              // Placeholder: assume valid for now (full implementation requires file access)
              newStatus = "valid"
              reason = "Hash verification requires file content access"
              break

            case "symbol":
              // Symbol anchors would use ast-grep to verify symbol exists
              // Placeholder: assume valid for now (full implementation requires ast-grep)
              newStatus = "valid"
              reason = "Symbol verification requires ast-grep integration"
              break

            case "line_range":
              // Line range anchors would check if line range is still within file bounds
              // Placeholder: assume valid for now
              newStatus = "valid"
              reason = "Line range verification requires file access"
              break
          }

          // Update status and verified_at timestamp
          if (newStatus !== previousStatus) {
            yield* anchorRepo.updateStatus(anchorId, newStatus)
          }
          yield* anchorRepo.updateVerifiedAt(anchorId)

          return {
            anchorId,
            previousStatus,
            newStatus,
            verified: true,
            reason
          }
        }),

      updateAnchorStatus: (anchorId, status) =>
        Effect.gen(function* () {
          // Validate status
          yield* validateStatus(status)

          // Get anchor to verify it exists
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }

          // Update the status
          yield* anchorRepo.updateStatus(anchorId, status)

          // Return updated anchor
          const updated = yield* anchorRepo.findById(anchorId)
          if (!updated) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }
          return updated
        }),

      findAnchorsForFile: (filePath) => anchorRepo.findByFilePath(filePath),

      findAnchorsForLearning: (learningId) => anchorRepo.findByLearningId(learningId),

      get: (id) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(id)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id }))
          }
          return anchor
        }),

      getWithVerification: (id, _options = {}) =>
        Effect.gen(function* () {
          // Get the anchor first
          const anchor = yield* anchorRepo.findById(id)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id }))
          }

          // Get TTL and check staleness
          const ttl = yield* getAnchorTTL()
          const anchorIsStale = isStale(anchor, ttl)

          // If fresh, return immediately without verification
          if (!anchorIsStale) {
            return {
              anchor,
              isFresh: true,
              wasVerified: false
            }
          }

          // Anchor is stale - run verification
          const previousStatus = anchor.status

          // Verification logic (simplified - uses the same logic as verifyAnchor)
          // For now, we simply update the verified_at timestamp
          // Full verification would check file existence, hash matches, symbol presence, etc.
          // Note: Future implementation will use AnchorVerificationService for full file-based verification
          let newStatus: AnchorStatus = previousStatus
          let reason: string | undefined
          let action: "unchanged" | "self_healed" | "drifted" | "invalidated" = "unchanged"

          switch (anchor.anchorType) {
            case "glob":
              // Glob anchors are generally considered valid if file path matches pattern
              // Full implementation would check if files matching the pattern exist
              break

            case "hash":
              // Hash anchors would compare stored hash with current file content hash
              // Placeholder: assume unchanged for now (full implementation requires file access)
              reason = "Hash verification requires file content access"
              break

            case "symbol":
              // Symbol anchors would use ast-grep to verify symbol exists
              // Placeholder: assume unchanged for now (full implementation requires ast-grep)
              reason = "Symbol verification requires ast-grep integration"
              break

            case "line_range":
              // Line range anchors would check if line range is still within file bounds
              // Placeholder: assume unchanged for now
              reason = "Line range verification requires file access"
              break
          }

          // Determine action based on status change
          if (newStatus !== previousStatus) {
            yield* anchorRepo.updateStatus(id, newStatus)
            if (newStatus === "drifted") {
              action = "drifted"
            } else if (newStatus === "invalid") {
              action = "invalidated"
            } else if (previousStatus === "drifted" && newStatus === "valid") {
              action = "self_healed"
            }
          }

          // Update verified_at timestamp
          yield* anchorRepo.updateVerifiedAt(id)

          // Get the updated anchor
          const updatedAnchor = yield* anchorRepo.findById(id)
          if (!updatedAnchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id }))
          }

          return {
            anchor: updatedAnchor,
            isFresh: false,
            wasVerified: true,
            verificationResult: {
              previousStatus,
              newStatus,
              action,
              reason
            }
          }
        }),

      remove: (id) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(id)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id }))
          }
          yield* anchorRepo.delete(id)
        }),

      findDrifted: () => anchorRepo.findDrifted(),

      findInvalid: () => anchorRepo.findInvalid(),

      verifyAnchorsForFile: (filePath) =>
        Effect.gen(function* () {
          const anchors = yield* anchorRepo.findByFilePath(filePath)

          let verified = 0
          let drifted = 0
          let invalid = 0

          for (const anchor of anchors) {
            // Simple verification - full implementation would check actual file state
            yield* anchorRepo.updateVerifiedAt(anchor.id)

            switch (anchor.status) {
              case "valid":
                verified++
                break
              case "drifted":
                drifted++
                break
              case "invalid":
                invalid++
                break
            }
          }

          return {
            total: anchors.length,
            verified,
            drifted,
            invalid
          }
        }),

      pin: (anchorId) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }

          yield* anchorRepo.setPinned(anchorId, true)

          const updated = yield* anchorRepo.findById(anchorId)
          if (!updated) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }
          return updated
        }),

      unpin: (anchorId) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }

          yield* anchorRepo.setPinned(anchorId, false)

          const updated = yield* anchorRepo.findById(anchorId)
          if (!updated) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }
          return updated
        }),

      invalidate: (anchorId, reason, detectedBy = "manual") =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }

          const oldStatus = anchor.status

          // Update status to invalid
          yield* anchorRepo.updateStatus(anchorId, "invalid")

          // Log the invalidation
          yield* anchorRepo.logInvalidation({
            anchorId,
            oldStatus,
            newStatus: "invalid",
            reason,
            detectedBy,
            oldContentHash: anchor.contentHash
          })

          const updated = yield* anchorRepo.findById(anchorId)
          if (!updated) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }
          return updated
        }),

      restore: (anchorId) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }

          const oldStatus = anchor.status

          // Update status to valid
          yield* anchorRepo.updateStatus(anchorId, "valid")
          yield* anchorRepo.updateVerifiedAt(anchorId)

          // Log the restoration
          yield* anchorRepo.logInvalidation({
            anchorId,
            oldStatus,
            newStatus: "valid",
            reason: "Manual restoration",
            detectedBy: "manual"
          })

          const updated = yield* anchorRepo.findById(anchorId)
          if (!updated) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }
          return updated
        }),

      prune: (olderThanDays) =>
        Effect.gen(function* () {
          const deleted = yield* anchorRepo.deleteOldInvalid(olderThanDays)
          return { deleted }
        }),

      getStatus: () =>
        Effect.gen(function* () {
          const summary = yield* anchorRepo.getStatusSummary()
          const recentInvalidations = yield* anchorRepo.getInvalidationLogs()

          return {
            total: summary.total,
            valid: summary.valid,
            drifted: summary.drifted,
            invalid: summary.invalid,
            pinned: summary.pinned,
            recentInvalidations: recentInvalidations.slice(0, 10)
          }
        }),

      verifyAll: () =>
        Effect.gen(function* () {
          const anchors = yield* anchorRepo.findAll()

          let verified = 0
          let drifted = 0
          let invalid = 0

          for (const anchor of anchors) {
            // Skip pinned anchors
            if (anchor.pinned) {
              switch (anchor.status) {
                case "valid":
                  verified++
                  break
                case "drifted":
                  drifted++
                  break
                case "invalid":
                  invalid++
                  break
              }
              continue
            }

            // Simple verification - full implementation would check actual file state
            yield* anchorRepo.updateVerifiedAt(anchor.id)

            switch (anchor.status) {
              case "valid":
                verified++
                break
              case "drifted":
                drifted++
                break
              case "invalid":
                invalid++
                break
            }
          }

          return {
            total: anchors.length,
            verified,
            drifted,
            invalid
          }
        })
    }
  })
)
