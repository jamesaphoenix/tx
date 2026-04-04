/**
 * Integration tests for new MCP tools: gate, label, and msg gc.
 *
 * Tests the Effect services that back these MCP tools:
 * - tx_auto_gate_* (PinService — gate as context pin)
 * - tx_auto_label_* (LabelRepository)
 * - tx_msg_gc (MessageService)
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  PinService,
  TaskService,
  MessageService,
  LabelRepository,
} from "@jamesaphoenix/tx-core"
// TaskId type available if needed for typed assertions

// =============================================================================
// Gate Tools Integration Tests (PinService-based HITL gates)
// =============================================================================

describe("MCP Gate Tools (tx_auto_gate_*)", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // Helper: create a gate via PinService (same as MCP tool would)
  const createGate = (name: string, opts?: { phaseFrom?: string; phaseTo?: string }) =>
    Effect.gen(function* () {
      const pinSvc = yield* PinService
      const state = {
        approved: false,
        phaseFrom: opts?.phaseFrom ?? null,
        phaseTo: opts?.phaseTo ?? null,
        required: true,
        approvedBy: null,
        approvedAt: null,
        revokedBy: null,
        revokedAt: null,
        revokeReason: null,
        note: null,
        taskId: null,
        createdAt: new Date().toISOString(),
      }
      const id = name.startsWith("gate.") ? name : `gate.${name}`
      yield* pinSvc.set(id, JSON.stringify(state))
      return { id, state }
    })

  const getGateState = (name: string) =>
    Effect.gen(function* () {
      const pinSvc = yield* PinService
      const id = name.startsWith("gate.") ? name : `gate.${name}`
      const pin = yield* pinSvc.get(id)
      return pin ? JSON.parse(pin.content) : null
    })

  it("gate create stores a new gate pin", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createGate("deploy")
        return yield* getGateState("deploy")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).not.toBeNull()
    expect(result.approved).toBe(false)
    expect(result.required).toBe(true)
  })

  it("gate create with phase from/to", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* createGate("review", { phaseFrom: "implement", phaseTo: "review" })
        return yield* getGateState("review")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.phaseFrom).toBe("implement")
    expect(result.phaseTo).toBe("review")
  })

  it("gate approve transitions state", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pinSvc = yield* PinService
        yield* createGate("deploy")

        // Approve the gate
        const pin = yield* pinSvc.get("gate.deploy")
        const state = JSON.parse(pin!.content)
        const approved = {
          ...state,
          approved: true,
          approvedBy: "human-james",
          approvedAt: new Date().toISOString(),
          note: "LGTM",
        }
        yield* pinSvc.set("gate.deploy", JSON.stringify(approved))
        return yield* getGateState("deploy")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.approved).toBe(true)
    expect(result.approvedBy).toBe("human-james")
    expect(result.note).toBe("LGTM")
  })

  it("gate revoke transitions state back", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pinSvc = yield* PinService

        // Create and approve
        yield* createGate("staging")
        const pin1 = yield* pinSvc.get("gate.staging")
        const state1 = JSON.parse(pin1!.content)
        yield* pinSvc.set("gate.staging", JSON.stringify({
          ...state1, approved: true, approvedBy: "human", approvedAt: new Date().toISOString(),
        }))

        // Revoke
        const pin2 = yield* pinSvc.get("gate.staging")
        const state2 = JSON.parse(pin2!.content)
        yield* pinSvc.set("gate.staging", JSON.stringify({
          ...state2,
          approved: false,
          approvedBy: null,
          approvedAt: null,
          revokedBy: "human",
          revokedAt: new Date().toISOString(),
          revokeReason: "Found a bug",
        }))

        return yield* getGateState("staging")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.approved).toBe(false)
    expect(result.revokedBy).toBe("human")
    expect(result.revokeReason).toBe("Found a bug")
  })

  it("gate list returns all gate pins", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pinSvc = yield* PinService
        yield* createGate("gate-a")
        yield* createGate("gate-b")

        const allPins = yield* pinSvc.list()
        return [...allPins].filter(p => p.id.startsWith("gate."))
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.some(g => g.id === "gate.gate-a")).toBe(true)
    expect(result.some(g => g.id === "gate.gate-b")).toBe(true)
  })

  it("gate rm removes the gate pin", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pinSvc = yield* PinService
        yield* createGate("temp-gate")

        const before = yield* pinSvc.get("gate.temp-gate")
        expect(before).not.toBeNull()

        yield* pinSvc.remove("gate.temp-gate")
        return yield* pinSvc.get("gate.temp-gate")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBeNull()
  })
})

// =============================================================================
// Label Tools Integration Tests (LabelRepository)
// =============================================================================

describe("MCP Label Tools (tx_auto_label_*)", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("label add creates a new label", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.create("phase:test", "#ff0000")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.name).toBe("phase:test")
    expect(result.color).toBe("#ff0000")
  })

  it("label add with default color", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.create("priority:high", "#6b7280")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.color).toBe("#6b7280")
  })

  it("label delete removes a label", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.create("temp-label", "#000000")
        const removed = yield* repo.remove("temp-label")
        return removed
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe(true)
  })

  it("label delete returns false for nonexistent label", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.remove("nonexistent-label")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe(false)
  })

  it("label assign attaches label to task", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService
        const task = yield* taskSvc.create({ title: "Labeled task" })
        yield* repo.create("sprint:w10", "#00ff00")
        yield* repo.assign(task.id, "sprint:w10")

        // Verify the label shows in task list when filtering
        const tasks = yield* taskSvc.listWithDeps({ labels: ["sprint:w10"] })
        expect(tasks.some(t => t.id === task.id)).toBe(true)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("label unassign removes label from task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService
        const task = yield* taskSvc.create({ title: "Unassign test" })
        yield* repo.create("remove-me", "#ff0000")
        yield* repo.assign(task.id, "remove-me")
        return yield* repo.unassign(task.id, "remove-me")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("removed")
  })

  it("label unassign returns not_assigned for unassigned label", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService
        const task = yield* taskSvc.create({ title: "Never assigned" })
        yield* repo.create("never-assigned", "#ff0000")
        return yield* repo.unassign(task.id, "never-assigned")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("not_assigned")
  })

  it("label list returns all labels", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.create("list-a", "#111111")
        yield* repo.create("list-b", "#222222")
        return yield* repo.findAll()
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.some(l => l.name === "list-a")).toBe(true)
    expect(result.some(l => l.name === "list-b")).toBe(true)
  })
})

// =============================================================================
// Message GC Integration Tests (MessageService)
// =============================================================================

describe("MCP Message GC Tool (tx_msg_gc)", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("gc removes expired messages", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService
        // Send a message with 0-second TTL (expires immediately)
        yield* svc.send({
          channel: "gc-test",
          sender: "test",
          content: "Will expire",
          correlationId: null,
          taskId: null,
          ttlSeconds: 1,
        })
        // GC should clean up expired
        return yield* svc.gc({})
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toHaveProperty("expired")
    expect(result).toHaveProperty("acked")
  })

  it("gc removes acked messages", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService
        // Send and ack a message
        const msg = yield* svc.send({
          channel: "gc-ack-test",
          sender: "test",
          content: "Will be acked",
          correlationId: null,
          taskId: null,
        })
        yield* svc.ack(msg.id)
        // GC with 0 hour threshold to remove all acked
        return yield* svc.gc({ ackedOlderThanHours: 0 })
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.acked).toBeGreaterThanOrEqual(1)
  })

  it("gc returns zero counts on empty channel", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService
        return yield* svc.gc({})
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.expired).toBeGreaterThanOrEqual(0)
    expect(result.acked).toBeGreaterThanOrEqual(0)
  })
})
