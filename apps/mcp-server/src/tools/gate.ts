/**
 * Gate-related MCP Tools
 *
 * Provides MCP tools for human-in-the-loop phase gate management.
 * Gates are built on top of context pins (PinService) with gate. prefix.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import { PinService } from "@jamesaphoenix/tx-core"
import { isValidTaskId } from "@jamesaphoenix/tx-types"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"

// -----------------------------------------------------------------------------
// Gate State
// -----------------------------------------------------------------------------

interface GateState {
  approved: boolean
  phaseFrom: string | null
  phaseTo: string | null
  required: boolean
  approvedBy: string | null
  approvedAt: string | null
  revokedBy: string | null
  revokedAt: string | null
  revokeReason: string | null
  note: string | null
  taskId: string | null
  createdAt: string
}

const gateId = (name: string): string =>
  name.startsWith("gate.") ? name : `gate.${name}`

const parseGateState = (content: string): GateState | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null

  const p = parsed as Partial<GateState>
  if (typeof p.approved !== "boolean") return null
  if (typeof p.required !== "boolean") return null
  if (typeof p.createdAt !== "string") return null

  return {
    approved: p.approved,
    phaseFrom: typeof p.phaseFrom === "string" ? p.phaseFrom : null,
    phaseTo: typeof p.phaseTo === "string" ? p.phaseTo : null,
    required: p.required,
    approvedBy: typeof p.approvedBy === "string" ? p.approvedBy : null,
    approvedAt: typeof p.approvedAt === "string" ? p.approvedAt : null,
    revokedBy: typeof p.revokedBy === "string" ? p.revokedBy : null,
    revokedAt: typeof p.revokedAt === "string" ? p.revokedAt : null,
    revokeReason: typeof p.revokeReason === "string" ? p.revokeReason : null,
    note: typeof p.note === "string" ? p.note : null,
    taskId: typeof p.taskId === "string" ? p.taskId : null,
    createdAt: p.createdAt,
  }
}

// -----------------------------------------------------------------------------
// Tool Handlers
// -----------------------------------------------------------------------------

const handleGateCreate = async (args: {
  name: string
  phaseFrom?: string
  phaseTo?: string
  taskId?: string
  force?: boolean
}): Promise<McpToolResult> => {
  try {
    if (args.taskId && !isValidTaskId(args.taskId)) {
      return {
        content: [{ type: "text", text: `Invalid task ID: ${args.taskId}` }],
        isError: true
      }
    }

    const id = gateId(args.name)
    const state: GateState = {
      approved: false,
      phaseFrom: args.phaseFrom ?? null,
      phaseTo: args.phaseTo ?? null,
      required: true,
      approvedBy: null,
      approvedAt: null,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      note: null,
      taskId: args.taskId ?? null,
      createdAt: new Date().toISOString(),
    }

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        const existing = yield* svc.get(id)
        if (existing && !args.force) {
          return { error: `Gate already exists: ${id} (use force: true to overwrite)` }
        }
        yield* svc.set(id, JSON.stringify(state))
        return { created: true }
      })
    )

    if ("error" in result) {
      return {
        content: [{ type: "text", text: result.error as string }],
        isError: true
      }
    }

    return {
      content: [
        { type: "text", text: `Gate created: ${id}` },
        { type: "text", text: JSON.stringify({ id, ...state }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_auto_gate_create", args, error)
  }
}

const handleGateApprove = async (args: {
  name: string
  by: string
  note?: string
}): Promise<McpToolResult> => {
  try {
    const id = gateId(args.name)
    const now = new Date().toISOString()

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        const pin = yield* svc.get(id)
        if (!pin) return { error: `Gate not found: ${id}` }

        const state = parseGateState(pin.content)
        if (!state) return { error: `Gate pin has invalid JSON state: ${id}` }

        const nextState: GateState = {
          ...state,
          approved: true,
          approvedBy: args.by,
          approvedAt: now,
          revokedBy: null,
          revokedAt: null,
          revokeReason: null,
          note: args.note ?? null,
        }

        yield* svc.set(id, JSON.stringify(nextState))
        return { state: nextState }
      })
    )

    if ("error" in result) {
      return {
        content: [{ type: "text", text: result.error as string }],
        isError: true
      }
    }

    return {
      content: [
        { type: "text", text: `Gate approved: ${id} by ${args.by}` },
        { type: "text", text: JSON.stringify({ id, ...(result as { state: GateState }).state }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_auto_gate_approve", args, error)
  }
}

const handleGateRevoke = async (args: {
  name: string
  by: string
  reason?: string
}): Promise<McpToolResult> => {
  try {
    const id = gateId(args.name)
    const now = new Date().toISOString()

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        const pin = yield* svc.get(id)
        if (!pin) return { error: `Gate not found: ${id}` }

        const state = parseGateState(pin.content)
        if (!state) return { error: `Gate pin has invalid JSON state: ${id}` }

        const nextState: GateState = {
          ...state,
          approved: false,
          approvedBy: null,
          approvedAt: null,
          revokedBy: args.by,
          revokedAt: now,
          revokeReason: args.reason ?? null,
          note: null,
        }

        yield* svc.set(id, JSON.stringify(nextState))
        return { state: nextState }
      })
    )

    if ("error" in result) {
      return {
        content: [{ type: "text", text: result.error as string }],
        isError: true
      }
    }

    return {
      content: [
        { type: "text", text: `Gate revoked: ${id} by ${args.by}` },
        { type: "text", text: JSON.stringify({ id, ...(result as { state: GateState }).state }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_auto_gate_revoke", args, error)
  }
}

const handleGateCheck = async (args: {
  name: string
}): Promise<McpToolResult> => {
  try {
    const id = gateId(args.name)

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        const pin = yield* svc.get(id)
        if (!pin) return { error: `Gate not found: ${id}` }

        const state = parseGateState(pin.content)
        if (!state) return { error: `Gate pin has invalid JSON state: ${id}` }

        return { approved: state.approved }
      })
    )

    if ("error" in result) {
      return {
        content: [{ type: "text", text: result.error as string }],
        isError: true
      }
    }

    const approved = (result as { approved: boolean }).approved
    return {
      content: [
        { type: "text", text: `${id}: ${approved ? "approved" : "not approved"}` },
        { type: "text", text: JSON.stringify({ id, approved }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_auto_gate_check", args, error)
  }
}

const handleGateStatus = async (args: {
  name: string
}): Promise<McpToolResult> => {
  try {
    const id = gateId(args.name)

    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        const pin = yield* svc.get(id)
        if (!pin) return { error: `Gate not found: ${id}` }

        const state = parseGateState(pin.content)
        if (!state) return { error: `Gate pin has invalid JSON state: ${id}` }

        return { state }
      })
    )

    if ("error" in result) {
      return {
        content: [{ type: "text", text: result.error as string }],
        isError: true
      }
    }

    const state = (result as { state: GateState }).state
    return {
      content: [
        { type: "text", text: `Gate: ${id} (${state.approved ? "approved" : "not approved"})` },
        { type: "text", text: JSON.stringify({ id, ...state }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_auto_gate_status", args, error)
  }
}

const handleGateList = async (): Promise<McpToolResult> => {
  try {
    const gates = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        const pins = yield* svc.list()
        return [...pins]
          .filter(pin => pin.id.startsWith("gate."))
          .map(pin => {
            const state = parseGateState(pin.content)
            return { id: pin.id, valid: state !== null, state }
          })
      })
    )

    if (gates.length === 0) {
      return {
        content: [
          { type: "text", text: "No gates found" },
          { type: "text", text: JSON.stringify([]) }
        ],
        isError: false
      }
    }

    const summary = gates.map(g => {
      if (!g.valid || !g.state) return `${g.id}  invalid`
      const fromTo = g.state.phaseFrom && g.state.phaseTo
        ? `${g.state.phaseFrom} -> ${g.state.phaseTo}`
        : "(no phase)"
      return `${g.id}  ${g.state.approved ? "approved" : "blocked"}  ${fromTo}`
    }).join("\n")

    return {
      content: [
        { type: "text", text: `${gates.length} gate(s)\n${summary}` },
        { type: "text", text: JSON.stringify(gates.map(g => ({ id: g.id, valid: g.valid, state: g.state }))) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_auto_gate_list", {}, error)
  }
}

const handleGateRm = async (args: {
  name: string
}): Promise<McpToolResult> => {
  try {
    const id = gateId(args.name)

    const deleted = await runEffect(
      Effect.gen(function* () {
        const svc = yield* PinService
        return yield* svc.remove(id)
      })
    )

    if (!deleted) {
      return {
        content: [{ type: "text", text: `Gate not found: ${id}` }],
        isError: true
      }
    }

    return {
      content: [
        { type: "text", text: `Gate removed: ${id}` },
        { type: "text", text: JSON.stringify({ deleted: true, id }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_auto_gate_rm", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerGateTools = (server: McpServer): void => {
  registerEffectTool(server,
    "tx_auto_gate_create",
    "Create a HITL phase gate. Gates block agent progression until a human approves. Built on context pins with 'gate.' prefix.",
    {
      name: z.string().describe("Gate name (e.g. 'deploy', 'review'). Will be prefixed with 'gate.' if not already."),
      phaseFrom: z.string().optional().describe("Phase the gate transitions from (e.g. 'dev')"),
      phaseTo: z.string().optional().describe("Phase the gate transitions to (e.g. 'staging')"),
      taskId: z.string().optional().describe("Task ID to associate with this gate"),
      force: z.boolean().optional().describe("Overwrite existing gate if it already exists"),
    },
    async (args) => handleGateCreate(args as { name: string; phaseFrom?: string; phaseTo?: string; taskId?: string; force?: boolean })
  )

  registerEffectTool(server,
    "tx_auto_gate_approve",
    "Approve a HITL phase gate, allowing agent progression past this checkpoint.",
    {
      name: z.string().describe("Gate name (e.g. 'deploy' or 'gate.deploy')"),
      by: z.string().describe("Identity of the approver (e.g. 'james', 'ci-bot')"),
      note: z.string().optional().describe("Optional approval note"),
    },
    async (args) => handleGateApprove(args as { name: string; by: string; note?: string })
  )

  registerEffectTool(server,
    "tx_auto_gate_revoke",
    "Revoke approval on a HITL phase gate, re-blocking agent progression.",
    {
      name: z.string().describe("Gate name (e.g. 'deploy' or 'gate.deploy')"),
      by: z.string().describe("Identity of the person revoking (e.g. 'james')"),
      reason: z.string().optional().describe("Reason for revoking the gate"),
    },
    async (args) => handleGateRevoke(args as { name: string; by: string; reason?: string })
  )

  registerEffectTool(server,
    "tx_auto_gate_check",
    "Check if a HITL phase gate is approved. Returns {approved: boolean}. Use this to conditionally proceed past a gate.",
    {
      name: z.string().describe("Gate name to check (e.g. 'deploy' or 'gate.deploy')"),
    },
    async (args) => handleGateCheck(args as { name: string })
  )

  registerEffectTool(server,
    "tx_auto_gate_status",
    "Get the full state of a HITL phase gate including approval/revocation history, phases, and associated task.",
    {
      name: z.string().describe("Gate name (e.g. 'deploy' or 'gate.deploy')"),
    },
    async (args) => handleGateStatus(args as { name: string })
  )

  registerEffectTool(server,
    "tx_auto_gate_list",
    "List all HITL phase gates with their approval status and phase transitions.",
    {},
    async () => handleGateList()
  )

  registerEffectTool(server,
    "tx_auto_gate_rm",
    "Remove a HITL phase gate entirely.",
    {
      name: z.string().describe("Gate name to remove (e.g. 'deploy' or 'gate.deploy')"),
    },
    async (args) => handleGateRm(args as { name: string })
  )
}
