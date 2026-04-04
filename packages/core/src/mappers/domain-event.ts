/**
 * Domain event mappers - convert database rows to domain objects
 */

import type {
  DomainEventEnvelope,
  DomainEventRow,
} from "@jamesaphoenix/tx-types"

/**
 * Safely parse a JSON string, returning empty object on failure.
 */
const safeParseJson = (json: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(json || "{}")
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = value
      }
      return result
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Safely parse a JSON payload (can be any value).
 */
const safeParsePayload = (json: string | null | undefined): unknown => {
  try {
    return JSON.parse(json || "{}")
  } catch {
    return {}
  }
}

/**
 * Convert a database row to a DomainEventEnvelope domain object.
 */
export const rowToDomainEvent = (row: DomainEventRow): DomainEventEnvelope => {
  return {
    id: row.event_id,
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    streamType: row.stream_type,
    streamId: row.stream_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    schemaVersion: row.schema_version,
    payload: safeParsePayload(row.payload),
    metadata: safeParseJson(row.metadata),
  }
}
