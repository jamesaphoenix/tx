# DD-018: Worker Coordination Primitives - Implementation

**Status**: Draft
**Implements**: [PRD-018](../prd/PRD-018-worker-orchestration.md)
**Last Updated**: 2026-02-02

---

## Overview

Implementation details for the k8s-style worker coordination system. Covers service architecture, database operations, worker protocol, and reconciliation loop.

**Note on naming**: The CLI command is `tx coordinator` (emphasizing primitives over framework). The internal service is `OrchestratorService` (implementation detail). This document shows actual code; CLI examples use `tx coordinator`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OrchestratorService                           │
│  start | stop | status | reconcile                              │
├─────────────────────────────────────────────────────────────────┤
│                    WorkerService                                 │
│  register | heartbeat | deregister | list | findDead           │
├─────────────────────────────────────────────────────────────────┤
│                    ClaimService                                  │
│  claim | release | renew | getExpired | expire                 │
├─────────────────────────────────────────────────────────────────┤
│                    WorkerRepository                              │
│                    ClaimRepository                               │
│                    OrchestratorStateRepository                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## TypeScript Types

```typescript
// src/schemas/worker.ts

import { Schema } from "@effect/schema"

export const WorkerStatus = Schema.Literal(
  'starting', 'idle', 'busy', 'stopping', 'dead'
)
export type WorkerStatus = typeof WorkerStatus.Type

export const Worker = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  hostname: Schema.String,
  pid: Schema.Number,
  status: WorkerStatus,
  registeredAt: Schema.Date,
  lastHeartbeatAt: Schema.Date,
  currentTaskId: Schema.NullOr(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown)
})
export type Worker = typeof Worker.Type

export const ClaimStatus = Schema.Literal(
  'active', 'released', 'expired', 'completed'
)
export type ClaimStatus = typeof ClaimStatus.Type

export const TaskClaim = Schema.Struct({
  id: Schema.Number,
  taskId: Schema.String,
  workerId: Schema.String,
  claimedAt: Schema.Date,
  leaseExpiresAt: Schema.Date,
  renewedCount: Schema.Number,
  status: ClaimStatus
})
export type TaskClaim = typeof TaskClaim.Type

export const OrchestratorStatus = Schema.Literal(
  'stopped', 'starting', 'running', 'stopping'
)
export type OrchestratorStatus = typeof OrchestratorStatus.Type

export const OrchestratorState = Schema.Struct({
  status: OrchestratorStatus,
  pid: Schema.NullOr(Schema.Number),
  startedAt: Schema.NullOr(Schema.Date),
  lastReconcileAt: Schema.NullOr(Schema.Date),
  workerPoolSize: Schema.Number,
  reconcileIntervalSeconds: Schema.Number,
  heartbeatIntervalSeconds: Schema.Number,
  leaseDurationMinutes: Schema.Number,
  metadata: Schema.Record(Schema.String, Schema.Unknown)
})
export type OrchestratorState = typeof OrchestratorState.Type

export const Heartbeat = Schema.Struct({
  workerId: Schema.String,
  timestamp: Schema.Date,
  status: Schema.Literal('idle', 'busy'),
  currentTaskId: Schema.optional(Schema.String),
  metrics: Schema.optional(Schema.Struct({
    cpuPercent: Schema.Number,
    memoryMb: Schema.Number,
    tasksCompleted: Schema.Number
  }))
})
export type Heartbeat = typeof Heartbeat.Type

export const ReconciliationResult = Schema.Struct({
  deadWorkersFound: Schema.Number,
  expiredClaimsReleased: Schema.Number,
  orphanedTasksRecovered: Schema.Number,
  staleStatesFixed: Schema.Number,
  reconcileTime: Schema.Number
})
export type ReconciliationResult = typeof ReconciliationResult.Type
```

---

## Service Implementations

### WorkerService

