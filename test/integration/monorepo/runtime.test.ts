/**
 * Runtime Integration Tests
 *
 * Verifies that the monorepo apps work correctly at runtime:
 * - CLI can create and list tasks using @tx/core
 * - MCP server can initialize runtime and run effects
 * - API server can initialize runtime and handle requests
 *
 * Uses real SQLite databases (in-memory) for true integration testing.
 * Uses SHA256-based fixture IDs per Rule 3.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import type { TaskId } from "@tx/types"

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
  it("can create layer with in-memory database", async () => {
    const { makeAppLayer } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")
    expect(layer).toBeDefined()
  })

  it("can run TaskService.create through layer", async () => {
    const { makeAppLayer, TaskService } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({
          title: "Test task from core",
          score: 500,
        })
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toMatch(/^tx-[a-z0-9]{8}$/)
    expect(task.title).toBe("Test task from core")
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(500)
  })

  it("can run TaskService.list through layer", async () => {
    const { makeAppLayer, TaskService } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")

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
    const { makeAppLayer, TaskService, ReadyService } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")

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
    const { makeAppLayer, TaskService, DependencyService } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")

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
    const { makeAppLayer, LearningService } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")

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
    const { makeAppLayer, TaskService, SyncService } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")

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
    const { TaskService } = await import("@tx/core")

    await initRuntime(":memory:")

    const task = await runEffect(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "MCP test task" })
      })
    )

    expect(task.title).toBe("MCP test task")
    expect(task.id).toMatch(/^tx-[a-z0-9]{8}$/)
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
  let initRuntime: typeof import("@tx/api-server").initRuntime
  let disposeRuntime: typeof import("@tx/api-server").disposeRuntime
  let runEffect: typeof import("@tx/api-server").runEffect
  let getRuntime: typeof import("@tx/api-server").getRuntime
  let getDbPath: typeof import("@tx/api-server").getDbPath
  let createApp: typeof import("@tx/api-server").createApp

  beforeEach(async () => {
    const api = await import("@tx/api-server")
    initRuntime = api.initRuntime
    disposeRuntime = api.disposeRuntime
    runEffect = api.runEffect
    getRuntime = api.getRuntime
    getDbPath = api.getDbPath
    createApp = api.createApp
  })

  afterEach(async () => {
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
    // getDbPath returns the configured path (may differ from :memory: if module caches state)
    expect(getDbPath()).toBeDefined()
  })

  it("can run effects after initialization", async () => {
    const { TaskService } = await import("@tx/core")

    await initRuntime(":memory:")

    const task = await runEffect(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "API test task" })
      })
    )

    expect(task.title).toBe("API test task")
  })

  it("can create Hono app instance", async () => {
    const app = createApp()
    expect(app).toBeDefined()
    expect(typeof app.fetch).toBe("function")
  })

  it("app has health endpoint", async () => {
    await initRuntime(":memory:")
    const app = createApp()

    const response = await app.fetch(
      new Request("http://localhost/health")
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe("healthy")
  })

  it("app has OpenAPI documentation", async () => {
    await initRuntime(":memory:")
    const app = createApp()

    const response = await app.fetch(
      new Request("http://localhost/api/openapi.json")
    )

    expect(response.status).toBe(200)
    const spec = await response.json()
    expect(spec.openapi).toBe("3.1.0")
    expect(spec.info.title).toBe("TX API")
  })

  it("disposeRuntime cleans up correctly", async () => {
    await initRuntime(":memory:")
    expect(getRuntime()).not.toBeNull()

    await disposeRuntime()
    expect(getRuntime()).toBeNull()
    expect(getDbPath()).toBeNull()
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

    expect(task.id).toMatch(/^tx-[a-z0-9]{8}$/)
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
  it("@tx/types exports match @tx/agent-sdk exports", async () => {
    const types = await import("@tx/types")
    const sdk = await import("@tx/agent-sdk")

    // Both should have the same task statuses
    expect(types.TASK_STATUSES).toEqual(sdk.TASK_STATUSES)
    expect(types.VALID_TRANSITIONS).toEqual(sdk.VALID_TRANSITIONS)
    expect(types.LEARNING_SOURCE_TYPES).toEqual(sdk.LEARNING_SOURCE_TYPES)
    expect(types.ATTEMPT_OUTCOMES).toEqual(sdk.ATTEMPT_OUTCOMES)
  })

  it("fixture IDs are deterministic across packages", async () => {
    const { fixtureId: coreFixtureId } = await import("@tx/core")

    // Our test fixture ID should be consistent with core's fixtureId
    const testId = coreFixtureId("test-id")
    const testId2 = coreFixtureId("test-id")
    expect(testId).toBe(testId2)
    expect(testId).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("services work consistently across initialization methods", async () => {
    const { makeAppLayer, TaskService } = await import("@tx/core")

    // Test 1: Direct layer creation
    const layer1 = makeAppLayer(":memory:")
    const task1 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "Layer test task" })
      }).pipe(Effect.provide(layer1))
    )
    expect(task1.title).toBe("Layer test task")

    // Test 2: MCP runtime
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

    // Test 3: API runtime
    const {
      initRuntime: initApiRuntime,
      runEffect: runApiEffect,
      disposeRuntime: disposeApiRuntime,
    } = await import("@tx/api-server")
    await initApiRuntime(":memory:")
    const task3 = await runApiEffect(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "API runtime test task" })
      })
    )
    expect(task3.title).toBe("API runtime test task")
    await disposeApiRuntime()

    // All tasks should have valid IDs
    expect(task1.id).toMatch(/^tx-[a-z0-9]{8}$/)
    expect(task2.id).toMatch(/^tx-[a-z0-9]{8}$/)
    expect(task3.id).toMatch(/^tx-[a-z0-9]{8}$/)
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("Error Handling Across Packages", () => {
  it("@tx/core errors are properly typed", async () => {
    const { makeAppLayer, TaskService } = await import("@tx/core")

    const layer = makeAppLayer(":memory:")

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
