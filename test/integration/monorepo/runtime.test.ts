/**
 * Runtime Integration Tests
 *
 * Verifies that the monorepo apps work correctly at runtime:
 * - CLI can create and list tasks using @tx/core
 * - MCP server can initialize runtime and run effects
 * - API server exports Effect HTTP platform layers and definitions
 *
 * Uses real SQLite databases (in-memory) for true integration testing.
 * Uses SHA256-based fixture IDs per Rule 3.
 *
 * OPTIMIZED: Uses global singleton test layer per RULE 8 for memory efficiency.
 * Database reset is handled via afterEach hooks in each describe block.
 * MCP/API runtime tests use their own :memory: databases to test initialization APIs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { getSharedTestLayer } from "@jamesaphoenix/tx-test-utils"
import type { TaskId } from "@jamesaphoenix/tx-types"

// Import services once at module level
import {
  TaskService,
  ReadyService,
  DependencyService,
  LearningService,
  SyncService,
  fixtureId as coreFixtureId,
} from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): TaskId => {
  const hash = createHash("sha256")
    .update(`monorepo-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}` as TaskId
}

// Fixture IDs for this test file
const FIXTURES = {
  CLI_TASK: fixtureId("cli-task"),
  MCP_TASK: fixtureId("mcp-task"),
  API_TASK: fixtureId("api-task"),
} as const

// Export to prevent unused warning (used for consistent test patterns)
void FIXTURES

// =============================================================================
// @tx/core Runtime Tests
// =============================================================================

describe("Runtime Integration: @tx/core", () => {
  // Reset shared DB between tests for isolation
  afterEach(async () => {
    const shared = await getSharedTestLayer()
    await shared.reset()
  })

  it("can create layer with in-memory database", async () => {
    const { layer } = await getSharedTestLayer()
    expect(layer).toBeDefined()
  })

  it("can run TaskService.create through layer", async () => {
    const { layer } = await getSharedTestLayer()
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({
          title: "Test task from core",
          score: 500,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
    expect(task.title).toBe("Test task from core")
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(500)
  })

  it("can run TaskService.list through layer", async () => {
    const { layer } = await getSharedTestLayer()
    // Create a task, then list
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        yield* svc.create({ title: "Task 1" })
        yield* svc.create({ title: "Task 2" })
        return yield* svc.list()
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    expect(result.map((t) => t.title)).toContain("Task 1")
    expect(result.map((t) => t.title)).toContain("Task 2")
  })

  it("can run ReadyService.getReady through layer", async () => {
    const { layer } = await getSharedTestLayer()
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        // Create tasks with ready-compatible status
        yield* taskSvc.create({ title: "Ready task 1", score: 700 })
        yield* taskSvc.create({ title: "Ready task 2", score: 600 })

        return yield* readySvc.getReady()
      }).pipe(Effect.provide(layer))
    )

    expect(ready.length).toBeGreaterThanOrEqual(2)
    // Should be sorted by score descending
    for (let i = 1; i < ready.length; i++) {
      expect(ready[i - 1].score).toBeGreaterThanOrEqual(ready[i].score)
    }
  })

  it("can run DependencyService.addBlocker through layer", async () => {
    const { layer } = await getSharedTestLayer()
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService

        const blocker = yield* taskSvc.create({ title: "Blocker task" })
        const blocked = yield* taskSvc.create({ title: "Blocked task" })

        yield* depSvc.addBlocker(blocked.id, blocker.id)

        // Verify dependency was created
        const blockedWithDeps = yield* taskSvc.getWithDeps(blocked.id)
        expect(blockedWithDeps.blockedBy).toContain(blocker.id)
        expect(blockedWithDeps.isReady).toBe(false)
      }).pipe(Effect.provide(layer))
    )
  })

  it("can run LearningService.create through layer", async () => {
    const { layer } = await getSharedTestLayer()
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* LearningService
        return yield* svc.create({
          content: "Test learning from monorepo integration test",
          sourceType: "manual",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(learning.id).toBeDefined()
    expect(learning.content).toBe("Test learning from monorepo integration test")
    expect(learning.sourceType).toBe("manual")
  })

  it("can run SyncService.export through layer", async () => {
    const { layer } = await getSharedTestLayer()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const syncSvc = yield* SyncService

        // Create some tasks
        yield* taskSvc.create({ title: "Export task 1" })
        yield* taskSvc.create({ title: "Export task 2" })

        return yield* syncSvc.export()
      }).pipe(Effect.provide(layer))
    )

    // Export writes to a file and returns the operation count and path
    expect(result.opCount).toBe(2)
    expect(result.path).toBeDefined()
  })
})

// =============================================================================
// @tx/mcp-server Runtime Tests
// =============================================================================

describe("Runtime Integration: @tx/mcp-server", () => {
  let initRuntime: typeof import("@tx/mcp-server").initRuntime
  let disposeRuntime: typeof import("@tx/mcp-server").disposeRuntime
  let runEffect: typeof import("@tx/mcp-server").runEffect
  let getRuntime: typeof import("@tx/mcp-server").getRuntime

  beforeEach(async () => {
    const mcp = await import("@tx/mcp-server")
    initRuntime = mcp.initRuntime
    disposeRuntime = mcp.disposeRuntime
    runEffect = mcp.runEffect
    getRuntime = mcp.getRuntime
  })

  afterEach(async () => {
    // Clean up runtime after each test
    try {
      await disposeRuntime()
    } catch {
      // Ignore errors during cleanup
    }
  })

  it("can initialize runtime with in-memory database", async () => {
    await initRuntime(":memory:")

    const runtime = getRuntime()
    expect(runtime).not.toBeNull()
  })

  it("can run effects after initialization", async () => {
    await initRuntime(":memory:")

    const task = await runEffect(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "MCP test task" })
      })
    )

    expect(task.title).toBe("MCP test task")
    expect(task.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
  })

  it("can create MCP server instance", async () => {
    const { createMcpServer } = await import("@tx/mcp-server")

    const server = createMcpServer()
    expect(server).toBeDefined()
  })

  it("MCP response helpers work correctly", async () => {
    const { mcpResponse, mcpError } = await import("@tx/mcp-server")

    const success = mcpResponse("Operation completed", { message: "Success" })
    expect(success.content).toBeDefined()
    expect(success.content[0].type).toBe("text")

    const error = mcpError(new Error("Something went wrong"))
    expect(error.isError).toBe(true)
    expect(error.content[0].text).toContain("Something went wrong")
  })

  it("disposeRuntime cleans up correctly", async () => {
    await initRuntime(":memory:")
    expect(getRuntime()).not.toBeNull()

    await disposeRuntime()
    expect(getRuntime()).toBeNull()
  })
})

// =============================================================================
// @tx/api-server Runtime Tests
// =============================================================================

describe("Runtime Integration: @tx/api-server", () => {
  it("exports makeServerLive factory function", async () => {
    const { makeServerLive } = await import("@tx/api-server")
    expect(makeServerLive).toBeDefined()
    expect(typeof makeServerLive).toBe("function")
  })

  it("exports TxApi definition", async () => {
    const { TxApi } = await import("@tx/api-server")
    expect(TxApi).toBeDefined()
  })

  it("exports all route handler layers", async () => {
    const { TasksLive, HealthLive, LearningsLive, RunsLive, SyncLive } =
      await import("@tx/api-server")
    expect(TasksLive).toBeDefined()
    expect(HealthLive).toBeDefined()
    expect(LearningsLive).toBeDefined()
    expect(RunsLive).toBeDefined()
    expect(SyncLive).toBeDefined()
  })

  it("exports all API group definitions", async () => {
    const { HealthGroup, TasksGroup, LearningsGroup, RunsGroup, SyncGroup } =
      await import("@tx/api-server")
    expect(HealthGroup).toBeDefined()
    expect(TasksGroup).toBeDefined()
    expect(LearningsGroup).toBeDefined()
    expect(RunsGroup).toBeDefined()
    expect(SyncGroup).toBeDefined()
  })

  it("exports all error types", async () => {
    const { NotFound, BadRequest, InternalError, Unauthorized, Forbidden, ServiceUnavailable } =
      await import("@tx/api-server")
    expect(NotFound).toBeDefined()
    expect(BadRequest).toBeDefined()
    expect(InternalError).toBeDefined()
    expect(Unauthorized).toBeDefined()
    expect(Forbidden).toBeDefined()
    expect(ServiceUnavailable).toBeDefined()
  })

  it("error types produce correct tagged errors", async () => {
    const { NotFound, BadRequest, InternalError } = await import("@tx/api-server")

    const notFound = new NotFound({ message: "Task not found" })
    expect(notFound._tag).toBe("NotFound")
    expect(notFound.message).toBe("Task not found")

    const badReq = new BadRequest({ message: "Invalid input" })
    expect(badReq._tag).toBe("BadRequest")
    expect(badReq.message).toBe("Invalid input")

    const internal = new InternalError({ message: "Server error" })
    expect(internal._tag).toBe("InternalError")
    expect(internal.message).toBe("Server error")
  })

  it("mapCoreError maps tagged errors correctly", async () => {
    const { mapCoreError } = await import("@tx/api-server")

    const notFound = mapCoreError({ _tag: "TaskNotFoundError", message: "Not found" })
    expect(notFound._tag).toBe("NotFound")

    const badReq = mapCoreError({ _tag: "ValidationError", message: "Bad" })
    expect(badReq._tag).toBe("BadRequest")

    const internal = mapCoreError({ _tag: "DatabaseError", message: "DB error" })
    expect(internal._tag).toBe("InternalError")

    const unavailable = mapCoreError({ _tag: "EmbeddingUnavailableError", message: "No model" })
    expect(unavailable._tag).toBe("ServiceUnavailable")
  })

  it("makeServerLive creates a Layer with options", async () => {
    const { makeServerLive } = await import("@tx/api-server")

    // Verify it accepts options and returns without throwing
    const layer = makeServerLive({ port: 0, dbPath: ":memory:" })
    expect(layer).toBeDefined()
  })
})

// =============================================================================
// @tx/agent-sdk Runtime Tests
// =============================================================================

describe("Runtime Integration: @tx/agent-sdk", () => {
  it("can create TxClient for direct DB access", async () => {
    const { TxClient } = await import("@tx/agent-sdk")

    const client = new TxClient({ dbPath: ":memory:" })
    expect(client).toBeDefined()
    expect(client.tasks).toBeDefined()
    expect(client.learnings).toBeDefined()
    expect(client.context).toBeDefined()
  })

  it("TxClient.tasks.create works with direct DB access", async () => {
    const { TxClient } = await import("@tx/agent-sdk")

    const client = new TxClient({ dbPath: ":memory:" })

    const task = await client.tasks.create({
      title: "SDK test task",
      score: 750,
    })

    expect(task.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
    expect(task.title).toBe("SDK test task")
    expect(task.score).toBe(750)
  })

  it("TxClient.tasks.ready works with direct DB access", async () => {
    const { TxClient } = await import("@tx/agent-sdk")

    const client = new TxClient({ dbPath: ":memory:" })

    // Create tasks
    await client.tasks.create({ title: "Task 1", score: 800 })
    await client.tasks.create({ title: "Task 2", score: 600 })

    const ready = await client.tasks.ready({ limit: 10 })

    expect(ready.length).toBeGreaterThanOrEqual(2)
    // Should be sorted by score descending
    for (let i = 1; i < ready.length; i++) {
      expect(ready[i - 1].score).toBeGreaterThanOrEqual(ready[i].score)
    }
  })

  it("TxClient.tasks.done marks task complete", async () => {
    const { TxClient } = await import("@tx/agent-sdk")

    const client = new TxClient({ dbPath: ":memory:" })

    const task = await client.tasks.create({ title: "Task to complete" })
    const result = await client.tasks.done(task.id)

    expect(result.task.status).toBe("done")
    expect(result.task.completedAt).toBeDefined()
  })

  it("TxClient.learnings.add works with direct DB access", async () => {
    const { TxClient } = await import("@tx/agent-sdk")

    const client = new TxClient({ dbPath: ":memory:" })

    const learning = await client.learnings.add({
      content: "SDK test learning",
      sourceType: "manual",
    })

    expect(learning.id).toBeDefined()
    expect(learning.content).toBe("SDK test learning")
  })

  it("utility functions work correctly", async () => {
    const {
      isValidTaskStatus,
      isValidTaskId,
      filterByStatus,
      sortByScore,
      getNextTask,
    } = await import("@tx/agent-sdk")

    // isValidTaskStatus
    expect(isValidTaskStatus("backlog")).toBe(true)
    expect(isValidTaskStatus("done")).toBe(true)
    expect(isValidTaskStatus("invalid")).toBe(false)

    // isValidTaskId
    expect(isValidTaskId("tx-abcd1234")).toBe(true)
    expect(isValidTaskId("invalid")).toBe(false)

    // filterByStatus
    const tasks = [
      { status: "backlog" },
      { status: "done" },
      { status: "backlog" },
    ] as any[]
    expect(filterByStatus(tasks, "backlog")).toHaveLength(2)
    expect(filterByStatus(tasks, "done")).toHaveLength(1)

    // sortByScore
    const unsorted = [{ score: 100 }, { score: 300 }, { score: 200 }] as any[]
    const sorted = sortByScore(unsorted)
    expect(sorted[0].score).toBe(300)
    expect(sorted[1].score).toBe(200)
    expect(sorted[2].score).toBe(100)

    // getNextTask
    const readyTasks = [
      { id: "tx-a", score: 100, isReady: true },
      { id: "tx-b", score: 300, isReady: true },
      { id: "tx-c", score: 200, isReady: false },
    ] as any[]
    const next = getNextTask(readyTasks)
    expect(next?.id).toBe("tx-b") // Highest score among ready
  })

  it("retry logic works correctly", async () => {
    const { withRetry } = await import("@tx/agent-sdk")

    let attempts = 0
    const fn = async () => {
      attempts++
      if (attempts < 3) {
        throw new Error("Transient error")
      }
      return "success"
    }

    // Custom shouldRetry to retry on all errors for this test
    const result = await withRetry(fn, {
      maxAttempts: 5,
      initialDelayMs: 10,
      shouldRetry: () => true,
    })

    expect(result).toBe("success")
    expect(attempts).toBe(3)
  })
})

// =============================================================================
// Cross-Package Integration Tests
// =============================================================================

describe("Cross-Package Integration", () => {
  afterEach(async () => {
    const shared = await getSharedTestLayer()
    await shared.reset()
  })

  it("@tx/types exports match @tx/agent-sdk exports", async () => {
    const types = await import("@jamesaphoenix/tx-types")
    const sdk = await import("@tx/agent-sdk")

    // Both should have the same task statuses
    expect(types.TASK_STATUSES).toEqual(sdk.TASK_STATUSES)
    expect(types.VALID_TRANSITIONS).toEqual(sdk.VALID_TRANSITIONS)
    expect(types.LEARNING_SOURCE_TYPES).toEqual(sdk.LEARNING_SOURCE_TYPES)
    expect(types.ATTEMPT_OUTCOMES).toEqual(sdk.ATTEMPT_OUTCOMES)
  })

  it("fixture IDs are deterministic across packages", async () => {
    // Our test fixture ID should be consistent with core's fixtureId
    const testId = coreFixtureId("test-id")
    const testId2 = coreFixtureId("test-id")
    expect(testId).toBe(testId2)
    expect(testId).toMatch(/^tx-[a-z0-9]{6,12}$/)
  })

  it("services work consistently across initialization methods", async () => {
    // Test 1: Shared singleton layer (per RULE 8)
    const { layer } = await getSharedTestLayer()
    const task1 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "Layer test task" })
      }).pipe(Effect.provide(layer))
    )
    expect(task1.title).toBe("Layer test task")

    // Test 2: MCP runtime (testing MCP server's initialization API)
    const { initRuntime, runEffect, disposeRuntime } = await import("@tx/mcp-server")
    await initRuntime(":memory:")
    const task2 = await runEffect(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "MCP runtime test task" })
      })
    )
    expect(task2.title).toBe("MCP runtime test task")
    await disposeRuntime()

    // Test 3: API server exports (api-server uses Effect HTTP platform,
    // no standalone runtime — verify makeServerLive is composable)
    const { makeServerLive } = await import("@tx/api-server")
    const serverLayer = makeServerLive({ port: 0, dbPath: ":memory:" })
    expect(serverLayer).toBeDefined()

    // All tasks should have valid IDs
    expect(task1.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
    expect(task2.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("Error Handling Across Packages", () => {
  afterEach(async () => {
    const shared = await getSharedTestLayer()
    await shared.reset()
  })

  it("@tx/core errors are properly typed", async () => {
    const { layer } = await getSharedTestLayer()
    // TaskNotFoundError
    const result1 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.get("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result1._tag).toBe("Left")
    if (result1._tag === "Left") {
      expect((result1.left as any)._tag).toBe("TaskNotFoundError")
    }

    // ValidationError for empty title
    const result2 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "" })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result2._tag).toBe("Left")
    if (result2._tag === "Left") {
      expect((result2.left as any)._tag).toBe("ValidationError")
    }
  })

  it("@tx/agent-sdk TxError works correctly", async () => {
    const { TxError } = await import("@tx/agent-sdk")

    const error = new TxError("Test error", "VALIDATION_ERROR", 400)
    expect(error.message).toBe("Test error")
    expect(error.code).toBe("VALIDATION_ERROR")
    expect(error.statusCode).toBe(400)

    // Test error type checks
    expect(error.isNotFound()).toBe(false)
    expect(error.isValidation()).toBe(true)
  })
})
