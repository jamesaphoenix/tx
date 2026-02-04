/**
 * Health Check Routes
 *
 * Provides health check and stats endpoints for monitoring.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { Effect } from "effect"
import { TaskService } from "@jamesaphoenix/tx-core"
import { runEffect, getDbPath } from "../runtime.js"

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const HealthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  timestamp: z.string().datetime(),
  version: z.string(),
  database: z.object({
    connected: z.boolean(),
    path: z.string().nullable()
  })
})

const StatsResponseSchema = z.object({
  tasks: z.number(),
  done: z.number(),
  ready: z.number(),
  learnings: z.number(),
  runsRunning: z.number().optional(),
  runsTotal: z.number().optional()
})

const RalphActivitySchema = z.object({
  timestamp: z.string(),
  iteration: z.number(),
  task: z.string(),
  taskTitle: z.string(),
  agent: z.string(),
  status: z.enum(["started", "completed", "failed"])
})

const RalphResponseSchema = z.object({
  running: z.boolean(),
  pid: z.number().nullable(),
  currentIteration: z.number(),
  currentTask: z.string().nullable(),
  recentActivity: z.array(RalphActivitySchema)
})

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  description: "Returns the health status of the API server",
  responses: {
    200: {
      description: "Server is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema
        }
      }
    }
  }
})

const statsRoute = createRoute({
  method: "get",
  path: "/api/stats",
  tags: ["Health"],
  summary: "API statistics",
  description: "Returns statistics about tasks and sync status",
  responses: {
    200: {
      description: "Statistics retrieved successfully",
      content: {
        "application/json": {
          schema: StatsResponseSchema
        }
      }
    }
  }
})

const ralphRoute = createRoute({
  method: "get",
  path: "/api/ralph",
  tags: ["Health"],
  summary: "RALPH loop status",
  description: "Returns the status of the RALPH automation loop",
  responses: {
    200: {
      description: "RALPH status retrieved successfully",
      content: {
        "application/json": {
          schema: RalphResponseSchema
        }
      }
    }
  }
})

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export const healthRouter = new OpenAPIHono()

healthRouter.openapi(healthRoute, async (c) => {
  let dbConnected = true

  try {
    // Simple query to test database connection
    await runEffect(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.listWithDeps({ limit: 1 })
      })
    )
  } catch {
    dbConnected = false
  }

  return c.json({
    status: dbConnected ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
    database: {
      connected: dbConnected,
      path: getDbPath()
    }
  }, 200)
})

healthRouter.openapi(ralphRoute, async (c) => {
  // Check if RALPH is running by looking for the state file
  const fs = await import("node:fs")
  const path = await import("node:path")

  const stateFile = path.join(process.cwd(), ".tx", "ralph-state")
  let running = false
  let pid: number | null = null
  let currentIteration = 0
  let currentTask: string | null = null

  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"))
      running = state.running ?? false
      pid = state.pid ?? null
      currentIteration = state.iteration ?? 0
      currentTask = state.currentTask ?? null
    }
  } catch {
    // State file doesn't exist or is invalid
  }

  return c.json({
    running,
    pid,
    currentIteration,
    currentTask,
    recentActivity: []
  }, 200)
})

healthRouter.openapi(statsRoute, async (c) => {
  const stats = await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService

      const allTasks = yield* taskService.listWithDeps({})

      // Count tasks by status
      let done = 0
      let ready = 0
      for (const task of allTasks) {
        if (task.status === "done") done++
        if (task.isReady) ready++
      }

      return {
        tasks: allTasks.length,
        done,
        ready,
        learnings: 0, // TODO: Add learning count when LearningService is available
        runsRunning: 0,
        runsTotal: 0
      }
    })
  )

  return c.json(stats, 200)
})
