/**
 * Outbox commands: send, inbox, ack, ack:all, outbox:pending, outbox:gc
 *
 * PRD-024: Agent Outbox Messaging Primitive
 *
 * Channel-based agent-to-agent messaging.
 */

import { Effect } from "effect"
import { MessageService } from "@jamesaphoenix/tx-core"
import { serializeMessage } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"
import { type Flags, flag, opt, parseIntOpt } from "../utils/parse.js"

/**
 * Send a message to a channel.
 *
 * Usage: tx send <channel> <content> [--sender <s>] [--task <id>] [--ttl <sec>] [--correlation <id>] [--metadata '{}'] [--json]
 */
export const send = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const channel = pos[0]
    const content = pos[1]

    if (!channel || !content) {
      console.error("Usage: tx send <channel> <content> [--sender <s>] [--task <id>] [--ttl <sec>] [--correlation <id>] [--metadata '{}'] [--json]")
      process.exit(1)
    }

    const sender = opt(flags, "sender", "s") ?? "cli"
    const taskId = opt(flags, "task") ?? null
    const ttlSeconds = parseIntOpt(flags, "ttl", "ttl")
    const correlationId = opt(flags, "correlation", "corr") ?? null
    const metadataRaw = opt(flags, "metadata")
    let metadata: Record<string, unknown> | undefined
    if (metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw) as Record<string, unknown>
      } catch {
        console.error("Error: --metadata must be valid JSON")
        process.exit(1)
      }
    }

    const svc = yield* MessageService
    const message = yield* svc.send({
      channel,
      sender,
      content,
      correlationId,
      taskId,
      metadata,
      ttlSeconds
    })

    if (flag(flags, "json")) {
      console.log(toJson(serializeMessage(message)))
    } else {
      console.log(`Message ${message.id} sent to channel "${message.channel}"`)
      console.log(`  Sender: ${message.sender}`)
      if (message.correlationId) console.log(`  Correlation: ${message.correlationId}`)
      if (message.taskId) console.log(`  Task: ${message.taskId}`)
      if (message.expiresAt) console.log(`  Expires: ${message.expiresAt.toISOString()}`)
    }
  })

/**
 * Read messages from a channel's inbox.
 * This is a pure read — no side effects, no status changes.
 *
 * Usage: tx inbox <channel> [--after <id>] [--limit <n>] [--sender <s>] [--correlation <id>] [--include-acked] [--json]
 */
export const inbox = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const channel = pos[0]

    if (!channel) {
      console.error("Usage: tx inbox <channel> [--after <id>] [--limit <n>] [--sender <s>] [--correlation <id>] [--include-acked] [--json]")
      process.exit(1)
    }

    const afterId = parseIntOpt(flags, "after", "after")
    const limit = parseIntOpt(flags, "limit", "limit", "n")
    const sender = opt(flags, "sender", "s")
    const correlationId = opt(flags, "correlation", "corr")
    const includeAcked = flag(flags, "include-acked")

    const svc = yield* MessageService
    const messages = yield* svc.inbox({
      channel,
      afterId,
      limit,
      sender,
      correlationId,
      includeAcked
    })

    if (flag(flags, "json")) {
      console.log(toJson(messages.map(serializeMessage)))
    } else {
      if (messages.length === 0) {
        console.log(`No messages in channel "${channel}"`)
        return
      }
      for (const msg of messages) {
        const ts = msg.createdAt.toISOString().slice(0, 19).replace("T", " ")
        console.log(`[${msg.id}] ${ts} ${msg.sender}: ${msg.content}`)
      }
      console.log(`\n${messages.length} message(s)`)
    }
  })

/**
 * Acknowledge a single message by ID.
 *
 * Usage: tx ack <message-id> [--json]
 */
export const ack = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawId = pos[0]

    if (!rawId) {
      console.error("Usage: tx ack <message-id> [--json]")
      process.exit(1)
    }

    const id = parseInt(rawId, 10)
    if (isNaN(id)) {
      console.error(`Error: invalid message ID "${rawId}"`)
      process.exit(1)
    }

    const svc = yield* MessageService
    const message = yield* svc.ack(id)

    if (flag(flags, "json")) {
      console.log(toJson(serializeMessage(message)))
    } else {
      console.log(`Message ${message.id} acknowledged`)
    }
  })

/**
 * Acknowledge all pending messages on a channel.
 *
 * Usage: tx ack:all <channel> [--json]
 */
export const ackAll = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const channel = pos[0]

    if (!channel) {
      console.error("Usage: tx ack:all <channel> [--json]")
      process.exit(1)
    }

    const svc = yield* MessageService
    const count = yield* svc.ackAll(channel)

    if (flag(flags, "json")) {
      console.log(toJson({ channel, ackedCount: count }))
    } else {
      console.log(`${count} message(s) acknowledged on channel "${channel}"`)
    }
  })

/**
 * Count pending messages on a channel.
 *
 * Usage: tx outbox:pending <channel> [--json]
 */
export const outboxPending = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const channel = pos[0]

    if (!channel) {
      console.error("Usage: tx outbox:pending <channel> [--json]")
      process.exit(1)
    }

    const svc = yield* MessageService
    const count = yield* svc.pending(channel)

    if (flag(flags, "json")) {
      console.log(toJson({ channel, count }))
    } else {
      console.log(`${count} pending message(s) on channel "${channel}"`)
    }
  })

/**
 * Garbage collect old messages.
 *
 * Usage: tx outbox:gc [--acked-older-than <hours>] [--json]
 */
export const outboxGc = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const ackedOlderThanHours = parseIntOpt(flags, "acked-older-than", "acked-older-than")

    const svc = yield* MessageService
    const result = yield* svc.gc({ ackedOlderThanHours })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`GC complete: ${result.expired} expired, ${result.acked} old acked messages removed`)
    }
  })
