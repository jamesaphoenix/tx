/**
 * Decision Route Handlers
 *
 * Implements decision lifecycle endpoint handlers for the spec-driven
 * development triangle.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { serializeDecision } from "@jamesaphoenix/tx-types"
import { DecisionService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const DecisionsLive = HttpApiBuilder.group(TxApi, "decisions", (handlers) =>
  handlers
    .handle("createDecision", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* DecisionService
        const decision = yield* svc.add({
          content: payload.content,
          question: payload.question ?? null,
          source: payload.source ?? "manual",
          taskId: payload.taskId ?? null,
          docId: payload.docId ?? null,
          commitSha: payload.commitSha ?? null,
        })
        return serializeDecision(decision)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listDecisions", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* DecisionService
        const decisions = yield* svc.list({
          status: urlParams.status,
          source: urlParams.source,
          limit: urlParams.limit,
        })
        return { decisions: decisions.map(serializeDecision) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getDecision", ({ path }) =>
      Effect.gen(function* () {
        const svc = yield* DecisionService
        const decision = yield* svc.show(path.id)
        return serializeDecision(decision)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("approveDecision", ({ path, payload }) =>
      Effect.gen(function* () {
        const svc = yield* DecisionService
        const decision = yield* svc.approve(path.id, payload.reviewer, payload.note)
        return serializeDecision(decision)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("rejectDecision", ({ path, payload }) =>
      Effect.gen(function* () {
        const svc = yield* DecisionService
        const decision = yield* svc.reject(path.id, payload.reviewer, payload.reason)
        return serializeDecision(decision)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("editDecision", ({ path, payload }) =>
      Effect.gen(function* () {
        const svc = yield* DecisionService
        const decision = yield* svc.edit(path.id, payload.content, payload.reviewer)
        return serializeDecision(decision)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("pendingDecisions", () =>
      Effect.gen(function* () {
        const svc = yield* DecisionService
        const decisions = yield* svc.pending()
        return { decisions: decisions.map(serializeDecision) }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
