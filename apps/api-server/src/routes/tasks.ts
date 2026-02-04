/**
 * Task Routes
 *
 * Provides REST API endpoints for task CRUD operations with cursor-based pagination.
 * All responses return TaskWithDeps per doctrine Rule 1.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { Effect } from "effect"
import type { TaskId, TaskStatus, TaskWithDeps, TaskCursor } from "@jamesaphoenix/tx-types"
import { TASK_STATUSES, isValidTaskStatus, serializeTask } from "@jamesaphoenix/tx-types"
import { TaskService, ReadyService, DependencyService, HierarchyService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const TaskIdSchema = z.string().regex(/^tx-[a-z0-9]{6,8}$/).openapi({
  example: "tx-abc123",
  description: "Task ID in format tx-[a-z0-9]{6,8}"
})

const TaskStatusSchema = z.enum(TASK_STATUSES).openapi({
  example: "active",
  description: "Task status"
})

const TaskWithDepsSchema = z.object({
  id: TaskIdSchema,
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  parentId: TaskIdSchema.nullable(),
  score: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  metadata: z.record(z.unknown()),
  blockedBy: z.array(TaskIdSchema),
  blocks: z.array(TaskIdSchema),
  children: z.array(TaskIdSchema),
  isReady: z.boolean()
}).openapi("TaskWithDeps")

const PaginatedTasksSchema = z.object({
  tasks: z.array(TaskWithDepsSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  total: z.number().int()
}).openapi("PaginatedTasks")

const TaskDetailSchema = z.object({
  task: TaskWithDepsSchema,
  blockedByTasks: z.array(TaskWithDepsSchema),
  blocksTasks: z.array(TaskWithDepsSchema),
  childTasks: z.array(TaskWithDepsSchema)
}).openapi("TaskDetail")

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  parentId: TaskIdSchema.optional(),
  score: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional()
}).openapi("CreateTask")

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  parentId: TaskIdSchema.nullable().optional(),
  score: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional()
}).openapi("UpdateTask")

const BlockDependencySchema = z.object({
  blockerId: TaskIdSchema
}).openapi("BlockDependency")

// Type alias for Zod-inferred task type (mutable arrays required by Zod)
type ZodTask = z.infer<typeof TaskWithDepsSchema>

// Helper to convert readonly TaskWithDepsSerialized to mutable ZodTask
// This is needed because the shared serializeTask returns readonly arrays
// but Zod's inferred type expects mutable arrays
const toZodTask = (task: TaskWithDeps): ZodTask => {
  const serialized = serializeTask(task)
  return {
    ...serialized,
    blockedBy: [...serialized.blockedBy],
    blocks: [...serialized.blocks],
    children: [...serialized.children]
  }
}

// -----------------------------------------------------------------------------
// Cursor Pagination Helpers
// -----------------------------------------------------------------------------

interface ParsedCursor {
  score: number
  id: string
}

const parseCursor = (cursor: string): ParsedCursor | null => {
  const colonIndex = cursor.lastIndexOf(":")
  if (colonIndex === -1) return null
  const score = parseInt(cursor.slice(0, colonIndex), 10)
  const id = cursor.slice(colonIndex + 1)
  if (isNaN(score)) return null
  return { score, id }
}

const buildCursor = (task: TaskWithDeps): string => {
  return `${task.score}:${task.id}`
}

// -----------------------------------------------------------------------------
// Route Definitions
// -----------------------------------------------------------------------------

const listTasksRoute = createRoute({
  method: "get",
  path: "/api/tasks",
  tags: ["Tasks"],
  summary: "List tasks with cursor-based pagination",
  description: "Returns paginated tasks with optional filtering by status and search",
  request: {
    query: z.object({
      cursor: z.string().optional().openapi({ description: "Pagination cursor (format: score:id)" }),
      limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ description: "Items per page" }),
      status: z.string().optional().openapi({ description: "Comma-separated statuses to filter" }),
      search: z.string().optional().openapi({ description: "Search in title/description" })
    })
  },
  responses: {
    200: {
      description: "Paginated list of tasks",
      content: { "application/json": { schema: PaginatedTasksSchema } }
    },
    400: {
      description: "Invalid status filter",
      content: { "application/json": { schema: z.object({ error: z.string() }) } }
    }
  }
})

const readyTasksRoute = createRoute({
  method: "get",
  path: "/api/tasks/ready",
  tags: ["Tasks"],
  summary: "List ready tasks",
  description: "Returns tasks that are ready to work on (no incomplete blockers)",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(100).openapi({ description: "Maximum tasks to return" })
    })
  },
  responses: {
    200: {
      description: "List of ready tasks",
      content: { "application/json": { schema: z.object({ tasks: z.array(TaskWithDepsSchema) }) } }
    }
  }
})

const getTaskRoute = createRoute({
  method: "get",
  path: "/api/tasks/{id}",
  tags: ["Tasks"],
  summary: "Get task details",
  description: "Returns detailed task information including related tasks",
  request: {
    params: z.object({ id: TaskIdSchema })
  },
  responses: {
    200: {
      description: "Task details with related tasks",
      content: { "application/json": { schema: TaskDetailSchema } }
    },
    404: {
      description: "Task not found",
      content: { "application/json": { schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }) } }
    }
  }
})

const createTaskRoute = createRoute({
  method: "post",
  path: "/api/tasks",
  tags: ["Tasks"],
  summary: "Create a new task",
  request: {
    body: { content: { "application/json": { schema: CreateTaskSchema } } }
  },
  responses: {
    201: {
      description: "Task created successfully",
      content: { "application/json": { schema: TaskWithDepsSchema } }
    }
  }
})

const updateTaskRoute = createRoute({
  method: "patch",
  path: "/api/tasks/{id}",
  tags: ["Tasks"],
  summary: "Update a task",
  request: {
    params: z.object({ id: TaskIdSchema }),
    body: { content: { "application/json": { schema: UpdateTaskSchema } } }
  },
  responses: {
    200: {
      description: "Task updated successfully",
      content: { "application/json": { schema: TaskWithDepsSchema } }
    },
    404: { description: "Task not found" }
  }
})

const completeTaskRoute = createRoute({
  method: "post",
  path: "/api/tasks/{id}/done",
  tags: ["Tasks"],
  summary: "Mark task as complete",
  description: "Marks task as done and returns any tasks that became ready",
  request: {
    params: z.object({ id: TaskIdSchema })
  },
  responses: {
    200: {
      description: "Task completed",
      content: {
        "application/json": {
          schema: z.object({
            task: TaskWithDepsSchema,
            nowReady: z.array(TaskWithDepsSchema)
          })
        }
      }
    },
    404: { description: "Task not found" }
  }
})

const deleteTaskRoute = createRoute({
  method: "delete",
  path: "/api/tasks/{id}",
  tags: ["Tasks"],
  summary: "Delete a task",
  request: {
    params: z.object({ id: TaskIdSchema })
  },
  responses: {
    200: {
      description: "Task deleted",
      content: { "application/json": { schema: z.object({ success: z.boolean(), id: TaskIdSchema }) } }
    },
    404: { description: "Task not found" }
  }
})

const blockTaskRoute = createRoute({
  method: "post",
  path: "/api/tasks/{id}/block",
  tags: ["Tasks"],
  summary: "Add a blocker dependency",
  description: "Makes blockerId block this task (task cannot start until blocker is done)",
  request: {
    params: z.object({ id: TaskIdSchema }),
    body: { content: { "application/json": { schema: BlockDependencySchema } } }
  },
  responses: {
    200: {
      description: "Dependency added",
      content: { "application/json": { schema: TaskWithDepsSchema } }
    },
    400: { description: "Invalid dependency (circular or self-blocking)" },
    404: { description: "Task not found" }
  }
})

const unblockTaskRoute = createRoute({
  method: "delete",
  path: "/api/tasks/{id}/block/{blockerId}",
  tags: ["Tasks"],
  summary: "Remove a blocker dependency",
  request: {
    params: z.object({
      id: TaskIdSchema,
      blockerId: TaskIdSchema
    })
  },
  responses: {
    200: {
      description: "Dependency removed",
      content: { "application/json": { schema: TaskWithDepsSchema } }
    },
    404: { description: "Task or dependency not found" }
  }
})

const getTaskTreeRoute = createRoute({
  method: "get",
  path: "/api/tasks/{id}/tree",
  tags: ["Tasks"],
  summary: "Get task subtree",
  description: "Returns the task and all descendants in tree structure",
  request: {
    params: z.object({ id: TaskIdSchema })
  },
  responses: {
    200: {
      description: "Task tree",
      content: { "application/json": { schema: z.object({ tasks: z.array(TaskWithDepsSchema) }) } }
    },
    404: { description: "Task not found" }
  }
})

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export const tasksRouter = new OpenAPIHono()

tasksRouter.openapi(listTasksRoute, async (c) => {
  const { cursor, limit, status, search } = c.req.valid("query")

  // Validate status filter before entering Effect
  let statusFilter: TaskStatus[] | undefined
  if (status) {
    const statuses = status.split(",").filter(Boolean)
    const invalidStatuses = statuses.filter(s => !isValidTaskStatus(s))
    if (invalidStatuses.length > 0) {
      return c.json({ error: `Invalid status values: ${invalidStatuses.join(", ")}. Valid: ${TASK_STATUSES.join(", ")}` }, 400)
    }
    statusFilter = statuses as TaskStatus[]
  }

  const result = await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService

      // Parse cursor for keyset pagination
      let cursorObj: TaskCursor | undefined
      if (cursor) {
        const parsed = parseCursor(cursor)
        if (parsed) {
          cursorObj = { score: parsed.score, id: parsed.id }
        }
      }

      // Build filter with all SQL-supported parameters
      const filter = {
        status: statusFilter,
        search: search,
        cursor: cursorObj,
        limit: limit + 1 // Fetch one extra to detect hasMore
      }

      // Get total count (without cursor, to get full count of matching records)
      const total = yield* taskService.count({
        status: statusFilter,
        search: search
      })

      // Fetch tasks with SQL filtering, search, and cursor pagination
      const tasks = yield* taskService.listWithDeps(filter)

      const hasMore = tasks.length > limit
      const resultTasks = hasMore ? tasks.slice(0, limit) : tasks

      return {
        tasks: resultTasks,
        hasMore,
        total,
        nextCursor: hasMore && resultTasks.length > 0
          ? buildCursor(resultTasks[resultTasks.length - 1] as TaskWithDeps)
          : null
      }
    })
  )

  return c.json({
    tasks: result.tasks.map(toZodTask),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    total: result.total
  }, 200)
})

tasksRouter.openapi(readyTasksRoute, async (c) => {
  const { limit } = c.req.valid("query")

  const tasks = await runEffect(
    Effect.gen(function* () {
      const readyService = yield* ReadyService
      return yield* readyService.getReady(limit)
    })
  )

  return c.json({ tasks: tasks.map(toZodTask) }, 200)
})

tasksRouter.openapi(getTaskRoute, async (c) => {
  const { id } = c.req.valid("param")

  const detail = await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService

      const task = yield* taskService.getWithDeps(id as TaskId)

      // Fetch related tasks
      const blockedByTasks = yield* taskService.getWithDepsBatch(task.blockedBy)
      const blocksTasks = yield* taskService.getWithDepsBatch(task.blocks)
      const childTasks = yield* taskService.getWithDepsBatch(task.children)

      return { task, blockedByTasks, blocksTasks, childTasks }
    })
  )

  return c.json({
    task: toZodTask(detail.task),
    blockedByTasks: detail.blockedByTasks.map(toZodTask),
    blocksTasks: detail.blocksTasks.map(toZodTask),
    childTasks: detail.childTasks.map(toZodTask)
  }, 200)
})

tasksRouter.openapi(createTaskRoute, async (c) => {
  const body = c.req.valid("json")

  const task = await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      const created = yield* taskService.create({
        title: body.title,
        description: body.description,
        parentId: body.parentId,
        score: body.score,
        metadata: body.metadata
      })
      return yield* taskService.getWithDeps(created.id)
    })
  )

  return c.json(toZodTask(task), 201)
})

tasksRouter.openapi(updateTaskRoute, async (c) => {
  const { id } = c.req.valid("param")
  const body = c.req.valid("json")

  const task = await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      yield* taskService.update(id as TaskId, {
        title: body.title,
        description: body.description,
        status: body.status,
        parentId: body.parentId,
        score: body.score,
        metadata: body.metadata
      })
      return yield* taskService.getWithDeps(id as TaskId)
    })
  )

  return c.json(toZodTask(task), 200)
})

tasksRouter.openapi(completeTaskRoute, async (c) => {
  const { id } = c.req.valid("param")

  const result = await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      const readyService = yield* ReadyService

      // Get tasks that this task blocks (before completing)
      const blocking = yield* readyService.getBlocking(id as TaskId)

      // Mark the task as done
      yield* taskService.update(id as TaskId, { status: "done" })

      // Get the updated task
      const completedTask = yield* taskService.getWithDeps(id as TaskId)

      // Find newly unblocked tasks
      const candidateIds = blocking
        .filter(t => ["backlog", "ready", "planning"].includes(t.status))
        .map(t => t.id)
      const candidatesWithDeps = yield* taskService.getWithDepsBatch(candidateIds)
      const nowReady = candidatesWithDeps.filter(t => t.isReady)

      return { task: completedTask, nowReady }
    })
  )

  return c.json({
    task: toZodTask(result.task),
    nowReady: result.nowReady.map(toZodTask)
  }, 200)
})

tasksRouter.openapi(deleteTaskRoute, async (c) => {
  const { id } = c.req.valid("param")

  await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      yield* taskService.remove(id as TaskId)
    })
  )

  return c.json({ success: true, id }, 200)
})

tasksRouter.openapi(blockTaskRoute, async (c) => {
  const { id } = c.req.valid("param")
  const { blockerId } = c.req.valid("json")

  const task = await runEffect(
    Effect.gen(function* () {
      const depService = yield* DependencyService
      const taskService = yield* TaskService

      yield* depService.addBlocker(id as TaskId, blockerId as TaskId)
      return yield* taskService.getWithDeps(id as TaskId)
    })
  )

  return c.json(toZodTask(task), 200)
})

tasksRouter.openapi(unblockTaskRoute, async (c) => {
  const { id, blockerId } = c.req.valid("param")

  const task = await runEffect(
    Effect.gen(function* () {
      const depService = yield* DependencyService
      const taskService = yield* TaskService

      yield* depService.removeBlocker(id as TaskId, blockerId as TaskId)
      return yield* taskService.getWithDeps(id as TaskId)
    })
  )

  return c.json(toZodTask(task), 200)
})

tasksRouter.openapi(getTaskTreeRoute, async (c) => {
  const { id } = c.req.valid("param")

  const tasks = await runEffect(
    Effect.gen(function* () {
      const hierarchyService = yield* HierarchyService
      const taskService = yield* TaskService

      const tree = yield* hierarchyService.getTree(id as TaskId)

      // Flatten tree and get all task IDs
      type TreeNode = { task: { id: TaskId }; children: readonly TreeNode[] }
      const flattenTree = (node: TreeNode): TaskId[] => {
        const ids: TaskId[] = [node.task.id]
        for (const child of node.children) {
          ids.push(...flattenTree(child))
        }
        return ids
      }

      const allIds = flattenTree(tree)
      return yield* taskService.getWithDepsBatch(allIds)
    })
  )

  return c.json({ tasks: tasks.map(toZodTask) }, 200)
})
