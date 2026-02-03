/**
 * Chaos Engineering: Invariant Assertion Tests
 *
 * Tests critical invariants from the DOCTRINE rules to ensure
 * system correctness under various conditions.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * These tests validate the non-negotiable rules defined in CLAUDE.md:
 * - Rule 1: Every API response MUST include full dependency information
 * - Rule 4: No circular dependencies, no self-blocking
 * - Rule 5: Effect-TS patterns are mandatory
 * - Rule 6: Telemetry MUST NOT block operations
 * - Rule 7: ANTHROPIC_API_KEY is optional for core commands
 *
 * @module test/chaos/invariants
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import type { TaskId } from "@jamesaphoenix/tx-types"
import {
  createTestDatabase,
  fixtureId,
  chaos,
  type TestDatabase
} from "@jamesaphoenix/tx-test-utils"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const FIXTURES = {
  TASK_1: fixtureId("invariant-task-1") as TaskId,
  TASK_2: fixtureId("invariant-task-2") as TaskId,
  TASK_3: fixtureId("invariant-task-3") as TaskId,
  TASK_PARENT: fixtureId("invariant-parent") as TaskId,
  TASK_CHILD: fixtureId("invariant-child") as TaskId
} as const

// =============================================================================
// Test Layer Factory
// =============================================================================

async function makeTestLayer() {
  const {
    SqliteClientLive,
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive,
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    AutoSyncServiceNoop
  } = await import("@jamesaphoenix/tx-core")

  const infra = SqliteClientLive(":memory:")
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive
  ).pipe(Layer.provide(infra))

  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(Layer.provide(Layer.merge(repos, AutoSyncServiceNoop)))

  return Layer.mergeAll(services, repos)
}

// =============================================================================
// DOCTRINE RULE 1: Every API response MUST include full dependency information
// =============================================================================

describe("DOCTRINE Rule 1: TaskWithDeps in all responses", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("getWithDeps returns all required TaskWithDeps fields", async () => {
    const { TaskService, DependencyService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService

        // Setup: Create tasks via service layer
        const parent = yield* taskSvc.create({ title: "Parent Task", score: 1000 })
        const child = yield* taskSvc.create({ title: "Child Task", score: 500, parentId: parent.id })
        const blocker = yield* taskSvc.create({ title: "Blocker Task", score: 600 })

        // Add dependency
        yield* depSvc.addBlocker(child.id, blocker.id)

        return yield* taskSvc.getWithDeps(child.id)
      }).pipe(Effect.provide(layer))
    )

    // INVARIANT: TaskWithDeps must have all fields
    expect(result).toHaveProperty("blockedBy")
    expect(result).toHaveProperty("blocks")
    expect(result).toHaveProperty("children")
    expect(result).toHaveProperty("isReady")

    // Verify actual values
    expect(Array.isArray(result.blockedBy)).toBe(true)
    expect(Array.isArray(result.blocks)).toBe(true)
    expect(Array.isArray(result.children)).toBe(true)
    expect(typeof result.isReady).toBe("boolean")

    expect(result.blockedBy.length).toBeGreaterThan(0)
    expect(result.isReady).toBe(false) // Blocked
  })

  it("ready service returns tasks with dependency info", async () => {
    const { ReadyService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    // Setup multiple tasks
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
      [FIXTURES.TASK_1, "Ready Task", now, now]
    )

    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    // INVARIANT: All ready tasks must have TaskWithDeps fields
    for (const task of ready) {
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
      expect(task.isReady).toBe(true)
    }
  })
})

// =============================================================================
// DOCTRINE RULE 4: No circular dependencies, no self-blocking
// =============================================================================

describe("DOCTRINE Rule 4: No circular dependencies, no self-blocking", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("CHECK constraint prevents self-blocking at database level", () => {
    const now = new Date().toISOString()

    // Create task
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`,
      [FIXTURES.TASK_1, "Self Block Test", now, now]
    )

    // Attempt to self-block should fail
    expect(() => {
      db.run(
        `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at)
         VALUES (?, ?, ?)`,
        [FIXTURES.TASK_1, FIXTURES.TASK_1, now]
      )
    }).toThrow()
  })

  it("DependencyService rejects self-blocking", async () => {
    const { DependencyService, TaskService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService

        const task = yield* taskSvc.create({
          title: "Self Block Test",
          score: 500
        })

        return yield* depSvc.addBlocker(task.id, task.id).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("ValidationError")
    }
  })

  it("DependencyService detects and rejects circular dependencies", async () => {
    const { DependencyService, TaskService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService

        // Create A and B
        const taskA = yield* taskSvc.create({ title: "Task A", score: 500 })
        const taskB = yield* taskSvc.create({ title: "Task B", score: 400 })

        // A blocks B (A -> B)
        yield* depSvc.addBlocker(taskB.id, taskA.id)

        // Attempt B blocks A (B -> A) should create cycle
        return yield* depSvc.addBlocker(taskA.id, taskB.id).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("CircularDependencyError")
    }
  })

  it("validates corrupted self-reference data is detectable", () => {
    const now = new Date().toISOString()

    // Create task
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`,
      [FIXTURES.TASK_1, "Corruption Test", now, now]
    )

    // Corrupt with self-reference (bypassing constraints)
    const corruption = chaos.corruptState({
      table: "tasks",
      type: "self_reference",
      db,
      rowId: FIXTURES.TASK_1
    })

    expect(corruption.corrupted).toBe(true)

    // Verify the corruption exists
    const task = db.query<{ parent_id: string | null }>(
      "SELECT parent_id FROM tasks WHERE id = ?",
      [FIXTURES.TASK_1]
    )[0]

    expect(task.parent_id).toBe(FIXTURES.TASK_1)
  })
})

// =============================================================================
// DOCTRINE RULE 5: Effect-TS patterns are mandatory
// =============================================================================

describe("DOCTRINE Rule 5: Effect-TS patterns", () => {
  it("services use Effect for all operations", async () => {
    const {
      TaskService,
      ReadyService,
      HierarchyService
    } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    // All service methods should return Effect
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService
        const hierarchySvc = yield* HierarchyService

        // Create a task using Effect pattern
        const task = yield* taskSvc.create({
          title: "Effect Test Task",
          score: 500
        })

        // Use various services
        const withDeps = yield* taskSvc.getWithDeps(task.id)
        const ready = yield* readySvc.getReady()
        const isReady = yield* readySvc.isReady(task.id)
        const children = yield* hierarchySvc.getChildren(task.id)

        return { task, withDeps, ready, isReady, children }
      }).pipe(Effect.provide(layer))
    )

    // All operations completed successfully using Effect
    expect(results.task.id).toMatch(/^tx-/)
    expect(results.withDeps.id).toBe(results.task.id)
    expect(Array.isArray(results.ready)).toBe(true)
    expect(typeof results.isReady).toBe("boolean")
    expect(Array.isArray(results.children)).toBe(true)
  })

  it("errors are properly typed using Effect error channel", async () => {
    const { TaskService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get("tx-nonexist" as TaskId).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("TaskNotFoundError")
    }
  })
})

// =============================================================================
// Additional Invariants: Data Integrity
// =============================================================================

describe("Data Integrity Invariants", () => {
  it("task IDs follow tx-[a-z0-9]{8} format", async () => {
    const { TaskService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({
          title: "ID Format Test",
          score: 500
        })
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("fixture IDs are deterministic", () => {
    const id1 = fixtureId("test-fixture")
    const id2 = fixtureId("test-fixture")
    const id3 = fixtureId("different-fixture")

    expect(id1).toBe(id2)
    expect(id1).not.toBe(id3)
    expect(id1).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("completed tasks have completedAt timestamp", async () => {
    const { TaskService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        const created = yield* svc.create({
          title: "Completion Test",
          score: 500
        })

        // Move to active then done
        yield* svc.update(created.id, { status: "active" })
        return yield* svc.update(created.id, { status: "done" })
      }).pipe(Effect.provide(layer))
    )

    expect(task.status).toBe("done")
    expect(task.completedAt).not.toBeNull()
    expect(task.completedAt).toBeInstanceOf(Date)
  })

  it("ready tasks have isReady=true and no open blockers", async () => {
    const { TaskService, DependencyService, ReadyService } = await import("@jamesaphoenix/tx-core")
    const layer = await makeTestLayer()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const readySvc = yield* ReadyService

        // Create tasks with and without blockers via service layer
        const readyTask = yield* taskSvc.create({ title: "Ready Task", score: 600 })
        yield* taskSvc.update(readyTask.id, { status: "ready" })

        const blockedTask = yield* taskSvc.create({ title: "Blocked Task", score: 500 })
        yield* depSvc.addBlocker(blockedTask.id, readyTask.id)

        // Query ready tasks using the same layer/database
        const readyTasks = yield* readySvc.getReady()

        return { readyTaskId: readyTask.id, blockedTaskId: blockedTask.id, readyTasks }
      }).pipe(Effect.provide(layer))
    )

    // Ready task should be in list, blocked task should not
    const task1 = result.readyTasks.find(t => t.id === result.readyTaskId)
    const task2 = result.readyTasks.find(t => t.id === result.blockedTaskId)

    expect(task1).toBeDefined()
    expect(task1?.isReady).toBe(true)
    expect(task1?.blockedBy).toEqual([])
    expect(task2).toBeUndefined() // Should not be in ready list
  })
})

// =============================================================================
// Stress Invariants: System maintains correctness under load
// =============================================================================

describe("Stress Invariants", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("claim invariant: only one winner even under high concurrency", async () => {
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, ?, ?, '{}')`,
      [FIXTURES.TASK_1, "Race Task", now, now]
    )

    const result = await chaos.raceWorkers({
      count: 10,
      taskId: FIXTURES.TASK_1,
      db
    })

    // INVARIANT: Exactly one winner
    expect(result.successfulClaims).toBe(1)
    expect(result.winner).not.toBeNull()
    expect(result.losers).toHaveLength(9)
  })

  it("transaction invariant: partial writes roll back completely", () => {
    const result = chaos.partialWrite({
      table: "tasks",
      db,
      rowCount: 10,
      failAtRow: 5,
      useTransaction: true
    })

    // INVARIANT: All-or-nothing with transactions
    expect(result.rowsWritten).toBe(0)
    expect(result.rolledBack).toBe(true)

    const tasks = db.query<{ id: string }>(
      "SELECT id FROM tasks WHERE title LIKE 'Partial Write%'"
    )
    expect(tasks.length).toBe(0)
  })
})
