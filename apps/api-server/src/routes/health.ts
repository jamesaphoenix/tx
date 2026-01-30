/**
 * Health Check Routes
 *
 * Provides health check and stats endpoints for monitoring.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { Effect } from "effect"
import { TaskService, SyncService } from "@tx/core"
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
  tasks: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number())
  }),
  sync: z.object({
    dbTaskCount: z.number(),
    jsonlOpCount: z.number(),
    isDirty: z.boolean(),
    autoSyncEnabled: z.boolean()
  })
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

healthRouter.openapi(statsRoute, async (c) => {
  const stats = await runEffect(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      const syncService = yield* SyncService

      const allTasks = yield* taskService.listWithDeps({})
      const syncStatus = yield* syncService.status()

      // Count tasks by status
      const byStatus: Record<string, number> = {}
      for (const task of allTasks) {
        byStatus[task.status] = (byStatus[task.status] ?? 0) + 1
      }

      return {
        tasks: {
          total: allTasks.length,
          byStatus
        },
        sync: {
          dbTaskCount: syncStatus.dbTaskCount,
          jsonlOpCount: syncStatus.jsonlOpCount,
          isDirty: syncStatus.isDirty,
          autoSyncEnabled: syncStatus.autoSyncEnabled
        }
      }
    })
  )

  return c.json(stats, 200)
})
