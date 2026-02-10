/**
 * MessageRepository - PRD-024 Agent Outbox
 *
 * Repository for outbox_messages table.
 * Provides channel-based agent-to-agent messaging with cursor support.
 */

import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToMessage, type MessageRow } from "../mappers/message.js"
import type { Message } from "@jamesaphoenix/tx-types"

export class MessageRepository extends Context.Tag("MessageRepository")<
  MessageRepository,
  {
    /** Insert a new message into the outbox. */
    readonly insert: (params: {
      channel: string
      sender: string
      content: string
      correlationId: string | null
      taskId: string | null
      metadata: string
      createdAt: string
      expiresAt: string | null
    }) => Effect.Effect<Message, DatabaseError>

    /**
     * Find messages by channel with cursor-based pagination.
     * Read-only: does NOT modify message status.
     */
    readonly findByChannel: (params: {
      channel: string
      afterId?: number
      limit?: number
      sender?: string
      correlationId?: string
      includeAcked?: boolean
      excludeExpired?: boolean
    }) => Effect.Effect<readonly Message[], DatabaseError>

    /** Find a single message by ID. */
    readonly findById: (id: number) => Effect.Effect<Message | null, DatabaseError>

    /** Mark a single message as acked. */
    readonly markAcked: (id: number, ackedAt: string) => Effect.Effect<boolean, DatabaseError>

    /** Mark all pending messages on a channel as acked. */
    readonly markAckedByChannel: (channel: string, ackedAt: string) => Effect.Effect<number, DatabaseError>

    /** Find messages by correlation ID (for request/reply pattern). */
    readonly findByCorrelationId: (correlationId: string) => Effect.Effect<readonly Message[], DatabaseError>

    /** Delete expired messages (TTL cleanup). */
    readonly deleteExpired: (now: string) => Effect.Effect<number, DatabaseError>

    /** Delete acked messages older than a given date. */
    readonly deleteAcked: (olderThan: string) => Effect.Effect<number, DatabaseError>

    /** Count pending messages on a channel. */
    readonly countPending: (channel: string) => Effect.Effect<number, DatabaseError>
  }
>() {}

export const MessageRepositoryLive = Layer.effect(
  MessageRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (params) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO outbox_messages
               (channel, sender, content, correlation_id, task_id, metadata, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              params.channel,
              params.sender,
              params.content,
              params.correlationId,
              params.taskId,
              params.metadata,
              params.createdAt,
              params.expiresAt
            )
            const row = db.prepare(
              "SELECT * FROM outbox_messages WHERE id = ?"
            ).get(result.lastInsertRowid) as MessageRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "message",
                id: result.lastInsertRowid as number,
                operation: "insert"
              })
            }
            return rowToMessage(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByChannel: (params) =>
        Effect.try({
          try: () => {
            const conditions: string[] = ["channel = ?"]
            const values: (string | number)[] = [params.channel]

            // Cursor: only return messages after this ID
            if (params.afterId !== undefined) {
              conditions.push("id > ?")
              values.push(params.afterId)
            }

            // Filter by status (default: pending only)
            if (!params.includeAcked) {
              conditions.push("status = 'pending'")
            }

            // Exclude expired messages (default: true)
            if (params.excludeExpired !== false) {
              conditions.push("(expires_at IS NULL OR expires_at > ?)")
              values.push(new Date().toISOString())
            }

            // Filter by sender
            if (params.sender) {
              conditions.push("sender = ?")
              values.push(params.sender)
            }

            // Filter by correlation ID
            if (params.correlationId) {
              conditions.push("correlation_id = ?")
              values.push(params.correlationId)
            }

            const limit = params.limit ?? 50
            values.push(limit)

            const sql = `SELECT * FROM outbox_messages
              WHERE ${conditions.join(" AND ")}
              ORDER BY id ASC
              LIMIT ?`

            const rows = db.prepare(sql).all(...values) as MessageRow[]
            return rows.map(rowToMessage)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM outbox_messages WHERE id = ?"
            ).get(id) as MessageRow | undefined
            return row ? rowToMessage(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      markAcked: (id, ackedAt) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `UPDATE outbox_messages SET status = 'acked', acked_at = ?
               WHERE id = ? AND status = 'pending'`
            ).run(ackedAt, id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      markAckedByChannel: (channel, ackedAt) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `UPDATE outbox_messages SET status = 'acked', acked_at = ?
               WHERE channel = ? AND status = 'pending'`
            ).run(ackedAt, channel)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByCorrelationId: (correlationId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM outbox_messages
               WHERE correlation_id = ?
               ORDER BY id ASC`
            ).all(correlationId) as MessageRow[]
            return rows.map(rowToMessage)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteExpired: (now) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `DELETE FROM outbox_messages
               WHERE expires_at IS NOT NULL AND expires_at <= ?`
            ).run(now)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      deleteAcked: (olderThan) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `DELETE FROM outbox_messages
               WHERE status = 'acked' AND acked_at IS NOT NULL AND acked_at <= ?`
            ).run(olderThan)
            return result.changes
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countPending: (channel) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const row = db.prepare(
              `SELECT COUNT(*) as count FROM outbox_messages
               WHERE channel = ? AND status = 'pending'
               AND (expires_at IS NULL OR expires_at > ?)`
            ).get(channel, now) as { count: number }
            return row.count
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
