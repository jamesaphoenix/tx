/**
 * Golden Path: Task Lifecycle Integration Tests
 *
 * Tests the complete task lifecycle from creation to completion.
 * This is the most common workflow: init → add → ready → done.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * @see CLAUDE.md Rule 3: All core paths MUST have integration tests
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  TaskServiceLive,
  TaskService,
  ReadyServiceLive,
  ReadyService,
  HierarchyServiceLive,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"
import { fixtureId, createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES } from "../fixtures.js"

// =============================================================================
// Test Layer Factory
// =============================================================================

function makeTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  const services = Layer.mergeAll(
    TaskServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(
    Layer.provide(Layer.merge(repos, AutoSyncServiceNoop))
  )
  return services
}

// =============================================================================
// Golden Path Fixture IDs
// =============================================================================

const _GOLDEN_PATH = {
  TASK_FEATURE: fixtureId("golden-path:feature"),
  TASK_SUBTASK_1: fixtureId("golden-path:subtask-1"),
  TASK_SUBTASK_2: fixtureId("golden-path:subtask-2"),
  TASK_SUBTASK_3: fixtureId("golden-path:subtask-3"),
} as const

// =============================================================================
// Golden Path: Basic Task Lifecycle
// =============================================================================

describe("Golden Path: Task Lifecycle", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeTestLayer(db)
  })

  it("complete lifecycle: create → ready → done", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        // Step 1: Create a task
        const task = yield* taskSvc.create({
          title: "Implement authentication feature",
          description: "Add user login and registration",
          score: 800
        })

        expect(task.id).toMatch(/^tx-[a-z0-9]{8}$/)
        expect(task.status).toBe("backlog")
        expect(task.score).toBe(800)

        // Step 2: Verify it appears in ready list
        const readyTasks = yield* readySvc.getReady()
        const inReady = readyTasks.find(t => t.id === task.id)
        expect(inReady).toBeDefined()
        expect(inReady!.isReady).toBe(true)

        // Step 3: Update to active (simulating work starting)
        const active = yield* taskSvc.update(task.id, { status: "active" })
        expect(active.status).toBe("active")

        // Step 4: Complete the task
        const done = yield* taskSvc.update(task.id, { status: "done" })
        expect(done.status).toBe("done")
        expect(done.completedAt).not.toBeNull()

        // Step 5: Verify it's no longer in ready list
        const readyAfter = yield* readySvc.getReady()
        expect(readyAfter.find(t => t.id === task.id)).toBeUndefined()

        return { task, done }
      }).pipe(Effect.provide(layer))
    )

    expect(result.done.status).toBe("done")
  })

  it("complete lifecycle with parent-child hierarchy", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        // Step 1: Create parent task
        const parent = yield* taskSvc.create({
          title: "Build user authentication",
          score: 1000
        })

        // Step 2: Create subtasks
        const subtask1 = yield* taskSvc.create({
          title: "Design auth schema",
          parentId: parent.id,
          score: 700
        })

        const subtask2 = yield* taskSvc.create({
          title: "Implement login endpoint",
          parentId: parent.id,
          score: 800
        })

        const subtask3 = yield* taskSvc.create({
          title: "Add session management",
          parentId: parent.id,
          score: 600
        })

        // Step 3: Get parent with full dependency info
        const parentWithDeps = yield* taskSvc.getWithDeps(parent.id)
        expect(parentWithDeps.children).toHaveLength(3)
        expect(parentWithDeps.children).toContain(subtask1.id)
        expect(parentWithDeps.children).toContain(subtask2.id)
        expect(parentWithDeps.children).toContain(subtask3.id)

        // Step 4: Complete subtasks one by one
        yield* taskSvc.update(subtask1.id, { status: "done" })
        yield* taskSvc.update(subtask2.id, { status: "done" })
        yield* taskSvc.update(subtask3.id, { status: "done" })

        // Step 5: Ready list should only show workable tasks
        const ready = yield* readySvc.getReady()
        const subtaskIds = [subtask1.id, subtask2.id, subtask3.id]
        for (const id of subtaskIds) {
          expect(ready.find(t => t.id === id)).toBeUndefined()
        }

        // Step 6: Complete parent
        yield* taskSvc.update(parent.id, { status: "done" })

        return { parent, subtask1, subtask2, subtask3 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.parent.id).toBeDefined()
    expect(result.subtask1.parentId).toBe(result.parent.id)
  })

  it("handles multiple task creation and listing", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        // Create multiple tasks with different scores
        const tasks = []
        for (let i = 0; i < 10; i++) {
          const task = yield* taskSvc.create({
            title: `Task ${i + 1}`,
            score: (i + 1) * 100
          })
          tasks.push(task)
        }

        // List all tasks
        const allTasks = yield* taskSvc.list()
        expect(allTasks.length).toBe(10)

        // List with filter
        const highScoreTasks = yield* taskSvc.listWithDeps({ limit: 5 })
        expect(highScoreTasks.length).toBe(5)
        // Tasks should be returned (but order may vary)

        return { tasks, allTasks, highScoreTasks }
      }).pipe(Effect.provide(layer))
    )

    expect(result.tasks).toHaveLength(10)
    expect(result.allTasks).toHaveLength(10)
  })

  it("getWithDeps returns TaskWithDeps with correct structure", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        // Create a task
        const task = yield* taskSvc.create({
          title: "Test TaskWithDeps structure",
          score: 500
        })

        // Get with deps
        const withDeps = yield* taskSvc.getWithDeps(task.id)

        // Rule 1: Every API response MUST include full dependency information
        expect(withDeps).toHaveProperty("blockedBy")
        expect(withDeps).toHaveProperty("blocks")
        expect(withDeps).toHaveProperty("children")
        expect(withDeps).toHaveProperty("isReady")

        expect(Array.isArray(withDeps.blockedBy)).toBe(true)
        expect(Array.isArray(withDeps.blocks)).toBe(true)
        expect(Array.isArray(withDeps.children)).toBe(true)
        expect(typeof withDeps.isReady).toBe("boolean")

        return withDeps
      }).pipe(Effect.provide(layer))
    )

    // Verify it's actually ready (no blockers)
    expect(result.blockedBy).toHaveLength(0)
    expect(result.isReady).toBe(true)
  })
})

// =============================================================================
// Golden Path: Ready Detection
// =============================================================================

describe("Golden Path: Ready Detection", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("ready tasks are sorted by score descending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const readySvc = yield* ReadyService
        const ready = yield* readySvc.getReady()

        // Verify score ordering
        for (let i = 1; i < ready.length; i++) {
          expect(ready[i - 1].score).toBeGreaterThanOrEqual(ready[i].score)
        }

        return ready
      }).pipe(Effect.provide(layer))
    )

    expect(result.length).toBeGreaterThan(0)
  })

  it("ready respects limit parameter", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const readySvc = yield* ReadyService
        const oneTask = yield* readySvc.getReady(1)
        const allReady = yield* readySvc.getReady(100)

        return { oneTask, allReady }
      }).pipe(Effect.provide(layer))
    )

    expect(result.oneTask).toHaveLength(1)
    expect(result.allReady.length).toBeGreaterThanOrEqual(1)
  })

  it("isReady correctly identifies blocked vs unblocked tasks", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const readySvc = yield* ReadyService

        // JWT is ready (has no open blockers)
        const jwtReady = yield* readySvc.isReady(FIXTURES.TASK_JWT)

        // BLOCKED is not ready (blocked by JWT and LOGIN)
        const blockedReady = yield* readySvc.isReady(FIXTURES.TASK_BLOCKED)

        return { jwtReady, blockedReady }
      }).pipe(Effect.provide(layer))
    )

    expect(result.jwtReady).toBe(true)
    expect(result.blockedReady).toBe(false)
  })
})

// =============================================================================
// Golden Path: Task Updates
// =============================================================================

describe("Golden Path: Task Updates", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("update changes specified fields only", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        const before = yield* taskSvc.get(FIXTURES.TASK_JWT)
        const originalTitle = before.title

        // Update only score
        const after = yield* taskSvc.update(FIXTURES.TASK_JWT, { score: 9999 })

        expect(after.score).toBe(9999)
        expect(after.title).toBe(originalTitle) // Title unchanged

        return { before, after }
      }).pipe(Effect.provide(layer))
    )

    expect(result.after.score).toBe(9999)
  })

  it("status transitions work correctly", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        // Create a fresh task
        const task = yield* taskSvc.create({ title: "Status test", score: 100 })
        expect(task.status).toBe("backlog")

        // Transition through statuses
        const ready = yield* taskSvc.update(task.id, { status: "ready" })
        expect(ready.status).toBe("ready")

        const active = yield* taskSvc.update(task.id, { status: "active" })
        expect(active.status).toBe("active")

        const done = yield* taskSvc.update(task.id, { status: "done" })
        expect(done.status).toBe("done")
        expect(done.completedAt).not.toBeNull()

        return { task, ready, active, done }
      }).pipe(Effect.provide(layer))
    )

    expect(result.done.completedAt).toBeDefined()
  })

  it("delete removes task completely", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        const task = yield* taskSvc.create({ title: "To delete", score: 100 })
        yield* taskSvc.remove(task.id)

        // Get should fail
        const getResult = yield* taskSvc.get(task.id).pipe(Effect.either)
        expect(getResult._tag).toBe("Left")

        return { task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.task.id).toBeDefined()
  })
})
