import { Effect } from "effect"
import * as path from "node:path"
import { DatabaseError } from "../../errors.js"
import type { Anchor, InvalidationSource } from "@jamesaphoenix/tx-types"
import type { VerificationResult } from "../anchor-verification.js"
import type { AnchorRepo } from "./anchor-service-deps.js"
import {
  computeContentHash,
  countLines,
  createContentPreview,
  fileExists,
  readFile,
  readLineRange,
  symbolExistsInFile,
  trySelfHeal
} from "./anchor-verification-utils.js"

export const createVerifyAnchor = (anchorRepo: AnchorRepo) =>
  (
    anchor: Anchor,
    detectedBy: InvalidationSource,
    baseDir: string
  ): Effect.Effect<VerificationResult, DatabaseError> =>
    Effect.gen(function* () {
      const oldStatus = anchor.status

      if (anchor.pinned) {
        return {
          anchorId: anchor.id,
          previousStatus: oldStatus,
          newStatus: oldStatus,
          action: "unchanged" as const
        }
      }

      const resolvedBase = path.resolve(baseDir)
      const fullPath = path.resolve(resolvedBase, anchor.filePath)

      if (!fullPath.startsWith(resolvedBase + path.sep) && fullPath !== resolvedBase) {
        yield* anchorRepo.updateStatus(anchor.id, "invalid")
        yield* anchorRepo.logInvalidation({
          anchorId: anchor.id,
          oldStatus,
          newStatus: "invalid",
          reason: "path_traversal_rejected",
          detectedBy
        })

        return {
          anchorId: anchor.id,
          previousStatus: oldStatus,
          newStatus: "invalid" as const,
          action: "invalidated" as const,
          reason: "path_traversal_rejected"
        }
      }

      const exists = yield* fileExists(fullPath)
      if (!exists) {
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

      switch (anchor.anchorType) {
        case "glob": {
          if (oldStatus !== "valid") {
            yield* anchorRepo.updateStatus(anchor.id, "valid")
            yield* anchorRepo.logInvalidation({
              anchorId: anchor.id,
              oldStatus,
              newStatus: "valid",
              reason: "recovered",
              detectedBy
            })
            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: "valid" as const,
              action: "self_healed" as const,
              reason: "file_restored"
            }
          }
          yield* anchorRepo.updateVerifiedAt(anchor.id)
          return {
            anchorId: anchor.id,
            previousStatus: oldStatus,
            newStatus: oldStatus,
            action: "unchanged" as const
          }
        }

        case "hash": {
          if (anchor.lineStart == null || anchor.lineEnd == null) {
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
              if (oldStatus !== "valid") {
                yield* anchorRepo.updateStatus(anchor.id, "valid")
                yield* anchorRepo.logInvalidation({
                  anchorId: anchor.id,
                  oldStatus,
                  newStatus: "valid",
                  reason: "recovered",
                  detectedBy
                })
                return {
                  anchorId: anchor.id,
                  previousStatus: oldStatus,
                  newStatus: "valid" as const,
                  action: "self_healed" as const,
                  reason: "content_restored"
                }
              }
              yield* anchorRepo.updateVerifiedAt(anchor.id)
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: oldStatus,
                action: "unchanged" as const
              }
            }

            const healResult = yield* trySelfHeal(anchor, content, newHash, anchorRepo)

            if (healResult.healed) {
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
            if (oldStatus !== "valid") {
              yield* anchorRepo.updateStatus(anchor.id, "valid")
              yield* anchorRepo.logInvalidation({
                anchorId: anchor.id,
                oldStatus,
                newStatus: "valid",
                reason: "recovered",
                detectedBy
              })
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: "valid" as const,
                action: "self_healed" as const,
                reason: "content_restored"
              }
            }
            yield* anchorRepo.updateVerifiedAt(anchor.id)
            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: oldStatus,
              action: "unchanged" as const
            }
          }

          const healResult = yield* trySelfHeal(anchor, content, newHash, anchorRepo)

          if (healResult.healed) {
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
          const symbolName = anchor.symbolFqname ?? anchor.anchorValue

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
            if (oldStatus !== "valid") {
              yield* anchorRepo.updateStatus(anchor.id, "valid")
              yield* anchorRepo.logInvalidation({
                anchorId: anchor.id,
                oldStatus,
                newStatus: "valid",
                reason: "recovered",
                detectedBy
              })
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: "valid" as const,
                action: "self_healed" as const,
                reason: "symbol_restored"
              }
            }
            yield* anchorRepo.updateVerifiedAt(anchor.id)
            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: oldStatus,
              action: "unchanged" as const
            }
          }

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
          const lineCount = yield* countLines(fullPath)
          const requiredLines = anchor.lineEnd ?? anchor.lineStart ?? 1

          if (lineCount >= requiredLines) {
            if (oldStatus !== "valid") {
              yield* anchorRepo.updateStatus(anchor.id, "valid")
              yield* anchorRepo.logInvalidation({
                anchorId: anchor.id,
                oldStatus,
                newStatus: "valid",
                reason: "recovered",
                detectedBy
              })
              return {
                anchorId: anchor.id,
                previousStatus: oldStatus,
                newStatus: "valid" as const,
                action: "self_healed" as const,
                reason: "line_count_restored"
              }
            }
            yield* anchorRepo.updateVerifiedAt(anchor.id)
            return {
              anchorId: anchor.id,
              previousStatus: oldStatus,
              newStatus: oldStatus,
              action: "unchanged" as const
            }
          }

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
          yield* anchorRepo.updateVerifiedAt(anchor.id)
          return {
            anchorId: anchor.id,
            previousStatus: oldStatus,
            newStatus: oldStatus,
            action: "unchanged" as const
          }
      }
    })
