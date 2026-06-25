/**
 * DomainEventRepository — database operations for the canonical domain event ledger.
 *
 * Append-only event store for supervision and review lifecycle events.
 * Application code never updates historical rows.
 * See DD-039 for specification.
 */
import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToDomainEvent } from "../mappers/domain-event.js"
import type {
  DomainEventEnvelope,
  DomainEventRow,
} from "../types/index.js"

// =============================================================================
// TYPES
// =============================================================================

export type DomainEventInsertInput = {
  readonly eventId: string
  readonly occurredAt: string
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

export type TimelineQuery = {
  readonly eventType?: string
  readonly limit?: number
  readonly offset?: number
}

// =============================================================================
// SERVICE
// =============================================================================

export type DomainEventRepositoryService = {
  readonly append: (input: DomainEventInsertInput) => Effect.Effect<DomainEventEnvelope, DatabaseError>
  readonly listByStream: (
    streamType: string,
    streamId: string,
    limit?: number,
  ) => Effect.Effect<readonly DomainEventEnvelope[], DatabaseError>
  readonly listByAggregate: (
    aggregateType: string,
    aggregateId: string,
    limit?: number,
  ) => Effect.Effect<readonly DomainEventEnvelope[], DatabaseError>
  readonly listTimeline: (
    query?: TimelineQuery,
  ) => Effect.Effect<readonly DomainEventEnvelope[], DatabaseError>
}

export class DomainEventRepository extends Context.Tag("DomainEventRepository")<
  DomainEventRepository,
  DomainEventRepositoryService
>() {}

export const DomainEventRepositoryLive = Layer.effect(
  DomainEventRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      append: (input: DomainEventInsertInput) =>
        Effect.try({
          try: () => {
            db.prepare(
              `INSERT INTO domain_events
               (event_id, occurred_at, event_type, stream_type, stream_id,
                aggregate_type, aggregate_id, correlation_id, causation_id,
                actor_type, actor_id, schema_version, payload, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              input.eventId,
              input.occurredAt,
              input.eventType,
              input.streamType,
              input.streamId,
              input.aggregateType,
              input.aggregateId,
              input.correlationId ?? null,
              input.causationId ?? null,
              input.actorType ?? null,
              input.actorId ?? null,
              input.schemaVersion ?? 1,
              JSON.stringify(input.payload),
              JSON.stringify(input.metadata ?? {}),
            )
            const row = db
              .prepare<DomainEventRow>(
                "SELECT * FROM domain_events WHERE event_id = ?"
              )
              .get(input.eventId)
            if (!row) {
              throw new EntityFetchError({
                entity: "domain_event",
                id: input.eventId,
                operation: "insert",
              })
            }
            return rowToDomainEvent(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      listByStream: (
        streamType: string,
        streamId: string,
        limit = 100,
      ) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DomainEventRow>(
                `SELECT * FROM domain_events
                 WHERE stream_type = ? AND stream_id = ?
                 ORDER BY occurred_at DESC, id DESC
                 LIMIT ?`
              )
              .all(streamType, streamId, limit)
            return rows.map(rowToDomainEvent)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      listByAggregate: (
        aggregateType: string,
        aggregateId: string,
        limit = 100,
      ) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DomainEventRow>(
                `SELECT * FROM domain_events
                 WHERE aggregate_type = ? AND aggregate_id = ?
                 ORDER BY occurred_at DESC, id DESC
                 LIMIT ?`
              )
              .all(aggregateType, aggregateId, limit)
            return rows.map(rowToDomainEvent)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      listTimeline: (query?: TimelineQuery) =>
        Effect.try({
          try: () => {
            const conditions: string[] = []
            const params: unknown[] = []

            if (query?.eventType) {
              conditions.push("event_type = ?")
              params.push(query.eventType)
            }

            let sql = "SELECT * FROM domain_events"
            if (conditions.length > 0) {
              sql += " WHERE " + conditions.join(" AND ")
            }
            sql += " ORDER BY occurred_at DESC, id DESC"

            const limit = query?.limit ?? 100
            const offset = query?.offset ?? 0
            sql += " LIMIT ? OFFSET ?"
            params.push(limit, offset)

            const rows = db.prepare<DomainEventRow>(sql).all(...params)
            return rows.map(rowToDomainEvent)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
    }
  })
)
