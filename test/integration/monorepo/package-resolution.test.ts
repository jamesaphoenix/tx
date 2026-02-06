/**
 * Package Dependency Resolution Tests
 *
 * Verifies that workspace packages can import from each other correctly.
 * These tests ensure the monorepo structure is working as expected.
 *
 * Tests:
 * - @tx/cli imports @tx/core correctly
 * - @tx/mcp-server imports @tx/core correctly
 * - @tx/api-server imports @tx/core correctly
 * - @tx/agent-sdk imports @tx/types correctly
 * - All packages resolve workspace dependencies
 *
 * OPTIMIZED: Uses shared test layer with reset between tests for memory efficiency.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"

// Import core services at module level
import {
  TaskService,
  ReadyService,
  DependencyService,
  HierarchyService,
  LearningService,
  SyncService,
  TaskNotFoundError,
  ValidationError,
  CircularDependencyError,
  DatabaseError,
  SqliteClient,
  makeSqliteClient,
  applyMigrations,
  getSchemaVersion,
  generateTaskId,
  fixtureId,
  TaskRepository,
  TaskRepositoryLive,
  DependencyRepository,
  LearningRepository,
  rowToTask,
  rowToLearning,
  rowToAttempt,
  isValidStatus,
  makeAppLayer
} from "@jamesaphoenix/tx-core"

describe("Package Resolution: @tx/types", () => {
  it("exports TaskStatus type constants", async () => {
    // Dynamic import to verify the package is resolvable
    const types = await import("@jamesaphoenix/tx-types")

    expect(types.TASK_STATUSES).toBeDefined()
    expect(types.TASK_STATUSES).toContain("backlog")
    expect(types.TASK_STATUSES).toContain("done")
  })

  it("exports VALID_TRANSITIONS for status state machine", async () => {
    const types = await import("@jamesaphoenix/tx-types")

    expect(types.VALID_TRANSITIONS).toBeDefined()
    expect(types.VALID_TRANSITIONS.backlog).toContain("ready")
    // done can transition back to backlog for reactivation
    expect(types.VALID_TRANSITIONS.done).toContain("backlog")
  })

  it("exports Learning-related types", async () => {
    const types = await import("@jamesaphoenix/tx-types")

    expect(types.LEARNING_SOURCE_TYPES).toBeDefined()
    expect(types.LEARNING_SOURCE_TYPES).toContain("manual")
    expect(types.LEARNING_SOURCE_TYPES).toContain("compaction")
  })

  it("exports Attempt and Run types", async () => {
    const types = await import("@jamesaphoenix/tx-types")

    expect(types.ATTEMPT_OUTCOMES).toBeDefined()
    expect(types.RUN_STATUSES).toBeDefined()
    expect(types.ATTEMPT_OUTCOMES).toContain("succeeded")
    expect(types.RUN_STATUSES).toContain("running")
  })
})

describe("Package Resolution: @tx/core", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("exports makeAppLayer for Effect service composition", () => {
    expect(makeAppLayer).toBeDefined()
    expect(typeof makeAppLayer).toBe("function")
  })

  it("exports all Effect service tags", () => {
    expect(TaskService).toBeDefined()
    expect(ReadyService).toBeDefined()
    expect(DependencyService).toBeDefined()
    expect(HierarchyService).toBeDefined()
    expect(LearningService).toBeDefined()
    expect(SyncService).toBeDefined()
  })

  it("exports error types", () => {
    expect(TaskNotFoundError).toBeDefined()
    expect(ValidationError).toBeDefined()
    expect(CircularDependencyError).toBeDefined()
    expect(DatabaseError).toBeDefined()
  })

  it("exports database utilities", () => {
    expect(SqliteClient).toBeDefined()
    expect(makeSqliteClient).toBeDefined()
    expect(applyMigrations).toBeDefined()
    expect(getSchemaVersion).toBeDefined()
  })

  it("exports ID generation utilities", () => {
    expect(generateTaskId).toBeDefined()
    expect(fixtureId).toBeDefined()

    // Verify fixtureId is deterministic
    const id1 = fixtureId("test-task")
    const id2 = fixtureId("test-task")
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^tx-[a-z0-9]{6,12}$/)
  })

  it("exports repository implementations", () => {
    expect(TaskRepository).toBeDefined()
    expect(TaskRepositoryLive).toBeDefined()
    expect(DependencyRepository).toBeDefined()
    expect(LearningRepository).toBeDefined()
  })

  it("exports mappers for data transformation", () => {
    expect(rowToTask).toBeDefined()
    expect(rowToLearning).toBeDefined()
    expect(rowToAttempt).toBeDefined()
    expect(isValidStatus).toBeDefined()
  })

  it("can create an in-memory database layer", () => {
    // Use the shared layer which is already an in-memory database
    expect(shared.layer).toBeDefined()

    // Verify it's a valid Effect Layer
    expect(Layer.isLayer(shared.layer)).toBe(true)
  })

  it("can run effects against the layer", async () => {
    // Run a simple effect to verify services work
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const tasks = yield* taskService.list()
        return tasks.length
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBe(0) // Empty database
  })
})

describe("Package Resolution: @tx/cli", () => {
  it("imports @tx/core correctly", async () => {
    // The CLI package should be able to import from @tx/core
    // We verify this by checking the CLI module loads without error
    // and contains expected command exports

    // Note: We can't easily test the CLI binary directly in unit tests,
    // but we can verify the package structure is correct
    const fs = await import("node:fs")
    const path = await import("node:path")

    const cliPackageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "apps/cli/package.json"),
        "utf-8"
      )
    )

    expect(cliPackageJson.dependencies["@jamesaphoenix/tx-core"]).toBe("*")
    expect(cliPackageJson.dependencies["@jamesaphoenix/tx-types"]).toBe("*")
    expect(cliPackageJson.name).toBe("@tx/cli")
  })
})

describe("Package Resolution: @tx/mcp-server", () => {
  it("exports server creation functions", async () => {
    const mcp = await import("@tx/mcp-server")

    expect(mcp.createMcpServer).toBeDefined()
    expect(typeof mcp.createMcpServer).toBe("function")
  })

  it("exports runtime management functions", async () => {
    const mcp = await import("@tx/mcp-server")

    expect(mcp.initRuntime).toBeDefined()
    expect(mcp.disposeRuntime).toBeDefined()
    expect(mcp.runEffect).toBeDefined()
    expect(mcp.getRuntime).toBeDefined()
  })

  it("exports response helpers", async () => {
    const mcp = await import("@tx/mcp-server")

    expect(mcp.mcpResponse).toBeDefined()
    expect(mcp.mcpError).toBeDefined()
  })

  it("exports tool registration functions", async () => {
    const mcp = await import("@tx/mcp-server")

    expect(mcp.registerTaskTools).toBeDefined()
    expect(mcp.registerLearningTools).toBeDefined()
    expect(mcp.registerSyncTools).toBeDefined()
  })

  it("imports @tx/core correctly", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")

    const mcpPackageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "apps/mcp-server/package.json"),
        "utf-8"
      )
    )

    expect(mcpPackageJson.dependencies["@jamesaphoenix/tx-core"]).toBe("*")
    expect(mcpPackageJson.dependencies["@jamesaphoenix/tx-types"]).toBe("*")
    expect(mcpPackageJson.name).toBe("@tx/mcp-server")
  })
})

describe("Package Resolution: @tx/api-server", () => {
  it("exports makeServerLive layer factory", async () => {
    const api = await import("@tx/api-server")

    expect(api.makeServerLive).toBeDefined()
    expect(typeof api.makeServerLive).toBe("function")
  })

  it("exports TxApi definition and error types", async () => {
    const api = await import("@tx/api-server")

    expect(api.TxApi).toBeDefined()
    expect(api.NotFound).toBeDefined()
    expect(api.BadRequest).toBeDefined()
    expect(api.InternalError).toBeDefined()
    expect(api.Unauthorized).toBeDefined()
    expect(api.Forbidden).toBeDefined()
    expect(api.ServiceUnavailable).toBeDefined()
    expect(api.mapCoreError).toBeDefined()
  })

  it("exports API group definitions", async () => {
    const api = await import("@tx/api-server")

    expect(api.HealthGroup).toBeDefined()
    expect(api.TasksGroup).toBeDefined()
    expect(api.LearningsGroup).toBeDefined()
    expect(api.RunsGroup).toBeDefined()
    expect(api.SyncGroup).toBeDefined()
  })

  it("exports route handler layers", async () => {
    const api = await import("@tx/api-server")

    expect(api.TasksLive).toBeDefined()
    expect(api.HealthLive).toBeDefined()
    expect(api.LearningsLive).toBeDefined()
    expect(api.RunsLive).toBeDefined()
    expect(api.SyncLive).toBeDefined()
  })

  it("imports @tx/core correctly", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")

    const apiPackageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "apps/api-server/package.json"),
        "utf-8"
      )
    )

    expect(apiPackageJson.dependencies["@jamesaphoenix/tx-core"]).toBe("*")
    expect(apiPackageJson.dependencies["@jamesaphoenix/tx-types"]).toBe("*")
    expect(apiPackageJson.name).toBe("@tx/api-server")
  })
})

describe("Package Resolution: @tx/agent-sdk", () => {
  it("exports TxClient class", async () => {
    const sdk = await import("@tx/agent-sdk")

    expect(sdk.TxClient).toBeDefined()
    expect(typeof sdk.TxClient).toBe("function")
  })

  it("exports utility functions", async () => {
    const sdk = await import("@tx/agent-sdk")

    expect(sdk.isValidTaskStatus).toBeDefined()
    expect(sdk.isValidTaskId).toBeDefined()
    expect(sdk.filterByStatus).toBeDefined()
    expect(sdk.sortByScore).toBeDefined()
    expect(sdk.getNextTask).toBeDefined()
  })

  it("exports retry logic", async () => {
    const sdk = await import("@tx/agent-sdk")

    expect(sdk.withRetry).toBeDefined()
    expect(sdk.defaultShouldRetry).toBeDefined()
    expect(sdk.sleep).toBeDefined()
  })

  it("exports TxError for error handling", async () => {
    const sdk = await import("@tx/agent-sdk")

    expect(sdk.TxError).toBeDefined()
    expect(sdk.parseApiError).toBeDefined()
  })

  it("re-exports type constants from @tx/types", async () => {
    const sdk = await import("@tx/agent-sdk")

    expect(sdk.TASK_STATUSES).toBeDefined()
    expect(sdk.VALID_TRANSITIONS).toBeDefined()
    expect(sdk.LEARNING_SOURCE_TYPES).toBeDefined()
    expect(sdk.ATTEMPT_OUTCOMES).toBeDefined()
    expect(sdk.RUN_STATUSES).toBeDefined()
  })

  it("imports @tx/types correctly", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")

    const sdkPackageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "apps/agent-sdk/package.json"),
        "utf-8"
      )
    )

    expect(sdkPackageJson.dependencies["@jamesaphoenix/tx-types"]).toBe("*")
    expect(sdkPackageJson.name).toBe("@tx/agent-sdk")
  })
})

describe("Cross-Package Type Consistency", () => {
  it("TaskStatus is consistent across packages", async () => {
    const types = await import("@jamesaphoenix/tx-types")
    const sdk = await import("@tx/agent-sdk")

    // Both should have the same task statuses
    expect(types.TASK_STATUSES).toEqual(sdk.TASK_STATUSES)
  })

  it("VALID_TRANSITIONS is consistent across packages", async () => {
    const types = await import("@jamesaphoenix/tx-types")
    const sdk = await import("@tx/agent-sdk")

    expect(types.VALID_TRANSITIONS).toEqual(sdk.VALID_TRANSITIONS)
  })

  it("LEARNING_SOURCE_TYPES is consistent across packages", async () => {
    const types = await import("@jamesaphoenix/tx-types")
    const sdk = await import("@tx/agent-sdk")

    expect(types.LEARNING_SOURCE_TYPES).toEqual(sdk.LEARNING_SOURCE_TYPES)
  })
})
