/**
 * Integration tests for MCP task tree and stats tools.
 *
 * Tests the Effect services that back the MCP tools:
 * - tx_dep_tree (HierarchyService)
 * - tx_diag_stats (TaskService + ReadyService)
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx/testing"
import {
  TaskService,
  ReadyService,
  HierarchyService,
  DependencyService,
} from "@jamesaphoenix/tx"
import type { TaskId } from "@jamesaphoenix/tx/types"

// =============================================================================
// Tree Tool Integration Tests
// =============================================================================

describe("MCP Tree Tool", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("getTree returns task tree with children", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const hierarchySvc = yield* HierarchyService

        const parent = yield* taskSvc.create({ title: "Parent task", score: 100 })
        yield* taskSvc.create({ title: "Child A", parentId: parent.id, score: 80 })
        yield* taskSvc.create({ title: "Child B", parentId: parent.id, score: 60 })

        return yield* hierarchySvc.getTree(parent.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.task.title).toBe("Parent task")
    expect(result.children).toHaveLength(2)

    const childTitles = result.children.map((c) => c.task.title)
    expect(childTitles).toContain("Child A")
    expect(childTitles).toContain("Child B")
  })

  it("getTree returns nested tree with 3 levels", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const hierarchySvc = yield* HierarchyService

        const root = yield* taskSvc.create({ title: "Root", score: 100 })
        const mid = yield* taskSvc.create({ title: "Middle", parentId: root.id, score: 80 })
        yield* taskSvc.create({ title: "Leaf", parentId: mid.id, score: 60 })

        return yield* hierarchySvc.getTree(root.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.task.title).toBe("Root")
    expect(result.children).toHaveLength(1)
    expect(result.children[0].task.title).toBe("Middle")
    expect(result.children[0].children).toHaveLength(1)
    expect(result.children[0].children[0].task.title).toBe("Leaf")
    expect(result.children[0].children[0].children).toHaveLength(0)
  })

  it("getTree fails for non-existent task", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const hierarchySvc = yield* HierarchyService
        return yield* hierarchySvc.getTree("tx-nonexist" as TaskId).pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("TaskNotFoundError")
  })
})

// =============================================================================
// Stats Tool Integration Tests
// =============================================================================

describe("MCP Stats Tool", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("stats returns task counts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        yield* taskSvc.create({ title: "Task one", score: 100 })
        yield* taskSvc.create({ title: "Task two", score: 200 })
        yield* taskSvc.create({ title: "Task three", score: 300 })

        const total = yield* taskSvc.count()
        const readyTasks = yield* readySvc.getReady(1000)

        return { total, ready: readyTasks.length }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(3)
    expect(result.ready).toBe(3)
  })

  it("stats returns done count", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        const t1 = yield* taskSvc.create({ title: "Will complete", score: 100 })
        yield* taskSvc.create({ title: "Still open", score: 200 })

        // Mark one as done
        yield* taskSvc.update(t1.id, { status: "done" })

        const total = yield* taskSvc.count()
        const done = yield* taskSvc.count({ status: "done" })

        return { total, done }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(2)
    expect(result.done).toBe(1)
  })

  it("stats returns zero for all fields with empty database", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        const total = yield* taskSvc.count()
        const readyTasks = yield* readySvc.getReady(1000)

        return { total, ready: readyTasks.length }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(0)
    expect(result.ready).toBe(0)
  })

  it("stats correctly excludes blocked tasks from ready count", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService
        const depService = yield* DependencyService

        const task1 = yield* taskSvc.create({ title: "Blocker task", score: 100 })
        const task2 = yield* taskSvc.create({ title: "Blocked task", score: 200 })
        yield* taskSvc.create({ title: "Free task", score: 300 })

        // task2 is blocked by task1
        yield* depService.addBlocker(task2.id, task1.id)

        const total = yield* taskSvc.count()
        const readyTasks = yield* readySvc.getReady(1000)

        return { total, ready: readyTasks.length }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(3)
    expect(result.ready).toBe(2) // task2 is blocked, so only task1 and task3 are ready
  })
})