```typescript
// src/services/worker-service.ts

import { Context, Effect, Layer, Duration } from "effect"
import * as os from "os"

export class WorkerService extends Context.Tag("WorkerService")<
  WorkerService,
  {
    readonly register: (registration: WorkerRegistration) =>
      Effect.Effect<Worker, RegistrationError | DatabaseError>
    readonly heartbeat: (heartbeat: Heartbeat) =>
      Effect.Effect<void, WorkerNotFoundError | DatabaseError>
    readonly deregister: (workerId: string) =>
      Effect.Effect<void, WorkerNotFoundError | DatabaseError>
    readonly list: (filter?: WorkerFilter) =>
      Effect.Effect<Worker[], DatabaseError>
    readonly findDead: (config: { missedHeartbeats: number }) =>
      Effect.Effect<Worker[], DatabaseError>
    readonly markDead: (workerId: string) =>
      Effect.Effect<void, WorkerNotFoundError | DatabaseError>
    readonly updateStatus: (workerId: string, status: WorkerStatus) =>
      Effect.Effect<void, WorkerNotFoundError | DatabaseError>
  }
>() {}

const generateWorkerId = (): string => {
  const hash = crypto.createHash('sha256')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
    .slice(0, 8)
  return `worker-${hash}`
}

export const WorkerServiceLive = Layer.effect(
  WorkerService,
  Effect.gen(function* () {
    const workerRepo = yield* WorkerRepository
    const orchestratorRepo = yield* OrchestratorStateRepository

    return {
      register: (registration) =>
        Effect.gen(function* () {
          // Verify coordinator is running
          const state = yield* orchestratorRepo.get()
          if (state.status !== 'running') {
            return yield* Effect.fail(new RegistrationError({
              message: 'Orchestrator is not running'
            }))
          }

          // Check pool capacity
          const activeWorkers = yield* workerRepo.countByStatus(['starting', 'idle', 'busy'])
          if (activeWorkers >= state.workerPoolSize) {
            return yield* Effect.fail(new RegistrationError({
              message: `Worker pool at capacity (${state.workerPoolSize})`
            }))
          }

          const worker: Worker = {
            id: registration.workerId || generateWorkerId(),
            name: registration.name || `worker-${Date.now()}`,
            hostname: registration.hostname || os.hostname(),
            pid: registration.pid || process.pid,
            status: 'starting',
            registeredAt: new Date(),
            lastHeartbeatAt: new Date(),
            currentTaskId: null,
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
            return yield* Effect.fail(new WorkerNotFoundError({
              workerId: heartbeat.workerId
            }))
          }

          yield* workerRepo.update(heartbeat.workerId, {
            lastHeartbeatAt: heartbeat.timestamp,
            status: heartbeat.status,
            currentTaskId: heartbeat.currentTaskId || null
          })

          // Store metrics if provided
          if (heartbeat.metrics) {
            yield* workerRepo.updateMetadata(heartbeat.workerId, {
              ...worker.metadata,
              lastMetrics: heartbeat.metrics
            })
          }
        }),

      deregister: (workerId) =>
        Effect.gen(function* () {
          const worker = yield* workerRepo.findById(workerId)
          if (!worker) {
            return yield* Effect.fail(new WorkerNotFoundError({ workerId }))
          }

          // Release any active claims
          yield* ClaimService.pipe(
            Effect.flatMap(cs => cs.releaseByWorker(workerId))
          )

          yield* workerRepo.delete(workerId)
          yield* Effect.log(`Worker ${workerId} deregistered`)
        }),

      list: (filter) =>
        Effect.gen(function* () {
          if (filter?.status) {
            return yield* workerRepo.findByStatus(filter.status)
          }
          return yield* workerRepo.findAll()
        }),

      findDead: (config) =>
        Effect.gen(function* () {
          const state = yield* orchestratorRepo.get()
          const heartbeatTimeout = state.heartbeatIntervalSeconds * config.missedHeartbeats

          const cutoff = new Date(Date.now() - heartbeatTimeout * 1000)

          return yield* workerRepo.findByLastHeartbeatBefore(cutoff, {
            excludeStatuses: ['dead', 'stopping']
          })
        }),

      markDead: (workerId) =>
        Effect.gen(function* () {
          yield* workerRepo.update(workerId, { status: 'dead' })
          yield* Effect.log(`Worker ${workerId} marked as dead`)
        }),

      updateStatus: (workerId, status) =>
        workerRepo.update(workerId, { status })
    }
  })
)
```

### ClaimService

