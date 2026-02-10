/**
 * Message types for tx
 *
 * Type definitions for agent outbox messaging (PRD-024).
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Valid message statuses.
 * Two-state lifecycle: pending -> acked
 */
export const MESSAGE_STATUSES = ["pending", "acked"] as const

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Message status - pending or acked. */
export const MessageStatusSchema = Schema.Literal(...MESSAGE_STATUSES)
export type MessageStatus = typeof MessageStatusSchema.Type

/** Message ID - branded integer. */
export const MessageIdSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("MessageId")
)
export type MessageId = typeof MessageIdSchema.Type

/** Message entity - an outbox message in a channel. */
export const MessageSchema = Schema.Struct({
  id: MessageIdSchema,
  channel: Schema.String,
  sender: Schema.String,
  content: Schema.String,
  status: MessageStatusSchema,
  correlationId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  createdAt: Schema.DateFromSelf,
  ackedAt: Schema.NullOr(Schema.DateFromSelf),
  expiresAt: Schema.NullOr(Schema.DateFromSelf),
})
export type Message = typeof MessageSchema.Type

/** Input for sending a new message. */
export const SendMessageInputSchema = Schema.Struct({
  channel: Schema.String,
  sender: Schema.String,
  content: Schema.String,
  correlationId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  ttlSeconds: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
})
export type SendMessageInput = typeof SendMessageInputSchema.Type

/** Filter for reading inbox messages. */
export const InboxFilterSchema = Schema.Struct({
  channel: Schema.String,
  afterId: Schema.optional(Schema.Number.pipe(Schema.int())),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  sender: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  includeAcked: Schema.optional(Schema.Boolean),
  excludeExpired: Schema.optional(Schema.Boolean),
})
export type InboxFilter = typeof InboxFilterSchema.Type

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for messages (snake_case from SQLite). */
export interface MessageRow {
  id: number
  channel: string
  sender: string
  content: string
  status: string
  correlation_id: string | null
  task_id: string | null
  metadata: string
  created_at: string
  acked_at: string | null
  expires_at: string | null
}

// =============================================================================
// RUNTIME VALIDATORS
// =============================================================================

/** Check if a string is a valid MessageStatus. */
export const isValidMessageStatus = (s: string): s is MessageStatus => {
  const statuses: readonly string[] = MESSAGE_STATUSES
  return statuses.includes(s)
}

/** Runtime error for invalid message status from database. */
export class InvalidMessageStatusError extends Error {
  readonly status: string
  constructor(opts: { status: string; id: number }) {
    super(`Invalid message status "${opts.status}" for message ${opts.id}`)
    this.name = "InvalidMessageStatusError"
    this.status = opts.status
  }
}

/** Assert a string is a valid MessageStatus, throwing if not. */
export const assertMessageStatus = (s: string, id: number): MessageStatus => {
  if (!isValidMessageStatus(s)) {
    throw new InvalidMessageStatusError({ status: s, id })
  }
  return s
}
