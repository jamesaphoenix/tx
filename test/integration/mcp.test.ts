/**
 * MCP Server Integration Tests
 *
 * Tests the MCP tool handlers to ensure they:
 * 1. Return TaskWithDeps with full dependency info (Rule 1)
 * 2. Work correctly with the Effect runtime
 * 3. Handle errors appropriately
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, ManagedRuntime, Layer } from "effect"
import Database from "better-sqlite3"
import { z } from "zod"

import { createTestDb, seedFixtures, FIXTURES } from "../fixtures.js"
import { SqliteClient } from "../../src/db.js"
import { TaskRepositoryLive } from "../../src/repo/task-repo.js"
import { DependencyRepositoryLive } from "../../src/repo/dep-repo.js"
import { TaskServiceLive, TaskService } from "../../src/services/task-service.js"
import { DependencyServiceLive, DependencyService } from "../../src/services/dep-service.js"
import { ReadyServiceLive, ReadyService } from "../../src/services/ready-service.js"
import { HierarchyServiceLive, HierarchyService } from "../../src/services/hierarchy-service.js"
import type { TaskId, TaskWithDeps } from "../../src/schema.js"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Services required by MCP tools */
export type McpTestServices = TaskService | ReadyService | DependencyService | HierarchyService

/** MCP tool response format */
export interface McpToolResponse {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

/** Parsed MCP response for easier testing */
export interface ParsedMcpResponse<T = unknown> {
  message: string
  data: T
  isError: boolean
}

// -----------------------------------------------------------------------------
// Test Runtime Factory
// -----------------------------------------------------------------------------

/**
 * Creates a ManagedRuntime configured with an in-memory test database.
 * Each call creates a fresh runtime with isolated state.
 *
 * @param db - Pre-configured Database instance (from createTestDb)
 * @returns ManagedRuntime ready to execute MCP tool Effects
 */
export function makeTestRuntime(db: InstanceType<typeof Database>): ManagedRuntime.ManagedRuntime<McpTestServices, never> {
  const infra = Layer.succeed(SqliteClient, db as Database.Database)

  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )

  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(
    Layer.provide(repos)
  )

  return ManagedRuntime.make(services)
}

// -----------------------------------------------------------------------------
// Tool Handler Registry
// -----------------------------------------------------------------------------

/** Schema definitions for each MCP tool's input parameters */
const toolSchemas = {
  tx_ready: z.object({
    limit: z.number().int().positive().optional()
  }),
  tx_show: z.object({
    id: z.string()
  }),
  tx_list: z.object({
    status: z.string().optional(),
    parentId: z.string().optional(),
    limit: z.number().int().positive().optional()
  }),
  tx_children: z.object({
    id: z.string()
  }),
  tx_add: z.object({
    title: z.string(),
    description: z.string().optional(),
    parentId: z.string().optional(),
    score: z.number().int().optional()
  }),
  tx_update: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    parentId: z.string().nullable().optional(),
    score: z.number().int().optional()
  }),
  tx_done: z.object({
    id: z.string()
  }),
  tx_delete: z.object({
    id: z.string()
  }),
  tx_block: z.object({
    taskId: z.string(),
    blockerId: z.string()
  }),
  tx_unblock: z.object({
    taskId: z.string(),
    blockerId: z.string()
  })
} as const

type ToolName = keyof typeof toolSchemas

// -----------------------------------------------------------------------------
// Tool Implementation
// -----------------------------------------------------------------------------

/**
 * Serialize a TaskWithDeps for JSON output.
 * Matches the serialization used in the actual MCP server.
 */
const serializeTask = (task: TaskWithDeps): Record<string, unknown> => ({
  id: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  parentId: task.parentId,
  score: task.score,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  completedAt: task.completedAt?.toISOString() ?? null,
  metadata: task.metadata,
  blockedBy: task.blockedBy,
  blocks: task.blocks,
  children: task.children,
  isReady: task.isReady
})

/**
 * Create the Effect for a specific MCP tool.
 * This mirrors the tool implementations in src/mcp/server.ts
 */
