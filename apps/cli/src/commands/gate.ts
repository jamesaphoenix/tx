/**
 * Gate commands: create, approve, revoke, check, status, list, rm
 *
 * Human-in-the-loop phase gates built on top of context pins.
 */

import { Effect } from "effect"
import { PinService } from "@jamesaphoenix/tx-core"
import { isValidTaskId } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"
import { type Flags, flag, opt, parseTaskId } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

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

const usage = "Usage: tx gate [create|approve|revoke|check|status|list|rm]"

const gateId = (name: string): string => name.startsWith("gate.") ? name : `gate.${name}`

const parseGateState = (content: string): GateState => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new CliExitError(1)
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CliExitError(1)
  }

  const p = parsed as Partial<GateState>
  if (typeof p.approved !== "boolean") throw new CliExitError(1)
  if (typeof p.required !== "boolean") throw new CliExitError(1)
  if (typeof p.createdAt !== "string") throw new CliExitError(1)
  if (p.phaseFrom !== undefined && p.phaseFrom !== null && typeof p.phaseFrom !== "string") throw new CliExitError(1)
  if (p.phaseTo !== undefined && p.phaseTo !== null && typeof p.phaseTo !== "string") throw new CliExitError(1)
  if (p.approvedBy !== undefined && p.approvedBy !== null && typeof p.approvedBy !== "string") throw new CliExitError(1)
  if (p.approvedAt !== undefined && p.approvedAt !== null && typeof p.approvedAt !== "string") throw new CliExitError(1)
  if (p.revokedBy !== undefined && p.revokedBy !== null && typeof p.revokedBy !== "string") throw new CliExitError(1)
  if (p.revokedAt !== undefined && p.revokedAt !== null && typeof p.revokedAt !== "string") throw new CliExitError(1)
  if (p.revokeReason !== undefined && p.revokeReason !== null && typeof p.revokeReason !== "string") throw new CliExitError(1)
  if (p.note !== undefined && p.note !== null && typeof p.note !== "string") throw new CliExitError(1)
  if (p.taskId !== undefined && p.taskId !== null && (typeof p.taskId !== "string" || !isValidTaskId(p.taskId))) throw new CliExitError(1)

  return {
    approved: p.approved,
    phaseFrom: p.phaseFrom ?? null,
    phaseTo: p.phaseTo ?? null,
    required: p.required,
    approvedBy: p.approvedBy ?? null,
    approvedAt: p.approvedAt ?? null,
    revokedBy: p.revokedBy ?? null,
    revokedAt: p.revokedAt ?? null,
    revokeReason: p.revokeReason ?? null,
    note: p.note ?? null,
    taskId: p.taskId ?? null,
    createdAt: p.createdAt,
  }
}

const getExistingGate = (id: string) =>
  Effect.gen(function* () {
    const pinService = yield* PinService
    const pin = yield* pinService.get(id)
    if (!pin) {
      console.error(`Gate not found: ${id}`)
      throw new CliExitError(1)
    }
    try {
      return parseGateState(pin.content)
    } catch {
      console.error(`Gate pin has invalid JSON state: ${id}`)
      throw new CliExitError(1)
    }
  })

const createGate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx gate create <name> [--phase-from <phase>] [--phase-to <phase>] [--task-id <id>] [--force] [--json]")
      throw new CliExitError(1)
    }

    const taskIdFlag = opt(flags, "task-id")
    const taskId = taskIdFlag ? parseTaskId(taskIdFlag) : null

    const state: GateState = {
      approved: false,
      phaseFrom: opt(flags, "phase-from") ?? null,
      phaseTo: opt(flags, "phase-to") ?? null,
      required: true,
      approvedBy: null,
      approvedAt: null,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      note: null,
      taskId,
      createdAt: new Date().toISOString(),
    }

    const id = gateId(name)
    const pinService = yield* PinService
    const existing = yield* pinService.get(id)
    if (existing && !flag(flags, "force", "f")) {
      console.error(`Gate already exists: ${id} (use --force to overwrite)`)
      throw new CliExitError(1)
    }
    yield* pinService.set(id, JSON.stringify(state))

    if (flag(flags, "json")) {
      console.log(toJson({ id, ...state }))
    } else {
      console.log(`Gate created: ${id}`)
    }
  })

const approveGate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    const by = opt(flags, "by")
    if (!name || !by) {
      console.error("Usage: tx gate approve <name> --by <approver> [--note <text>] [--json]")
      throw new CliExitError(1)
    }

    const id = gateId(name)
    const now = new Date().toISOString()
    const state = yield* getExistingGate(id)
    const nextState: GateState = {
      ...state,
      approved: true,
      approvedBy: by,
      approvedAt: now,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      note: opt(flags, "note") ?? null,
    }

    const pinService = yield* PinService
    yield* pinService.set(id, JSON.stringify(nextState))

    if (flag(flags, "json")) {
      console.log(toJson({ id, ...nextState }))
    } else {
      console.log(`Gate approved: ${id} by ${by}`)
    }
  })