```typescript
// src/services/claim-service.ts

import { Context, Effect, Layer, Duration } from "effect"

export class ClaimService extends Context.Tag("ClaimService")<
  ClaimService,
  {
    readonly claim: (taskId: string, workerId: string, leaseDuration?: Duration.Duration) =>
      Effect.Effect<TaskClaim, TaskNotFoundError | AlreadyClaimedError | DatabaseError>
    readonly release: (taskId: string, workerId: string) =>
      Effect.Effect<void, ClaimNotFoundError | DatabaseError>
    readonly renew: (taskId: string, workerId: string) =>
      Effect.Effect<TaskClaim, ClaimNotFoundError | LeaseExpiredError | MaxRenewalsExceededError>
    readonly getExpired: () =>
      Effect.Effect<TaskClaim[], DatabaseError>
    readonly expire: (claimId: number) =>
      Effect.Effect<void, ClaimNotFoundError | DatabaseError>
    readonly releaseByWorker: (workerId: string) =>
      Effect.Effect<number, DatabaseError>
    readonly getActiveClaim: (taskId: string) =>
      Effect.Effect<TaskClaim | null, DatabaseError>
  }
>() {}

export const ClaimServiceLive = Layer.effect(
  ClaimService,
  Effect.gen(function* () {
    const claimRepo = yield* ClaimRepository
    const taskRepo = yield* TaskRepository
    const workerRepo = yield* WorkerRepository
    const orchestratorRepo = yield* OrchestratorStateRepository

    return {
      claim: (taskId, workerId, leaseDuration) =>
        Effect.gen(function* () {
          // Verify task exists
          const task = yield* taskRepo.findById(taskId)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ taskId }))
          }

          // Verify worker exists and is active
          const worker = yield* workerRepo.findById(workerId)
          if (!worker || worker.status === 'dead') {
            return yield* Effect.fail(new WorkerNotFoundError({ workerId }))
          }

          // Check for existing active claim
          const existingClaim = yield* claimRepo.findActiveByTaskId(taskId)
          if (existingClaim) {
            return yield* Effect.fail(new AlreadyClaimedError({
              taskId,
              existingClaimId: existingClaim.id,
              existingWorkerId: existingClaim.workerId
            }))
          }

          // Get lease duration from config
          const state = yield* orchestratorRepo.get()
          const leaseMinutes = leaseDuration
            ? Duration.toMinutes(leaseDuration)
            : state.leaseDurationMinutes

          const now = new Date()
          const claim: TaskClaim = {
            id: 0, // Auto-increment
            taskId,
            workerId,
            claimedAt: now,
            leaseExpiresAt: new Date(now.getTime() + leaseMinutes * 60 * 1000),
            renewedCount: 0,
            status: 'active'
          }

          const inserted = yield* claimRepo.insert(claim)

          // Update worker's current task
          yield* workerRepo.update(workerId, {
            status: 'busy',
            currentTaskId: taskId
          })

          // Update task status
          yield* taskRepo.update(taskId, { status: 'active' })

          yield* Effect.log(`Task ${taskId} claimed by worker ${workerId}`)

          return inserted
        }),

      release: (taskId, workerId) =>
        Effect.gen(function* () {
          const claim = yield* claimRepo.findActiveByTaskId(taskId)
          if (!claim || claim.workerId !== workerId) {
            return yield* Effect.fail(new ClaimNotFoundError({
              taskId,
              workerId
            }))
          }

          yield* claimRepo.update(claim.id, { status: 'released' })

          // Clear worker's current task
          yield* workerRepo.update(workerId, {
            status: 'idle',
            currentTaskId: null
          })

          // Task goes back to ready
          yield* taskRepo.update(taskId, { status: 'ready' })

          yield* Effect.log(`Claim on task ${taskId} released by worker ${workerId}`)
        }),

      renew: (taskId, workerId) =>
        Effect.gen(function* () {
          const claim = yield* claimRepo.findActiveByTaskId(taskId)
          if (!claim || claim.workerId !== workerId) {
            return yield* Effect.fail(new ClaimNotFoundError({
              taskId,
              workerId
            }))
          }

          // Check if lease already expired
          if (new Date() > claim.leaseExpiresAt) {
            return yield* Effect.fail(new LeaseExpiredError({
              taskId,
              expiredAt: claim.leaseExpiresAt
            }))
          }

          // Check max renewals
          const state = yield* orchestratorRepo.get()
          const maxRenewals = (state.metadata as any).maxClaimRenewals ?? 10

          if (claim.renewedCount >= maxRenewals) {
            return yield* Effect.fail(new MaxRenewalsExceededError({
              taskId,
              maxRenewals
            }))
          }

          // Extend lease
          const newExpiry = new Date(
            Date.now() + state.leaseDurationMinutes * 60 * 1000
          )

          yield* claimRepo.update(claim.id, {
            leaseExpiresAt: newExpiry,
            renewedCount: claim.renewedCount + 1
          })

          yield* Effect.log(`Claim on task ${taskId} renewed (${claim.renewedCount + 1}/${maxRenewals})`)

          return {
            ...claim,
            leaseExpiresAt: newExpiry,
            renewedCount: claim.renewedCount + 1
          }
        }),

      getExpired: () =>
        claimRepo.findExpired(new Date()),

      expire: (claimId) =>
        Effect.gen(function* () {
          const claim = yield* claimRepo.findById(claimId)
          if (!claim) {
            return yield* Effect.fail(new ClaimNotFoundError({ claimId }))
          }

          yield* claimRepo.update(claimId, { status: 'expired' })
          yield* Effect.log(`Claim ${claimId} expired`)
        }),

      releaseByWorker: (workerId) =>
        claimRepo.releaseAllByWorkerId(workerId),

      getActiveClaim: (taskId) =>
        claimRepo.findActiveByTaskId(taskId)
    }
  })
)
```

### OrchestratorService