function createToolEffect(
  toolName: ToolName,
  args: Record<string, unknown>
): Effect.Effect<McpToolResponse, never, McpTestServices> {
  switch (toolName) {
    case "tx_ready":
      return Effect.gen(function* () {
        const { limit } = args as z.infer<typeof toolSchemas.tx_ready>
        const ready = yield* ReadyService
        const tasks = yield* ready.getReady(limit ?? 100)
        const serialized = tasks.map(serializeTask)
        return {
          content: [
            { type: "text" as const, text: `Found ${tasks.length} ready task(s)` },
            { type: "text" as const, text: JSON.stringify(serialized) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_show":
      return Effect.gen(function* () {
        const { id } = args as z.infer<typeof toolSchemas.tx_show>
        const taskService = yield* TaskService
        const task = yield* taskService.getWithDeps(id as TaskId)
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text" as const, text: `Task: ${task.title}` },
            { type: "text" as const, text: JSON.stringify(serialized) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_list":
      return Effect.gen(function* () {
        const { status, parentId, limit } = args as z.infer<typeof toolSchemas.tx_list>
        const taskService = yield* TaskService
        const tasks = yield* taskService.listWithDeps({
          status: status as any,
          parentId: parentId ?? undefined,
          limit: limit ?? undefined
        })
        const serialized = tasks.map(serializeTask)
        return {
          content: [
            { type: "text" as const, text: `Found ${tasks.length} task(s)` },
            { type: "text" as const, text: JSON.stringify(serialized) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_children":
      return Effect.gen(function* () {
        const { id } = args as z.infer<typeof toolSchemas.tx_children>
        const taskService = yield* TaskService
        const tasks = yield* taskService.listWithDeps({ parentId: id })
        const serialized = tasks.map(serializeTask)
        return {
          content: [
            { type: "text" as const, text: `Found ${tasks.length} child task(s)` },
            { type: "text" as const, text: JSON.stringify(serialized) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_add":
      return Effect.gen(function* () {
        const { title, description, parentId, score } = args as z.infer<typeof toolSchemas.tx_add>
        const taskService = yield* TaskService
        const created = yield* taskService.create({
          title,
          description: description ?? undefined,
          parentId: parentId ?? undefined,
          score: score ?? undefined
        })
        const task = yield* taskService.getWithDeps(created.id)
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text" as const, text: `Created task: ${task.id}` },
            { type: "text" as const, text: JSON.stringify(serialized) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_update":
      return Effect.gen(function* () {
        const { id, title, description, status, parentId, score } = args as z.infer<typeof toolSchemas.tx_update>
        const taskService = yield* TaskService
        yield* taskService.update(id as TaskId, {
          title: title ?? undefined,
          description: description ?? undefined,
          status: status as any,
          parentId: parentId,
          score: score ?? undefined
        })
        const task = yield* taskService.getWithDeps(id as TaskId)
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text" as const, text: `Updated task: ${task.id}` },
            { type: "text" as const, text: JSON.stringify(serialized) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_done":
      return Effect.gen(function* () {
        const { id } = args as z.infer<typeof toolSchemas.tx_done>
        const taskService = yield* TaskService
        const readyService = yield* ReadyService

        // Get tasks blocked by this task before completing
        const blocking = yield* readyService.getBlocking(id as TaskId)

        // Mark the task as done
        yield* taskService.update(id as TaskId, { status: "done" })

        // Get the updated task with deps
        const completedTask = yield* taskService.getWithDeps(id as TaskId)

        // Check which previously blocked tasks are now ready
        const nowReady: TaskWithDeps[] = []
        for (const blockedTask of blocking) {
          if (blockedTask.status === "done") continue
          const isNowReady = yield* readyService.isReady(blockedTask.id)
          if (isNowReady) {
            nowReady.push(yield* taskService.getWithDeps(blockedTask.id))
          }
        }

        const serializedTask = serializeTask(completedTask)
        const serializedNowReady = nowReady.map(serializeTask)

        return {
          content: [
            { type: "text" as const, text: `Completed task: ${completedTask.id}${nowReady.length > 0 ? `. ${nowReady.length} task(s) now ready.` : ""}` },
            { type: "text" as const, text: JSON.stringify({ task: serializedTask, nowReady: serializedNowReady }) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_delete":
      return Effect.gen(function* () {
        const { id } = args as z.infer<typeof toolSchemas.tx_delete>
        const taskService = yield* TaskService
        yield* taskService.remove(id as TaskId)
        return {
          content: [
            { type: "text" as const, text: `Deleted task: ${id}` },
            { type: "text" as const, text: JSON.stringify({ success: true, id }) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_block":
      return Effect.gen(function* () {
        const { taskId, blockerId } = args as z.infer<typeof toolSchemas.tx_block>
        const depService = yield* DependencyService
        const taskService = yield* TaskService

        yield* depService.addBlocker(taskId as TaskId, blockerId as TaskId)

        const task = yield* taskService.getWithDeps(taskId as TaskId)
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text" as const, text: `Added dependency: ${blockerId} blocks ${taskId}` },
            { type: "text" as const, text: JSON.stringify({ success: true, task: serialized }) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )

    case "tx_unblock":
      return Effect.gen(function* () {
        const { taskId, blockerId } = args as z.infer<typeof toolSchemas.tx_unblock>
        const depService = yield* DependencyService
        const taskService = yield* TaskService

        yield* depService.removeBlocker(taskId as TaskId, blockerId as TaskId)

        const task = yield* taskService.getWithDeps(taskId as TaskId)
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text" as const, text: `Removed dependency: ${blockerId} no longer blocks ${taskId}` },
            { type: "text" as const, text: JSON.stringify({ success: true, task: serialized }) }
          ]
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          })
        )
      )
  }
}

// -----------------------------------------------------------------------------
// callMcpTool Helper
// -----------------------------------------------------------------------------

/**
 * Executes an MCP tool handler using the provided test runtime.
 *
 * This helper:
 * 1. Validates the tool name and arguments using Zod schemas
 * 2. Executes the corresponding Effect using the ManagedRuntime
 * 3. Returns the raw MCP response in the same format as the real server
 *
 * @param runtime - ManagedRuntime created by makeTestRuntime()
 * @param toolName - Name of the MCP tool to invoke
 * @param args - Tool arguments (will be validated against schema)
 * @returns Promise<McpToolResponse> - Raw MCP response with content array
 */
export async function callMcpTool<T extends ToolName>(
  runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>,
  toolName: T,
  args: z.infer<typeof toolSchemas[T]>
): Promise<McpToolResponse> {
  const schema = toolSchemas[toolName]
  const validatedArgs = schema.parse(args)

  const effect = createToolEffect(toolName, validatedArgs)
  return runtime.runPromise(effect)
}

/**
 * Convenience function to call an MCP tool and parse the JSON response.
 * Extracts the message and data from the MCP response format.
 *
 * @param runtime - ManagedRuntime created by makeTestRuntime()
 * @param toolName - Name of the MCP tool to invoke
 * @param args - Tool arguments (will be validated against schema)
 * @returns Promise<ParsedMcpResponse<T>> - Parsed response with typed data
 */
export async function callMcpToolParsed<T extends ToolName, R = unknown>(
  runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>,
  toolName: T,
  args: z.infer<typeof toolSchemas[T]>
): Promise<ParsedMcpResponse<R>> {
  const response = await callMcpTool(runtime, toolName, args)

  const message = response.content[0]?.text ?? ""
  const isError = response.isError ?? false

  // For error responses, there's no JSON data
  if (isError || response.content.length < 2) {
    return { message, data: null as unknown as R, isError }
  }

  const data = JSON.parse(response.content[1].text) as R
  return { message, data, isError }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("MCP Test Infrastructure", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  describe("makeTestRuntime", () => {
    it("creates a functional runtime with in-memory database", async () => {
      // Verify runtime can execute basic Effect
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const taskService = yield* TaskService
          return yield* taskService.get(FIXTURES.TASK_JWT)
        })
      )

      expect(result.id).toBe(FIXTURES.TASK_JWT)
      expect(result.title).toBe("JWT validation")
    })

    it("provides isolated state per runtime instance", async () => {
      // Create a second runtime with fresh db
      const db2 = createTestDb()
      // Don't seed - should be empty
      const runtime2 = makeTestRuntime(db2)

      try {
        const tasks = await runtime2.runPromise(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            return yield* taskService.list()
          })
        )

        expect(tasks).toHaveLength(0)
      } finally {
        await runtime2.dispose()
      }
    })
  })

  describe("callMcpTool", () => {
    it("returns raw MCP response format", async () => {
      const response = await callMcpTool(runtime, "tx_ready", {})

      expect(response).toHaveProperty("content")
      expect(Array.isArray(response.content)).toBe(true)
      expect(response.content.length).toBeGreaterThanOrEqual(1)
      expect(response.content[0]).toHaveProperty("type", "text")
      expect(response.content[0]).toHaveProperty("text")
    })

    it("validates tool arguments with Zod schema", async () => {
      // Invalid limit (negative number)
      await expect(
        callMcpTool(runtime, "tx_ready", { limit: -1 } as any)
      ).rejects.toThrow()
    })
  })

  describe("callMcpToolParsed", () => {
    it("parses JSON data from response", async () => {
      const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
        runtime,
        "tx_ready",
        {}
      )

      expect(response.isError).toBe(false)
      expect(Array.isArray(response.data)).toBe(true)
    })

    it("returns error flag for failed operations", async () => {
      const response = await callMcpToolParsed(
        runtime,
        "tx_show",
        { id: "tx-nonexistent" }
      )

      expect(response.isError).toBe(true)
      expect(response.message).toContain("Error")
    })
  })
})

describe("MCP tx_ready Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("returns TaskWithDeps[] with full dependency information (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
      runtime,
      "tx_ready",
      {}
    )

    expect(response.isError).toBe(false)
    expect(Array.isArray(response.data)).toBe(true)

    // Verify TaskWithDeps fields are present on each task
    for (const task of response.data) {
      // Core Task fields
      expect(task).toHaveProperty("id")
      expect(task).toHaveProperty("title")
      expect(task).toHaveProperty("description")
      expect(task).toHaveProperty("status")
      expect(task).toHaveProperty("parentId")
      expect(task).toHaveProperty("score")
      expect(task).toHaveProperty("createdAt")
      expect(task).toHaveProperty("updatedAt")
      expect(task).toHaveProperty("metadata")

      // TaskWithDeps fields (Rule 1 - MUST be present)
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")

      // Verify types
      expect(Array.isArray(task.blockedBy)).toBe(true)
      expect(Array.isArray(task.blocks)).toBe(true)
      expect(Array.isArray(task.children)).toBe(true)
      expect(typeof task.isReady).toBe("boolean")
    }
  })

  it("returns tasks with correct blocks information", async () => {
    const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
      runtime,
      "tx_ready",
      {}
    )

    // Find JWT task which blocks BLOCKED
    const jwt = response.data.find(t => t.id === FIXTURES.TASK_JWT)
    expect(jwt).toBeDefined()
    expect(jwt!.blocks).toContain(FIXTURES.TASK_BLOCKED)

    // Find LOGIN task which also blocks BLOCKED
    const login = response.data.find(t => t.id === FIXTURES.TASK_LOGIN)
    expect(login).toBeDefined()
    expect(login!.blocks).toContain(FIXTURES.TASK_BLOCKED)
  })

  it("respects limit parameter", async () => {
    const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
      runtime,
      "tx_ready",
      { limit: 1 }
    )

    expect(response.data).toHaveLength(1)
  })

  it("returns sorted by score descending", async () => {
    const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
      runtime,
      "tx_ready",
      {}
    )

    for (let i = 1; i < response.data.length; i++) {
      expect((response.data[i - 1] as any).score).toBeGreaterThanOrEqual((response.data[i] as any).score)
    }
  })

  it("excludes tasks with incomplete blockers", async () => {
    const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
      runtime,
      "tx_ready",
      {}
    )

    // TASK_BLOCKED should not be in ready list (blocked by JWT and LOGIN which are not done)
    const blocked = response.data.find(t => t.id === FIXTURES.TASK_BLOCKED)
    expect(blocked).toBeUndefined()
  })

  it("excludes done tasks", async () => {
    const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
      runtime,
      "tx_ready",
      {}
    )

    const done = response.data.find(t => t.id === FIXTURES.TASK_DONE)
    expect(done).toBeUndefined()
  })

  it("includes isReady: true for all returned tasks", async () => {
    const response = await callMcpToolParsed<"tx_ready", Record<string, unknown>[]>(
      runtime,
      "tx_ready",
      {}
    )

    for (const task of response.data) {
      expect(task.isReady).toBe(true)
    }
  })
})

// -----------------------------------------------------------------------------
// tx_show Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_show Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("returns TaskWithDeps with full dependency information (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(false)
    const task = response.data

    // Core Task fields
    expect(task).toHaveProperty("id", FIXTURES.TASK_JWT)
    expect(task).toHaveProperty("title", "JWT validation")
    expect(task).toHaveProperty("status", "ready")

    // TaskWithDeps fields (Rule 1 - MUST be present)
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")

    expect(Array.isArray(task.blockedBy)).toBe(true)
    expect(Array.isArray(task.blocks)).toBe(true)
    expect(Array.isArray(task.children)).toBe(true)
    expect(typeof task.isReady).toBe("boolean")
  })

  it("returns correct blocks information", async () => {
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(false)
    // JWT blocks BLOCKED
    expect(response.data.blocks).toContain(FIXTURES.TASK_BLOCKED)
    expect(response.data.blockedBy).toEqual([])
  })

  it("returns correct blockedBy information", async () => {
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_BLOCKED }
    )

    expect(response.isError).toBe(false)
    // BLOCKED is blocked by JWT and LOGIN
    expect(response.data.blockedBy).toContain(FIXTURES.TASK_JWT)
    expect(response.data.blockedBy).toContain(FIXTURES.TASK_LOGIN)
    expect((response.data.blockedBy as string[]).length).toBe(2)
  })

  it("returns correct children information", async () => {
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_AUTH }
    )

    expect(response.isError).toBe(false)
    // AUTH has children: LOGIN, JWT, BLOCKED, DONE
    expect(response.data.children).toContain(FIXTURES.TASK_LOGIN)
    expect(response.data.children).toContain(FIXTURES.TASK_JWT)
    expect(response.data.children).toContain(FIXTURES.TASK_BLOCKED)
    expect(response.data.children).toContain(FIXTURES.TASK_DONE)
    expect((response.data.children as string[]).length).toBe(4)
  })

  it("returns isReady: false for blocked tasks", async () => {
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_BLOCKED }
    )

    expect(response.isError).toBe(false)
    expect(response.data.isReady).toBe(false)
  })

  it("returns isReady: true for ready tasks without blockers", async () => {
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(false)
    expect(response.data.isReady).toBe(true)
  })

  it("returns error for nonexistent task", async () => {
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: "tx-nonexistent" }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_show", { id: FIXTURES.TASK_JWT })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toContain("Task:")
    expect(response.content[0].text).toContain("JWT validation")
    expect(response.content[1].type).toBe("text")
    // Second content should be valid JSON
    expect(() => JSON.parse(response.content[1].text)).not.toThrow()
  })
})

// -----------------------------------------------------------------------------
// tx_list Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_list Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("returns TaskWithDeps[] with full dependency information (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_list", Record<string, unknown>[]>(
      runtime,
      "tx_list",
      {}
    )

    expect(response.isError).toBe(false)
    expect(Array.isArray(response.data)).toBe(true)
    expect(response.data.length).toBeGreaterThan(0)

    for (const task of response.data) {
      // TaskWithDeps fields (Rule 1 - MUST be present)
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
      expect(Array.isArray(task.blockedBy)).toBe(true)
      expect(Array.isArray(task.blocks)).toBe(true)
      expect(Array.isArray(task.children)).toBe(true)
      expect(typeof task.isReady).toBe("boolean")
    }
  })

  it("filters by status", async () => {
    const response = await callMcpToolParsed<"tx_list", Record<string, unknown>[]>(
      runtime,
      "tx_list",
      { status: "done" }
    )

    expect(response.isError).toBe(false)
    expect(response.data).toHaveLength(1)
    expect(response.data[0].id).toBe(FIXTURES.TASK_DONE)
    expect(response.data[0].status).toBe("done")
  })

  it("filters by parentId", async () => {
    const response = await callMcpToolParsed<"tx_list", Record<string, unknown>[]>(
      runtime,
      "tx_list",
      { parentId: FIXTURES.TASK_AUTH }
    )

    expect(response.isError).toBe(false)
    // AUTH has 4 children: LOGIN, JWT, BLOCKED, DONE
    expect(response.data).toHaveLength(4)
    for (const task of response.data) {
      expect(task.parentId).toBe(FIXTURES.TASK_AUTH)
    }
  })

  it("respects limit parameter", async () => {
    const response = await callMcpToolParsed<"tx_list", Record<string, unknown>[]>(
      runtime,
      "tx_list",
      { limit: 2 }
    )

    expect(response.isError).toBe(false)
    expect(response.data).toHaveLength(2)
  })

  it("combines status and parentId filters", async () => {
    const response = await callMcpToolParsed<"tx_list", Record<string, unknown>[]>(
      runtime,
      "tx_list",
      { status: "ready", parentId: FIXTURES.TASK_AUTH }
    )

    expect(response.isError).toBe(false)
    // AUTH has 2 ready children: LOGIN, JWT
    expect(response.data).toHaveLength(2)
    for (const task of response.data) {
      expect(task.status).toBe("ready")
      expect(task.parentId).toBe(FIXTURES.TASK_AUTH)
    }
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_list", {})

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toMatch(/Found \d+ task\(s\)/)
    expect(response.content[1].type).toBe("text")
    expect(() => JSON.parse(response.content[1].text)).not.toThrow()
  })
})

// -----------------------------------------------------------------------------
// tx_children Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_children Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("returns TaskWithDeps[] for children (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_children", Record<string, unknown>[]>(
      runtime,
      "tx_children",
      { id: FIXTURES.TASK_AUTH }
    )

    expect(response.isError).toBe(false)
    expect(response.data).toHaveLength(4)

    for (const task of response.data) {
      // TaskWithDeps fields (Rule 1 - MUST be present)
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
      expect(Array.isArray(task.blockedBy)).toBe(true)
      expect(Array.isArray(task.blocks)).toBe(true)
    }
  })

  it("returns correct children with dependency info", async () => {
    const response = await callMcpToolParsed<"tx_children", Record<string, unknown>[]>(
      runtime,
      "tx_children",
      { id: FIXTURES.TASK_AUTH }
    )

    expect(response.isError).toBe(false)
    const ids = response.data.map(t => t.id)
    expect(ids).toContain(FIXTURES.TASK_LOGIN)
    expect(ids).toContain(FIXTURES.TASK_JWT)
    expect(ids).toContain(FIXTURES.TASK_BLOCKED)
    expect(ids).toContain(FIXTURES.TASK_DONE)

    // JWT should have blocks info
    const jwt = response.data.find(t => t.id === FIXTURES.TASK_JWT)
    expect(jwt).toBeDefined()
    expect(jwt!.blocks).toContain(FIXTURES.TASK_BLOCKED)
  })

  it("returns empty array for leaf nodes", async () => {
    const response = await callMcpToolParsed<"tx_children", Record<string, unknown>[]>(
      runtime,
      "tx_children",
      { id: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(false)
    expect(response.data).toHaveLength(0)
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_children", { id: FIXTURES.TASK_AUTH })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toMatch(/Found \d+ child task\(s\)/)
    expect(response.content[1].type).toBe("text")
    expect(() => JSON.parse(response.content[1].text)).not.toThrow()
  })
})

