/**
 * MCP Server Infrastructure
 *
 * Provides:
 * - initRuntime: Initialize Effect runtime ONCE at startup
 * - runEffect: Run Effect using the pre-built runtime
 * - mcpResponse/mcpError: Format MCP responses
 * - createMcpServer/startMcpServer: Server lifecycle
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Effect, ManagedRuntime } from "effect"
import { z } from "zod"

import { TaskService } from "../services/task-service.js"
import { ReadyService } from "../services/ready-service.js"
import { DependencyService } from "../services/dep-service.js"
import { HierarchyService } from "../services/hierarchy-service.js"
import { LearningService } from "../services/learning-service.js"
import { FileLearningService } from "../services/file-learning-service.js"
import { SyncService } from "../services/sync-service.js"
import { makeAppLayer } from "../layer.js"
import type { TaskId, TaskStatus, TaskWithDeps } from "../schema.js"
import { TASK_STATUSES } from "../schema.js"
import type { FileLearning } from "../schemas/file-learning.js"
import type { Learning, LearningWithScore } from "../schemas/learning.js"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type McpServices = TaskService | ReadyService | DependencyService | HierarchyService | LearningService | FileLearningService | SyncService

export interface McpContent {
  type: "text"
  text: string
}

export interface McpResponse {
  content: McpContent[]
  isError?: boolean
}

// -----------------------------------------------------------------------------
// Runtime
// -----------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let managedRuntime: ManagedRuntime.ManagedRuntime<McpServices, any> | null = null

/**
 * Initialize the Effect runtime ONCE at server startup.
 * Creates the full service layer with database connection.
 */
export const initRuntime = async (dbPath = ".tx/tasks.db"): Promise<void> => {
  if (managedRuntime) {
    return // Already initialized
  }

  const appLayer = makeAppLayer(dbPath)
  managedRuntime = ManagedRuntime.make(appLayer)
}

/**
 * Run an Effect using the pre-built runtime.
 * Must call initRuntime() first.
 */
export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, McpServices>
): Promise<A> => {
  if (!managedRuntime) {
    throw new Error("Runtime not initialized. Call initRuntime() first.")
  }
  return managedRuntime.runPromise(effect)
}

/**
 * Get the current runtime for advanced use cases.
 * Returns null if not initialized.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getRuntime = (): ManagedRuntime.ManagedRuntime<McpServices, any> | null => {
  return managedRuntime
}

/**
 * Dispose of the runtime and release resources.
 * Call when shutting down the server.
 */
export const disposeRuntime = async (): Promise<void> => {
  if (managedRuntime) {
    await managedRuntime.dispose()
    managedRuntime = null
  }
}

// -----------------------------------------------------------------------------
// Response Formatters
// -----------------------------------------------------------------------------

/**
 * Format a successful MCP response with text summary and JSON data.
 */
export const mcpResponse = (text: string, data: unknown): McpResponse => ({
  content: [
    { type: "text" as const, text },
    { type: "text" as const, text: JSON.stringify(data) }
  ]
})

/**
 * Format an error MCP response.
 */
export const mcpError = (error: unknown): McpResponse => ({
  content: [{
    type: "text" as const,
    text: `Error: ${error instanceof Error ? error.message : String(error)}`
  }],
  isError: true
})

// -----------------------------------------------------------------------------
// Serialization Helpers
// -----------------------------------------------------------------------------

/**
 * Serialize a TaskWithDeps for JSON output.
 * Converts Date objects to ISO strings for proper serialization.
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
 * Serialize a FileLearning for JSON output.
 */
const serializeFileLearning = (learning: FileLearning): Record<string, unknown> => ({
  id: learning.id,
  filePattern: learning.filePattern,
  note: learning.note,
  taskId: learning.taskId,
  createdAt: learning.createdAt.toISOString()
})

/**
 * Serialize a Learning for JSON output.
 * Converts Date objects to ISO strings and Float32Array to number array.
 */
export const serializeLearning = (learning: Learning): Record<string, unknown> => ({
  id: learning.id,
  content: learning.content,
  sourceType: learning.sourceType,
  sourceRef: learning.sourceRef,
  createdAt: learning.createdAt.toISOString(),
  keywords: learning.keywords,
  category: learning.category,
  usageCount: learning.usageCount,
  lastUsedAt: learning.lastUsedAt?.toISOString() ?? null,
  outcomeScore: learning.outcomeScore,
  embedding: learning.embedding ? Array.from(learning.embedding) : null
})

/**
 * Serialize a LearningWithScore for JSON output.
 * Extends serializeLearning with score fields.
 */
export const serializeLearningWithScore = (learning: LearningWithScore): Record<string, unknown> => ({
  ...serializeLearning(learning),
  relevanceScore: learning.relevanceScore,
  bm25Score: learning.bm25Score,
  vectorScore: learning.vectorScore,
  recencyScore: learning.recencyScore
})

// -----------------------------------------------------------------------------
// Server Creation
// -----------------------------------------------------------------------------

/**
 * Create the MCP server with tool registrations.
 */
