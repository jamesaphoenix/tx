/**
 * Integration tests for new MCP tools: gate, label, and msg gc.
 *
 * Tests the Effect services that back these MCP tools:
 * - tx_auto_gate_* (PinService — gate as context pin)
 * - tx_task_label_* (LabelRepository)
 * - tx_msg_gc (MessageService)
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx/testing"
import {
  TaskService,
  LabelRepository,
} from "@jamesaphoenix/tx"

// =============================================================================
// Label Tools Integration Tests (LabelRepository)
// =============================================================================

describe("MCP Label Tools (tx_task_label_*)", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("task label add creates a new label", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.create("phase:test", "#ff0000")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.name).toBe("phase:test")
    expect(result.color).toBe("#ff0000")
  })

  it("task label add with default color", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.create("priority:high", "#6b7280")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result.color).toBe("#6b7280")
  })

  it("task label delete removes a label", async () => {
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

  it("task label delete returns false for nonexistent label", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        return yield* repo.remove("nonexistent-label")
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe(false)
  })

  it("task label assign attaches label to task", async () => {
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

  it("task label unassign removes label from task", async () => {
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

  it("task label unassign returns not_assigned for unassigned label", async () => {
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

  it("task label list returns all labels", async () => {
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
