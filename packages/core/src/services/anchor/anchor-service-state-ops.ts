import { Effect } from "effect"
import { AnchorNotFoundError } from "../../errors.js"
import type { AnchorStatus, InvalidationSource } from "@jamesaphoenix/tx-types"
import type { AnchorServiceDeps } from "./anchor-service-deps.js"
import { validateStatus } from "./anchor-service-validation.js"

export const createAnchorStateOps = ({ anchorRepo }: AnchorServiceDeps) => ({
  updateAnchorStatus: (anchorId: number, status: AnchorStatus, reason?: string, detectedBy: InvalidationSource = "manual") =>
    Effect.gen(function* () {
      yield* validateStatus(status)

      const anchor = yield* anchorRepo.findById(anchorId)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
      }

      const oldStatus = anchor.status

      yield* anchorRepo.updateStatus(anchorId, status)

      if (oldStatus !== status) {
        yield* anchorRepo.logInvalidation({
          anchorId,
          oldStatus,
          newStatus: status,
          reason: reason ?? `Status changed from ${oldStatus} to ${status}`,
          detectedBy,
          oldContentHash: anchor.contentHash
        })
      }

      const updated = yield* anchorRepo.findById(anchorId)
      if (!updated) {
        return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
      }
      return updated
    }),

  remove: (id: number, reason = "Soft deleted") =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(id)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id }))
      }

      const oldStatus = anchor.status

      yield* anchorRepo.updateStatus(id, "invalid")

      yield* anchorRepo.logInvalidation({
        anchorId: id,
        oldStatus,
        newStatus: "invalid",
        reason,
        detectedBy: "manual",
        oldContentHash: anchor.contentHash
      })

      const updated = yield* anchorRepo.findById(id)
      if (!updated) {
        return yield* Effect.fail(new AnchorNotFoundError({ id }))
      }
      return updated
    }),

  hardDelete: (id: number) =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(id)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id }))
      }
      yield* anchorRepo.delete(id)
    }),

  pin: (anchorId: number) =>
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

  unpin: (anchorId: number) =>
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

  invalidate: (anchorId: number, reason: string, detectedBy: InvalidationSource = "manual") =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(anchorId)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
      }

      const oldStatus = anchor.status

      yield* anchorRepo.updateStatus(anchorId, "invalid")

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

  restore: (anchorId: number) =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(anchorId)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
      }

      const currentStatus = anchor.status
      const logs = yield* anchorRepo.getInvalidationLogs(anchorId)
      const invalidationEntry = logs.find(log => log.newStatus === "invalid")

      const restoreToStatus: AnchorStatus = invalidationEntry?.oldStatus ?? "valid"

      yield* anchorRepo.updateStatus(anchorId, restoreToStatus)
      yield* anchorRepo.updateVerifiedAt(anchorId)

      if (invalidationEntry?.oldContentHash) {
        yield* anchorRepo.update(anchorId, { contentHash: invalidationEntry.oldContentHash })
      }

      yield* anchorRepo.logInvalidation({
        anchorId,
        oldStatus: currentStatus,
        newStatus: restoreToStatus,
        reason: invalidationEntry
          ? `Restored to ${restoreToStatus} (from invalidation log)`
          : "Manual restoration",
        detectedBy: "manual",
        oldContentHash: anchor.contentHash,
        newContentHash: invalidationEntry?.oldContentHash ?? null
      })

      const updated = yield* anchorRepo.findById(anchorId)
      if (!updated) {
        return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
      }
      return updated
    }),

  logStatusChange: (
    anchorId: number,
    oldStatus: AnchorStatus,
    newStatus: AnchorStatus,
    reason: string,
    detectedBy: InvalidationSource = "manual",
    oldHash?: string | null,
    newHash?: string | null,
    similarity?: number | null
  ) =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(anchorId)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
      }

      return yield* anchorRepo.logInvalidation({
        anchorId,
        oldStatus,
        newStatus,
        reason,
        detectedBy,
        oldContentHash: oldHash ?? null,
        newContentHash: newHash ?? null,
        similarityScore: similarity ?? null
      })
    })
})
