/**
 * MessageService - PRD-024 Agent Outbox
 *
 * Service layer for agent-to-agent messaging.
 * Read-only inbox (no side effects on read), explicit ack, cursor-based fan-out.
 */

import { Context, Effect, Layer } from "effect"
import { MessageRepository } from "../repo/message-repo.js"
import {
  DatabaseError,
  MessageNotFoundError,
  MessageAlreadyAckedError,
  ValidationError
} from "../errors.js"
import type { Message, SendMessageInput, InboxFilter } from "@jamesaphoenix/tx-types"

export class MessageService extends Context.Tag("MessageService")<
  MessageService,
  {
    /**
     * Send a message to a channel.
     * Returns the created message.
     */
    readonly send: (
      input: SendMessageInput
    ) => Effect.Effect<Message, ValidationError | DatabaseError>

    /**
     * Read messages from a channel's inbox.
     * This is a pure read — no side effects, no status changes.
     * Use afterId for cursor-based reading (Kafka-style fan-out).
     */
    readonly inbox: (
      filter: InboxFilter
    ) => Effect.Effect<readonly Message[], DatabaseError>

    /**
     * Acknowledge a single message by ID.
     * Transitions from pending to acked.
     */
    readonly ack: (
      id: number
    ) => Effect.Effect<Message, MessageNotFoundError | MessageAlreadyAckedError | DatabaseError>

    /**
     * Acknowledge all pending messages on a channel.
     * Returns the number of messages acked.
     */
    readonly ackAll: (
      channel: string
    ) => Effect.Effect<number, DatabaseError>

    /**
     * Count pending (unacked) messages on a channel.
     */
    readonly pending: (
      channel: string
    ) => Effect.Effect<number, DatabaseError>

    /**
     * Garbage collect old messages.
     * Deletes expired messages and optionally acked messages older than a threshold.
     */
    readonly gc: (options?: {
      ackedOlderThanHours?: number
    }) => Effect.Effect<{ expired: number; acked: number }, DatabaseError>

    /**
     * Find all messages with a given correlation ID.
     * Used for request/reply patterns.
     */
    readonly findReplies: (
      correlationId: string
    ) => Effect.Effect<readonly Message[], DatabaseError>
  }
>() {}

export const MessageServiceLive = Layer.effect(
  MessageService,
  Effect.gen(function* () {
    const repo = yield* MessageRepository

    return {
      send: (input) =>
        Effect.gen(function* () {
          if (input.ttlSeconds !== undefined && input.ttlSeconds <= 0) {
            return yield* Effect.fail(new ValidationError({ reason: "ttlSeconds must be positive" }))
          }
          const now = new Date()
          const expiresAt = input.ttlSeconds
            ? new Date(now.getTime() + input.ttlSeconds * 1000)
            : null

          return yield* repo.insert({
            channel: input.channel,
            sender: input.sender,
            content: input.content,
            correlationId: input.correlationId ?? null,
            taskId: input.taskId ?? null,
            metadata: JSON.stringify(input.metadata ?? {}),
            createdAt: now.toISOString(),
            expiresAt: expiresAt?.toISOString() ?? null
          })
        }),

      inbox: (filter) =>
        repo.findByChannel({
          channel: filter.channel,
          afterId: filter.afterId,
          limit: filter.limit,
          sender: filter.sender,
          correlationId: filter.correlationId,
          includeAcked: filter.includeAcked,
          excludeExpired: filter.excludeExpired
        }),

      ack: (id) =>
        Effect.gen(function* () {
          const message = yield* repo.findById(id)
          if (!message) {
            return yield* Effect.fail(new MessageNotFoundError({ id }))
          }
          if (message.status === "acked") {
            return yield* Effect.fail(new MessageAlreadyAckedError({ id }))
          }

          const ackedAt = new Date().toISOString()
          yield* repo.markAcked(id, ackedAt)

          // Re-fetch to return updated message
          const updated = yield* repo.findById(id)
          if (!updated) {
            return yield* Effect.fail(new MessageNotFoundError({ id }))
          }
          return updated
        }),

      ackAll: (channel) =>
        repo.markAckedByChannel(channel, new Date().toISOString()),

      pending: (channel) =>
        repo.countPending(channel),

      gc: (options) =>
        Effect.gen(function* () {
          const now = new Date()

          // Delete expired messages
          const expired = yield* repo.deleteExpired(now.toISOString())

          // Delete old acked messages if threshold provided
          let acked = 0
          const hours = options?.ackedOlderThanHours
          if (hours !== undefined && hours >= 0) {
            const threshold = new Date(now.getTime() - hours * 60 * 60 * 1000)
            acked = yield* repo.deleteAcked(threshold.toISOString())
          }

          return { expired, acked }
        }),

      findReplies: (correlationId) =>
        repo.findByCorrelationId(correlationId)
    }
  })
)
