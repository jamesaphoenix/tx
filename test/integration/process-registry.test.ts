/**
 * Process Registry & ReadyAndClaim Integration Tests
 *
 * Tests the ProcessRegistryService and ReadyService.readyAndClaim
 * with real SQLite database per RULE 3 and RULE 8.
 */

import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer } from "@jamesaphoenix/tx-test-utils"
import { createHash } from "node:crypto"
import type { TaskId } from "@jamesaphoenix/tx-types"

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`process-registry-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const fixtureWorkerId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`process-registry-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

// =============================================================================
// Process Registry Tests
// =============================================================================

describe("ProcessRegistryService", () => {
  it("registers a process and returns it", async () => {
    const { layer } = await getSharedTestLayer()
    const { ProcessRegistryService } = await import("@jamesaphoenix/tx-core")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProcessRegistryService
        return yield* svc.register({
          pid: 12345,
          parentPid: null,
          workerId: null,
          runId: null,
          role: "orchestrator",
          commandHint: "ralph.sh"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.pid).toBe(12345)
    expect(result.role).toBe("orchestrator")
    expect(result.commandHint).toBe("ralph.sh")
    expect(result.endedAt).toBeNull()
    expect(result.parentPid).toBeNull()
  })

  it("registers a worker process with parent PID", async () => {
    const { layer } = await getSharedTestLayer()
    const { ProcessRegistryService, WorkerRepository } = await import("@jamesaphoenix/tx-core")

    const workerId = fixtureWorkerId("worker-parent")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProcessRegistryService
        const workerRepo = yield* WorkerRepository

        // Register worker first (FK constraint)
        yield* workerRepo.insert({
          id: workerId,
          name: "test-worker",
          hostname: "localhost",
          pid: 99999,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        return yield* svc.register({
          pid: 99999,
          parentPid: 12345,
          workerId,
          runId: null,
          role: "worker",
          commandHint: "ralph.sh --child"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.pid).toBe(99999)
    expect(result.parentPid).toBe(12345)
    expect(result.workerId).toBe(workerId)
    expect(result.role).toBe("worker")
  })

  it("heartbeat updates last_heartbeat_at", async () => {
    const { layer } = await getSharedTestLayer()
    const { ProcessRegistryService } = await import("@jamesaphoenix/tx-core")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProcessRegistryService

        yield* svc.register({
          pid: 11111,
          parentPid: null,
          workerId: null,
          runId: null,
          role: "orchestrator",
          commandHint: null
        })

        const updated = yield* svc.heartbeat(11111)
        return updated
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(1)
  })

  it("deregister sets ended_at", async () => {
    const { layer } = await getSharedTestLayer()
    const { ProcessRegistryService } = await import("@jamesaphoenix/tx-core")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProcessRegistryService

        yield* svc.register({
          pid: 22222,
          parentPid: null,
          workerId: null,
          runId: null,
          role: "orchestrator",
          commandHint: null
        })

        yield* svc.deregister(22222)
        const alive = yield* svc.findAlive()
        return alive.filter(p => p.pid === 22222)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(0)
  })

  it("findAlive returns only active processes", async () => {
    const { layer } = await getSharedTestLayer()
    const { ProcessRegistryService } = await import("@jamesaphoenix/tx-core")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProcessRegistryService

        yield* svc.register({
          pid: 33333,
          parentPid: null,
          workerId: null,
          runId: null,
          role: "orchestrator",
          commandHint: null
        })

        yield* svc.register({
          pid: 33334,
          parentPid: 33333,
          workerId: null,
          runId: null,
          role: "worker",
          commandHint: null
        })

        yield* svc.deregister(33334)
        return yield* svc.findAlive()
      }).pipe(Effect.provide(layer))
    )

    const pids = result.map(p => p.pid)
    expect(pids).toContain(33333)
    expect(pids).not.toContain(33334)
  })

  it("findOrphans detects processes with stale heartbeats", async () => {
    const { layer } = await getSharedTestLayer()
    const { ProcessRegistryRepository } = await import("@jamesaphoenix/tx-core")
    const { SqliteClient } = await import("@jamesaphoenix/tx-core")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* ProcessRegistryRepository
        const db = yield* SqliteClient

        // Insert a process with a stale heartbeat (5 minutes ago)
        db.prepare(
          `INSERT INTO process_registry (pid, role, started_at, last_heartbeat_at)
           VALUES (44444, 'orchestrator', datetime('now', '-10 minutes'), datetime('now', '-5 minutes'))`
        ).run()

        // Insert a fresh process
        db.prepare(
          `INSERT INTO process_registry (pid, role, started_at, last_heartbeat_at)
           VALUES (44445, 'worker', datetime('now'), datetime('now'))`
        ).run()

        // Find orphans with 120s threshold (< 2 minutes old heartbeat = orphan)
        return yield* repo.findOrphans(120)
      }).pipe(Effect.provide(layer))
    )

    const pids = result.map(p => p.pid)
    expect(pids).toContain(44444)
    expect(pids).not.toContain(44445)
  })
})

