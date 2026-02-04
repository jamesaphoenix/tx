/**
 * ClaimService - PRD-018
 *
 * Manages task claims with lease-based expiration.
 * Uses Effect-TS patterns per DD-002.
 */

import { Context, Effect, Layer } from "effect"
import { ClaimRepository } from "../repo/claim-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { OrchestratorStateRepository } from "../repo/orchestrator-state-repo.js"
import {
  AlreadyClaimedError,
  ClaimIdNotFoundError,
  ClaimNotFoundError,
  DatabaseError,
  LeaseExpiredError,
  MaxRenewalsExceededError,
  TaskNotFoundError
} from "../errors.js"
import type { TaskClaim } from "../schemas/worker.js"

/**
 * Default maximum number of times a lease can be renewed.
 * This is a safeguard to prevent indefinite claim holding.
 */
const DEFAULT_MAX_RENEWALS = 10

export class ClaimService extends Context.Tag("ClaimService")<
  ClaimService,
  {
    /**
     * Claim a task for a worker with a lease.
     * The lease duration is taken from orchestrator config or defaults to 30 minutes.
     */
    readonly claim: (
      taskId: string,
      workerId: string,
      leaseDurationMinutes?: number
    ) => Effect.Effect<TaskClaim, TaskNotFoundError | AlreadyClaimedError | DatabaseError>

    /**
     * Release a claim on a task.
     * Only the worker who holds the claim can release it.
     */
    readonly release: (
      taskId: string,
      workerId: string
    ) => Effect.Effect<void, ClaimNotFoundError | ClaimIdNotFoundError | DatabaseError>

    /**
     * Renew the lease on an existing claim.
     * Fails if the claim is expired or max renewals exceeded.
     */
    readonly renew: (
      taskId: string,
      workerId: string
    ) => Effect.Effect<TaskClaim, ClaimNotFoundError | ClaimIdNotFoundError | LeaseExpiredError | MaxRenewalsExceededError | DatabaseError>

    /**
     * Get all claims that have expired but are still marked as active.
     */
    readonly getExpired: () => Effect.Effect<readonly TaskClaim[], DatabaseError>

    /**
     * Mark a claim as expired.
     * Used during reconciliation to handle stale claims.
     */
    readonly expire: (
      claimId: number
    ) => Effect.Effect<void, ClaimIdNotFoundError | DatabaseError>

    /**
     * Release all active claims held by a worker.
     * Used during worker deregistration.
     */
    readonly releaseByWorker: (
      workerId: string
    ) => Effect.Effect<number, DatabaseError>

    /**
     * Get the active claim for a task, if any.
     */
    readonly getActiveClaim: (
      taskId: string
    ) => Effect.Effect<TaskClaim | null, DatabaseError>

    /**
     * Get active claims on tasks that are not in 'active' status.
     * These are orphaned claims left behind when claim release fails
     * after task completion.
     */
    readonly getOrphanedClaims: () => Effect.Effect<readonly TaskClaim[], DatabaseError>
  }
>() {}

