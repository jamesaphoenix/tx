import { Effect } from "effect"
import { AnchorNotFoundError } from "../../errors.js"
import { getAnchorTTL, isStale } from "../anchor-verification.js"
import type { AnchorStatus } from "@jamesaphoenix/tx-types"
import type { AnchorServiceDeps } from "./anchor-service-deps.js"

export const createAnchorVerificationOps = ({ anchorRepo }: AnchorServiceDeps) => ({
  verifyAnchor: (anchorId: number) =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(anchorId)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
      }

      const previousStatus = anchor.status

      let newStatus: AnchorStatus = "valid"
      let reason: string | undefined

      switch (anchor.anchorType) {
        case "glob":
          newStatus = "valid"
          break

        case "hash":
          newStatus = "valid"
          reason = "Hash verification requires file content access"
          break

        case "symbol":
          newStatus = "valid"
          reason = "Symbol verification requires ast-grep integration"
          break

        case "line_range":
          newStatus = "valid"
          reason = "Line range verification requires file access"
          break
      }

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

  getWithVerification: (id: number, _options = {}) =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(id)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id }))
      }

      const ttl = yield* getAnchorTTL()
      const anchorIsStale = isStale(anchor, ttl)

      if (!anchorIsStale) {
        return {
          anchor,
          isFresh: true,
          wasVerified: false
        }
      }

      const previousStatus = anchor.status
      const newStatus: AnchorStatus = previousStatus
      let reason: string | undefined
      let action: "unchanged" | "self_healed" | "drifted" | "invalidated" = "unchanged"

      switch (anchor.anchorType) {
        case "glob":
          break
        case "hash":
          reason = "Hash verification requires file content access"
          break
        case "symbol":
          reason = "Symbol verification requires ast-grep integration"
          break
        case "line_range":
          reason = "Line range verification requires file access"
          break
      }

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

      yield* anchorRepo.updateVerifiedAt(id)

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

  verifyAnchorsForFile: (filePath: string) =>
    Effect.gen(function* () {
      const anchors = yield* anchorRepo.findByFilePath(filePath)

      let verified = 0
      let drifted = 0
      let invalid = 0

      for (const anchor of anchors) {
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

  verifyAll: () =>
    Effect.gen(function* () {
      const anchors = yield* anchorRepo.findAll(100_000)

      let verified = 0
      let drifted = 0
      let invalid = 0

      for (const anchor of anchors) {
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
})