// -----------------------------------------------------------------------------
// tx_add Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_add Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("creates task and returns TaskWithDeps (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_add", Record<string, unknown>>(
      runtime,
      "tx_add",
      { title: "New test task" }
    )

    expect(response.isError).toBe(false)
    const task = response.data

    expect(task).toHaveProperty("id")
    expect(task.id).toMatch(/^tx-[a-z0-9]{8}$/)
    expect(task.title).toBe("New test task")
    expect(task.status).toBe("backlog")

    // TaskWithDeps fields (Rule 1 - MUST be present)
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")
    expect(Array.isArray(task.blockedBy)).toBe(true)
    expect(Array.isArray(task.blocks)).toBe(true)
    expect(Array.isArray(task.children)).toBe(true)
    expect(typeof task.isReady).toBe("boolean")
  })

  it("creates task with description", async () => {
    const response = await callMcpToolParsed<"tx_add", Record<string, unknown>>(
      runtime,
      "tx_add",
      { title: "Task with desc", description: "This is a description" }
    )

    expect(response.isError).toBe(false)
    expect(response.data.description).toBe("This is a description")
  })

  it("creates task with parent", async () => {
    const response = await callMcpToolParsed<"tx_add", Record<string, unknown>>(
      runtime,
      "tx_add",
      { title: "Child task", parentId: FIXTURES.TASK_AUTH }
    )

    expect(response.isError).toBe(false)
    expect(response.data.parentId).toBe(FIXTURES.TASK_AUTH)
  })

  it("creates task with custom score", async () => {
    const response = await callMcpToolParsed<"tx_add", Record<string, unknown>>(
      runtime,
      "tx_add",
      { title: "High priority", score: 999 }
    )

    expect(response.isError).toBe(false)
    expect(response.data.score).toBe(999)
  })

  it("new task has empty dependency arrays and isReady: true", async () => {
    const response = await callMcpToolParsed<"tx_add", Record<string, unknown>>(
      runtime,
      "tx_add",
      { title: "Fresh task" }
    )

    expect(response.isError).toBe(false)
    expect(response.data.blockedBy).toEqual([])
    expect(response.data.blocks).toEqual([])
    expect(response.data.children).toEqual([])
    expect(response.data.isReady).toBe(true)
  })

  it("returns error for nonexistent parent", async () => {
    const response = await callMcpToolParsed<"tx_add", Record<string, unknown>>(
      runtime,
      "tx_add",
      { title: "Orphan", parentId: "tx-nonexistent" }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("returns error for empty title", async () => {
    const response = await callMcpToolParsed<"tx_add", Record<string, unknown>>(
      runtime,
      "tx_add",
      { title: "" }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_add", { title: "Test task" })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toMatch(/Created task: tx-[a-z0-9]{8}/)
    expect(response.content[1].type).toBe("text")
    expect(() => JSON.parse(response.content[1].text)).not.toThrow()
  })
})

// -----------------------------------------------------------------------------
// tx_update Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_update Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("updates task and returns TaskWithDeps (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_update", Record<string, unknown>>(
      runtime,
      "tx_update",
      { id: FIXTURES.TASK_JWT, title: "Updated JWT" }
    )

    expect(response.isError).toBe(false)
    const task = response.data

    expect(task.id).toBe(FIXTURES.TASK_JWT)
    expect(task.title).toBe("Updated JWT")

    // TaskWithDeps fields preserved
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")
    expect(task.blocks).toContain(FIXTURES.TASK_BLOCKED)
  })

  it("updates description", async () => {
    const response = await callMcpToolParsed<"tx_update", Record<string, unknown>>(
      runtime,
      "tx_update",
      { id: FIXTURES.TASK_JWT, description: "New description" }
    )

    expect(response.isError).toBe(false)
    expect(response.data.description).toBe("New description")
  })

  it("updates status", async () => {
    const response = await callMcpToolParsed<"tx_update", Record<string, unknown>>(
      runtime,
      "tx_update",
      { id: FIXTURES.TASK_JWT, status: "active" }
    )

    expect(response.isError).toBe(false)
    expect(response.data.status).toBe("active")
  })

  it("updates score", async () => {
    const response = await callMcpToolParsed<"tx_update", Record<string, unknown>>(
      runtime,
      "tx_update",
      { id: FIXTURES.TASK_JWT, score: 1000 }
    )

    expect(response.isError).toBe(false)
    expect(response.data.score).toBe(1000)
  })

  it("updates parentId", async () => {
    const response = await callMcpToolParsed<"tx_update", Record<string, unknown>>(
      runtime,
      "tx_update",
      { id: FIXTURES.TASK_JWT, parentId: FIXTURES.TASK_ROOT }
    )

    expect(response.isError).toBe(false)
    expect(response.data.parentId).toBe(FIXTURES.TASK_ROOT)
  })

  it("removes parentId with null", async () => {
    const response = await callMcpToolParsed<"tx_update", Record<string, unknown>>(
      runtime,
      "tx_update",
      { id: FIXTURES.TASK_JWT, parentId: null }
    )

    expect(response.isError).toBe(false)
    expect(response.data.parentId).toBeNull()
  })

  it("returns error for nonexistent task", async () => {
    const response = await callMcpToolParsed<"tx_update", Record<string, unknown>>(
      runtime,
      "tx_update",
      { id: "tx-nonexistent", title: "Won't work" }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_update", { id: FIXTURES.TASK_JWT, title: "Test" })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toContain("Updated task:")
    expect(response.content[0].text).toContain(FIXTURES.TASK_JWT)
    expect(response.content[1].type).toBe("text")
    expect(() => JSON.parse(response.content[1].text)).not.toThrow()
  })
})