```typescript
// src/services/orchestrator-service.ts

import { Context, Effect, Layer, Fiber, Schedule, Duration } from "effect"

export class OrchestratorService extends Context.Tag("OrchestratorService")<
  OrchestratorService,
  {
    readonly start: (config?: Partial<OrchestratorConfig>) =>
      Effect.Effect<void, OrchestratorError>
    readonly stop: (graceful: boolean) =>
      Effect.Effect<void, OrchestratorError>
    readonly status: () =>
      Effect.Effect<OrchestratorState, DatabaseError>
    readonly reconcile: () =>
      Effect.Effect<ReconciliationResult, DatabaseError>
  }
>() {}

interface OrchestratorConfig {
  workerPoolSize: number
  heartbeatIntervalSeconds: number
  leaseDurationMinutes: number
  reconcileIntervalSeconds: number
  shutdownTimeoutSeconds: number
  maxClaimRenewals: number
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  workerPoolSize: 1,
  heartbeatIntervalSeconds: 30,
  leaseDurationMinutes: 30,
  reconcileIntervalSeconds: 60,
  shutdownTimeoutSeconds: 300,
  maxClaimRenewals: 10
}

export const OrchestratorServiceLive = Layer.scoped(
  OrchestratorService,
  Effect.gen(function* () {
    const stateRepo = yield* OrchestratorStateRepository
    const workerService = yield* WorkerService
    const claimService = yield* ClaimService
    const taskService = yield* TaskService

    // State
    let reconcileFiber: Fiber.RuntimeFiber<never, never> | null = null
    let shutdownRequested = false

    // Reconciliation loop
    const runReconcileLoop = (intervalSeconds: number) =>
      Effect.gen(function* () {
        while (!shutdownRequested) {
          const result = yield* reconcileOnce().pipe(
            Effect.catchAll((error) =>
              Effect.log(`Reconciliation error: ${error.message}`)
            )
          )

          yield* stateRepo.update({
            lastReconcileAt: new Date()
          })

          yield* Effect.sleep(Duration.seconds(intervalSeconds))
        }
      })

    // Single reconciliation pass
    const reconcileOnce = (): Effect.Effect<ReconciliationResult, DatabaseError> =>
      Effect.gen(function* () {
        const startTime = Date.now()
        const result: ReconciliationResult = {
          deadWorkersFound: 0,
          expiredClaimsReleased: 0,
          orphanedTasksRecovered: 0,
          staleStatesFixed: 0,
          reconcileTime: 0
        }

        // 1. Detect dead workers
        const deadWorkers = yield* workerService.findDead({ missedHeartbeats: 2 })
        for (const worker of deadWorkers) {
          yield* workerService.markDead(worker.id)
          result.deadWorkersFound++
        }

        // 2. Expire stale claims
        const expiredClaims = yield* claimService.getExpired()
        for (const claim of expiredClaims) {
          yield* claimService.expire(claim.id)
          yield* taskService.update(claim.taskId, { status: 'ready' })
          result.expiredClaimsReleased++
        }

        // 3. Find orphaned tasks (active status but no active claim)
        const orphanedTasks = yield* taskService.findOrphaned()
        for (const task of orphanedTasks) {
          yield* taskService.update(task.id, { status: 'ready' })
          result.orphanedTasksRecovered++
        }

        // 4. Fix workers marked busy but with no current_task_id
        const busyWorkersNoTask = yield* workerService.list({
          status: ['busy'],
          noCurrentTask: true
        })
        for (const worker of busyWorkersNoTask) {
          yield* workerService.updateStatus(worker.id, 'idle')
          result.staleStatesFixed++
        }

        result.reconcileTime = Date.now() - startTime

        if (result.deadWorkersFound > 0 ||
            result.expiredClaimsReleased > 0 ||
            result.orphanedTasksRecovered > 0) {
          yield* Effect.log(
            `Reconciliation: ${result.deadWorkersFound} dead workers, ` +
            `${result.expiredClaimsReleased} expired claims, ` +
            `${result.orphanedTasksRecovered} orphaned tasks`
          )
        }

        return result
      })

    return {
      start: (config) =>
        Effect.gen(function* () {
          const state = yield* stateRepo.get()

          if (state.status === 'running') {
            return yield* Effect.fail(new OrchestratorError({
              message: 'Orchestrator already running'
            }))
          }

          const mergedConfig = { ...DEFAULT_CONFIG, ...config }

          // Update state
          yield* stateRepo.update({
            status: 'starting',
            pid: process.pid,
            startedAt: new Date(),
            workerPoolSize: mergedConfig.workerPoolSize,
            reconcileIntervalSeconds: mergedConfig.reconcileIntervalSeconds,
            heartbeatIntervalSeconds: mergedConfig.heartbeatIntervalSeconds,
            leaseDurationMinutes: mergedConfig.leaseDurationMinutes,
            metadata: { maxClaimRenewals: mergedConfig.maxClaimRenewals }
          })

          // Initial reconciliation
          yield* reconcileOnce()

          // Start reconcile loop
          reconcileFiber = yield* Effect.fork(
            runReconcileLoop(mergedConfig.reconcileIntervalSeconds)
          )

          yield* stateRepo.update({ status: 'running' })
          yield* Effect.log(`Orchestrator started with pool size ${mergedConfig.workerPoolSize}`)
        }),

      stop: (graceful) =>
        Effect.gen(function* () {
          const state = yield* stateRepo.get()

          if (state.status !== 'running') {
            return yield* Effect.fail(new OrchestratorError({
              message: 'Orchestrator is not running'
            }))
          }

          yield* stateRepo.update({ status: 'stopping' })
          shutdownRequested = true

          if (graceful) {
            // Signal all workers to stop
            const workers = yield* workerService.list({ status: ['idle', 'busy'] })

            for (const worker of workers) {
              yield* workerService.updateStatus(worker.id, 'stopping')
            }

            // Wait for workers to finish (with timeout)
            const timeoutMs = (state.metadata as any).shutdownTimeoutSeconds * 1000 || 300000

            yield* Effect.race(
              waitForWorkersToStop(workers.map(w => w.id)),
              Effect.sleep(Duration.millis(timeoutMs))
            )

            // Force cleanup any remaining
            const remaining = yield* workerService.list({
              status: ['idle', 'busy', 'stopping']
            })

            for (const worker of remaining) {
              yield* workerService.markDead(worker.id)
            }
          }

          // Stop reconcile loop
          if (reconcileFiber) {
            yield* Fiber.interrupt(reconcileFiber)
            reconcileFiber = null
          }

          yield* stateRepo.update({
            status: 'stopped',
            pid: null
          })

          yield* Effect.log('Orchestrator stopped')
        }),

      status: () => stateRepo.get(),

      reconcile: () => reconcileOnce()
    }

    // Helper: wait for workers to finish
    function waitForWorkersToStop(workerIds: string[]) {
      return Effect.gen(function* () {
        while (true) {
          const activeCount = yield* workerService.list({
            status: ['busy']
          }).pipe(Effect.map(ws => ws.filter(w => workerIds.includes(w.id)).length))

          if (activeCount === 0) break

          yield* Effect.sleep(Duration.seconds(1))
        }
      })
    }
  })
)
```

