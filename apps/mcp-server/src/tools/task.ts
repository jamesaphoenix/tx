/**
 * Task-related MCP Tools
 *
 * Provides MCP tools for task CRUD operations, dependencies, and hierarchy.
 * All tools return TaskWithDeps per doctrine Rule 1.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import type { TaskStatus } from "@jamesaphoenix/tx-types"
import { TASK_STATUSES, serializeTask, assertTaskId } from "@jamesaphoenix/tx-types"

// Re-export for use in other modules
export { serializeTask }
import { TaskService, ReadyService, DependencyService, HierarchyService, LearningService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { normalizeLimit, MCP_MAX_LIMIT } from "./index.js"

// -----------------------------------------------------------------------------
// Tool Handlers (extracted to avoid deep type inference issues with MCP SDK)
// -----------------------------------------------------------------------------

const handleReady = async (args: { limit?: number; labels?: string; excludeLabels?: string }): Promise<McpToolResult> => {
  try {
    const effectiveLimit = normalizeLimit(args.limit)
    const labels = args.labels ? args.labels.split(",").map(s => s.trim()).filter(Boolean) : undefined
    const excludeLabels = args.excludeLabels ? args.excludeLabels.split(",").map(s => s.trim()).filter(Boolean) : undefined
    const tasks = await runEffect(
      Effect.gen(function* () {
        const ready = yield* ReadyService
        return yield* ready.getReady(effectiveLimit, {
          labels: labels?.length ? labels : undefined,
          excludeLabels: excludeLabels?.length ? excludeLabels : undefined,
        })
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

const handleList = async (args: { status?: TaskStatus; parentId?: string; limit?: number; labels?: string; excludeLabels?: string }): Promise<McpToolResult> => {
  try {
    const parentId = args.parentId != null ? assertTaskId(args.parentId) : undefined
    const effectiveLimit = normalizeLimit(args.limit)
    const labels = args.labels ? args.labels.split(",").map(s => s.trim()).filter(Boolean) : undefined
    const excludeLabels = args.excludeLabels ? args.excludeLabels.split(",").map(s => s.trim()).filter(Boolean) : undefined
    const tasks = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.listWithDeps({
          status: args.status,
          parentId,
          limit: effectiveLimit,
          labels: labels?.length ? labels : undefined,
          excludeLabels: excludeLabels?.length ? excludeLabels : undefined,
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
        }, { actor: "agent" })
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
        yield* taskService.update(taskId, { status: "done" }, { actor: "agent" })

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

const handleGroupContextSet = async (args: { taskId: string; context: string }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.setGroupContext(taskId, args.context)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Updated task-group context for ${args.taskId}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_group_context_set", args, error)
  }
}

const handleGroupContextClear = async (args: { taskId: string }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.taskId)
    const task = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        return yield* taskService.clearGroupContext(taskId)
      })
    )
    const serialized = serializeTask(task)
    return {
      content: [
        { type: "text", text: `Cleared task-group context for ${args.taskId}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_group_context_clear", args, error)
  }
}

const handleTree = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    const taskId = assertTaskId(args.id)
    const tree = await runEffect(
      Effect.gen(function* () {
        const hierarchyService = yield* HierarchyService
        return yield* hierarchyService.getTree(taskId)
      })
    )
    return {
      content: [
        { type: "text", text: `Task tree for ${args.id}` },
        { type: "text", text: JSON.stringify(tree) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_tree", args, error)
  }
}

const handleStats = async (): Promise<McpToolResult> => {
  try {
    const stats = await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const readyService = yield* ReadyService
        const learningService = yield* LearningService

        const total = yield* taskService.count()
        const done = yield* taskService.count({ status: "done" })
        const readyTasks = yield* readyService.getReady(MCP_MAX_LIMIT)
        const learnings = yield* learningService.count()

        return {
          tasks: total,
          done,
          ready: readyTasks.length,
          learnings
        }
      })
    )
    return {
      content: [
        { type: "text", text: `Stats: ${stats.tasks} tasks (${stats.done} done, ${stats.ready} ready), ${stats.learnings} learnings` },
        { type: "text", text: JSON.stringify(stats) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_stats", {}, error)
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
  registerEffectTool(server,
    "tx_ready",
    "List tasks ready to be worked on (no incomplete blockers). Supports label filtering.",
    {
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of tasks to return (default: 100, max: ${MCP_MAX_LIMIT})`),
      labels: z.string().optional().describe("Comma-separated label names to include (e.g. 'phase:implement,sprint:w10')"),
      excludeLabels: z.string().optional().describe("Comma-separated label names to exclude (e.g. 'needs-review')"),
    },
    handleReady
  )

  // tx_show - Show a single task with full dependency info
  registerEffectTool(server,
    "tx_show",
    "Show detailed information about a task including dependencies",
    { id: z.string().describe("Task ID to show") },
    handleShow
  )

  // tx_list - List tasks with optional filters
  registerEffectTool(server,
    "tx_list",
    "List tasks with optional filters for status, parent, labels, and limit",
    {
      status: z.enum(TASK_STATUSES).optional().describe(`Filter by status: ${TASK_STATUSES.join(", ")}`),
      parentId: z.string().optional().describe("Filter by parent task ID"),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of tasks to return (default: 100, max: ${MCP_MAX_LIMIT})`),
      labels: z.string().optional().describe("Comma-separated label names to include (e.g. 'phase:implement,sprint:w10')"),
      excludeLabels: z.string().optional().describe("Comma-separated label names to exclude (e.g. 'needs-review')"),
    },
    handleList
  )

  // tx_children - List children of a task
  registerEffectTool(server,
    "tx_children",
    "List direct children of a task",
    {
      id: z.string().describe("Parent task ID"),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of children to return (default: 100, max: ${MCP_MAX_LIMIT})`)
    },
    handleChildren
  )

  // tx_add - Create a new task
  registerEffectTool(server,
    "tx_add",
    "Create a new task",
    {
      title: z.string().max(1000).describe("Task title (required, max 1000 chars)"),
      description: z.string().max(10000).optional().describe("Task description (max 10000 chars)"),
      parentId: z.string().optional().describe("Parent task ID for subtasks"),
      score: z.number().int().finite().min(-10000).max(10000).optional().describe("Priority score (higher = more important, range: -10000 to 10000)")
    },
    handleAdd
  )

  // tx_update - Update an existing task
  registerEffectTool(server,
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
    handleUpdate
  )

  // tx_done - Mark a task as complete
  registerEffectTool(server,
    "tx_done",
    "Mark a task as complete and return any tasks that are now ready",
    { id: z.string().describe("Task ID to complete") },
    handleDone
  )

  // tx_delete - Delete a task
  registerEffectTool(server,
    "tx_delete",
    "Delete a task permanently. Fails if the task has children unless cascade is true.",
    {
      id: z.string().describe("Task ID to delete"),
      cascade: z.boolean().optional().describe("If true, delete all descendant tasks. If false (default), fail when children exist.")
    },
    handleDelete
  )

  // tx_block - Add a dependency (blocker blocks taskId)
  registerEffectTool(server,
    "tx_block",
    "Add a dependency: blockerId blocks taskId (taskId cannot start until blockerId is done). Rejects circular dependencies.",
    {
      taskId: z.string().describe("Task ID that will be blocked"),
      blockerId: z.string().describe("Task ID that blocks the other task")
    },
    handleBlock
  )

  // tx_unblock - Remove a dependency
  registerEffectTool(server,
    "tx_unblock",
    "Remove a dependency: blockerId no longer blocks taskId",
    {
      taskId: z.string().describe("Task ID that is currently blocked"),
      blockerId: z.string().describe("Task ID to remove as a blocker")
    },
    handleUnblock
  )

  // tx_group_context_set - Set direct task-group context on a task
  registerEffectTool(server,
    "tx_group_context_set",
    "Set direct task-group context on a task. The context is inherited by related ancestor/descendant tasks.",
    {
      taskId: z.string().describe("Task ID to set context on"),
      context: z.string().max(20000).describe("Group context text")
    },
    handleGroupContextSet
  )

  // tx_group_context_clear - Clear direct task-group context from a task
  registerEffectTool(server,
    "tx_group_context_clear",
    "Clear direct task-group context from a task and recompute effective inherited context.",
    {
      taskId: z.string().describe("Task ID to clear context from")
    },
    handleGroupContextClear
  )

  // tx_tree - Show task subtree
  registerEffectTool(server,
    "tx_tree",
    "Show the full subtree of a task including all descendants. Returns a nested tree structure.",
    {
      id: z.string().describe("Root task ID to show tree for")
    },
    handleTree
  )

  // tx_stats - Aggregate queue statistics
  registerEffectTool(server,
    "tx_stats",
    "Get aggregate queue statistics: total tasks, done, ready, and learnings count.",
    {},
    handleStats
  )
}
