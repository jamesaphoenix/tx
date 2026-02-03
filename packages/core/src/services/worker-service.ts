/**
 * WorkerService - PRD-018
 *
 * Manages worker registration, heartbeats, and lifecycle.
 * Uses Effect-TS patterns per DD-002.
 */

import { Context, Effect, Layer } from "effect"
import { createHash, randomBytes } from "crypto"
import * as os from "os"
import { WorkerRepository } from "../repo/worker-repo.js"
import { OrchestratorStateRepository } from "../repo/orchestrator-state-repo.js"
import {
  DatabaseError,
  RegistrationError,
  WorkerNotFoundError
} from "../errors.js"
import type { Worker, WorkerStatus, Heartbeat } from "../schemas/worker.js"

/**
 * Input for worker registration.
 */
export interface WorkerRegistration {
  readonly workerId?: string
  readonly name?: string
  readonly hostname?: string
  readonly pid?: number
  readonly capabilities?: readonly string[]
}

/**
 * Filter options for listing workers.
 */
export interface WorkerFilter {
  readonly status?: readonly WorkerStatus[]
  readonly noCurrentTask?: boolean
}

/**
 * Configuration for finding dead workers.
 */
export interface FindDeadConfig {
  readonly missedHeartbeats: number
}

/**
 * Generate a unique worker ID.
 */