---

## Headless Worker Design

The worker is split into two parts:
1. **Worker primitives** (tx provides) - registration, heartbeat, claims
2. **Execution hooks** (you provide) - what the worker actually does

```
┌─────────────────────────────────────────────────────────────┐
│  runWorker(config, hooks)                                   │
├─────────────────────────────────────────────────────────────┤
│  Worker Loop (tx provides)                                  │
│  ├── Register with coordinator                             │
│  ├── Heartbeat loop                                         │
│  ├── Claim available tasks                                  │
│  ├── → hooks.selectAgent(task)                              │
│  ├── → hooks.buildPrompt(agent, task)                       │
│  ├── → hooks.execute(prompt, task, context)    ← YOUR CODE  │
│  ├── → hooks.onSuccess(task, result)                        │
│  ├── → hooks.onFailure(task, error)                         │
│  ├── Lease renewal loop                                     │
│  └── Graceful shutdown                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Worker Hooks Interface

Two hooks. Extensible context.

```typescript
// src/worker/hooks.ts

export interface WorkerHooks<TContext = {}> {
  /**
   * Execute the work - YOUR logic lives here
   */
  execute: (task: Task, ctx: WorkerContext & TContext) => Promise<ExecutionResult>

  /**
   * Where to capture IO (optional)
   */
  captureIO?: (runId: string, task: Task) => IOCapture
}

export interface WorkerContext {
  // tx primitives
  workerId: string
  runId: string
  renewLease: () => Promise<void>
  log: (message: string) => void

  // Mutable state
  state: Record<string, unknown>
}

export interface ExecutionResult {
  success: boolean
  output?: string
  error?: string
}

export interface IOCapture {
  transcriptPath?: string
  stderrPath?: string
}
```

### WorkerConfig with Custom Context

```typescript
export interface WorkerConfig<TContext = {}> {
  name?: string
  heartbeatIntervalSeconds?: number

  // Your custom context - merged into ctx
  context?: TContext

  // Hooks
  execute: (task: Task, ctx: WorkerContext & TContext) => Promise<ExecutionResult>
  captureIO?: (runId: string, task: Task) => IOCapture
}
```

### Building the Context

```typescript
// In worker loop, build ctx with tx primitives + user context
const ctx: WorkerContext & TContext = {
  // tx primitives
  workerId,
  runId,
  renewLease: async () => {
    await Effect.runPromise(claimService.renew(task.id, workerId))
  },
  log: (msg) => console.log(`[${workerId}] ${msg}`),
  state: {},

  // User's custom context merged in
  ...config.context
}
```

---

## Worker Process Implementation

```typescript
// src/worker/worker-process.ts

import { Effect, Schedule, Duration, Fiber } from "effect"

export interface WorkerProcessConfig {
  name?: string
  heartbeatIntervalSeconds: number
  hooks?: Partial<WorkerHooks>
}

export const runWorkerProcess = (config: WorkerProcessConfig) =>
  Effect.gen(function* () {
    const workerService = yield* WorkerService
    const claimService = yield* ClaimService
    const taskService = yield* TaskService
    const runService = yield* RunService

    // Merge user hooks with defaults
    const hooks: Required<WorkerHooks> = {
      ...defaultHooks,
      ...config.hooks
    }

    // Register with coordinator
    const worker = yield* workerService.register({
      name: config.name,
      hostname: os.hostname(),
      pid: process.pid
    })

    const workerId = worker.id
    let shutdownRequested = false

    // Signal handlers for graceful shutdown
    const handleSignal = (signal: string) => {
      console.log(`Worker ${workerId} received ${signal}`)
      shutdownRequested = true

      // Kill Claude subprocess if running
      if (claudeProcess) {
        claudeProcess.kill('SIGTERM')
      }
    }

    process.on('SIGTERM', () => handleSignal('SIGTERM'))
    process.on('SIGINT', () => handleSignal('SIGINT'))

    // Heartbeat fiber
    const heartbeatFiber = yield* Effect.fork(
      runHeartbeatLoop(workerId, config.heartbeatIntervalSeconds)
    )

    try {
      // Main work loop
      while (!shutdownRequested) {
        // Update status
        yield* workerService.updateStatus(workerId, 'idle')

        // Check for available work
        const readyTasks = yield* taskService.ready({ limit: 1 })

        if (readyTasks.length === 0) {
          yield* Effect.sleep(Duration.seconds(5))
          continue
        }

        const task = readyTasks[0]

        // Try to claim the task
        const claimResult = yield* claimService.claim(task.id, workerId).pipe(
          Effect.either
        )

        if (claimResult._tag === 'Left') {
          // Someone else claimed it, try again
          continue
        }

        const claim = claimResult.right
        yield* Effect.log(`Worker ${workerId} claimed task ${task.id}`)

        const runId = generateRunId()

        // Setup IO capture if provided
        const ioCapture = config.hooks?.captureIO?.(runId, task) ?? {}

        // Create run record
        yield* runService.create({
          id: runId,
          taskId: task.id,
          agent: workerId,
          transcriptPath: ioCapture.transcriptPath,
          stderrPath: ioCapture.stderrPath
        })

        // Context for execute hook
        const context: WorkerContext = {
          workerId,
          runId,
          renewLease: async () => {
            await Effect.runPromise(claimService.renew(task.id, workerId))
          }
        }

        try {
          // USER HOOK: Execute (all your logic here)
          const result = await config.hooks!.execute(task, context)

          // Update run status
          yield* runService.update(runId, {
            status: result.success ? 'completed' : 'failed',
            endedAt: new Date()
          })

          if (!result.success) {
            yield* Effect.log(`Task ${task.id} failed: ${result.error}`)
          }
        } catch (error) {
          yield* runService.update(runId, {
            status: 'failed',
            endedAt: new Date()
          })
          yield* Effect.log(`Task ${task.id} error: ${error}`)
        }

        // Release claim
        yield* claimService.release(task.id, workerId)
      }

      // Graceful shutdown: finish current task then exit
      yield* workerService.updateStatus(workerId, 'stopping')

    } finally {
      // Cleanup
      yield* Fiber.interrupt(heartbeatFiber)
      yield* workerService.deregister(workerId)
    }
  })

