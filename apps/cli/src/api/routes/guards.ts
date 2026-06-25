/**
 * Guard Route Handlers
 *
 * Implements guard endpoint handlers for task creation limits.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { GuardService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError } from "../api.js"

// Helper to serialize guard (Guard type from repo already has enforce: boolean)
const serializeGuard = (g: {
  id: number
  scope: string
  maxPending: number | null
  maxChildren: number | null
  maxDepth: number | null
  enforce: boolean
  createdAt: string | Date
}) => ({
  id: g.id,
  scope: g.scope,
  maxPending: g.maxPending ?? null,
  maxChildren: g.maxChildren ?? null,
  maxDepth: g.maxDepth ?? null,
  enforce: g.enforce,
  createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
})

export const GuardsLive = HttpApiBuilder.group(TxApi, "guards", (handlers) =>
  handlers
    .handle("setGuard", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* GuardService
        const guard = yield* svc.set({
          scope: payload.scope,
          maxPending: payload.maxPending,
          maxChildren: payload.maxChildren,
          maxDepth: payload.maxDepth,
          enforce: payload.enforce,
        })
        return serializeGuard(guard)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listGuards", () =>
      Effect.gen(function* () {
        const svc = yield* GuardService
        const guards = yield* svc.show()
        return { guards: guards.map(serializeGuard) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("clearGuards", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* GuardService
        const cleared = yield* svc.clear(urlParams.scope)
        return { cleared }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("checkGuard", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* GuardService
        const result = yield* svc.check(urlParams.parentId)
        return { passed: result.passed, warnings: [...result.warnings] }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
