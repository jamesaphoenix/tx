import { Context, Effect, Layer } from "effect"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { LearningRepository } from "../repo/learning-repo.js"
import { createAnchorServiceOps } from "./anchor/anchor-service-ops.js"
import type { AnchorNotFoundError, DatabaseError, LearningNotFoundError, ValidationError } from "../errors.js"
import type {
  Anchor,
  AnchorStatus,
  AnchorType,
  AnchorWithFreshness,
  InvalidationLog,
  InvalidationSource
} from "@jamesaphoenix/tx-types"

export type AnchorVerificationResult = {
  readonly anchorId: number
  readonly previousStatus: AnchorStatus
  readonly newStatus: AnchorStatus
  readonly verified: boolean
  readonly reason?: string
}

export type BatchVerificationResult = {
  readonly total: number
  readonly verified: number
  readonly drifted: number
  readonly invalid: number
}

export type GraphStatusResult = {
  readonly total: number
  readonly valid: number
  readonly drifted: number
  readonly invalid: number
  readonly pinned: number
  readonly recentInvalidations: readonly InvalidationLog[]
}

export type PruneResult = {
  readonly deleted: number
}

export type TypedAnchorInput = {
  readonly learningId: number
  readonly anchorType: AnchorType
  readonly filePath: string
  readonly value: string
  readonly symbolFqname?: string
  readonly lineStart?: number
  readonly lineEnd?: number
  readonly contentHash?: string
  readonly contentPreview?: string
}

export class AnchorService extends Context.Tag("AnchorService")<
  AnchorService,
  {
    readonly createAnchor: (input: TypedAnchorInput) => Effect.Effect<Anchor, ValidationError | LearningNotFoundError | DatabaseError>
    readonly verifyAnchor: (anchorId: number) => Effect.Effect<AnchorVerificationResult, AnchorNotFoundError | DatabaseError>
    readonly updateAnchorStatus: (anchorId: number, status: AnchorStatus, reason?: string, detectedBy?: InvalidationSource) => Effect.Effect<Anchor, AnchorNotFoundError | ValidationError | DatabaseError>
    readonly logStatusChange: (
      anchorId: number,
      oldStatus: AnchorStatus,
      newStatus: AnchorStatus,
      reason: string,
      detectedBy?: InvalidationSource,
      oldHash?: string | null,
      newHash?: string | null,
      similarity?: number | null
    ) => Effect.Effect<InvalidationLog, AnchorNotFoundError | DatabaseError>
    readonly findAnchorsForFile: (filePath: string) => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly findAnchorsForLearning: (learningId: number) => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly get: (id: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>
    readonly getWithVerification: (id: number, options?: { baseDir?: string }) => Effect.Effect<AnchorWithFreshness, AnchorNotFoundError | DatabaseError>
    readonly remove: (id: number, reason?: string) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>
    readonly hardDelete: (id: number) => Effect.Effect<void, AnchorNotFoundError | DatabaseError>
    readonly findDrifted: () => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly findInvalid: () => Effect.Effect<readonly Anchor[], DatabaseError>
    readonly verifyAnchorsForFile: (filePath: string) => Effect.Effect<BatchVerificationResult, DatabaseError>
    readonly pin: (anchorId: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>
    readonly unpin: (anchorId: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>
    readonly invalidate: (anchorId: number, reason: string, detectedBy?: InvalidationSource) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>
    readonly restore: (anchorId: number) => Effect.Effect<Anchor, AnchorNotFoundError | DatabaseError>
    readonly prune: (olderThanDays: number) => Effect.Effect<PruneResult, DatabaseError>
    readonly getStatus: () => Effect.Effect<GraphStatusResult, DatabaseError>
    readonly verifyAll: () => Effect.Effect<BatchVerificationResult, DatabaseError>
  }
>() {}

export const AnchorServiceLive = Layer.effect(
  AnchorService,
  Effect.gen(function* () {
    const anchorRepo = yield* AnchorRepository
    const learningRepo = yield* LearningRepository

    return createAnchorServiceOps({
      anchorRepo,
      learningRepo
    })
  })
)
