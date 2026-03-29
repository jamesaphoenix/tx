/**
 * DomainEventService — DD-039
 *
 * The single entry point for all domain event emission.
 * No other code should call DomainEventRepo directly for publishing events.
 * Uses Effect-TS patterns per DD-002.
 */

import { Context, Effect, Layer, Schema } from "effect"
import {
  DomainEventRepository,
  type DomainEventInsertInput,
} from "../repo/domain-event-repo.js"
import { DatabaseError } from "../errors.js"
import { generateUlid } from "../utils/ulid.js"
import type { DomainEventEnvelope } from "@jamesaphoenix/tx-types"
import { SupervisionEventTypeSchema } from "@jamesaphoenix/tx-types"

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for publishing a domain event.
 * The service generates event_id (ULID) and occurred_at automatically.
 */
export type PublishDomainEventInput = {
  readonly eventType: string
  readonly streamType: string
  readonly streamId: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly correlationId?: string | null
  readonly causationId?: string | null
  readonly actorType?: string | null
  readonly actorId?: string | null
  readonly schemaVersion?: number
  readonly payload: unknown
  readonly metadata?: Record<string, unknown>
}

// =============================================================================
// SERVICE
// =============================================================================

export class DomainEventService extends Context.Tag("DomainEventService")<
  DomainEventService,
  {
    /**
     * Publish a domain event. Generates event_id via ULID and sets occurred_at.
     * Validates that eventType is a known supervision event type.
     * This is the single entry point for all domain event emission.
     */
    readonly publish: (
      input: PublishDomainEventInput
    ) => Effect.Effect<DomainEventEnvelope, DatabaseError>

    /**
     * List events by stream (stream_type + stream_id).
     * Delegates to DomainEventRepo.listByStream.
     */
    readonly listByStream: (
      streamType: string,
      streamId: string,
      limit?: number
    ) => Effect.Effect<readonly DomainEventEnvelope[], DatabaseError>

    /**
     * List events by aggregate (aggregate_type + aggregate_id).
     * Delegates to DomainEventRepo.listByAggregate.
     */
    readonly listByAggregate: (
      aggregateType: string,
      aggregateId: string,
      limit?: number
    ) => Effect.Effect<readonly DomainEventEnvelope[], DatabaseError>
  }
>() {}

export const DomainEventServiceLive = Layer.effect(
  DomainEventService,
  Effect.gen(function* () {
    const repo = yield* DomainEventRepository

    return {
      publish: (input: PublishDomainEventInput) =>
        Effect.gen(function* () {
          // Validate eventType is a known supervision event type
          const parseResult = Schema.decodeUnknownEither(SupervisionEventTypeSchema)(input.eventType)
          if (parseResult._tag === "Left") {
            return yield* Effect.fail(
              new DatabaseError({
                cause: new Error(`Invalid event type: '${input.eventType}'. Must be a known supervision event type.`),
              })
            )
          }

          const eventId = generateUlid()
          const occurredAt = new Date().toISOString()

          const insertInput: DomainEventInsertInput = {
            eventId,
            occurredAt,
            eventType: input.eventType,
            streamType: input.streamType,
            streamId: input.streamId,
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            correlationId: input.correlationId ?? null,
            causationId: input.causationId ?? null,
            actorType: input.actorType ?? null,
            actorId: input.actorId ?? null,
            schemaVersion: input.schemaVersion ?? 1,
            payload: input.payload,
            metadata: input.metadata ?? {},
          }

          return yield* repo.append(insertInput)
        }),

      listByStream: (streamType: string, streamId: string, limit?: number) =>
        repo.listByStream(streamType, streamId, limit),

      listByAggregate: (aggregateType: string, aggregateId: string, limit?: number) =>
        repo.listByAggregate(aggregateType, aggregateId, limit),
    }
  })
)