const generateWorkerId = (): string => {
  const random = randomBytes(16).toString("hex")
  const timestamp = Date.now().toString(36)
  const hash = createHash("sha256")
    .update(timestamp + random)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

export class WorkerService extends Context.Tag("WorkerService")<
  WorkerService,
  {
    /**
     * Register a new worker with the orchestrator.
     * Checks orchestrator state and pool capacity before registration.
     */
    readonly register: (
      registration: WorkerRegistration
    ) => Effect.Effect<Worker, RegistrationError | DatabaseError>

    /**
     * Process a heartbeat from a worker.
     * Updates last heartbeat time, status, and optional metrics.
     */
    readonly heartbeat: (
      heartbeat: Heartbeat
    ) => Effect.Effect<void, WorkerNotFoundError | DatabaseError>

    /**
     * Deregister a worker.
     * Removes the worker from the registry.
     * Note: Active claims should be released by ClaimService before calling this.
     */
    readonly deregister: (
      workerId: string
    ) => Effect.Effect<void, WorkerNotFoundError | DatabaseError>

    /**
     * List workers with optional filtering.
     */
    readonly list: (
      filter?: WorkerFilter
    ) => Effect.Effect<readonly Worker[], DatabaseError>

    /**
     * Find workers that have missed heartbeats.
     * Uses the orchestrator's configured heartbeat interval.
     */
    readonly findDead: (
      config: FindDeadConfig
    ) => Effect.Effect<readonly Worker[], DatabaseError>

    /**
     * Mark a worker as dead.
     */
    readonly markDead: (
      workerId: string
    ) => Effect.Effect<void, WorkerNotFoundError | DatabaseError>

    /**
     * Update a worker's status.
     */
    readonly updateStatus: (
      workerId: string,
      status: WorkerStatus
    ) => Effect.Effect<void, WorkerNotFoundError | DatabaseError>
  }
>() {}

export const WorkerServiceLive = Layer.effect(
  WorkerService,
  Effect.gen(function* () {
    const workerRepo = yield* WorkerRepository
    const orchestratorRepo = yield* OrchestratorStateRepository

    return {
      register: (registration) =>
        Effect.gen(function* () {
          // Verify orchestrator is running
          const state = yield* orchestratorRepo.get()
          if (state.status !== "running") {
            return yield* Effect.fail(
              new RegistrationError({
                reason: "Orchestrator is not running"
              })
            )
          }

          // Count active workers (starting, idle, busy)
          const startingCount = yield* workerRepo.countByStatus("starting")
          const idleCount = yield* workerRepo.countByStatus("idle")
          const busyCount = yield* workerRepo.countByStatus("busy")
          const activeWorkers = startingCount + idleCount + busyCount

          // Check pool capacity
          if (activeWorkers >= state.workerPoolSize) {
            return yield* Effect.fail(
              new RegistrationError({
                reason: `Worker pool at capacity (${state.workerPoolSize})`
              })
            )
          }

          const now = new Date()
          const worker: Worker = {
            id: registration.workerId ?? generateWorkerId(),
            name: registration.name ?? `worker-${Date.now()}`,
            hostname: registration.hostname ?? os.hostname(),
            pid: registration.pid ?? process.pid,
            status: "starting",
            registeredAt: now,
            lastHeartbeatAt: now,
            currentTaskId: null,
            capabilities: [...(registration.capabilities ?? ["tx-implementer"])],
            metadata: {}
          }

          yield* workerRepo.insert(worker)
          yield* Effect.log(`Worker ${worker.id} registered`)

          return worker
        }),

      heartbeat: (heartbeat) =>
        Effect.gen(function* () {
          const worker = yield* workerRepo.findById(heartbeat.workerId)
          if (!worker) {
            return yield* Effect.fail(
              new WorkerNotFoundError({ workerId: heartbeat.workerId })
            )
          }

          // Build updated worker
          const updated: Worker = {
            ...worker,
            lastHeartbeatAt: heartbeat.timestamp,
            status: heartbeat.status,
            currentTaskId: heartbeat.currentTaskId ?? null,
            metadata: heartbeat.metrics
              ? { ...worker.metadata, lastMetrics: heartbeat.metrics }
              : worker.metadata
          }

          yield* workerRepo.update(updated)
        }),

      deregister: (workerId) =>
        Effect.gen(function* () {
          const worker = yield* workerRepo.findById(workerId)
          if (!worker) {
            return yield* Effect.fail(new WorkerNotFoundError({ workerId }))
          }

          // Note: Active claims should be released by ClaimService before calling this.
          // The ClaimService.releaseByWorker call is handled by the orchestrator/caller.

          const deleted = yield* workerRepo.delete(workerId)
          if (deleted) {
            yield* Effect.log(`Worker ${workerId} deregistered`)
          }
        }),

      list: (filter) =>
        Effect.gen(function* () {
          if (!filter) {
            // Get all workers by querying each status
            const starting = yield* workerRepo.findByStatus("starting")
            const idle = yield* workerRepo.findByStatus("idle")
            const busy = yield* workerRepo.findByStatus("busy")
            const stopping = yield* workerRepo.findByStatus("stopping")
            const dead = yield* workerRepo.findByStatus("dead")
            const all = [...starting, ...idle, ...busy, ...stopping, ...dead]

            return all
          }

          // Filter by status
          if (filter.status && filter.status.length > 0) {
            const results: Worker[] = []
            for (const status of filter.status) {
              const workers = yield* workerRepo.findByStatus(status)
              results.push(...workers)
            }

            // Apply noCurrentTask filter if specified
            if (filter.noCurrentTask) {
              return results.filter((w) => w.currentTaskId === null)
            }
            return results
          }

          // Only noCurrentTask filter without status
          if (filter.noCurrentTask) {
            const starting = yield* workerRepo.findByStatus("starting")
            const idle = yield* workerRepo.findByStatus("idle")
            const busy = yield* workerRepo.findByStatus("busy")
            const stopping = yield* workerRepo.findByStatus("stopping")
            const dead = yield* workerRepo.findByStatus("dead")
            const all = [...starting, ...idle, ...busy, ...stopping, ...dead]

            return all.filter((w) => w.currentTaskId === null)
          }

          // No filter, return all
          const starting = yield* workerRepo.findByStatus("starting")
          const idle = yield* workerRepo.findByStatus("idle")
          const busy = yield* workerRepo.findByStatus("busy")
          const stopping = yield* workerRepo.findByStatus("stopping")
          const dead = yield* workerRepo.findByStatus("dead")
          return [...starting, ...idle, ...busy, ...stopping, ...dead]
        }),

      findDead: (config) =>
        Effect.gen(function* () {
          const state = yield* orchestratorRepo.get()
          const heartbeatTimeoutSeconds =
            state.heartbeatIntervalSeconds * config.missedHeartbeats

          const cutoff = new Date(Date.now() - heartbeatTimeoutSeconds * 1000)

          // Get workers with old heartbeats
          const staleWorkers = yield* workerRepo.findByLastHeartbeatBefore(cutoff)

          // Exclude workers that are already dead or stopping
          return staleWorkers.filter(
            (w) => w.status !== "dead" && w.status !== "stopping"
          )
        }),

      markDead: (workerId) =>
        Effect.gen(function* () {
          const worker = yield* workerRepo.findById(workerId)
          if (!worker) {
            return yield* Effect.fail(new WorkerNotFoundError({ workerId }))
          }

          const updated: Worker = {
            ...worker,
            status: "dead"
          }
          yield* workerRepo.update(updated)
          yield* Effect.log(`Worker ${workerId} marked as dead`)
        }),

      updateStatus: (workerId, status) =>
        Effect.gen(function* () {
          const worker = yield* workerRepo.findById(workerId)
          if (!worker) {
            return yield* Effect.fail(new WorkerNotFoundError({ workerId }))
          }

          const updated: Worker = {
            ...worker,
            status
          }
          yield* workerRepo.update(updated)
        })
    }
  })
)
