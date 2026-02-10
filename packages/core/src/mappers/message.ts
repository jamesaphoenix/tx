/**
 * Message mappers - convert database rows to domain objects
 *
 * PRD-024: Agent Outbox Messaging
 */

import type {
  Message,
  MessageRow,
} from "@jamesaphoenix/tx-types"
import { MESSAGE_STATUSES, isValidMessageStatus } from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

// Re-export types and constants from @tx/types for convenience
export type { MessageRow } from "@jamesaphoenix/tx-types"
export { MESSAGE_STATUSES, isValidMessageStatus }

/**
 * Safely parse JSON metadata from a database string.
 * Returns empty object on any parse failure.
 */
const safeParseMetadata = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
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
 * Convert a database row to a Message domain object.
 * Validates status field at runtime.
 */
export const rowToMessage = (row: MessageRow): Message => {
  if (!isValidMessageStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "message",
      status: row.status,
      validStatuses: MESSAGE_STATUSES,
      rowId: row.id
    })
  }
  return {
    // eslint-disable-next-line tx/no-as-cast-in-repos -- branded integer ID from SQLite autoincrement
    id: row.id as Message["id"],
    channel: row.channel,
    sender: row.sender,
    content: row.content,
    status: row.status,
    correlationId: row.correlation_id,
    taskId: row.task_id,
    metadata: safeParseMetadata(row.metadata),
    createdAt: parseDate(row.created_at, "created_at", row.id),
    ackedAt: row.acked_at ? parseDate(row.acked_at, "acked_at", row.id) : null,
    expiresAt: row.expires_at ? parseDate(row.expires_at, "expires_at", row.id) : null,
  }
}
