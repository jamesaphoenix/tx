/**
 * Task-related MCP Tools
 *
 * Provides MCP tools for task CRUD operations, dependencies, and hierarchy.
 * All tools return TaskWithDeps per doctrine Rule 1.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { z } from "zod"
import type { TaskStatus } from "@jamesaphoenix/tx-types"
import { TASK_STATUSES, serializeTask, assertTaskId } from "@jamesaphoenix/tx-types"

// Re-export for use in other modules
export { serializeTask }
import { TaskService, ReadyService, DependencyService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { normalizeLimit, MCP_MAX_LIMIT } from "./index.js"

// -----------------------------------------------------------------------------
// Tool Handlers (extracted to avoid deep type inference issues with MCP SDK)
// -----------------------------------------------------------------------------

const handleReady = async (args: { limit?: number }): Promise<McpToolResult> => {
  try {
    const effectiveLimit = normalizeLimit(args.limit)
    const tasks = await runEffect(
      Effect.gen(function* () {
        const ready = yield* ReadyService
        return yield* ready.getReady(effectiveLimit)
      })
    )
    const serialized = tasks.map(serializeTask)
    return {
      content: [
        { type: "text", text: `Found ${tasks.length} ready task(s)` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_ready", args, error)
  }
}

const handleShow = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.id)
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.getWithDeps(taskId)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Task: ${task.title}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_show", args, error)
  }
}

const handleList = async (args: { status?: TaskStatus; parentId?: string; limit?: number }): Promise<McpToolResult> => {
  try {
    const parentId = args.parentId != null ? assertTaskId(args.parentId) : undefined
    const effectiveLimit = normalizeLimit(args.limit)
    const tasks = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.listWithDeps({
          status: args.status,
          parentId,
          limit: effectiveLimit
        })
      })
    )
    const serialized = tasks.map(serializeTask)
    return {
      content: [
        { type: "text", text: `Found ${tasks.length} task(s)` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_list", args, error)
  }
}

const handleChildren = async (args: { id: string; limit?: number }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.id)
    const effectiveLimit = normalizeLimit(args.limit)
    const tasks = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.listWithDeps({ parentId: taskId, limit: effectiveLimit })
      })
    )
    const serialized = tasks.map(serializeTask)
    return {
      content: [
        { type: "text", text: `Found ${tasks.length} child task(s)` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_children", args, error)
  }
}

const handleAdd = async (args: {
  title: string
  description?: string
  parentId?: string
  score?: number
}): Promise<McpToolResult> => {
  try {
    const parentId = args.parentId != null ? assertTaskId(args.parentId) : undefined
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const created = yield* taskService.create({
          title: args.title,
          description: args.description ?? undefined,
          parentId,
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
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_add", args, error)
  }
}

const handleUpdate = async (args: {
  id: string
  title?: string
  description?: string
  status?: TaskStatus
  parentId?: string | null
  score?: number
}): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.id)
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.update(taskId, {
          title: args.title ?? undefined,
          description: args.description ?? undefined,
          status: args.status,
          parentId: args.parentId,
          score: args.score ?? undefined
        })
        return yield* taskService.getWithDeps(taskId)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Updated task: ${task.id}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_update", args, error)
  }
}

const handleDone = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.id)
    const result = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const readyService = yield* ReadyService

        // Get tasks that this task blocks (before completing)
        const blocking = yield* readyService.getBlocking(taskId)

        // Mark the task as done
        yield* taskService.update(taskId, { status: "done" })

        // Get the updated task with deps
        const completedTask = yield* taskService.getWithDeps(taskId)

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
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_done", args, error)
  }
}

const handleDelete = async (args: { id: string; cascade?: boolean }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.id)
    const cascade = args.cascade ?? false
    await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.remove(taskId, { cascade })
      })
    )
    return {
      content: [
        { type: "text", text: `Deleted task: ${args.id}${cascade ? " (with children)" : ""}` },
        { type: "text", text: JSON.stringify({ success: true, id: args.id, cascade }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_delete", args, error)
  }
}

const handleBlock = async (args: { taskId: string; blockerId: string }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    const blockerId = assertTaskId(args.blockerId)
    const task = await runEffect(
      Effect.gen(function* () {
        const depService = yield* DependencyService
        const taskService = yield* TaskService

        yield* depService.addBlocker(taskId, blockerId)
        return yield* taskService.getWithDeps(taskId)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Added dependency: ${args.blockerId} blocks ${args.taskId}` },
        { type: "text", text: JSON.stringify({ success: true, task: serialized }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_block", args, error)
  }
}

const handleUnblock = async (args: { taskId: string; blockerId: string }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    const blockerId = assertTaskId(args.blockerId)
    const task = await runEffect(
      Effect.gen(function* () {
        const depService = yield* DependencyService
        const taskService = yield* TaskService

        yield* depService.removeBlocker(taskId, blockerId)
        return yield* taskService.getWithDeps(taskId)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Removed dependency: ${args.blockerId} no longer blocks ${args.taskId}` },
        { type: "text", text: JSON.stringify({ success: true, task: serialized }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_unblock", args, error)
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
    { limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of tasks to return (default: 100, max: ${MCP_MAX_LIMIT})`) },
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
      status: z.enum(TASK_STATUSES).optional().describe(`Filter by status: ${TASK_STATUSES.join(", ")}`),
      parentId: z.string().optional().describe("Filter by parent task ID"),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of tasks to return (default: 100, max: ${MCP_MAX_LIMIT})`)
    },
    handleList as Parameters<typeof server.tool>[3]
  )

  // tx_children - List children of a task
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_children",
    "List direct children of a task",
    {
      id: z.string().describe("Parent task ID"),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of children to return (default: 100, max: ${MCP_MAX_LIMIT})`)
    },
    handleChildren as Parameters<typeof server.tool>[3]
  )

  // tx_add - Create a new task
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_add",
    "Create a new task",
    {
      title: z.string().max(1000).describe("Task title (required, max 1000 chars)"),
      description: z.string().max(10000).optional().describe("Task description (max 10000 chars)"),
      parentId: z.string().optional().describe("Parent task ID for subtasks"),
      score: z.number().int().finite().min(-10000).max(10000).optional().describe("Priority score (higher = more important, range: -10000 to 10000)")
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
      title: z.string().max(1000).optional().describe("New title (max 1000 chars)"),
      description: z.string().max(10000).optional().describe("New description (max 10000 chars)"),
      status: z.enum(TASK_STATUSES).optional().describe(`New status: ${TASK_STATUSES.join(", ")}`),
      parentId: z.string().nullable().optional().describe("New parent ID (null to remove parent)"),
      score: z.number().int().finite().min(-10000).max(10000).optional().describe("New priority score (range: -10000 to 10000)")
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
    "Delete a task permanently. Fails if the task has children unless cascade is true.",
    {
      id: z.string().describe("Task ID to delete"),
      cascade: z.boolean().optional().describe("If true, delete all descendant tasks. If false (default), fail when children exist.")
    },
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