export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "tx",
    version: "0.1.0"
  })

  // ---------------------------------------------------------------------------
  // tx_ready - List tasks that are ready to work on
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_ready",
    "List tasks ready to be worked on (no incomplete blockers)",
    { limit: z.number().int().positive().optional().describe("Maximum number of tasks to return (default: 100)") },
    async ({ limit }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const tasks = await runEffect(
          Effect.gen(function* () {
            const ready = yield* ReadyService
            return yield* ready.getReady(limit ?? 100)
          })
        )
        const serialized = tasks.map(serializeTask)
        return {
          content: [
            { type: "text", text: `Found ${tasks.length} ready task(s)` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_show - Show a single task with full dependency info
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_show",
    "Show detailed information about a task including dependencies",
    { id: z.string().describe("Task ID to show") },
    async ({ id }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const task = await runEffect(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            return yield* taskService.getWithDeps(id as TaskId)
          })
        )
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text", text: `Task: ${task.title}` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_list - List tasks with optional filters
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_list",
    "List tasks with optional filters for status, parent, and limit",
    {
      status: z.string().optional().describe(`Filter by status: ${TASK_STATUSES.join(", ")}`),
      parentId: z.string().optional().describe("Filter by parent task ID"),
      limit: z.number().int().positive().optional().describe("Maximum number of tasks to return")
    },
    async ({ status, parentId, limit }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const tasks = await runEffect(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            return yield* taskService.listWithDeps({
              status: status as TaskStatus | undefined,
              parentId: parentId ?? undefined,
              limit: limit ?? undefined
            })
          })
        )
        const serialized = tasks.map(serializeTask)
        return {
          content: [
            { type: "text", text: `Found ${tasks.length} task(s)` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_children - List children of a task
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_children",
    "List direct children of a task",
    { id: z.string().describe("Parent task ID") },
    async ({ id }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const tasks = await runEffect(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            // Use listWithDeps with parentId filter to get TaskWithDeps[]
            return yield* taskService.listWithDeps({ parentId: id })
          })
        )
        const serialized = tasks.map(serializeTask)
        return {
          content: [
            { type: "text", text: `Found ${tasks.length} child task(s)` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_add - Create a new task
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_add",
    "Create a new task",
    {
      title: z.string().describe("Task title (required)"),
      description: z.string().optional().describe("Task description"),
      parentId: z.string().optional().describe("Parent task ID for subtasks"),
      score: z.number().int().optional().describe("Priority score (higher = more important)")
    },
    async ({ title, description, parentId, score }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const task = await runEffect(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            const created = yield* taskService.create({
              title,
              description: description ?? undefined,
              parentId: parentId ?? undefined,
              score: score ?? undefined
            })
            // Return with deps (new task will have no deps, but we follow the pattern)
            return yield* taskService.getWithDeps(created.id)
          })
        )
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text", text: `Created task: ${task.id}` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_update - Update an existing task
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_update",
    "Update an existing task",
    {
      id: z.string().describe("Task ID to update"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      status: z.string().optional().describe(`New status: ${TASK_STATUSES.join(", ")}`),
      parentId: z.string().nullable().optional().describe("New parent ID (null to remove parent)"),
      score: z.number().int().optional().describe("New priority score")
    },
    async ({ id, title, description, status, parentId, score }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const task = await runEffect(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            yield* taskService.update(id as TaskId, {
              title: title ?? undefined,
              description: description ?? undefined,
              status: status as TaskStatus | undefined,
              parentId: parentId,
              score: score ?? undefined
            })
            // Return with deps after update
            return yield* taskService.getWithDeps(id as TaskId)
          })
        )
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text", text: `Updated task: ${task.id}` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_done - Mark a task as complete
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_done",
    "Mark a task as complete and return any tasks that are now ready",
    { id: z.string().describe("Task ID to complete") },
    async ({ id }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const result = await runEffect(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            const readyService = yield* ReadyService

            // Get tasks that this task blocks (before completing)
            const blocking = yield* readyService.getBlocking(id as TaskId)

            // Mark the task as done
            yield* taskService.update(id as TaskId, { status: "done" })

            // Get the updated task with deps
            const completedTask = yield* taskService.getWithDeps(id as TaskId)

            // Find newly unblocked tasks using batch query
            // Filter to workable statuses (skip done tasks) and get their full deps info in one batch
            const candidateIds = blocking
              .filter(t => ["backlog", "ready", "planning"].includes(t.status))
              .map(t => t.id)
            const candidatesWithDeps = yield* taskService.getWithDepsBatch(candidateIds)
            const nowReady = candidatesWithDeps.filter(t => t.isReady)

            return { completedTask, nowReady }
          })
        )

        const serializedTask = serializeTask(result.completedTask)
        const serializedNowReady = result.nowReady.map(serializeTask)

        return {
          content: [
            { type: "text", text: `Completed task: ${result.completedTask.id}${result.nowReady.length > 0 ? `. ${result.nowReady.length} task(s) now ready.` : ""}` },
            { type: "text", text: JSON.stringify({ task: serializedTask, nowReady: serializedNowReady }) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_delete - Delete a task
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_delete",
    "Delete a task permanently",
    { id: z.string().describe("Task ID to delete") },
    async ({ id }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        await runEffect(
          Effect.gen(function* () {
            const taskService = yield* TaskService
            yield* taskService.remove(id as TaskId)
          })
        )
        return {
          content: [
            { type: "text", text: `Deleted task: ${id}` },
            { type: "text", text: JSON.stringify({ success: true, id }) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_block - Add a dependency (blocker blocks taskId)
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_block",
    "Add a dependency: blockerId blocks taskId (taskId cannot start until blockerId is done). Rejects circular dependencies.",
    {
      taskId: z.string().describe("Task ID that will be blocked"),
      blockerId: z.string().describe("Task ID that blocks the other task")
    },
    async ({ taskId, blockerId }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const task = await runEffect(
          Effect.gen(function* () {
            const depService = yield* DependencyService
            const taskService = yield* TaskService

            // Add the blocker relationship
            yield* depService.addBlocker(taskId as TaskId, blockerId as TaskId)

            // Return the updated task with deps
            return yield* taskService.getWithDeps(taskId as TaskId)
          })
        )
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text", text: `Added dependency: ${blockerId} blocks ${taskId}` },
            { type: "text", text: JSON.stringify({ success: true, task: serialized }) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_unblock - Remove a dependency
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_unblock",
    "Remove a dependency: blockerId no longer blocks taskId",
    {
      taskId: z.string().describe("Task ID that is currently blocked"),
      blockerId: z.string().describe("Task ID to remove as a blocker")
    },
    async ({ taskId, blockerId }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const task = await runEffect(
          Effect.gen(function* () {
            const depService = yield* DependencyService
            const taskService = yield* TaskService

            // Remove the blocker relationship
            yield* depService.removeBlocker(taskId as TaskId, blockerId as TaskId)

            // Return the updated task with deps
            return yield* taskService.getWithDeps(taskId as TaskId)
          })
        )
        const serialized = serializeTask(task)
        return {
          content: [
            { type: "text", text: `Removed dependency: ${blockerId} no longer blocks ${taskId}` },
            { type: "text", text: JSON.stringify({ success: true, task: serialized }) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_learn - Attach a learning to a file path or glob pattern
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_learn",
    "Attach a learning/note to a file path or glob pattern. Agents can query this when working on files.",
    {
      filePattern: z.string().describe("File path or glob pattern (e.g., src/services/*.ts)"),
      note: z.string().describe("The learning/note to attach"),
      taskId: z.string().optional().describe("Optional task ID to associate with")
    },
    async ({ filePattern, note, taskId }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const learning = await runEffect(
          Effect.gen(function* () {
            const fileLearningService = yield* FileLearningService
            return yield* fileLearningService.create({
              filePattern,
              note,
              taskId: taskId ?? undefined
            })
          })
        )
        const serialized = serializeFileLearning(learning)
        return {
          content: [
            { type: "text", text: `Created file learning: #${learning.id} for pattern "${learning.filePattern}"` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // tx_recall - Query file learnings by path
  // ---------------------------------------------------------------------------
  server.tool(
    "tx_recall",
    "Query file-specific learnings. If path is provided, returns learnings matching that path. Otherwise returns all file learnings.",
    {
      path: z.string().optional().describe("Optional file path to match against stored patterns")
    },
    async ({ path }): Promise<{ content: { type: "text"; text: string }[] }> => {
      try {
        const learnings = await runEffect(
          Effect.gen(function* () {
            const fileLearningService = yield* FileLearningService
            if (path) {
              return yield* fileLearningService.recall(path)
            }
            return yield* fileLearningService.getAll()
          })
        )
        const serialized = learnings.map(serializeFileLearning)
        const pathInfo = path ? ` for "${path}"` : ""
        return {
          content: [
            { type: "text", text: `Found ${learnings.length} file learning(s)${pathInfo}` },
            { type: "text", text: JSON.stringify(serialized) }
          ]
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
        }
      }
    }
  )

  return server
}

/**
 * Start the MCP server with stdio transport.
 * Initializes runtime and begins accepting tool calls.
 * Registers graceful shutdown handlers for SIGINT/SIGTERM.
 */
export const startMcpServer = async (dbPath = ".tx/tasks.db"): Promise<void> => {
  // Initialize runtime (runs migrations, builds service layer ONCE)
  await initRuntime(dbPath)

  const server = createMcpServer()
  const transport = new StdioServerTransport()

  // Track shutdown state to prevent multiple cleanup attempts
  let isShuttingDown = false

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return
    }
    isShuttingDown = true

    try {
      // Close the MCP server connection
      await server.close()
    } catch (error) {
      // Log error but continue shutdown
      console.error(`MCP server close error during ${signal}:`, error)
    }

    try {
      // Dispose of the Effect runtime (releases database connections)
      await disposeRuntime()
    } catch (error) {
      // Log error but continue shutdown
      console.error(`Runtime dispose error during ${signal}:`, error)
    }

    process.exit(0)
  }

  // Register shutdown handlers
  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

  await server.connect(transport)
}
