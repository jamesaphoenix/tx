/**
 * Invariant Route Handlers
 *
 * Implements invariant endpoint handlers for listing, retrieving,
 * and recording invariant checks via DocService.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { DocService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError, NotFound } from "../api.js"

import type { Invariant, InvariantCheck } from "@jamesaphoenix/tx-types"

// Serialize an Invariant domain object for API responses.
// Preserves literal types (enforcement) by accepting the domain type directly.
const serializeInvariant = (inv: Invariant) => ({
  id: inv.id,
  rule: inv.rule,
  enforcement: inv.enforcement,
  docId: inv.docId,
  subsystem: inv.subsystem,
  status: inv.status,
  testRef: inv.testRef,
  lintRule: inv.lintRule,
  promptRef: inv.promptRef,
  createdAt: inv.createdAt.toISOString(),
})

// Serialize an InvariantCheck domain object for API responses
const serializeCheck = (check: InvariantCheck) => ({
  id: check.id,
  invariantId: check.invariantId,
  passed: check.passed,
  details: check.details,
  durationMs: check.durationMs,
  checkedAt: check.checkedAt.toISOString(),
})

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const InvariantsLive = HttpApiBuilder.group(TxApi, "invariants", (handlers) =>
  handlers
    .handle("listInvariants", ({ urlParams }) =>
      Effect.gen(function* () {
        const docService = yield* DocService
        const invariants = yield* docService.listInvariants({
          subsystem: urlParams.subsystem,
          enforcement: urlParams.enforcement,
        })
        return { invariants: invariants.map(serializeInvariant) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getInvariant", ({ path }) =>
      Effect.gen(function* () {
        const docService = yield* DocService
        // TODO: Add DocService.getInvariant(id) method for O(1) lookup
        const all = yield* docService.listInvariants()
        const inv = all.find((i) => i.id === path.id)
        if (!inv) {
          return yield* Effect.fail(new NotFound({ message: `Invariant '${path.id}' not found` }))
        }
        return serializeInvariant(inv)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("recordInvariantCheck", ({ path, payload }) =>
      Effect.gen(function* () {
        const docService = yield* DocService
        const check = yield* docService.recordInvariantCheck(
          path.id,
          payload.passed,
          payload.details,
          payload.durationMs,
        )
        return serializeCheck(check)
      }).pipe(Effect.mapError(mapCoreError))
    )
)
