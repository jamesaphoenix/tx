/**
 * Health Route Handlers
 *
 * Implements health check and stats endpoint handlers.
 */

import { HttpApiBuilder, HttpServerRequest } from "@effect/platform"
import { Effect } from "effect"
import { TaskService } from "@jamesaphoenix/tx"
import { TxApi, mapCoreError } from "../api.js"
import { extractApiKey, timingSafeEqual } from "../middleware/auth.js"

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

        // Only expose database path when auth is enabled AND request is authenticated
        const showSensitive = yield* Effect.gen(function* () {
          const apiKey = process.env.TX_API_KEY
          if (!apiKey) return false

          const request = yield* HttpServerRequest.HttpServerRequest
          const providedKey = extractApiKey(request.headers as unknown as Record<string, string | undefined>)
          if (!providedKey) return false

          return timingSafeEqual(providedKey, apiKey)
        })
        const dbPath = showSensitive
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
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("stats", () =>
      Effect.gen(function* () {
        const taskService = yield* TaskService

        const allTasks = yield* taskService.listWithDeps({})

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
        }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
