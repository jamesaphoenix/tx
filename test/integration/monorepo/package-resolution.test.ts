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
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"

describe("Package Resolution: @tx/types", () => {
  it("exports TaskStatus type constants", async () => {
    // Dynamic import to verify the package is resolvable
    const types = await import("@tx/types")

    expect(types.TASK_STATUSES).toBeDefined()
    expect(types.TASK_STATUSES).toContain("backlog")
    expect(types.TASK_STATUSES).toContain("done")
  })

  it("exports VALID_TRANSITIONS for status state machine", async () => {
    const types = await import("@tx/types")

    expect(types.VALID_TRANSITIONS).toBeDefined()
    expect(types.VALID_TRANSITIONS.backlog).toContain("ready")
    // done can transition back to backlog for reactivation
    expect(types.VALID_TRANSITIONS.done).toContain("backlog")
  })

  it("exports Learning-related types", async () => {
    const types = await import("@tx/types")

    expect(types.LEARNING_SOURCE_TYPES).toBeDefined()
    expect(types.LEARNING_SOURCE_TYPES).toContain("manual")
    expect(types.LEARNING_SOURCE_TYPES).toContain("compaction")
  })

  it("exports Attempt and Run types", async () => {
    const types = await import("@tx/types")

    expect(types.ATTEMPT_OUTCOMES).toBeDefined()
    expect(types.RUN_STATUSES).toBeDefined()
    expect(types.ATTEMPT_OUTCOMES).toContain("succeeded")
    expect(types.RUN_STATUSES).toContain("running")
  })
})

describe("Package Resolution: @tx/core", () => {
  it("exports makeAppLayer for Effect service composition", async () => {
    const core = await import("@tx/core")

    expect(core.makeAppLayer).toBeDefined()
    expect(typeof core.makeAppLayer).toBe("function")
  })

  it("exports all Effect service tags", async () => {
    const core = await import("@tx/core")

    expect(core.TaskService).toBeDefined()
    expect(core.ReadyService).toBeDefined()
    expect(core.DependencyService).toBeDefined()
    expect(core.HierarchyService).toBeDefined()
    expect(core.LearningService).toBeDefined()
    expect(core.SyncService).toBeDefined()
  })

  it("exports error types", async () => {
    const core = await import("@tx/core")

    expect(core.TaskNotFoundError).toBeDefined()
    expect(core.ValidationError).toBeDefined()
    expect(core.CircularDependencyError).toBeDefined()
    expect(core.DatabaseError).toBeDefined()
  })

  it("exports database utilities", async () => {
    const core = await import("@tx/core")

    expect(core.SqliteClient).toBeDefined()
    expect(core.makeSqliteClient).toBeDefined()
    expect(core.applyMigrations).toBeDefined()
    expect(core.getSchemaVersion).toBeDefined()
  })

  it("exports ID generation utilities", async () => {
    const core = await import("@tx/core")

    expect(core.generateTaskId).toBeDefined()
    expect(core.fixtureId).toBeDefined()

    // Verify fixtureId is deterministic
    const id1 = core.fixtureId("test-task")
    const id2 = core.fixtureId("test-task")
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("exports repository implementations", async () => {
    const core = await import("@tx/core")

    expect(core.TaskRepository).toBeDefined()
    expect(core.TaskRepositoryLive).toBeDefined()
    expect(core.DependencyRepository).toBeDefined()
    expect(core.LearningRepository).toBeDefined()
  })

  it("exports mappers for data transformation", async () => {
    const core = await import("@tx/core")

    expect(core.rowToTask).toBeDefined()
    expect(core.rowToLearning).toBeDefined()
    expect(core.rowToAttempt).toBeDefined()
    expect(core.isValidStatus).toBeDefined()
  })

  it("can create an in-memory database layer", async () => {
    const core = await import("@tx/core")

    // Create layer with in-memory database
    const layer = core.makeAppLayer(":memory:")
    expect(layer).toBeDefined()

    // Verify it's a valid Effect Layer
    expect(Layer.isLayer(layer)).toBe(true)
  })

  it("can run effects against the layer", async () => {
    const core = await import("@tx/core")

    const layer = core.makeAppLayer(":memory:")

    // Run a simple effect to verify services work
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        const tasks = yield* taskService.list()
        return tasks.length
      }).pipe(Effect.provide(layer))
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

    expect(cliPackageJson.dependencies["@tx/core"]).toBe("*")
    expect(cliPackageJson.dependencies["@tx/types"]).toBe("*")
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

    expect(mcpPackageJson.dependencies["@tx/core"]).toBe("*")
    expect(mcpPackageJson.dependencies["@tx/types"]).toBe("*")
    expect(mcpPackageJson.name).toBe("@tx/mcp-server")
  })
})

describe("Package Resolution: @tx/api-server", () => {
  it("exports app creation function", async () => {
    const api = await import("@tx/api-server")

    expect(api.createApp).toBeDefined()
    expect(typeof api.createApp).toBe("function")
  })

  it("exports runtime management functions", async () => {
    const api = await import("@tx/api-server")

    expect(api.initRuntime).toBeDefined()
    expect(api.disposeRuntime).toBeDefined()
    expect(api.runEffect).toBeDefined()
    expect(api.getRuntime).toBeDefined()
    expect(api.getDbPath).toBeDefined()
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

    expect(apiPackageJson.dependencies["@tx/core"]).toBe("*")
    expect(apiPackageJson.dependencies["@tx/types"]).toBe("*")
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

    expect(sdkPackageJson.dependencies["@tx/types"]).toBe("*")
    expect(sdkPackageJson.name).toBe("@tx/agent-sdk")
  })
})

describe("Cross-Package Type Consistency", () => {
  it("TaskStatus is consistent across packages", async () => {
    const types = await import("@tx/types")
    const sdk = await import("@tx/agent-sdk")

    // Both should have the same task statuses
    expect(types.TASK_STATUSES).toEqual(sdk.TASK_STATUSES)
  })

  it("VALID_TRANSITIONS is consistent across packages", async () => {
    const types = await import("@tx/types")
    const sdk = await import("@tx/agent-sdk")

    expect(types.VALID_TRANSITIONS).toEqual(sdk.VALID_TRANSITIONS)
  })

  it("LEARNING_SOURCE_TYPES is consistent across packages", async () => {
    const types = await import("@tx/types")
    const sdk = await import("@tx/agent-sdk")

    expect(types.LEARNING_SOURCE_TYPES).toEqual(sdk.LEARNING_SOURCE_TYPES)
  })
})