export const ClaimServiceLive = Layer.effect(
  ClaimService,
  Effect.gen(function* () {
    const claimRepo = yield* ClaimRepository
    const taskRepo = yield* TaskRepository
    const orchestratorRepo = yield* OrchestratorStateRepository

    return {
      claim: (taskId, workerId, leaseDurationMinutes) =>
        Effect.gen(function* () {
          // Verify task exists
          const task = yield* taskRepo.findById(taskId)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
          }

          // Get lease duration from config or use provided/default
          const state = yield* orchestratorRepo.get()
          const duration = leaseDurationMinutes ?? state.leaseDurationMinutes

          const now = new Date()
          const leaseExpiresAt = new Date(now.getTime() + duration * 60 * 1000)

          // Use atomic insert to prevent race condition
          // This single SQL operation checks for existing claims AND inserts atomically
          const result = yield* claimRepo.tryInsertAtomic({
            taskId,
            workerId,
            claimedAt: now,
            leaseExpiresAt,
            renewedCount: 0,
            status: "active"
          })

          if (!result.success) {
            // Another worker already has an active claim
            return yield* Effect.fail(
              new AlreadyClaimedError({
                taskId,
                claimedByWorkerId: result.existingClaim?.workerId ?? "unknown"
              })
            )
          }

          yield* Effect.log(`Task ${taskId} claimed by worker ${workerId}, expires at ${leaseExpiresAt.toISOString()}`)

          return result.claim!
        }),

      release: (taskId, workerId) =>
        Effect.gen(function* () {
          const claim = yield* claimRepo.findActiveByTaskId(taskId)
          if (!claim) {
            return yield* Effect.fail(new ClaimNotFoundError({ taskId, workerId }))
          }

          // Verify the worker owns this claim
          if (claim.workerId !== workerId) {
            return yield* Effect.fail(new ClaimNotFoundError({ taskId, workerId }))
          }

          // Update claim status to released
          yield* claimRepo.update({
            ...claim,
            status: "released"
          })

          yield* Effect.log(`Task ${taskId} claim released by worker ${workerId}`)
        }),

      renew: (taskId, workerId) =>
        Effect.gen(function* () {
          // First fetch the claim to check ownership and max renewals
          const claim = yield* claimRepo.findActiveByTaskId(taskId)
          if (!claim) {
            return yield* Effect.fail(new ClaimNotFoundError({ taskId, workerId }))
          }

          // Verify the worker owns this claim
          if (claim.workerId !== workerId) {
            return yield* Effect.fail(new ClaimNotFoundError({ taskId, workerId }))
          }

          // Check max renewals before attempting atomic renewal
          if (claim.renewedCount >= DEFAULT_MAX_RENEWALS) {
            return yield* Effect.fail(
              new MaxRenewalsExceededError({
                taskId,
                renewalCount: claim.renewedCount,
                maxRenewals: DEFAULT_MAX_RENEWALS
              })
            )
          }

          // Get lease duration from config
          const state = yield* orchestratorRepo.get()
          const now = new Date()
          const newLeaseExpiresAt = new Date(
            now.getTime() + state.leaseDurationMinutes * 60 * 1000
          )

          // Use atomic renewal to prevent race condition between expiration check and update
          // The renewal only succeeds if the lease hasn't expired at the moment of update
          const result = yield* claimRepo.tryRenewAtomic(claim.id, workerId, newLeaseExpiresAt)

          if (!result.success) {
            if (result.failureReason === "expired") {
              // The lease expired between our initial check and the atomic renewal attempt
              return yield* Effect.fail(
                new LeaseExpiredError({
                  taskId,
                  expiredAt: claim.leaseExpiresAt.toISOString()
                })
              )
            }
            // not_found - claim was released or expired by another process
            return yield* Effect.fail(new ClaimNotFoundError({ taskId, workerId }))
          }

          yield* Effect.log(`Task ${taskId} lease renewed (${result.claim!.renewedCount}/${DEFAULT_MAX_RENEWALS}), new expiry: ${newLeaseExpiresAt.toISOString()}`)

          return result.claim!
        }),

      getExpired: () =>
        Effect.gen(function* () {
          const now = new Date()
          return yield* claimRepo.findExpired(now)
        }),

      expire: (claimId) =>
        Effect.gen(function* () {
          const claim = yield* claimRepo.findById(claimId)
          if (!claim) {
            return yield* Effect.fail(new ClaimIdNotFoundError({ claimId }))
          }

          yield* claimRepo.update({
            ...claim,
            status: "expired"
          })

          yield* Effect.log(`Claim ${claimId} for task ${claim.taskId} marked as expired`)
        }),

      releaseByWorker: (workerId) =>
        Effect.gen(function* () {
          const count = yield* claimRepo.releaseAllByWorkerId(workerId)
          if (count > 0) {
            yield* Effect.log(`Released ${count} claims for worker ${workerId}`)
          }
          return count
        }),

      getActiveClaim: (taskId) =>
        Effect.gen(function* () {
          return yield* claimRepo.findActiveByTaskId(taskId)
        })
    }
  })
)