// =============================================================================
// ReadyAndClaim Tests
// =============================================================================

describe("ReadyService.readyAndClaim", () => {
  it("returns null when no tasks are ready", async () => {
    const { layer } = await getSharedTestLayer()
    const { ReadyService } = await import("@jamesaphoenix/tx-core")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.readyAndClaim("worker-1")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })

  it("atomically fetches and claims a ready task", async () => {
    const { layer } = await getSharedTestLayer()
    const {
      ReadyService,
      TaskRepository,
      WorkerRepository,
    } = await import("@jamesaphoenix/tx-core")

    const taskId = fixtureId("ready-claim-1")
    const workerId = fixtureWorkerId("ready-claim-worker")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository
        const readySvc = yield* ReadyService

        // Create a task
        yield* taskRepo.insert({
          id: taskId as TaskId,
          title: "Test ready-and-claim task",
          description: "Testing atomic ready+claim",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          assigneeType: null,
          assigneeId: null,
          assignedAt: null,
          assignedBy: null,
          metadata: {}
        })

        // Register worker (FK for claims)
        yield* workerRepo.insert({
          id: workerId,
          name: "test-worker",
          hostname: "localhost",
          pid: 55555,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        return yield* readySvc.readyAndClaim(workerId, 30)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.task.id).toBe(taskId)
    expect(result!.claim.workerId).toBe(workerId)
    expect(result!.claim.status).toBe("active")
  })

  it("skips already-claimed tasks and claims the next one", async () => {
    const { layer } = await getSharedTestLayer()
    const {
      ReadyService,
      TaskRepository,
      WorkerRepository,
      ClaimService,
    } = await import("@jamesaphoenix/tx-core")

    const task1 = fixtureId("skip-claimed-1")
    const task2 = fixtureId("skip-claimed-2")
    const worker1 = fixtureWorkerId("skip-worker-1")
    const worker2 = fixtureWorkerId("skip-worker-2")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository
        const claimSvc = yield* ClaimService
        const readySvc = yield* ReadyService

        // Create two tasks (task1 has higher score)
        for (const [id, score] of [[task1, 900], [task2, 800]] as const) {
          yield* taskRepo.insert({
            id: id as TaskId,
            title: `Task ${id}`,
            description: "",
            status: "ready",
            parentId: null,
            score,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            assigneeType: null,
            assigneeId: null,
            assignedAt: null,
            assignedBy: null,
            metadata: {}
          })
        }

        // Register both workers
        for (const wid of [worker1, worker2]) {
          yield* workerRepo.insert({
            id: wid,
            name: wid,
            hostname: "localhost",
            pid: Math.floor(Math.random() * 99999),
            status: "idle",
            registeredAt: new Date(),
            lastHeartbeatAt: new Date(),
            currentTaskId: null,
            capabilities: [],
            metadata: {}
          })
        }

        // Worker 1 claims task1 (highest priority)
        yield* claimSvc.claim(task1, worker1, 30)

        // Worker 2 tries readyAndClaim — should skip task1 and get task2
        return yield* readySvc.readyAndClaim(worker2, 30)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.task.id).toBe(task2)
    expect(result!.claim.workerId).toBe(worker2)
  })

  it("returns null when all ready tasks are claimed", async () => {
    const { layer } = await getSharedTestLayer()
    const {
      ReadyService,
      TaskRepository,
      WorkerRepository,
      ClaimService,
    } = await import("@jamesaphoenix/tx-core")

    const taskId = fixtureId("all-claimed")
    const worker1 = fixtureWorkerId("all-claimed-w1")
    const worker2 = fixtureWorkerId("all-claimed-w2")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskRepo = yield* TaskRepository
        const workerRepo = yield* WorkerRepository
        const claimSvc = yield* ClaimService
        const readySvc = yield* ReadyService

        yield* taskRepo.insert({
          id: taskId as TaskId,
          title: "Only task",
          description: "",
          status: "ready",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          assigneeType: null,
          assigneeId: null,
          assignedAt: null,
          assignedBy: null,
          metadata: {}
        })

        for (const wid of [worker1, worker2]) {
          yield* workerRepo.insert({
            id: wid,
            name: wid,
            hostname: "localhost",
            pid: Math.floor(Math.random() * 99999),
            status: "idle",
            registeredAt: new Date(),
            lastHeartbeatAt: new Date(),
            currentTaskId: null,
            capabilities: [],
            metadata: {}
          })
        }

        // Worker 1 claims the only task
        yield* claimSvc.claim(taskId, worker1, 30)

        // Worker 2 tries readyAndClaim — should get null
        return yield* readySvc.readyAndClaim(worker2, 30)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})
