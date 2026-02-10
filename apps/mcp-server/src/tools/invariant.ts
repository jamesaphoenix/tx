/**
 * Invariant-related MCP Tools
 *
 * Provides MCP tools for managing project invariants (rules that must hold).
 * Uses DocService from @jamesaphoenix/tx-core.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { z } from "zod"
import type { Invariant, InvariantCheck, InvariantEnforcement } from "@jamesaphoenix/tx-types"
import { INVARIANT_ENFORCEMENT_TYPES } from "@jamesaphoenix/tx-types"
import { DocService, InvariantNotFoundError } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// -----------------------------------------------------------------------------
// Serializers
// -----------------------------------------------------------------------------

interface SerializedInvariant {
  id: string
  rule: string
  enforcement: InvariantEnforcement
  docId: number
  subsystem: string | null
  status: string
  testRef: string | null
  lintRule: string | null
  promptRef: string | null
  createdAt: string
}

interface SerializedInvariantCheck {
  id: number
  invariantId: string
  passed: boolean
  details: string | null
  durationMs: number | null
  checkedAt: string
}

const serializeInvariant = (inv: Invariant): SerializedInvariant => ({
  id: inv.id,
  rule: inv.rule,
  enforcement: inv.enforcement,
  docId: inv.docId,
  subsystem: inv.subsystem,
  status: inv.status,
  testRef: inv.testRef,
  lintRule: inv.lintRule,
  promptRef: inv.promptRef,
  createdAt: inv.createdAt.toISOString(),
})

const serializeInvariantCheck = (check: InvariantCheck): SerializedInvariantCheck => ({
  id: check.id,
  invariantId: check.invariantId,
  passed: check.passed,
  details: check.details,
  durationMs: check.durationMs,
  checkedAt: check.checkedAt.toISOString(),
})

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleInvariantList = async (args: { subsystem?: string; enforcement?: string }): Promise<McpToolResult> => {
  try {
    const invariants = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.listInvariants({
          subsystem: args.subsystem,
          enforcement: args.enforcement,
        })
      })
    )
    const serialized = invariants.map(serializeInvariant)
    return {
      content: [
        { type: "text", text: `Found ${invariants.length} invariant(s)` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_invariant_list", args, error)
  }
}

const handleInvariantGet = async (args: { id: string }): Promise<McpToolResult> => {
  try {
    const invariant = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        const all = yield* docService.listInvariants()
        const found = all.find(inv => inv.id === args.id)
        if (!found) {
          return yield* Effect.fail(new InvariantNotFoundError({ id: args.id }))
        }
        return found
      })
    )
    const serialized = serializeInvariant(invariant)
    return {
      content: [
        { type: "text", text: `Invariant: ${invariant.id} (${invariant.enforcement})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_invariant_get", args, error)
  }
}

const handleInvariantRecord = async (args: { invariantId: string; passed: boolean; details?: string; durationMs?: number }): Promise<McpToolResult> => {
  try {
    const check = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.recordInvariantCheck(args.invariantId, args.passed, args.details, args.durationMs)
      })
    )
    const serialized = serializeInvariantCheck(check)
    return {
      content: [
        { type: "text", text: `Recorded ${args.passed ? "PASS" : "FAIL"} for invariant ${args.invariantId}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_invariant_record", args, error)
  }
}

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

/**
 * Register all invariant-related MCP tools on the server.
 */
export const registerInvariantTools = (server: McpServer): void => {
  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_invariant_list",
    "List project invariants (rules that must hold). Can filter by subsystem or enforcement type.",
    {
      subsystem: z.string().optional().describe("Filter by subsystem (e.g., 'database', 'api')"),
      enforcement: z.enum(INVARIANT_ENFORCEMENT_TYPES).optional().describe(`Filter by enforcement type: ${INVARIANT_ENFORCEMENT_TYPES.join(", ")}`)
    },
    handleInvariantList
  )

  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_invariant_get",
    "Get a specific invariant by its ID",
    {
      id: z.string().describe("Invariant ID to look up")
    },
    handleInvariantGet
  )

  // @ts-expect-error - MCP SDK types cause deep type instantiation issues
  server.tool(
    "tx_invariant_record",
    "Record the result of an invariant check (pass/fail with optional details)",
    {
      invariantId: z.string().describe("Invariant ID that was checked"),
      passed: z.boolean().describe("Whether the invariant check passed"),
      details: z.string().max(10000).optional().describe("Details about the check result"),
      durationMs: z.number().int().nonnegative().optional().describe("How long the check took in milliseconds")
    },
    handleInvariantRecord
  )
}