// Heartbeat loop
const runHeartbeatLoop = (workerId: string, intervalSeconds: number) =>
  Effect.gen(function* () {
    const workerService = yield* WorkerService

    while (true) {
      yield* workerService.heartbeat({
        workerId,
        timestamp: new Date(),
        status: 'idle', // Will be updated by main loop
        metrics: {
          cpuPercent: process.cpuUsage().user / 1000000,
          memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
          tasksCompleted: 0
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.log(`Heartbeat failed: ${error.message}`)
        )
      )

      yield* Effect.sleep(Duration.seconds(intervalSeconds))
    }
  })

// Lease renewal loop
const runLeaseRenewalLoop = (taskId: string, workerId: string, intervalSeconds: number) =>
  Effect.gen(function* () {
    const claimService = yield* ClaimService

    while (true) {
      yield* Effect.sleep(Duration.seconds(intervalSeconds))

      yield* claimService.renew(taskId, workerId).pipe(
        Effect.tap(() => Effect.log(`Renewed lease on task ${taskId}`)),
        Effect.catchAll((error) =>
          Effect.log(`Lease renewal failed: ${error.message}`)
        )
      )
    }
  })

// Run Claude subprocess
const runClaude = (
  agent: string,
  task: Task,
  workerId: string,
  onProcess: (proc: ChildProcess) => void
): Effect.Effect<{ success: boolean; error?: string }, never> =>
  Effect.async((resume) => {
    const prompt = buildPrompt(agent, task)

    const proc = spawn('claude', [
      '--dangerously-skip-permissions',
      '--print',
      prompt
    ], {
      cwd: process.cwd(),
      env: { ...process.env, TX_WORKER_ID: workerId },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    onProcess(proc)

    let stderr = ''

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resume(Effect.succeed({ success: true }))
      } else {
        resume(Effect.succeed({ success: false, error: stderr || `Exit code ${code}` }))
      }
    })

    proc.on('error', (err) => {
      resume(Effect.succeed({ success: false, error: err.message }))
    })
  })

const buildPrompt = (agent: string, task: Task): string =>
  `Read .claude/agents/${agent}.md for your instructions.

Your assigned task: ${task.id}
Task title: ${task.title}

Run \`tx show ${task.id}\` to get full details, then follow your agent instructions.
When done, run \`tx done ${task.id}\` to mark the task complete.
If you discover new work, create subtasks with \`tx add\`.
If you hit a blocker, update the task status: \`tx update ${task.id} --status blocked\`.`

const selectAgent = (task: Task): string => {
  const title = task.title.toLowerCase()

  if (title.includes('test') || title.includes('integration') || title.includes('fixture')) {
    return 'tx-tester'
  }
  if (title.includes('review') || title.includes('audit') || title.includes('check')) {
    return 'tx-reviewer'
  }
  if (task.score >= 800 && !task.children?.length) {
    return 'tx-decomposer'
  }

  return 'tx-implementer'
}
```

---

## CLI Commands

```typescript
// apps/cli/src/commands/orchestrator.ts

import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

const startCommand = Command.make(
  "start",
  {
    workers: Options.integer("workers").pipe(
      Options.withDefault(1),
      Options.withDescription("Number of workers in the pool")
    ),
    daemon: Options.boolean("daemon").pipe(
      Options.withDefault(false),
      Options.withDescription("Run as daemon")
    )
  },
  ({ workers, daemon }) =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService

      yield* orchestrator.start({
        workerPoolSize: workers
      })

      if (!daemon) {
        console.log(`Orchestrator started with ${workers} worker(s)`)
        console.log('Press Ctrl+C to stop')

        // Keep process running
        yield* Effect.never
      }
    })
)

