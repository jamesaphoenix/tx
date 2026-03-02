/**
 * Claim-related MCP Tools
 *
 * Provides MCP tools for worker claim management (lease-based task claiming).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import z from "zod"
import { ClaimService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// Serialize a claim object, converting Dates to ISO strings for safe JSON output
const serializeClaim = (claim: {
  id: number
  taskId: string
  workerId: string
  status: string
  claimedAt: Date
  leaseExpiresAt: Date
  renewedCount: number
}) => ({
  id: claim.id,
  taskId: claim.taskId,
  workerId: claim.workerId,
  status: claim.status,
  claimedAt: claim.claimedAt instanceof Date ? claim.claimedAt.toISOString() : String(claim.claimedAt),
  leaseExpiresAt: claim.leaseExpiresAt instanceof Date ? claim.leaseExpiresAt.toISOString() : String(claim.leaseExpiresAt),
  renewedCount: claim.renewedCount,
})

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleClaim = async (args: {
  taskId: string
  workerId: string
  leaseDurationMinutes?: number
}): Promise<McpToolResult> => {
  try {
    const claim = await runEffect(
      Effect.gen(function* () {
        const svc = yield* ClaimService
        return yield* svc.claim(args.taskId, args.workerId, args.leaseDurationMinutes)
      })
    )
    return {
      content: [
        { type: "text", text: `Task ${args.taskId} claimed by worker ${args.workerId}, expires at ${claim.leaseExpiresAt.toISOString()}` },
        { type: "text", text: JSON.stringify(serializeClaim(claim)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_claim", args, error)
  }
}

const handleClaimRelease = async (args: {
  taskId: string
  workerId: string
}): Promise<McpToolResult> => {
  try {
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* ClaimService
        return yield* svc.release(args.taskId, args.workerId)
      })
    )
    return {
      content: [
        { type: "text", text: `Claim on task ${args.taskId} released by worker ${args.workerId}` }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_claim_release", args, error)
  }
}

const handleClaimRenew = async (args: {
  taskId: string
  workerId: string
}): Promise<McpToolResult> => {
  try {
    const claim = await runEffect(
      Effect.gen(function* () {
        const svc = yield* ClaimService
        return yield* svc.renew(args.taskId, args.workerId)
      })
    )
    return {
      content: [
        { type: "text", text: `Claim on task ${args.taskId} renewed, new expiry: ${claim.leaseExpiresAt.toISOString()}` },
        { type: "text", text: JSON.stringify(serializeClaim(claim)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_claim_renew", args, error)
  }
}

const handleClaimGet = async (args: {
  taskId: string
}): Promise<McpToolResult> => {
  try {
    const claim = await runEffect(
      Effect.gen(function* () {
        const svc = yield* ClaimService
        return yield* svc.getActiveClaim(args.taskId)
      })
    )
    if (!claim) {
      return {
        content: [
          { type: "text", text: `No active claim on task ${args.taskId}` },
          { type: "text", text: JSON.stringify(null) }
        ],
        isError: false
      }
    }
    return {
      content: [
        { type: "text", text: `Active claim on task ${args.taskId} by worker ${claim.workerId}, expires at ${claim.leaseExpiresAt.toISOString()}` },
        { type: "text", text: JSON.stringify(serializeClaim(claim)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_claim_get", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerClaimTools = (server: McpServer): void => {
  server.tool(
    "tx_claim",
    "Claim a task for a worker with a lease. Prevents other workers from claiming the same task until the lease expires.",
    {
      taskId: z.string().describe("Task ID to claim"),
      workerId: z.string().describe("Worker ID claiming the task"),
      leaseDurationMinutes: z.number().int().positive().optional().describe("Lease duration in minutes (default: from orchestrator config or 30)")
    },
    async (args) => handleClaim(args as { taskId: string; workerId: string; leaseDurationMinutes?: number })
  )

  server.tool(
    "tx_claim_release",
    "Release a task claim. Only the worker who holds the claim can release it.",
    {
      taskId: z.string().describe("Task ID to release claim on"),
      workerId: z.string().describe("Worker ID releasing the claim")
    },
    async (args) => handleClaimRelease(args as { taskId: string; workerId: string })
  )

  server.tool(
    "tx_claim_renew",
    "Renew the lease on an existing task claim. Fails if the claim is expired or max renewals exceeded.",
    {
      taskId: z.string().describe("Task ID to renew claim on"),
      workerId: z.string().describe("Worker ID renewing the claim")
    },
    async (args) => handleClaimRenew(args as { taskId: string; workerId: string })
  )

  server.tool(
    "tx_claim_get",
    "Get the active claim for a task, if any. Returns null if no active claim exists.",
    {
      taskId: z.string().describe("Task ID to check for active claim")
    },
    async (args) => handleClaimGet(args as { taskId: string })
  )
}
