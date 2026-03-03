/**
 * Integration tests for Label filtering and ready queue scoping.
 *
 * Tests label CRUD, assignment, unassignment discriminated results,
 * and ready queue filtering by --label / --exclude-label flags.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  TaskService,
  ReadyService,
  LabelRepository,
} from "@jamesaphoenix/tx-core"

describe("Label filtering integration", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  // ===== Label CRUD =====

  it("creates and retrieves a label", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const label = yield* repo.create("phase:discovery", "#3b82f6")

        expect(label.name).toBe("phase:discovery")
        expect(label.color).toBe("#3b82f6")

        const found = yield* repo.findByName("phase:discovery")
        expect(found).not.toBeNull()
        expect(found!.name).toBe("phase:discovery")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("findByName is case-insensitive", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.create("Phase:Discovery", "#3b82f6")

        const found = yield* repo.findByName("phase:discovery")
        expect(found).not.toBeNull()
        expect(found!.name).toBe("Phase:Discovery")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("findAll lists all labels sorted by name", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.create("zebra", "#000")
        yield* repo.create("alpha", "#fff")
        yield* repo.create("mid", "#888")

        const all = yield* repo.findAll()
        expect(all.length).toBe(3)
        expect(all.map(l => l.name)).toEqual(["alpha", "mid", "zebra"])
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("remove deletes a label and returns true", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.create("temp", "#000")

        const removed = yield* repo.remove("temp")
        expect(removed).toBe(true)

        const found = yield* repo.findByName("temp")
        expect(found).toBeNull()
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("remove returns false when label does not exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const removed = yield* repo.remove("nonexistent")
        expect(removed).toBe(false)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Label: duplicate name constraint =====

  it("create with duplicate name throws DatabaseError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.create("bug", "#ef4444")

        return yield* repo.create("bug", "#000000").pipe(
          Effect.map(() => "created" as const),
          Effect.catchTag("DatabaseError", () => Effect.succeed("duplicate" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("duplicate")
  })

  // ===== Label: remove cascades to assignments =====

  it("removing a label also removes its assignments", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "Labeled task", metadata: {} })
        yield* repo.create("temp-label", "#000")
        yield* repo.assign(task.id, "temp-label")

        // Verify assignment exists
        const labelsBefore = yield* repo.getLabelsForTask(task.id)
        expect(labelsBefore.length).toBe(1)

        // Remove the label
        yield* repo.remove("temp-label")

        // Assignment should be gone (FK cascade or manual cleanup)
        const labelsAfter = yield* repo.getLabelsForTask(task.id)
        expect(labelsAfter.length).toBe(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Label: assign fails for non-existent task =====

  it("assign fails with TaskNotFoundError for non-existent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        yield* repo.create("bug", "#ef4444")

        return yield* repo.assign("tx-nonexist", "bug").pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("TaskNotFoundError", () => Effect.succeed("not_found" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("not_found")
  })

  // ===== Label Assignment =====

  it("assigns and retrieves labels for a task", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "Labeled task", metadata: {} })
        yield* repo.create("bug", "#ef4444")
        yield* repo.create("urgent", "#f59e0b")

        yield* repo.assign(task.id, "bug")
        yield* repo.assign(task.id, "urgent")

        const labels = yield* repo.getLabelsForTask(task.id)
        expect(labels.length).toBe(2)
        expect(labels.map(l => l.name).sort()).toEqual(["bug", "urgent"])
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("assign is idempotent (INSERT OR IGNORE)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "Task", metadata: {} })
        yield* repo.create("bug", "#ef4444")

        // Assign twice — should not throw or create duplicates
        yield* repo.assign(task.id, "bug")
        yield* repo.assign(task.id, "bug")

        const labels = yield* repo.getLabelsForTask(task.id)
        expect(labels.length).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("assign fails with LabelNotFoundError for nonexistent label", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "Task", metadata: {} })

        return yield* repo.assign(task.id, "nonexistent").pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("LabelNotFoundError", () => Effect.succeed("not_found" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("not_found")
  })

  // ===== Label Unassignment (discriminated results) =====

  it("unassign returns 'removed' when label was assigned", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "Task", metadata: {} })
        yield* repo.create("bug", "#ef4444")
        yield* repo.assign(task.id, "bug")

        const result = yield* repo.unassign(task.id, "bug")
        expect(result).toBe("removed")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("unassign returns 'not_assigned' when label exists but was not assigned", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "Task", metadata: {} })
        yield* repo.create("bug", "#ef4444")
        // Don't assign, then try to unassign

        const result = yield* repo.unassign(task.id, "bug")
        expect(result).toBe("not_assigned")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("unassign returns 'label_not_found' when label does not exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "Task", metadata: {} })

        const result = yield* repo.unassign(task.id, "nonexistent")
        expect(result).toBe("label_not_found")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Ready Queue Scoping =====

  it("ready filters by --label", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        yield* repo.create("phase:impl", "#3b82f6")
        yield* repo.create("phase:test", "#22c55e")

        // Create 3 tasks
        const t1 = yield* taskSvc.create({ title: "Impl task", metadata: {} })
        const t2 = yield* taskSvc.create({ title: "Test task", metadata: {} })
        yield* taskSvc.create({ title: "No label task", metadata: {} })

        // Assign labels
        yield* repo.assign(t1.id, "phase:impl")
        yield* repo.assign(t2.id, "phase:test")

        // Filter by phase:impl
        const ready = yield* readySvc.getReady(10, { labels: ["phase:impl"] })
        expect(ready.length).toBe(1)
        expect(ready[0].id).toBe(t1.id)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("ready filters by --exclude-label", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        yield* repo.create("wontfix", "#6b7280")

        const t1 = yield* taskSvc.create({ title: "Good task", metadata: {} })
        const t2 = yield* taskSvc.create({ title: "Wontfix task", metadata: {} })

        yield* repo.assign(t2.id, "wontfix")

        // Exclude wontfix — should only get t1
        const ready = yield* readySvc.getReady(10, { excludeLabels: ["wontfix"] })
        expect(ready.length).toBe(1)
        expect(ready[0].id).toBe(t1.id)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("ready with both --label and --exclude-label narrows results", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        yield* repo.create("sprint", "#3b82f6")
        yield* repo.create("blocked", "#ef4444")

        const t1 = yield* taskSvc.create({ title: "Sprint & blocked", metadata: {} })
        const t2 = yield* taskSvc.create({ title: "Sprint only", metadata: {} })
        yield* taskSvc.create({ title: "Neither", metadata: {} })

        yield* repo.assign(t1.id, "sprint")
        yield* repo.assign(t1.id, "blocked")
        yield* repo.assign(t2.id, "sprint")

        // Filter: sprint but not blocked
        const ready = yield* readySvc.getReady(10, {
          labels: ["sprint"],
          excludeLabels: ["blocked"],
        })
        expect(ready.length).toBe(1)
        expect(ready[0].id).toBe(t2.id)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("ready --exclude-label is case-insensitive", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        yield* repo.create("WontFix", "#6b7280")

        const t1 = yield* taskSvc.create({ title: "Good task", metadata: {} })
        const t2 = yield* taskSvc.create({ title: "Excluded task", metadata: {} })

        yield* repo.assign(t2.id, "WontFix")

        // Exclude with different case — should still filter correctly
        const ready = yield* readySvc.getReady(10, { excludeLabels: ["wontfix"] })
        expect(ready.length).toBe(1)
        expect(ready[0].id).toBe(t1.id)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("ready with empty label arrays returns all tasks", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        yield* taskSvc.create({ title: "Task 1", metadata: {} })
        yield* taskSvc.create({ title: "Task 2", metadata: {} })

        // Empty arrays — should not filter
        const ready = yield* readySvc.getReady(10, { labels: [], excludeLabels: [] })
        expect(ready.length).toBe(2)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Task list also supports label filtering =====

  it("task list filters by labels", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LabelRepository
        const taskSvc = yield* TaskService

        yield* repo.create("frontend", "#3b82f6")

        const t1 = yield* taskSvc.create({ title: "Frontend task", metadata: {} })
        yield* taskSvc.create({ title: "Backend task", metadata: {} })

        yield* repo.assign(t1.id, "frontend")

        const tasks = yield* taskSvc.listWithDeps({
          labels: ["frontend"],
        })
        expect(tasks.length).toBe(1)
        expect(tasks[0].id).toBe(t1.id)
      }).pipe(Effect.provide(shared.layer))
    )
  })
})
