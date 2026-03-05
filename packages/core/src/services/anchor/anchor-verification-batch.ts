import { Effect } from "effect"
import { matchesGlob } from "../../utils/glob.js"
import { DatabaseError } from "../../errors.js"
import type { Anchor, InvalidationSource } from "@jamesaphoenix/tx-types"
import type { AnchorRepo } from "./anchor-service-deps.js"
import type { FailedAnchor, VerificationResult, VerificationSummary, VerifyOptions } from "../anchor-verification.js"

const aggregateResults = (
  results: VerificationResult[],
  failedAnchors: FailedAnchor[],
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
    total: results.length + failedAnchors.length,
    unchanged,
    selfHealed,
    drifted,
    invalid,
    errors: failedAnchors.length,
    duration: Date.now() - startTime,
    failedAnchors
  }
}

const verifyAnchors = (
  anchors: readonly Anchor[],
  verifyAnchor: (
    anchor: Anchor,
    detectedBy: InvalidationSource,
    baseDir: string
  ) => Effect.Effect<VerificationResult, DatabaseError>,
  detectedBy: InvalidationSource,
  baseDir: string,
  skipPinned: boolean
): Effect.Effect<{ readonly results: VerificationResult[]; readonly failedAnchors: FailedAnchor[] }, never> =>
  Effect.gen(function* () {
    const results: VerificationResult[] = []
    const failedAnchors: FailedAnchor[] = []

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
        Effect.catchAll((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.error(`[AnchorVerification] Failed to verify anchor ${anchor.id} (${anchor.filePath}): ${errorMessage}`)
          failedAnchors.push({
            anchorId: anchor.id,
            filePath: anchor.filePath,
            error: errorMessage
          })
          return Effect.succeed(null)
        })
      )

      if (result) {
        results.push(result)
      }
    }

    return { results, failedAnchors }
  })

export const createAnchorVerificationBatchOps = (
  anchorRepo: AnchorRepo,
  verifyAnchor: (
    anchor: Anchor,
    detectedBy: InvalidationSource,
    baseDir: string
  ) => Effect.Effect<VerificationResult, DatabaseError>
) => ({
  verify: (anchorId: number, options: VerifyOptions = {}) =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(anchorId)
      if (!anchor) {
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

  verifyAll: (options: VerifyOptions = {}) =>
    Effect.gen(function* () {
      const startTime = Date.now()
      const detectedBy = options.detectedBy ?? "periodic"
      const baseDir = options.baseDir ?? process.cwd()
      const skipPinned = options.skipPinned ?? true

      const anchors = yield* anchorRepo.findAll(100_000)
      const { results, failedAnchors } = yield* verifyAnchors(anchors, verifyAnchor, detectedBy, baseDir, skipPinned)

      return aggregateResults(results, failedAnchors, startTime)
    }),

  verifyFile: (filePath: string, options: VerifyOptions = {}) =>
    Effect.gen(function* () {
      const startTime = Date.now()
      const detectedBy = options.detectedBy ?? "manual"
      const baseDir = options.baseDir ?? process.cwd()
      const skipPinned = options.skipPinned ?? true

      const anchors = yield* anchorRepo.findByFilePath(filePath)
      const { results, failedAnchors } = yield* verifyAnchors(anchors, verifyAnchor, detectedBy, baseDir, skipPinned)

      return aggregateResults(results, failedAnchors, startTime)
    }),

  verifyGlob: (globPattern: string, options: VerifyOptions = {}) =>
    Effect.gen(function* () {
      const startTime = Date.now()
      const detectedBy = options.detectedBy ?? "manual"
      const baseDir = options.baseDir ?? process.cwd()
      const skipPinned = options.skipPinned ?? true

      const allAnchors = yield* anchorRepo.findAll(100_000)
      const matchingAnchors = allAnchors.filter(a => matchesGlob(a.filePath, globPattern))
      const { results, failedAnchors } = yield* verifyAnchors(matchingAnchors, verifyAnchor, detectedBy, baseDir, skipPinned)

      return aggregateResults(results, failedAnchors, startTime)
    })
})
