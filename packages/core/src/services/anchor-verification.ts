/**
 * AnchorVerificationService - Periodic anchor verification for PRD-017
 */

import { Config, Context, Effect, Layer } from "effect"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { createAnchorVerificationBatchOps } from "./anchor/anchor-verification-batch.js"
import { createVerifyAnchor } from "./anchor/anchor-verification-single.js"
import type { DatabaseError } from "../errors.js"
import type { Anchor, AnchorStatus, InvalidationSource } from "@jamesaphoenix/tx-types"

export type VerificationResult = {
  readonly anchorId: number
  readonly previousStatus: AnchorStatus
  readonly newStatus: AnchorStatus
  readonly action: "unchanged" | "self_healed" | "drifted" | "invalidated"
  readonly reason?: string
  readonly similarity?: number
  readonly oldContentHash?: string | null
  readonly newContentHash?: string | null
}

export type FailedAnchor = {
  readonly anchorId: number
  readonly filePath: string
  readonly error: string
}

export type VerificationSummary = {
  readonly total: number
  readonly unchanged: number
  readonly selfHealed: number
  readonly drifted: number
  readonly invalid: number
  readonly errors: number
  readonly duration: number
  readonly failedAnchors: ReadonlyArray<FailedAnchor>
}

export type VerifyOptions = {
  readonly detectedBy?: InvalidationSource
  readonly skipPinned?: boolean
  readonly baseDir?: string
}

export class AnchorVerificationService extends Context.Tag("AnchorVerificationService")<
  AnchorVerificationService,
  {
    readonly verify: (
      anchorId: number,
      options?: VerifyOptions
    ) => Effect.Effect<VerificationResult, DatabaseError>

    readonly verifyAll: (
      options?: VerifyOptions
    ) => Effect.Effect<VerificationSummary, DatabaseError>

    readonly verifyFile: (
      filePath: string,
      options?: VerifyOptions
    ) => Effect.Effect<VerificationSummary, DatabaseError>

    readonly verifyGlob: (
      globPattern: string,
      options?: VerifyOptions
    ) => Effect.Effect<VerificationSummary, DatabaseError>
  }
>() {}

export const DEFAULT_ANCHOR_CACHE_TTL = 3600

export const getAnchorTTL = (): Effect.Effect<number, never> =>
  Config.number("TX_ANCHOR_CACHE_TTL").pipe(
    Config.withDefault(DEFAULT_ANCHOR_CACHE_TTL),
    Effect.catchAll(() => Effect.succeed(DEFAULT_ANCHOR_CACHE_TTL))
  )

export const isStale = (anchor: Anchor, ttlSeconds: number): boolean => {
  if (!anchor.verifiedAt) {
    return true
  }

  const verifiedAtMs = anchor.verifiedAt.getTime()
  const ttlMs = ttlSeconds * 1000
  const cutoffMs = Date.now() - ttlMs

  return verifiedAtMs < cutoffMs
}

export const AnchorVerificationServiceLive = Layer.effect(
  AnchorVerificationService,
  Effect.gen(function* () {
    const anchorRepo = yield* AnchorRepository
    const verifyAnchor = createVerifyAnchor(anchorRepo)

    return createAnchorVerificationBatchOps(anchorRepo, verifyAnchor)
  })
)
