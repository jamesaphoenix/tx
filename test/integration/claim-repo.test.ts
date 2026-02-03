/**
 * ClaimRepository Integration Tests
 *
 * Tests the ClaimRepository at the repository layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import type { TaskId, Task } from "@jamesaphoenix/tx-types"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`claim-repo-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const FIXTURES = {
  WORKER_1: fixtureId("worker-1"),
  WORKER_2: fixtureId("worker-2"),
  TASK_1: fixtureId("task-1") as TaskId,
  TASK_2: fixtureId("task-2") as TaskId,
  TASK_3: fixtureId("task-3") as TaskId,
} as const

// =============================================================================
// Helper: Create Claim Data
// =============================================================================

const createClaimData = (
  overrides?: Partial<{
    taskId: string
    workerId: string
    claimedAt: Date
    leaseExpiresAt: Date
    renewedCount: number
    status: "active" | "released" | "expired" | "completed"
  }>
) => ({
  taskId: overrides?.taskId ?? FIXTURES.TASK_1,
  workerId: overrides?.workerId ?? FIXTURES.WORKER_1,
  claimedAt: overrides?.claimedAt ?? new Date(),
  leaseExpiresAt: overrides?.leaseExpiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
  renewedCount: overrides?.renewedCount ?? 0,
  status: overrides?.status ?? "active" as const
})

// =============================================================================
// ClaimRepository.insert Tests
// =============================================================================

describe("ClaimRepository.insert", () => {
  it("creates claim and returns with auto-generated ID", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const claimData = createClaimData()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        const task1: Task = {
          id: FIXTURES.TASK_1,
          title: "Task 1",
          description: "",
          status: "backlog",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        }
        yield* taskRepo.insert(task1)

        // Test claim insert
        const repo = yield* ClaimRepository
        return yield* repo.insert(claimData)
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toBe(1)
    expect(result.taskId).toBe(FIXTURES.TASK_1)
    expect(result.workerId).toBe(FIXTURES.WORKER_1)
    expect(result.renewedCount).toBe(0)
    expect(result.status).toBe("active")
    expect(result.claimedAt).toBeInstanceOf(Date)
    expect(result.leaseExpiresAt).toBeInstanceOf(Date)
  })

  it("auto-increments IDs for multiple inserts", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        for (const [id, title, score] of [
          [FIXTURES.TASK_1, "Task 1", 500],
          [FIXTURES.TASK_2, "Task 2", 600],
          [FIXTURES.TASK_3, "Task 3", 700]
        ] as const) {
          const task: Task = {
            id: id as TaskId,
            title,
            description: "",
            status: "backlog",
            parentId: null,
            score,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            metadata: {}
          }
          yield* taskRepo.insert(task)
        }

        const repo = yield* ClaimRepository

        const c1 = yield* repo.insert(createClaimData({ taskId: FIXTURES.TASK_1 }))
        const c2 = yield* repo.insert(createClaimData({ taskId: FIXTURES.TASK_2 }))
        const c3 = yield* repo.insert(createClaimData({ taskId: FIXTURES.TASK_3 }))

        return { c1, c2, c3 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.c1.id).toBe(1)
    expect(result.c2.id).toBe(2)
    expect(result.c3.id).toBe(3)
  })
})

// =============================================================================
// ClaimRepository.update Tests
// =============================================================================

describe("ClaimRepository.update", () => {
  it("updates claim fields (lease, status, renewedCount)", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        const task1: Task = {
          id: FIXTURES.TASK_1,
          title: "Task 1",
          description: "",
          status: "backlog",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        }
        yield* taskRepo.insert(task1)

        const repo = yield* ClaimRepository
        const claim = yield* repo.insert(createClaimData())

        const newLeaseExpires = new Date(Date.now() + 60 * 60 * 1000)
        const updatedClaim = {
          ...claim,
          leaseExpiresAt: newLeaseExpires,
          renewedCount: 1,
          status: "released" as const
        }
        yield* repo.update(updatedClaim)

        return yield* repo.findById(claim.id)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.renewedCount).toBe(1)
    expect(result!.status).toBe("released")
  })
})

// =============================================================================
// ClaimRepository.findById Tests
// =============================================================================

describe("ClaimRepository.findById", () => {
  it("returns claim by ID", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        const task1: Task = {
          id: FIXTURES.TASK_1,
          title: "Task 1",
          description: "",
          status: "backlog",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        }
        yield* taskRepo.insert(task1)

        const repo = yield* ClaimRepository
        const inserted = yield* repo.insert(createClaimData())
        return yield* repo.findById(inserted.id)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.id).toBe(1)
    expect(result!.taskId).toBe(FIXTURES.TASK_1)
    expect(result!.workerId).toBe(FIXTURES.WORKER_1)
  })

  it("returns null for nonexistent ID", async () => {
    const { ClaimRepository, ClaimRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = ClaimRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* ClaimRepository
        return yield* repo.findById(999)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// ClaimRepository.findActiveByTaskId Tests
// =============================================================================

describe("ClaimRepository.findActiveByTaskId", () => {
  it("returns active claim for a task", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        const task1: Task = {
          id: FIXTURES.TASK_1,
          title: "Task 1",
          description: "",
          status: "backlog",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        }
        yield* taskRepo.insert(task1)

        const repo = yield* ClaimRepository
        yield* repo.insert(createClaimData({ taskId: FIXTURES.TASK_1, status: "active" }))

        return yield* repo.findActiveByTaskId(FIXTURES.TASK_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.taskId).toBe(FIXTURES.TASK_1)
    expect(result!.status).toBe("active")
  })

  it("returns null when no active claim exists", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        const task1: Task = {
          id: FIXTURES.TASK_1,
          title: "Task 1",
          description: "",
          status: "backlog",
          parentId: null,
          score: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          metadata: {}
        }
        yield* taskRepo.insert(task1)

        const repo = yield* ClaimRepository
        const claim = yield* repo.insert(createClaimData({ taskId: FIXTURES.TASK_1 }))
        yield* repo.update({ ...claim, status: "released" })

        return yield* repo.findActiveByTaskId(FIXTURES.TASK_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })

  it("returns null for task with no claims", async () => {
    const { ClaimRepository, ClaimRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = ClaimRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* ClaimRepository
        return yield* repo.findActiveByTaskId("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// ClaimRepository.findExpired Tests
// =============================================================================

describe("ClaimRepository.findExpired", () => {
  it("finds claims with expired leases", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const now = new Date()
    const pastTime = new Date(now.getTime() - 60000)
    const futureTime = new Date(now.getTime() + 60000)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        for (const [id, title, score] of [
          [FIXTURES.TASK_1, "Task 1", 500],
          [FIXTURES.TASK_2, "Task 2", 600]
        ] as const) {
          const task: Task = {
            id: id as TaskId,
            title,
            description: "",
            status: "backlog",
            parentId: null,
            score,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            metadata: {}
          }
          yield* taskRepo.insert(task)
        }

        const repo = yield* ClaimRepository

        yield* repo.insert(createClaimData({
          taskId: FIXTURES.TASK_1,
          leaseExpiresAt: pastTime,
          status: "active"
        }))

        yield* repo.insert(createClaimData({
          taskId: FIXTURES.TASK_2,
          leaseExpiresAt: futureTime,
          status: "active"
        }))

        return yield* repo.findExpired(now)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe(FIXTURES.TASK_1)
  })

  it("returns empty array when no expired claims", async () => {
    const { ClaimRepository, ClaimRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = ClaimRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* ClaimRepository
        return yield* repo.findExpired(new Date())
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(0)
  })
})

// =============================================================================
// ClaimRepository.releaseAllByWorkerId Tests
// =============================================================================

describe("ClaimRepository.releaseAllByWorkerId", () => {
  it("releases all active claims for a worker", async () => {
    const { ClaimRepository, ClaimRepositoryLive, WorkerRepository, WorkerRepositoryLive, TaskRepository, TaskRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = Layer.mergeAll(ClaimRepositoryLive, WorkerRepositoryLive, TaskRepositoryLive).pipe(
      Layer.provide(infra)
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Seed data
        const workerRepo = yield* WorkerRepository
        const taskRepo = yield* TaskRepository

        yield* workerRepo.insert({
          id: FIXTURES.WORKER_1,
          name: "worker-1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: FIXTURES.WORKER_2,
          name: "worker-2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        for (const [id, title, score] of [
          [FIXTURES.TASK_1, "Task 1", 500],
          [FIXTURES.TASK_2, "Task 2", 600],
          [FIXTURES.TASK_3, "Task 3", 700]
        ] as const) {
          const task: Task = {
            id: id as TaskId,
            title,
            description: "",
            status: "backlog",
            parentId: null,
            score,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            metadata: {}
          }
          yield* taskRepo.insert(task)
        }

        const repo = yield* ClaimRepository

        yield* repo.insert(createClaimData({
          taskId: FIXTURES.TASK_1,
          workerId: FIXTURES.WORKER_1
        }))
        yield* repo.insert(createClaimData({
          taskId: FIXTURES.TASK_2,
          workerId: FIXTURES.WORKER_1
        }))

        yield* repo.insert(createClaimData({
          taskId: FIXTURES.TASK_3,
          workerId: FIXTURES.WORKER_2
        }))

        const released = yield* repo.releaseAllByWorkerId(FIXTURES.WORKER_1)

        const task1Claim = yield* repo.findActiveByTaskId(FIXTURES.TASK_1)
        const task2Claim = yield* repo.findActiveByTaskId(FIXTURES.TASK_2)
        const task3Claim = yield* repo.findActiveByTaskId(FIXTURES.TASK_3)

        return { released, task1Claim, task2Claim, task3Claim }
      }).pipe(Effect.provide(layer))
    )

    expect(result.released).toBe(2)
    expect(result.task1Claim).toBeNull()
    expect(result.task2Claim).toBeNull()
    expect(result.task3Claim).not.toBeNull()
  })

  it("returns 0 when no active claims exist", async () => {
    const { ClaimRepository, ClaimRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = ClaimRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* ClaimRepository
        return yield* repo.releaseAllByWorkerId("nonexistent-worker")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(0)
  })
})
