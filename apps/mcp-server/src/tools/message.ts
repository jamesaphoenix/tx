/**
 * Message-related MCP Tools
 *
 * Provides MCP tools for agent outbox messaging (PRD-024).
 * Channel-based messaging with cursor support for fan-out.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { z } from "zod"
import { serializeMessage } from "@jamesaphoenix/tx-types"
import { MessageService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { normalizeLimit } from "./index.js"

// Re-export for use in other modules
export { serializeMessage }

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleSend = async (args: {
  channel: string
  content: string
  sender?: string
  taskId?: string
  ttlSeconds?: number
  correlationId?: string
  metadata?: string
}): Promise<McpToolResult> => {
  try {
    let parsedMetadata: Record<string, unknown> | undefined
    if (args.metadata) {
      try {
        parsedMetadata = JSON.parse(args.metadata) as Record<string, unknown>
      } catch {
        return {
          content: [{ type: "text", text: "Error: metadata must be valid JSON" }],
          isError: true
        }
      }
    }

    const message = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MessageService
        return yield* svc.send({
          channel: args.channel,
          sender: args.sender ?? "mcp",
          content: args.content,
          correlationId: args.correlationId ?? null,
          taskId: args.taskId ?? null,
          metadata: parsedMetadata,
          ttlSeconds: args.ttlSeconds
        })
      })
    )
    const serialized = serializeMessage(message)
    return {
      content: [
        { type: "text", text: `Message ${message.id} sent to channel "${message.channel}"` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_send", args, error)
  }
}

const handleInbox = async (args: {
  channel: string
  afterId?: number
  limit?: number
  sender?: string
  correlationId?: string
  includeAcked?: boolean
}): Promise<McpToolResult> => {
  try {
    const effectiveLimit = normalizeLimit(args.limit)
    const messages = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MessageService
        return yield* svc.inbox({
          channel: args.channel,
          afterId: args.afterId,
          limit: effectiveLimit,
          sender: args.sender,
          correlationId: args.correlationId,
          includeAcked: args.includeAcked
        })
      })
    )
    const serialized = messages.map(serializeMessage)
    return {
      content: [
        { type: "text", text: `${messages.length} message(s) in channel "${args.channel}"` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_inbox", args, error)
  }
}

const handleAck = async (args: { id: number }): Promise<McpToolResult> => {
  try {
    const message = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MessageService
        return yield* svc.ack(args.id)
      })
    )
    const serialized = serializeMessage(message)
    return {
      content: [
        { type: "text", text: `Message ${message.id} acknowledged` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_ack", args, error)
  }
}

const handleAckAll = async (args: { channel: string }): Promise<McpToolResult> => {
  try {
    const count = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MessageService
        return yield* svc.ackAll(args.channel)
      })
    )
    return {
      content: [
        { type: "text", text: `${count} message(s) acknowledged on channel "${args.channel}"` },
        { type: "text", text: JSON.stringify({ channel: args.channel, ackedCount: count }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_ack_all", args, error)
  }
}

const handlePending = async (args: { channel: string }): Promise<McpToolResult> => {
  try {
    const count = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MessageService
        return yield* svc.pending(args.channel)
      })
    )
    return {
      content: [
        { type: "text", text: JSON.stringify({ channel: args.channel, count }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_outbox_pending", args, error)
  }
}

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

export const registerMessageTools = (server: McpServer) => {
  server.tool(
    "tx_send",
    "Send a message to a channel for agent-to-agent communication",
    {
      channel: z.string().min(1).describe("Channel name (e.g., agent ID, topic, or 'task:tx-abc123')"),
      content: z.string().min(1).describe("Message content"),
      sender: z.string().optional().describe("Sender name (default: 'mcp')"),
      taskId: z.string().optional().describe("Associated task ID"),
      ttlSeconds: z.number().int().positive().optional().describe("Time-to-live in seconds"),
      correlationId: z.string().optional().describe("Correlation ID for request/reply"),
      metadata: z.string().optional().describe("JSON metadata string")
    },
    async (args) => handleSend(args)
  )

  server.tool(
    "tx_inbox",
    "Read messages from a channel (read-only, no side effects). Use afterId for cursor-based fan-out.",
    {
      channel: z.string().min(1).describe("Channel to read from"),
      afterId: z.number().int().optional().describe("Cursor: only messages with ID > this value"),
      limit: z.number().int().positive().optional().describe("Max messages (default: 50)"),
      sender: z.string().optional().describe("Filter by sender"),
      correlationId: z.string().optional().describe("Filter by correlation ID"),
      includeAcked: z.boolean().optional().describe("Include acknowledged messages")
    },
    async (args) => handleInbox(args)
  )

  server.tool(
    "tx_ack",
    "Acknowledge a message (transition from pending to acked)",
    {
      id: z.number().int().describe("Message ID to acknowledge")
    },
    async (args) => handleAck(args)
  )

  server.tool(
    "tx_ack_all",
    "Acknowledge all pending messages on a channel",
    {
      channel: z.string().min(1).describe("Channel to acknowledge all messages for")
    },
    async (args) => handleAckAll(args)
  )

  server.tool(
    "tx_outbox_pending",
    "Count pending (unacknowledged) messages on a channel",
    {
      channel: z.string().min(1).describe("Channel to count pending messages for")
    },
    async (args) => handlePending(args)
  )
}