// -----------------------------------------------------------------------------
// tx_done Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_done Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("marks task as done and returns TaskWithDeps (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_done", { task: Record<string, unknown>; nowReady: Record<string, unknown>[] }>(
      runtime,
      "tx_done",
      { id: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(false)
    const task = response.data.task

    expect(task.id).toBe(FIXTURES.TASK_JWT)
    expect(task.status).toBe("done")
    expect(task.completedAt).not.toBeNull()

    // TaskWithDeps fields
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")
  })

  it("returns nowReady array with tasks that became unblocked", async () => {
    // First complete JWT (one of two blockers for BLOCKED)
    await callMcpTool(runtime, "tx_done", { id: FIXTURES.TASK_JWT })

    // Now complete LOGIN (the last blocker for BLOCKED)
    const response = await callMcpToolParsed<"tx_done", { task: Record<string, unknown>; nowReady: Record<string, unknown>[] }>(
      runtime,
      "tx_done",
      { id: FIXTURES.TASK_LOGIN }
    )

    expect(response.isError).toBe(false)
    expect(Array.isArray(response.data.nowReady)).toBe(true)
    // BLOCKED should now be ready since both JWT and LOGIN are done
    const blockedTask = response.data.nowReady.find(t => t.id === FIXTURES.TASK_BLOCKED)
    expect(blockedTask).toBeDefined()
    expect(blockedTask!.isReady).toBe(true)
  })

  it("nowReady tasks have full TaskWithDeps info (Rule 1)", async () => {
    // Complete both blockers
    await callMcpTool(runtime, "tx_done", { id: FIXTURES.TASK_JWT })
    const response = await callMcpToolParsed<"tx_done", { task: Record<string, unknown>; nowReady: Record<string, unknown>[] }>(
      runtime,
      "tx_done",
      { id: FIXTURES.TASK_LOGIN }
    )

    expect(response.isError).toBe(false)
    expect(response.data.nowReady.length).toBeGreaterThan(0)

    for (const task of response.data.nowReady) {
      // TaskWithDeps fields (Rule 1)
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
      expect(Array.isArray(task.blockedBy)).toBe(true)
      expect(Array.isArray(task.blocks)).toBe(true)
      expect(Array.isArray(task.children)).toBe(true)
    }
  })

  it("nowReady is empty when no tasks become unblocked", async () => {
    // Complete ROOT which doesn't block anything
    const response = await callMcpToolParsed<"tx_done", { task: Record<string, unknown>; nowReady: Record<string, unknown>[] }>(
      runtime,
      "tx_done",
      { id: FIXTURES.TASK_ROOT }
    )

    expect(response.isError).toBe(false)
    expect(response.data.nowReady).toHaveLength(0)
  })

  it("returns error for nonexistent task", async () => {
    const response = await callMcpToolParsed<"tx_done", { task: Record<string, unknown>; nowReady: Record<string, unknown>[] }>(
      runtime,
      "tx_done",
      { id: "tx-nonexistent" }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("includes correct text content format with nowReady count", async () => {
    // Complete both blockers to trigger nowReady
    await callMcpTool(runtime, "tx_done", { id: FIXTURES.TASK_JWT })
    const response = await callMcpTool(runtime, "tx_done", { id: FIXTURES.TASK_LOGIN })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toContain("Completed task:")
    expect(response.content[0].text).toContain("task(s) now ready")
    expect(response.content[1].type).toBe("text")
    const json = JSON.parse(response.content[1].text)
    expect(json).toHaveProperty("task")
    expect(json).toHaveProperty("nowReady")
  })
})

// -----------------------------------------------------------------------------
// tx_delete Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_delete Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("deletes task and returns success", async () => {
    const response = await callMcpToolParsed<"tx_delete", { success: boolean; id: string }>(
      runtime,
      "tx_delete",
      { id: FIXTURES.TASK_DONE }
    )

    expect(response.isError).toBe(false)
    expect(response.data.success).toBe(true)
    expect(response.data.id).toBe(FIXTURES.TASK_DONE)
  })

  it("actually removes task from database", async () => {
    await callMcpTool(runtime, "tx_delete", { id: FIXTURES.TASK_DONE })

    // Try to show the deleted task
    const response = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_DONE }
    )

    expect(response.isError).toBe(true)
  })

  it("returns error for nonexistent task", async () => {
    const response = await callMcpToolParsed<"tx_delete", { success: boolean; id: string }>(
      runtime,
      "tx_delete",
      { id: "tx-nonexistent" }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_delete", { id: FIXTURES.TASK_DONE })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toContain("Deleted task:")
    expect(response.content[0].text).toContain(FIXTURES.TASK_DONE)
    expect(response.content[1].type).toBe("text")
    const json = JSON.parse(response.content[1].text)
    expect(json.success).toBe(true)
    expect(json.id).toBe(FIXTURES.TASK_DONE)
  })
})

