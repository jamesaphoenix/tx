import { Effect } from "effect"
import { ValidationError } from "../../errors.js"
import type { AnchorStatus, AnchorType, CreateAnchorInput } from "@jamesaphoenix/tx-types"
import type { TypedAnchorInput } from "../anchor-service.js"

const VALID_ANCHOR_TYPES: readonly AnchorType[] = ["glob", "hash", "symbol", "line_range"]

export const validateAnchorInput = (input: TypedAnchorInput): Effect.Effect<CreateAnchorInput, ValidationError> =>
  Effect.gen(function* () {
    if (!VALID_ANCHOR_TYPES.includes(input.anchorType)) {
      return yield* Effect.fail(new ValidationError({
        reason: `Invalid anchor type: ${input.anchorType}. Valid types: ${VALID_ANCHOR_TYPES.join(", ")}`
      }))
    }

    if (!input.filePath || input.filePath.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({
        reason: "File path is required"
      }))
    }

    if (!input.value || input.value.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({
        reason: "Anchor value is required"
      }))
    }

    switch (input.anchorType) {
      case "glob":
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
        if (!input.symbolFqname || input.symbolFqname.trim().length === 0) {
          return yield* Effect.fail(new ValidationError({
            reason: "Symbol anchor requires symbolFqname"
          }))
        }
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

const VALID_STATUSES: readonly AnchorStatus[] = ["valid", "drifted", "invalid"]

export const validateStatus = (status: AnchorStatus): Effect.Effect<AnchorStatus, ValidationError> =>
  Effect.gen(function* () {
    if (!VALID_STATUSES.includes(status)) {
      return yield* Effect.fail(new ValidationError({
        reason: `Invalid anchor status: ${status}. Valid statuses: ${VALID_STATUSES.join(", ")}`
      }))
    }
    return status
  })
