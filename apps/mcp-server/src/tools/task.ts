/**
 * Task-related MCP Tools
 *
 * Provides MCP tools for task CRUD operations, dependencies, and hierarchy.
 * All tools return TaskWithDeps per doctrine Rule 1.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { z } from "zod"
import type { TaskId, TaskStatus, TaskWithDeps } from "@jamesaphoenix/tx-types"
import { TASK_STATUSES } from "@jamesaphoenix/tx-types"
import { TaskService, ReadyService, DependencyService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type McpToolResult = { content: { type: "text"; text: string }[] }

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

/**
 * Serialize a TaskWithDeps for JSON output.
 * Converts Date objects to ISO strings for proper serialization.
 */
export const serializeTask = (task: TaskWithDeps): Record<string, unknown> => ({
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

// -----------------------------------------------------------------------------
// Tool Handlers (extracted to avoid deep type inference issues with MCP SDK)
// -----------------------------------------------------------------------------

const handleReady = async (args: { limit?: number }): Promise<McpToolResult> => {
  try {
    const tasks = await runEffect(
      Effect.gen(function* () {
        const ready = yield* ReadyService
        return yield* ready.getReady(args.limit ?? 100)
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

const handleShow = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.getWithDeps(args.id as TaskId)
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

const handleList = async (args: { status?: string; parentId?: string; limit?: number }): Promise<McpToolResult> => {
  try {
    const tasks = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.listWithDeps({
          status: args.status as TaskStatus | undefined,
          parentId: args.parentId ?? undefined,
          limit: args.limit ?? undefined
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

const handleChildren = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    const tasks = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.listWithDeps({ parentId: args.id })
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

const handleAdd = async (args: {
  title: string
  description?: string
  parentId?: string
  score?: number
}): Promise<McpToolResult> => {
  try {
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const created = yield* taskService.create({
          title: args.title,
          description: args.description ?? undefined,
          parentId: args.parentId ?? undefined,
          score: args.score ?? undefined
        })
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

const handleUpdate = async (args: {
  id: string
  title?: string
  description?: string
  status?: string
  parentId?: string | null
  score?: number
}): Promise<McpToolResult> => {
  try {
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.update(args.id as TaskId, {
          title: args.title ?? undefined,
          description: args.description ?? undefined,
          status: args.status as TaskStatus | undefined,
          parentId: args.parentId,
          score: args.score ?? undefined
        })
        return yield* taskService.getWithDeps(args.id as TaskId)
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

const handleDone = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const readyService = yield* ReadyService

        // Get tasks that this task blocks (before completing)
        const blocking = yield* readyService.getBlocking(args.id as TaskId)

        // Mark the task as done
        yield* taskService.update(args.id as TaskId, { status: "done" })

        // Get the updated task with deps
        const completedTask = yield* taskService.getWithDeps(args.id as TaskId)

        // Find newly unblocked tasks using batch query
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

const handleDelete = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.remove(args.id as TaskId)
      })
    )
    return {
      content: [
        { type: "text", text: `Deleted task: ${args.id}` },
        { type: "text", text: JSON.stringify({ success: true, id: args.id }) }
      ]
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
    }
  }
}

const handleBlock = async (args: { taskId: string; blockerId: string }): Promise<McpToolResult> => {
  try {
    const task = await runEffect(
      Effect.gen(function* () {
        const depService = yield* DependencyService
        const taskService = yield* TaskService

        yield* depService.addBlocker(args.taskId as TaskId, args.blockerId as TaskId)
        return yield* taskService.getWithDeps(args.taskId as TaskId)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Added dependency: ${args.blockerId} blocks ${args.taskId}` },
        { type: "text", text: JSON.stringify({ success: true, task: serialized }) }
      ]
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
    }
  }
}

const handleUnblock = async (args: { taskId: string; blockerId: string }): Promise<McpToolResult> => {
  try {
    const task = await runEffect(
      Effect.gen(function* () {
        const depService = yield* DependencyService
        const taskService = yield* TaskService

        yield* depService.removeBlocker(args.taskId as TaskId, args.blockerId as TaskId)
        return yield* taskService.getWithDeps(args.taskId as TaskId)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Removed dependency: ${args.blockerId} no longer blocks ${args.taskId}` },
        { type: "text", text: JSON.stringify({ success: true, task: serialized }) }
      ]
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
    }
  }
}

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

/**
 * Register all task-related MCP tools on the server.
 */
export const registerTaskTools = (server: McpServer): void => {
  // tx_ready - List tasks that are ready to work on
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_ready",
    "List tasks ready to be worked on (no incomplete blockers)",
    { limit: z.number().int().positive().optional().describe("Maximum number of tasks to return (default: 100)") },
    handleReady as Parameters<typeof server.tool>[3]
  )

  // tx_show - Show a single task with full dependency info
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_show",
    "Show detailed information about a task including dependencies",
    { id: z.string().describe("Task ID to show") },
    handleShow as Parameters<typeof server.tool>[3]
  )

  // tx_list - List tasks with optional filters
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_list",
    "List tasks with optional filters for status, parent, and limit",
    {
      status: z.string().optional().describe(`Filter by status: ${TASK_STATUSES.join(", ")}`),
      parentId: z.string().optional().describe("Filter by parent task ID"),
      limit: z.number().int().positive().optional().describe("Maximum number of tasks to return")
    },
    handleList as Parameters<typeof server.tool>[3]
  )

  // tx_children - List children of a task
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_children",
    "List direct children of a task",
    { id: z.string().describe("Parent task ID") },
    handleChildren as Parameters<typeof server.tool>[3]
  )

  // tx_add - Create a new task
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_add",
    "Create a new task",
    {
      title: z.string().describe("Task title (required)"),
      description: z.string().optional().describe("Task description"),
      parentId: z.string().optional().describe("Parent task ID for subtasks"),
      score: z.number().int().optional().describe("Priority score (higher = more important)")
    },
    handleAdd as Parameters<typeof server.tool>[3]
  )

  // tx_update - Update an existing task
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
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
    handleUpdate as Parameters<typeof server.tool>[3]
  )

  // tx_done - Mark a task as complete
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_done",
    "Mark a task as complete and return any tasks that are now ready",
    { id: z.string().describe("Task ID to complete") },
    handleDone as Parameters<typeof server.tool>[3]
  )

  // tx_delete - Delete a task
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_delete",
    "Delete a task permanently",
    { id: z.string().describe("Task ID to delete") },
    handleDelete as Parameters<typeof server.tool>[3]
  )

  // tx_block - Add a dependency (blocker blocks taskId)
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_block",
    "Add a dependency: blockerId blocks taskId (taskId cannot start until blockerId is done). Rejects circular dependencies.",
    {
      taskId: z.string().describe("Task ID that will be blocked"),
      blockerId: z.string().describe("Task ID that blocks the other task")
    },
    handleBlock as Parameters<typeof server.tool>[3]
  )

  // tx_unblock - Remove a dependency
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_unblock",
    "Remove a dependency: blockerId no longer blocks taskId",
    {
      taskId: z.string().describe("Task ID that is currently blocked"),
      blockerId: z.string().describe("Task ID to remove as a blocker")
    },
    handleUnblock as Parameters<typeof server.tool>[3]
  )
}
