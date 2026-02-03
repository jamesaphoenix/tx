/**
 * WorkerRepository Integration Tests
 *
 * Tests the WorkerRepository at the repository layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`worker-repo-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `worker-${hash}`
}

const FIXTURES = {
  WORKER_1: fixtureId("worker-1"),
  WORKER_2: fixtureId("worker-2"),
  WORKER_3: fixtureId("worker-3"),
} as const

// =============================================================================
// Helper: Create Worker Data
// =============================================================================

const createWorkerData = (
  id: string,
  overrides?: Partial<{
    name: string
    hostname: string
    pid: number
    status: "starting" | "idle" | "busy" | "stopping" | "dead"
    registeredAt: Date
    lastHeartbeatAt: Date
    currentTaskId: string | null
    capabilities: string[]
    metadata: Record<string, unknown>
  }>
) => ({
  id,
  name: overrides?.name ?? `worker-${id}`,
  hostname: overrides?.hostname ?? "localhost",
  pid: overrides?.pid ?? 12345,
  status: overrides?.status ?? "idle" as const,
  registeredAt: overrides?.registeredAt ?? new Date(),
  lastHeartbeatAt: overrides?.lastHeartbeatAt ?? new Date(),
  currentTaskId: overrides?.currentTaskId ?? null,
  capabilities: overrides?.capabilities ?? [],
  metadata: overrides?.metadata ?? {}
})

// =============================================================================
// WorkerRepository.insert Tests
// =============================================================================

describe("WorkerRepository.insert", () => {
  it("creates a worker with all fields", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const worker = createWorkerData(FIXTURES.WORKER_1, {
      name: "test-worker",
      hostname: "test-host",
      pid: 9999,
      status: "idle",
      capabilities: ["compile", "test"],
      metadata: { version: "1.0.0" }
    })

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        yield* repo.insert(worker)
        return yield* repo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(found).not.toBeNull()
    expect(found!.id).toBe(FIXTURES.WORKER_1)
    expect(found!.name).toBe("test-worker")
    expect(found!.hostname).toBe("test-host")
    expect(found!.pid).toBe(9999)
    expect(found!.status).toBe("idle")
    expect(found!.capabilities).toEqual(["compile", "test"])
    expect(found!.metadata).toEqual({ version: "1.0.0" })
    expect(found!.currentTaskId).toBeNull()
    expect(found!.registeredAt).toBeInstanceOf(Date)
    expect(found!.lastHeartbeatAt).toBeInstanceOf(Date)
  })
})

// =============================================================================
// WorkerRepository.update Tests
// =============================================================================

describe("WorkerRepository.update", () => {
  it("updates worker fields", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const worker = createWorkerData(FIXTURES.WORKER_1, { status: "idle" })

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        yield* repo.insert(worker)

        // Update status (note: currentTaskId has FK constraint so we leave it null)
        const updatedWorker = {
          ...worker,
          status: "busy" as const,
          lastHeartbeatAt: new Date()
        }
        yield* repo.update(updatedWorker)

        return yield* repo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(found).not.toBeNull()
    expect(found!.status).toBe("busy")
  })
})

// =============================================================================
// WorkerRepository.delete Tests
// =============================================================================

describe("WorkerRepository.delete", () => {
  it("removes worker and returns true", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const worker = createWorkerData(FIXTURES.WORKER_1)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        yield* repo.insert(worker)
        const deleted = yield* repo.delete(FIXTURES.WORKER_1)
        const found = yield* repo.findById(FIXTURES.WORKER_1)
        return { deleted, found }
      }).pipe(Effect.provide(layer))
    )

    expect(result.deleted).toBe(true)
    expect(result.found).toBeNull()
  })

  it("returns false for nonexistent worker", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        return yield* repo.delete("nonexistent-worker")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(false)
  })
})

// =============================================================================
// WorkerRepository.findById Tests
// =============================================================================

describe("WorkerRepository.findById", () => {
  it("returns worker by ID", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const worker = createWorkerData(FIXTURES.WORKER_1, { name: "find-test-worker" })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        yield* repo.insert(worker)
        return yield* repo.findById(FIXTURES.WORKER_1)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.id).toBe(FIXTURES.WORKER_1)
    expect(result!.name).toBe("find-test-worker")
  })

  it("returns null for nonexistent ID", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        return yield* repo.findById("nonexistent-id")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// WorkerRepository.findByStatus Tests
// =============================================================================

describe("WorkerRepository.findByStatus", () => {
  it("filters workers by status", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository

        yield* repo.insert(createWorkerData(FIXTURES.WORKER_1, { status: "idle" }))
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_2, { status: "busy" }))
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_3, { status: "idle" }))

        return yield* repo.findByStatus("idle")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    const ids = result.map(w => w.id)
    expect(ids).toContain(FIXTURES.WORKER_1)
    expect(ids).toContain(FIXTURES.WORKER_3)
  })

  it("returns empty array when no workers match status", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_1, { status: "idle" }))
        return yield* repo.findByStatus("dead")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toEqual([])
  })
})

// =============================================================================
// WorkerRepository.findByLastHeartbeatBefore Tests
// =============================================================================

describe("WorkerRepository.findByLastHeartbeatBefore", () => {
  it("finds stale workers", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const now = new Date()
    const oldTime = new Date(now.getTime() - 60000) // 1 minute ago
    const veryOldTime = new Date(now.getTime() - 120000) // 2 minutes ago

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository

        yield* repo.insert(createWorkerData(FIXTURES.WORKER_1, { lastHeartbeatAt: veryOldTime }))
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_2, { lastHeartbeatAt: oldTime }))
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_3, { lastHeartbeatAt: now }))

        // Find workers with heartbeat before 30 seconds ago
        const threshold = new Date(now.getTime() - 30000)
        return yield* repo.findByLastHeartbeatBefore(threshold)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    const ids = result.map(w => w.id)
    expect(ids).toContain(FIXTURES.WORKER_1)
    expect(ids).toContain(FIXTURES.WORKER_2)
  })

  it("returns workers sorted by last heartbeat ASC", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const now = new Date()
    const time1 = new Date(now.getTime() - 60000)
    const time2 = new Date(now.getTime() - 30000)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository

        yield* repo.insert(createWorkerData(FIXTURES.WORKER_1, { lastHeartbeatAt: time2 }))
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_2, { lastHeartbeatAt: time1 }))

        return yield* repo.findByLastHeartbeatBefore(now)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    // Should be sorted by last_heartbeat_at ASC (oldest first)
    expect(result[0].id).toBe(FIXTURES.WORKER_2)
    expect(result[1].id).toBe(FIXTURES.WORKER_1)
  })
})

// =============================================================================
// WorkerRepository.countByStatus Tests
// =============================================================================

describe("WorkerRepository.countByStatus", () => {
  it("counts workers by status", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository

        yield* repo.insert(createWorkerData(FIXTURES.WORKER_1, { status: "idle" }))
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_2, { status: "idle" }))
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_3, { status: "busy" }))

        return yield* repo.countByStatus("idle")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(2)
  })

  it("returns 0 when no workers match status", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        yield* repo.insert(createWorkerData(FIXTURES.WORKER_1, { status: "idle" }))
        return yield* repo.countByStatus("dead")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(0)
  })

  it("returns 0 when no workers exist", async () => {
    const { WorkerRepository, WorkerRepositoryLive, SqliteClientLive } = await import("@jamesaphoenix/tx-core")

    const infra = SqliteClientLive(":memory:")
    const layer = WorkerRepositoryLive.pipe(Layer.provide(infra))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* WorkerRepository
        return yield* repo.countByStatus("idle")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(0)
  })
})
