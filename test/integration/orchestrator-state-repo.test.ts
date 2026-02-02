/**
 * OrchestratorStateRepository Integration Tests
 *
 * Tests the OrchestratorStateRepository at the repository layer with full dependency injection.
 * Uses real SQLite database (in-memory) per Rule 3.
 *
 * @see PRD-018 for worker orchestration specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"

// =============================================================================
// Helper: Setup layer with required dependencies
// =============================================================================

async function makeTestLayer() {
  const { OrchestratorStateRepositoryLive, SqliteClientLive } = await import("@tx/core")

  const infra = SqliteClientLive(":memory:")
  const layer = OrchestratorStateRepositoryLive.pipe(Layer.provide(infra))
  return layer
}

// =============================================================================
// OrchestratorStateRepository.get Tests
// =============================================================================

describe("OrchestratorStateRepository.get", () => {
  it("returns singleton state", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    // Singleton initialized with defaults
    expect(result.status).toBe("stopped")
    expect(result.pid).toBeNull()
    expect(result.startedAt).toBeNull()
    expect(result.lastReconcileAt).toBeNull()
    expect(result.workerPoolSize).toBe(1)
    expect(result.reconcileIntervalSeconds).toBe(60)
    expect(result.heartbeatIntervalSeconds).toBe(30)
    expect(result.leaseDurationMinutes).toBe(30)
    expect(result.metadata).toEqual({})
  })

  it("initializes singleton if needed", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    // First call should initialize
    const result1 = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    // Second call should return same state
    const result2 = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result1.status).toBe(result2.status)
    expect(result1.workerPoolSize).toBe(result2.workerPoolSize)
  })
})

// =============================================================================
// OrchestratorStateRepository.update Tests
// =============================================================================

describe("OrchestratorStateRepository.update", () => {
  it("updates status field", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ status: "running" })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("running")
  })

  it("updates pid field", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ pid: 12345 })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.pid).toBe(12345)
  })

  it("updates startedAt timestamp", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const startedAt = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ startedAt })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.startedAt).not.toBeNull()
    expect(result.startedAt!.getTime()).toBeCloseTo(startedAt.getTime(), -3)
  })

  it("updates lastReconcileAt timestamp", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const lastReconcileAt = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ lastReconcileAt })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.lastReconcileAt).not.toBeNull()
    expect(result.lastReconcileAt!.getTime()).toBeCloseTo(lastReconcileAt.getTime(), -3)
  })

  it("updates configuration fields (workerPoolSize)", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ workerPoolSize: 5 })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.workerPoolSize).toBe(5)
  })

  it("updates reconcileIntervalSeconds", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ reconcileIntervalSeconds: 120 })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.reconcileIntervalSeconds).toBe(120)
  })

  it("updates heartbeatIntervalSeconds", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ heartbeatIntervalSeconds: 15 })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.heartbeatIntervalSeconds).toBe(15)
  })

  it("updates leaseDurationMinutes", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ leaseDurationMinutes: 60 })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.leaseDurationMinutes).toBe(60)
  })

  it("updates metadata field", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ metadata: { version: "1.0.0", environment: "test" } })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.metadata).toEqual({ version: "1.0.0", environment: "test" })
  })

  it("updates multiple fields at once", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const now = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({
          status: "running",
          pid: 5678,
          startedAt: now,
          workerPoolSize: 3,
          reconcileIntervalSeconds: 90
        })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("running")
    expect(result.pid).toBe(5678)
    expect(result.startedAt).not.toBeNull()
    expect(result.workerPoolSize).toBe(3)
    expect(result.reconcileIntervalSeconds).toBe(90)
  })

  it("does nothing when no fields provided", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const { initial, result } = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        // Get initial state
        const initial = yield* repo.get()
        // Update with empty object
        yield* repo.update({})
        // Verify nothing changed
        const result = yield* repo.get()
        return { initial, result }
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe(initial.status)
    expect(result.pid).toBe(initial.pid)
    expect(result.workerPoolSize).toBe(initial.workerPoolSize)
  })

  it("can set null values for nullable fields", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        // First set values
        yield* repo.update({
          pid: 12345,
          startedAt: new Date(),
          lastReconcileAt: new Date()
        })
        // Then set them back to null
        yield* repo.update({
          pid: null,
          startedAt: null,
          lastReconcileAt: null
        })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.pid).toBeNull()
    expect(result.startedAt).toBeNull()
    expect(result.lastReconcileAt).toBeNull()
  })
})

// =============================================================================
// Singleton Pattern Tests
// =============================================================================

describe("OrchestratorStateRepository singleton pattern", () => {
  it("always returns the same row (id=1)", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    // Multiple get calls should return consistent state
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository

        const r1 = yield* repo.get()
        yield* repo.update({ status: "starting" })
        const r2 = yield* repo.get()
        yield* repo.update({ status: "running" })
        const r3 = yield* repo.get()

        return { r1, r2, r3 }
      }).pipe(Effect.provide(layer))
    )

    // All should reflect singleton state at time of read
    expect(results.r1.status).toBe("stopped")
    expect(results.r2.status).toBe("starting")
    expect(results.r3.status).toBe("running")
  })

  it("updates affect subsequent get calls", async () => {
    const { OrchestratorStateRepository } = await import("@tx/core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* OrchestratorStateRepository
        yield* repo.update({ workerPoolSize: 10 })
        return yield* repo.get()
      }).pipe(Effect.provide(layer))
    )

    expect(result.workerPoolSize).toBe(10)
  })
})
