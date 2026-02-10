/**
 * Message Route Handlers
 *
 * Implements agent outbox messaging endpoint handlers (PRD-024).
 * Channel-based messaging with cursor support for fan-out.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { MessageService } from "@jamesaphoenix/tx-core"
import { serializeMessage } from "@jamesaphoenix/tx-types"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const MessagesLive = HttpApiBuilder.group(TxApi, "messages", (handlers) =>
  handlers
    .handle("sendMessage", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* MessageService
        const message = yield* svc.send({
          channel: payload.channel,
          sender: payload.sender ?? "api",
          content: payload.content,
          correlationId: payload.correlationId ?? null,
          taskId: payload.taskId ?? null,
          metadata: payload.metadata,
          ttlSeconds: payload.ttlSeconds,
        })
        return serializeMessage(message)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("inbox", ({ path: { channel }, urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* MessageService
        const messages = yield* svc.inbox({
          channel,
          afterId: urlParams.afterId,
          limit: urlParams.limit,
          sender: urlParams.sender,
          correlationId: urlParams.correlationId,
          includeAcked: urlParams.includeAcked === "true",
        })
        return {
          messages: messages.map(serializeMessage),
          channel,
          count: messages.length,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("ackMessage", ({ path: { id } }) =>
      Effect.gen(function* () {
        const svc = yield* MessageService
        const message = yield* svc.ack(id)
        return { message: serializeMessage(message) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("ackAllMessages", ({ path: { channel } }) =>
      Effect.gen(function* () {
        const svc = yield* MessageService
        const count = yield* svc.ackAll(channel)
        return { channel, ackedCount: count }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("pendingCount", ({ path: { channel } }) =>
      Effect.gen(function* () {
        const svc = yield* MessageService
        const count = yield* svc.pending(channel)
        return { channel, count }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("gcMessages", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* MessageService
        const result = yield* svc.gc({
          ackedOlderThanHours: payload.ackedOlderThanHours,
        })
        return { expired: result.expired, acked: result.acked }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
