/**
 * Health Route Handlers
 *
 * Implements health check and stats endpoint handlers.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { TaskService, LearningService, RunRepository } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const HealthLive = HttpApiBuilder.group(TxApi, "health", (handlers) =>
  handlers
    .handle("health", () =>
      Effect.gen(function* () {
        let dbConnected = true

        const result = yield* Effect.gen(function* () {
          const taskService = yield* TaskService
          yield* taskService.listWithDeps({ limit: 1 })
        }).pipe(Effect.either)

        if (result._tag === "Left") {
          dbConnected = false
        }

        // Only expose database path when auth is not configured (dev mode)
        const dbPath = !process.env.TX_API_KEY
          ? (process.env.TX_DB_PATH ?? ".tx/tasks.db")
          : null

        return {
          status: dbConnected ? "healthy" as const : "degraded" as const,
          timestamp: new Date().toISOString(),
          version: "0.1.0",
          database: {
            connected: dbConnected,
            path: dbPath,
          },
        }
      })
    )

    .handle("stats", () =>
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const learningService = yield* LearningService
        const runRepo = yield* RunRepository

        const allTasks = yield* taskService.listWithDeps({})
        const learningsCount = yield* learningService.count()
        const runCounts = yield* runRepo.countByStatus()

        let done = 0
        let ready = 0
        for (const task of allTasks) {
          if (task.status === "done") done++
          if (task.isReady) ready++
        }

        const runsTotal = Object.values(runCounts).reduce((a, b) => a + b, 0)

        return {
          tasks: allTasks.length,
          done,
          ready,
          learnings: learningsCount,
          runsRunning: runCounts.running ?? 0,
          runsTotal,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("ralph", () =>
      Effect.gen(function* () {
        const fs = yield* Effect.promise(() => import("node:fs"))
        const path = yield* Effect.promise(() => import("node:path"))

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
        } catch (error) {
          console.warn(
            `[health] Failed to parse RALPH state file at ${stateFile}:`,
            error instanceof Error ? error.message : String(error)
          )
        }

        return {
          running,
          pid,
          currentIteration,
          currentTask,
          recentActivity: [] as Array<{
            timestamp: string
            iteration: number
            task: string
            taskTitle: string
            agent: string
            status: "started" | "completed" | "failed"
          }>,
        }
      })
    )
)