const stopCommand = Command.make(
  "stop",
  {
    graceful: Options.boolean("graceful").pipe(
      Options.withDefault(true),
      Options.withDescription("Wait for workers to finish")
    )
  },
  ({ graceful }) =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      yield* orchestrator.stop(graceful)
      console.log('Orchestrator stopped')
    })
)

const statusCommand = Command.make(
  "status",
  {},
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const workerService = yield* WorkerService

      const state = yield* orchestrator.status()
      const workers = yield* workerService.list()

      console.log('Orchestrator Status:')
      console.log(`  Status: ${state.status}`)
      console.log(`  PID: ${state.pid ?? '-'}`)
      console.log(`  Started: ${state.startedAt?.toISOString() ?? '-'}`)
      console.log(`  Last Reconcile: ${state.lastReconcileAt?.toISOString() ?? '-'}`)
      console.log(`  Pool Size: ${state.workerPoolSize}`)
      console.log('')
      console.log('Workers:')

      if (workers.length === 0) {
        console.log('  (none)')
      } else {
        for (const worker of workers) {
          console.log(`  ${worker.id}: ${worker.status} (${worker.name})`)
          if (worker.currentTaskId) {
            console.log(`    Current task: ${worker.currentTaskId}`)
          }
          console.log(`    Last heartbeat: ${worker.lastHeartbeatAt.toISOString()}`)
        }
      }
    })
)

const reconcileCommand = Command.make(
  "reconcile",
  {},
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const result = yield* orchestrator.reconcile()

      console.log('Reconciliation Results:')
      console.log(`  Dead workers found: ${result.deadWorkersFound}`)
      console.log(`  Expired claims released: ${result.expiredClaimsReleased}`)
      console.log(`  Orphaned tasks recovered: ${result.orphanedTasksRecovered}`)
      console.log(`  Stale states fixed: ${result.staleStatesFixed}`)
      console.log(`  Time: ${result.reconcileTime}ms`)
    })
)

export const orchestratorCommand = Command.make(
  "orchestrator",
  {},
  () => Effect.unit
).pipe(
  Command.withSubcommands([
    startCommand,
    stopCommand,
    statusCommand,
    reconcileCommand
  ])
)
```

```typescript
// apps/cli/src/commands/worker.ts

import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

const startCommand = Command.make(
  "start",
  {
    name: Options.text("name").pipe(
      Options.optional,
      Options.withDescription("Worker name")
    )
  },
  ({ name }) =>
    Effect.gen(function* () {
      yield* runWorkerProcess({
        name: name ?? undefined,
        heartbeatIntervalSeconds: 30
      })
    })
)

const stopCommand = Command.make(
  "stop",
  {
    graceful: Options.boolean("graceful").pipe(
      Options.withDefault(true)
    )
  },
  ({ graceful }) =>
    Effect.gen(function* () {
      // Send SIGTERM to worker process
      // In practice, this would look up the worker's PID
      console.log('Worker stop not implemented - use Ctrl+C or kill')
    })
)

const statusCommand = Command.make(
  "status",
  {},
  () =>
    Effect.gen(function* () {
      const workerService = yield* WorkerService
      const workers = yield* workerService.list()

      console.log('Workers:')
      for (const worker of workers) {
        console.log(`  ${worker.id}: ${worker.status}`)
        console.log(`    Name: ${worker.name}`)
        console.log(`    Hostname: ${worker.hostname}`)
        console.log(`    PID: ${worker.pid}`)
        console.log(`    Last heartbeat: ${worker.lastHeartbeatAt.toISOString()}`)
        if (worker.currentTaskId) {
          console.log(`    Current task: ${worker.currentTaskId}`)
        }
        console.log('')
      }
    })
)

const listCommand = Command.make(
  "list",
  {},
  () =>
    Effect.gen(function* () {
      const workerService = yield* WorkerService
      const workers = yield* workerService.list()

      if (workers.length === 0) {
        console.log('No workers registered')
        return
      }

      console.log('ID\t\t\tStatus\tName\t\tTask')
      for (const worker of workers) {
        console.log(
          `${worker.id}\t${worker.status}\t${worker.name}\t${worker.currentTaskId ?? '-'}`
        )
      }
    })
)

export const workerCommand = Command.make(
  "worker",
  {},
  () => Effect.unit
).pipe(
  Command.withSubcommands([
    startCommand,
    stopCommand,
    statusCommand,
    listCommand
  ])
)
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('WorkerService', () => {
  it('should register worker within pool capacity', async () => {
    // Setup coordinator with pool size 2
    await runEffect(orchestratorService.start({ workerPoolSize: 2 }), db)

    const worker = await runEffect(
      workerService.register({
        name: 'test-worker',
        hostname: 'localhost',
        pid: 123,
      }),
      db
    )

    expect(worker.id).toMatch(/^worker-[a-z0-9]{8}$/)
    expect(worker.status).toBe('starting')
  })

  it('should reject registration when pool is full', async () => {
    await runEffect(orchestratorService.start({ workerPoolSize: 1 }), db)

    // Register first worker
    await runEffect(
      workerService.register({ name: 'worker-1', hostname: 'localhost', pid: 1 }),
      db
    )

    // Second should fail
    const result = await runEffect(
      workerService.register({ name: 'worker-2', hostname: 'localhost', pid: 2 }),
      db
    ).pipe(Effect.either)

    expect(result._tag).toBe('Left')
  })
})

