/**
 * Reflect Route Handlers
 *
 * Implements reflect endpoint handlers for session retrospective.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { ReflectService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError } from "../api.js"

export const ReflectLive = HttpApiBuilder.group(TxApi, "reflect", (handlers) =>
  handlers
    .handle("reflect", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* ReflectService
        const result = yield* svc.reflect({
          sessions: urlParams.sessions,
          hours: urlParams.hours,
          analyze: urlParams.analyze === "true",
        })
        return {
          sessions: result.sessions,
          throughput: result.throughput,
          proliferation: result.proliferation,
          stuckTasks: [...result.stuckTasks],
          signals: [...result.signals],
          analysis: result.analysis,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
