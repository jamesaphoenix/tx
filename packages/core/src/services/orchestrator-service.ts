/**
 * OrchestratorService - PRD-018
 *
 * Manages orchestrator lifecycle and reconciliation loop.
 * Uses Effect-TS patterns per DD-002.
 */

import { Context, Effect, Exit, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { OrchestratorStateRepository } from "../repo/orchestrator-state-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { ClaimRepository } from "../repo/claim-repo.js"
import { WorkerService } from "./worker-service.js"
import { ClaimService } from "./claim-service.js"
import { ReadyService } from "./ready-service.js"
import { DatabaseError, OrchestratorError, TaskNotFoundError } from "../errors.js"
import type { OrchestratorState, ReconciliationResult } from "../schemas/worker.js"

/**
 * Configuration options for the orchestrator.
 */
export interface OrchestratorConfig {
  readonly workerPoolSize?: number
  readonly heartbeatIntervalSeconds?: number
  readonly leaseDurationMinutes?: number
  readonly reconcileIntervalSeconds?: number
  readonly shutdownTimeoutSeconds?: number
  readonly maxClaimRenewals?: number
}

/**
 * Default orchestrator configuration values.
 */
const DEFAULT_CONFIG: Required<OrchestratorConfig> = {
  workerPoolSize: 1,
  heartbeatIntervalSeconds: 30,
  leaseDurationMinutes: 30,
  reconcileIntervalSeconds: 60,
  shutdownTimeoutSeconds: 300,
  maxClaimRenewals: 10
}

export class OrchestratorService extends Context.Tag("OrchestratorService")<
  OrchestratorService,
  {
    /**
     * Start the orchestrator with the given configuration.
     * Sets status to 'running' and initializes the orchestrator state.
     */
    readonly start: (
      config?: OrchestratorConfig
    ) => Effect.Effect<void, OrchestratorError | DatabaseError>

    /**
     * Stop the orchestrator.
     * If graceful is true, waits for workers to finish current tasks.
     */
    readonly stop: (
      graceful: boolean
    ) => Effect.Effect<void, OrchestratorError | DatabaseError>

    /**
     * Get the current orchestrator status.
     */
    readonly status: () => Effect.Effect<OrchestratorState, DatabaseError>

    /**
     * Run a single reconciliation pass.
     * Detects dead workers, expires claims, recovers orphaned tasks,
     * and fixes state inconsistencies.
     */
    readonly reconcile: () => Effect.Effect<ReconciliationResult, DatabaseError | TaskNotFoundError>
  }
>() {}

export const OrchestratorServiceLive = Layer.effect(
  OrchestratorService,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const stateRepo = yield* OrchestratorStateRepository
    const workerService = yield* WorkerService
    const claimService = yield* ClaimService
    const readyService = yield* ReadyService
    const taskRepo = yield* TaskRepository
    const claimRepo = yield* ClaimRepository

    /**
     * Helper to wrap an Effect in a database transaction.
     * Ensures atomicity: either all operations succeed and COMMIT,
     * or any failure triggers ROLLBACK.
     */
    const withTransaction = <A, E>(
      effect: Effect.Effect<A, E>
    ): Effect.Effect<A, E | DatabaseError> =>
      Effect.acquireUseRelease(
        // Acquire: Begin transaction
        Effect.try({
          try: () => {
            db.exec("BEGIN IMMEDIATE")
            return undefined
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
        // Use: Run the wrapped effect
        () => effect,
        // Release: Commit on success, rollback on failure
        (_, exit) =>
          Effect.sync(() => {
            if (Exit.isSuccess(exit)) {
              db.exec("COMMIT")
            } else {
              db.exec("ROLLBACK")
            }
          })
      )

    return {
      start: (config) =>
        Effect.gen(function* () {
          const currentState = yield* stateRepo.get()

          // Check if already running
          if (currentState.status === "running") {
            return yield* Effect.fail(
              new OrchestratorError({
                code: "ALREADY_RUNNING",
                reason: "Orchestrator is already running"
              })
            )
          }

          // Check if in an incompatible state
          if (currentState.status === "stopping") {
            return yield* Effect.fail(
              new OrchestratorError({
                code: "INVALID_STATE",
                reason: "Orchestrator is currently stopping"
              })
            )
          }

          const mergedConfig = { ...DEFAULT_CONFIG, ...config }

          // Transition to starting
          yield* stateRepo.update({
            status: "starting",
            pid: process.pid,
            startedAt: new Date(),
            workerPoolSize: mergedConfig.workerPoolSize,
            reconcileIntervalSeconds: mergedConfig.reconcileIntervalSeconds,
            heartbeatIntervalSeconds: mergedConfig.heartbeatIntervalSeconds,
            leaseDurationMinutes: mergedConfig.leaseDurationMinutes,
            metadata: {
              maxClaimRenewals: mergedConfig.maxClaimRenewals,
              shutdownTimeoutSeconds: mergedConfig.shutdownTimeoutSeconds
            }
          })

          // Transition to running
          yield* stateRepo.update({ status: "running" })
          yield* Effect.log(
            `Orchestrator started with pool size ${mergedConfig.workerPoolSize}`
          )
        }),

      stop: (graceful) =>
        Effect.gen(function* () {
          const currentState = yield* stateRepo.get()

          // Check if not running
          if (currentState.status !== "running") {
            return yield* Effect.fail(
              new OrchestratorError({
                code: "NOT_RUNNING",
                reason: "Orchestrator is not running"
              })
            )
          }

          // Transition to stopping
          yield* stateRepo.update({ status: "stopping" })
          yield* Effect.log("Orchestrator stopping...")

          if (graceful) {
            // Get all active workers
            const workers = yield* workerService.list({
              status: ["idle", "busy", "starting"]
            })

            // Signal workers to stop
            for (const worker of workers) {
              yield* workerService.updateStatus(worker.id, "stopping").pipe(
                Effect.catchAll(() => Effect.void)
              )
            }

            // Note: In a full implementation, we would wait for workers
            // to finish their current tasks with a timeout.
            // For Phase 1, we just mark them as stopping.

            yield* Effect.log(
              `Signaled ${workers.length} worker(s) to stop`
            )
          }

          // Mark any remaining active workers as dead
          const remainingWorkers = yield* workerService.list({
            status: ["idle", "busy", "starting", "stopping"]
          })

          for (const worker of remainingWorkers) {
            yield* workerService.markDead(worker.id).pipe(
              Effect.catchAll(() => Effect.void)
            )
          }

          // Transition to stopped
          yield* stateRepo.update({
            status: "stopped",
            pid: null
          })

          yield* Effect.log("Orchestrator stopped")
        }),

      status: () => stateRepo.get(),

      reconcile: () =>
        // Wrap entire reconciliation in a transaction for atomicity.
        // Prevents race conditions where state changes between steps.
        // See: tx-a1c2b151 - OrchestratorService missing transaction boundaries
        withTransaction(
          Effect.gen(function* () {
            const startTime = Date.now()
            let deadWorkersFound = 0
            let expiredClaimsReleased = 0
            let orphanedTasksRecovered = 0
            let staleStatesFixed = 0

            // 1. Detect dead workers (missed 1+ heartbeats)
          // Changed from 2 to 1 to reduce worst-case detection time from ~90s to ~60s.
          // With missedHeartbeats: 2, if worker dies at t=1 after heartbeat at t=0,
          // detection doesn't occur until t=90+ (60s threshold + 30s reconcile delay).
          const deadWorkers = yield* workerService.findDead({
            missedHeartbeats: 1
          })

          for (const worker of deadWorkers) {
            yield* workerService.markDead(worker.id).pipe(
              Effect.catchAll(() => Effect.void)
            )
            // Release any claims held by this dead worker
            yield* claimService.releaseByWorker(worker.id).pipe(
              Effect.catchAll(() => Effect.succeed(0))
            )
            deadWorkersFound++
          }

          // 2. Expire stale claims (past lease expiration)
          const expiredClaims = yield* claimService.getExpired()

          for (const claim of expiredClaims) {
            yield* claimService.expire(claim.id).pipe(
              Effect.catchAll(() => Effect.void)
            )
            // Return task to appropriate state if it was active
            const task = yield* taskRepo.findById(claim.taskId)
            if (task && task.status === "active") {
              // Check if all blockers are done before setting to ready
              const blockers = yield* readyService.getBlockers(task.id)
              const allBlockersDone = blockers.every(b => b.status === "done")
              const newStatus = allBlockersDone ? "ready" : "blocked"
              const now = new Date()
              yield* taskRepo.update({
                ...task,
                status: newStatus,
                updatedAt: now
              })
            }
            expiredClaimsReleased++
          }

          // 3. Find orphaned tasks (status='active' but no active claim)
          const activeTasks = yield* taskRepo.findAll({ status: "active" })

          for (const task of activeTasks) {
            const activeClaim = yield* claimRepo.findActiveByTaskId(task.id)
            if (!activeClaim) {
              // Task is orphaned - check blockers before setting status
              const blockers = yield* readyService.getBlockers(task.id)
              const allBlockersDone = blockers.every(b => b.status === "done")
              const newStatus = allBlockersDone ? "ready" : "blocked"
              const now = new Date()
              yield* taskRepo.update({
                ...task,
                status: newStatus,
                updatedAt: now
              })
              orphanedTasksRecovered++
            }
          }

          // 4. Fix workers marked busy but with no current_task_id
          const busyWorkers = yield* workerService.list({ status: ["busy"] })

          for (const worker of busyWorkers) {
            if (worker.currentTaskId === null) {
              yield* workerService.updateStatus(worker.id, "idle").pipe(
                Effect.catchAll(() => Effect.void)
              )
              staleStatesFixed++
            }
          }

          // 5. Fix workers with current_task_id but task is not active
          for (const worker of busyWorkers) {
            if (worker.currentTaskId) {
              const task = yield* taskRepo.findById(worker.currentTaskId)
              if (!task || task.status !== "active") {
                yield* workerService.updateStatus(worker.id, "idle").pipe(
                  Effect.catchAll(() => Effect.void)
                )
                staleStatesFixed++
              }
            }
          }

          const reconcileTime = Date.now() - startTime

          // Update last reconcile timestamp
          yield* stateRepo.update({
            lastReconcileAt: new Date()
          })

          // Log if any issues were found
          if (
            deadWorkersFound > 0 ||
            expiredClaimsReleased > 0 ||
            orphanedTasksRecovered > 0 ||
            staleStatesFixed > 0
          ) {
            yield* Effect.log(
              `Reconciliation: ${deadWorkersFound} dead workers, ` +
                `${expiredClaimsReleased} expired claims, ` +
                `${orphanedTasksRecovered} orphaned tasks, ` +
                `${staleStatesFixed} stale states fixed ` +
                `(${reconcileTime}ms)`
            )
          }

            // Build and return the result
            const result: ReconciliationResult = {
              deadWorkersFound,
              expiredClaimsReleased,
              orphanedTasksRecovered,
              staleStatesFixed,
              reconcileTime
            }

            return result
          })
        )
    }
  })
)