const revokeGate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    const by = opt(flags, "by")
    if (!name || !by) {
      console.error("Usage: tx gate revoke <name> --by <approver> [--reason <text>] [--json]")
      throw new CliExitError(1)
    }

    const id = gateId(name)
    const now = new Date().toISOString()
    const state = yield* getExistingGate(id)
    const nextState: GateState = {
      ...state,
      approved: false,
      approvedBy: null,
      approvedAt: null,
      revokedBy: by,
      revokedAt: now,
      revokeReason: opt(flags, "reason") ?? null,
      note: null,
    }

    const pinService = yield* PinService
    yield* pinService.set(id, JSON.stringify(nextState))

    if (flag(flags, "json")) {
      console.log(toJson({ id, ...nextState }))
    } else {
      console.log(`Gate revoked: ${id} by ${by}`)
    }
  })

const checkGate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx gate check <name> [--json]")
      throw new CliExitError(1)
    }

    const id = gateId(name)
    const state = yield* getExistingGate(id)

    if (flag(flags, "json")) {
      console.log(toJson({ id, approved: state.approved }))
    } else {
      console.log(`${id}: ${state.approved ? "approved" : "not approved"}`)
    }

    if (!state.approved) {
      throw new CliExitError(1)
    }
  })

const statusGate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx gate status <name> [--json]")
      throw new CliExitError(1)
    }

    const id = gateId(name)
    const state = yield* getExistingGate(id)

    if (flag(flags, "json")) {
      console.log(toJson({ id, ...state }))
      return
    }

    console.log(`Gate: ${id}`)
    console.log(`  approved: ${state.approved}`)
    if (state.phaseFrom) console.log(`  phaseFrom: ${state.phaseFrom}`)
    if (state.phaseTo) console.log(`  phaseTo: ${state.phaseTo}`)
    if (state.taskId) console.log(`  taskId: ${state.taskId}`)
    if (state.approvedBy) console.log(`  approvedBy: ${state.approvedBy}`)
    if (state.approvedAt) console.log(`  approvedAt: ${state.approvedAt}`)
    if (state.revokedBy) console.log(`  revokedBy: ${state.revokedBy}`)
    if (state.revokedAt) console.log(`  revokedAt: ${state.revokedAt}`)
    if (state.revokeReason) console.log(`  revokeReason: ${state.revokeReason}`)
    if (state.note) console.log(`  note: ${state.note}`)
    console.log(`  createdAt: ${state.createdAt}`)
  })

const listGates = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const pinService = yield* PinService
    const pins = yield* pinService.list()
    const gates = [...pins]
      .filter(pin => pin.id.startsWith("gate."))
      .map(pin => {
        try {
          return { id: pin.id, state: parseGateState(pin.content), valid: true }
        } catch {
          return { id: pin.id, state: null, valid: false }
        }
      })

    if (flag(flags, "json")) {
      console.log(toJson(gates.map(g => ({ id: g.id, valid: g.valid, state: g.state }))))
      return
    }

    if (gates.length === 0) {
      console.log("No gates found")
      return
    }

    for (const gate of gates) {
      if (!gate.valid || !gate.state) {
        console.log(`${gate.id}  invalid`)
        continue
      }
      const fromTo = gate.state.phaseFrom && gate.state.phaseTo
        ? `${gate.state.phaseFrom} -> ${gate.state.phaseTo}`
        : "(no phase)"
      console.log(`${gate.id}  ${gate.state.approved ? "approved" : "blocked"}  ${fromTo}`)
    }
    console.log(`\n${gates.length} gate(s)`)
  })

const removeGate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const name = pos[0]
    if (!name) {
      console.error("Usage: tx gate rm <name>")
      throw new CliExitError(1)
    }

    const id = gateId(name)
    const pinService = yield* PinService
    const deleted = yield* pinService.remove(id)
    if (!deleted) {
      console.error(`Gate not found: ${id}`)
      throw new CliExitError(1)
    }

    if (flag(flags, "json")) {
      console.log(toJson({ deleted: true, id }))
    } else {
      console.log(`Gate removed: ${id}`)
    }
  })

export const gate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]
    if (!sub || sub === "help") {
      console.log(usage)
      return
    }

    if (sub === "create") return yield* createGate(pos.slice(1), flags)
    if (sub === "approve") return yield* approveGate(pos.slice(1), flags)
    if (sub === "revoke") return yield* revokeGate(pos.slice(1), flags)
    if (sub === "check") return yield* checkGate(pos.slice(1), flags)
    if (sub === "status") return yield* statusGate(pos.slice(1), flags)
    if (sub === "list") return yield* listGates(pos.slice(1), flags)
    if (sub === "rm" || sub === "remove") return yield* removeGate(pos.slice(1), flags)

    console.error(`Unknown gate subcommand: ${sub}`)
    console.error(usage)
    throw new CliExitError(1)
  })