describe('ClaimService', () => {
  it('should claim task and set status to active', async () => {
    const task = await createTestTask(db, { status: 'ready' })
    const worker = await registerTestWorker(db)

    const claim = await runEffect(
      claimService.claim(task.id, worker.id),
      db
    )

    expect(claim.taskId).toBe(task.id)
    expect(claim.workerId).toBe(worker.id)
    expect(claim.status).toBe('active')

    // Task should be active
    const updatedTask = await runEffect(taskService.findById(task.id), db)
    expect(updatedTask?.status).toBe('active')
  })

  it('should reject double claim', async () => {
    const task = await createTestTask(db, { status: 'ready' })
    const worker1 = await registerTestWorker(db, { name: 'worker-1' })
    const worker2 = await registerTestWorker(db, { name: 'worker-2' })

    await runEffect(claimService.claim(task.id, worker1.id), db)

    const result = await runEffect(
      claimService.claim(task.id, worker2.id),
      db
    ).pipe(Effect.either)

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(AlreadyClaimedError)
  })
})

describe('OrchestratorService', () => {
  it('should detect dead workers on reconcile', async () => {
    await runEffect(orchestratorService.start(), db)

    // Register worker
    const worker = await registerTestWorker(db)

    // Simulate missed heartbeats by backdating last_heartbeat_at
    await db.run(
      `UPDATE workers SET last_heartbeat_at = datetime('now', '-5 minutes') WHERE id = ?`,
      [worker.id]
    )

    // Reconcile
    const result = await runEffect(orchestratorService.reconcile(), db)

    expect(result.deadWorkersFound).toBe(1)

    // Worker should be marked dead
    const updated = await runEffect(workerService.list(), db)
    expect(updated.find(w => w.id === worker.id)?.status).toBe('dead')
  })
})
```

### Integration Tests

```typescript
describe('Worker Orchestration Integration', () => {
  it('should complete full task lifecycle', async () => {
    // 1. Start coordinator
    await runEffect(orchestratorService.start({ workerPoolSize: 1 }), db)

    // 2. Create task
    const task = await createTestTask(db, {
      title: 'Test task',
      status: 'ready',
      score: 500
    })

    // 3. Start worker (simulated)
    const worker = await registerTestWorker(db)
    await runEffect(workerService.updateStatus(worker.id, 'idle'), db)

    // 4. Claim task
    await runEffect(claimService.claim(task.id, worker.id), db)

    // 5. Complete task
    await runEffect(taskService.update(task.id, { status: 'done' }), db)
    await runEffect(claimService.release(task.id, worker.id), db)

    // 6. Verify
    const finalTask = await runEffect(taskService.findById(task.id), db)
    expect(finalTask?.status).toBe('done')

    const finalWorker = await runEffect(workerService.list(), db)
    expect(finalWorker[0].status).toBe('idle')
    expect(finalWorker[0].currentTaskId).toBeNull()
  })

  it('should recover orphaned task after worker death', async () => {
    await runEffect(orchestratorService.start(), db)

    const task = await createTestTask(db, { status: 'ready' })
    const worker = await registerTestWorker(db)

    // Claim task
    await runEffect(claimService.claim(task.id, worker.id), db)

    // Simulate worker death (no heartbeats)
    await db.run(
      `UPDATE workers SET last_heartbeat_at = datetime('now', '-5 minutes') WHERE id = ?`,
      [worker.id]
    )

    // Reconcile
    await runEffect(orchestratorService.reconcile(), db)

    // Task should be back to ready
    const recoveredTask = await runEffect(taskService.findById(task.id), db)
    expect(recoveredTask?.status).toBe('ready')
  })
})
```

---

## Migration from ralph.sh

### Phase 1: Parallel Operation

```bash
# ralph.sh remains unchanged
# New commands available

# Start coordinator (runs alongside ralph.sh)
tx coordinator start --workers 1

# Workers use new claim system
tx worker start
```

### Phase 2: Feature Parity Checklist

| ralph.sh Feature | Coordinator Equivalent | Status |
|-----------------|------------------------|--------|
| Lock file | Singleton coordinator state | Planned |
| Run tracking | Task claims with metadata | Planned |
| Orphan cleanup | Reconciliation loop | Planned |
| Circuit breaker | Per-worker failure tracking | Planned |
| Agent selection | Worker hooks | Planned |
| Review cycles | Scheduled review tasks | Future |

### Phase 3: Deprecation

```bash
# ralph.sh prints deprecation warning
./scripts/ralph.sh
# WARNING: ralph.sh is deprecated. Use 'tx coordinator start' instead.

# Migration command
tx migrate:from-ralph

# Removes ralph.sh, updates docs
```

---

## Performance Considerations

1. **SQLite concurrency**: Use WAL mode, short transactions
2. **Heartbeat volume**: 1 heartbeat/30s × N workers = low overhead
3. **Reconciliation**: O(dead_workers + expired_claims + orphaned_tasks)
4. **Claim contention**: Rare with lease-based system

---

## References

- PRD-018: Worker Orchestration System
- DD-001: Data Model & Storage
- DD-002: Effect-TS Service Layer
- Kubernetes controller pattern: https://kubernetes.io/docs/concepts/architecture/controller/