// -----------------------------------------------------------------------------
// tx_block Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_block Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("adds blocker and returns TaskWithDeps with updated blockedBy (Rule 1)", async () => {
    const response = await callMcpToolParsed<"tx_block", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_block",
      { taskId: FIXTURES.TASK_LOGIN, blockerId: FIXTURES.TASK_ROOT }
    )

    expect(response.isError).toBe(false)
    expect(response.data.success).toBe(true)

    const task = response.data.task
    expect(task.id).toBe(FIXTURES.TASK_LOGIN)

    // TaskWithDeps fields (Rule 1)
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")

    // Verify ROOT is now in blockedBy
    expect(task.blockedBy).toContain(FIXTURES.TASK_ROOT)
  })

  it("updates isReady status correctly", async () => {
    // LOGIN is currently ready (no incomplete blockers)
    const before = await callMcpToolParsed<"tx_show", Record<string, unknown>>(
      runtime,
      "tx_show",
      { id: FIXTURES.TASK_LOGIN }
    )
    expect(before.data.isReady).toBe(true)

    // Add ROOT as blocker (ROOT is not done)
    const response = await callMcpToolParsed<"tx_block", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_block",
      { taskId: FIXTURES.TASK_LOGIN, blockerId: FIXTURES.TASK_ROOT }
    )

    expect(response.isError).toBe(false)
    // LOGIN should no longer be ready
    expect(response.data.task.isReady).toBe(false)
  })

  it("returns error for self-blocking", async () => {
    const response = await callMcpToolParsed<"tx_block", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_block",
      { taskId: FIXTURES.TASK_JWT, blockerId: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("returns error for circular dependency", async () => {
    // JWT already blocks BLOCKED. Trying to make BLOCKED block JWT creates a cycle.
    const response = await callMcpToolParsed<"tx_block", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_block",
      { taskId: FIXTURES.TASK_JWT, blockerId: FIXTURES.TASK_BLOCKED }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("returns error for nonexistent task", async () => {
    const response = await callMcpToolParsed<"tx_block", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_block",
      { taskId: "tx-nonexistent", blockerId: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("returns error for nonexistent blocker", async () => {
    const response = await callMcpToolParsed<"tx_block", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_block",
      { taskId: FIXTURES.TASK_JWT, blockerId: "tx-nonexistent" }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_block", {
      taskId: FIXTURES.TASK_LOGIN,
      blockerId: FIXTURES.TASK_ROOT
    })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toContain("Added dependency:")
    expect(response.content[0].text).toContain(FIXTURES.TASK_ROOT)
    expect(response.content[0].text).toContain("blocks")
    expect(response.content[0].text).toContain(FIXTURES.TASK_LOGIN)
    expect(response.content[1].type).toBe("text")
    const json = JSON.parse(response.content[1].text)
    expect(json.success).toBe(true)
    expect(json.task).toHaveProperty("blockedBy")
  })
})

// -----------------------------------------------------------------------------
// tx_unblock Tool Tests
// -----------------------------------------------------------------------------

describe("MCP tx_unblock Tool", () => {
  let db: InstanceType<typeof Database>
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, never>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    runtime = makeTestRuntime(db)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  it("removes blocker and returns TaskWithDeps with updated blockedBy (Rule 1)", async () => {
    // BLOCKED is currently blocked by JWT and LOGIN
    const response = await callMcpToolParsed<"tx_unblock", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_unblock",
      { taskId: FIXTURES.TASK_BLOCKED, blockerId: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(false)
    expect(response.data.success).toBe(true)

    const task = response.data.task
    expect(task.id).toBe(FIXTURES.TASK_BLOCKED)

    // TaskWithDeps fields (Rule 1)
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")

    // JWT should no longer be in blockedBy
    expect(task.blockedBy).not.toContain(FIXTURES.TASK_JWT)
    // LOGIN should still be in blockedBy
    expect(task.blockedBy).toContain(FIXTURES.TASK_LOGIN)
  })

  it("updates isReady status when last blocker removed", async () => {
    // Remove JWT as blocker
    await callMcpTool(runtime, "tx_unblock", {
      taskId: FIXTURES.TASK_BLOCKED,
      blockerId: FIXTURES.TASK_JWT
    })

    // Remove LOGIN as blocker (last one)
    const response = await callMcpToolParsed<"tx_unblock", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_unblock",
      { taskId: FIXTURES.TASK_BLOCKED, blockerId: FIXTURES.TASK_LOGIN }
    )

    expect(response.isError).toBe(false)
    // BLOCKED should now be ready (no blockers)
    expect(response.data.task.blockedBy).toEqual([])
    expect(response.data.task.isReady).toBe(true)
  })

  it("returns error for nonexistent task", async () => {
    const response = await callMcpToolParsed<"tx_unblock", { success: boolean; task: Record<string, unknown> }>(
      runtime,
      "tx_unblock",
      { taskId: "tx-nonexistent", blockerId: FIXTURES.TASK_JWT }
    )

    expect(response.isError).toBe(true)
    expect(response.message).toContain("Error")
  })

  it("includes correct text content format", async () => {
    const response = await callMcpTool(runtime, "tx_unblock", {
      taskId: FIXTURES.TASK_BLOCKED,
      blockerId: FIXTURES.TASK_JWT
    })

    expect(response.content).toHaveLength(2)
    expect(response.content[0].type).toBe("text")
    expect(response.content[0].text).toContain("Removed dependency:")
    expect(response.content[0].text).toContain(FIXTURES.TASK_JWT)
    expect(response.content[0].text).toContain("no longer blocks")
    expect(response.content[0].text).toContain(FIXTURES.TASK_BLOCKED)
    expect(response.content[1].type).toBe("text")
    const json = JSON.parse(response.content[1].text)
    expect(json.success).toBe(true)
    expect(json.task).toHaveProperty("blockedBy")
  })
})
