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
    ) => Effect.Effect<void, ClaimNotFoundError | DatabaseError>

    /**
     * Renew the lease on an existing claim.
     * Fails if the claim is expired or max renewals exceeded.
     */
    readonly renew: (
      taskId: string,
      workerId: string
    ) => Effect.Effect<TaskClaim, ClaimNotFoundError | LeaseExpiredError | MaxRenewalsExceededError | DatabaseError>

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
    ) => Effect.Effect<void, ClaimNotFoundError | DatabaseError>

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

          // Check if task is already claimed
          const existingClaim = yield* claimRepo.findActiveByTaskId(taskId)
          if (existingClaim) {
            return yield* Effect.fail(
              new AlreadyClaimedError({
                taskId,
                claimedByWorkerId: existingClaim.workerId
              })
            )
          }

          // Get lease duration from config or use provided/default
          const state = yield* orchestratorRepo.get()
          const duration = leaseDurationMinutes ?? state.leaseDurationMinutes

          const now = new Date()
          const leaseExpiresAt = new Date(now.getTime() + duration * 60 * 1000)

          const claim = yield* claimRepo.insert({
            taskId,
            workerId,
            claimedAt: now,
            leaseExpiresAt,
            renewedCount: 0,
            status: "active"
          })

          yield* Effect.log(`Task ${taskId} claimed by worker ${workerId}, expires at ${leaseExpiresAt.toISOString()}`)

          return claim
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
          const claim = yield* claimRepo.findActiveByTaskId(taskId)
          if (!claim) {
            return yield* Effect.fail(new ClaimNotFoundError({ taskId, workerId }))
          }

          // Verify the worker owns this claim
          if (claim.workerId !== workerId) {
            return yield* Effect.fail(new ClaimNotFoundError({ taskId, workerId }))
          }

          // Check if claim has already expired
          const now = new Date()
          if (claim.leaseExpiresAt < now) {
            return yield* Effect.fail(
              new LeaseExpiredError({
                taskId,
                expiredAt: claim.leaseExpiresAt.toISOString()
              })
            )
          }

          // Check max renewals
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
          const newLeaseExpiresAt = new Date(
            now.getTime() + state.leaseDurationMinutes * 60 * 1000
          )

          const updatedClaim: TaskClaim = {
            ...claim,
            leaseExpiresAt: newLeaseExpiresAt,
            renewedCount: claim.renewedCount + 1
          }

          yield* claimRepo.update(updatedClaim)
          yield* Effect.log(`Task ${taskId} lease renewed (${updatedClaim.renewedCount}/${DEFAULT_MAX_RENEWALS}), new expiry: ${newLeaseExpiresAt.toISOString()}`)

          return updatedClaim
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
            return yield* Effect.fail(
              new ClaimNotFoundError({ taskId: `claim:${claimId}` })
            )
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
