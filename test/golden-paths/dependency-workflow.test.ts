/**
 * Golden Path: Dependency Workflow Integration Tests
 *
 * Tests the complete dependency workflow: block → unblock → ready detection.
 * Verifies that dependency chains are correctly tracked and enforced.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 * Per Rule 4: No circular dependencies, no self-blocking.
 *
 * @see DD-004: Ready Detection Algorithm
 * @see PRD-003: Dependency Blocking System
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  TaskServiceLive,
  TaskService,
  DependencyServiceLive,
  DependencyService,
  ReadyServiceLive,
  ReadyService,
  isReadyResult,
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
    DependencyServiceLive,
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

const _DEP_FIXTURES = {
  TASK_A: fixtureId("dep-workflow:task-a"),
  TASK_B: fixtureId("dep-workflow:task-b"),
  TASK_C: fixtureId("dep-workflow:task-c"),
  TASK_D: fixtureId("dep-workflow:task-d"),
} as const

// =============================================================================
// Golden Path: Dependency Chain
// =============================================================================

describe("Golden Path: Dependency Chain", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeTestLayer(db)
  })

  it("complete chain: A → B → C (A blocks B, B blocks C)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const readySvc = yield* ReadyService

        // Step 1: Create tasks
        const taskA = yield* taskSvc.create({ title: "Task A - Foundation", score: 800 })
        const taskB = yield* taskSvc.create({ title: "Task B - Build on A", score: 600 })
        const taskC = yield* taskSvc.create({ title: "Task C - Build on B", score: 400 })

        // Step 2: Create dependency chain: A → B → C
        yield* depSvc.addBlocker(taskB.id, taskA.id) // A blocks B
        yield* depSvc.addBlocker(taskC.id, taskB.id) // B blocks C

        // Step 3: Verify ready state
        const aReady = yield* readySvc.isReady(taskA.id)
        const bReady = yield* readySvc.isReady(taskB.id)
        const cReady = yield* readySvc.isReady(taskC.id)

        expect(aReady._tag).toBe("Ready")    // A has no blockers
        expect(bReady._tag).toBe("Blocked")  // A blocks B
        expect(cReady._tag).toBe("Blocked")  // B blocks C

        // Step 4: Complete A
        yield* taskSvc.update(taskA.id, { status: "done" })

        // Step 5: Now B should be ready, but C still blocked
        const bReadyAfterA = yield* readySvc.isReady(taskB.id)
        const cReadyAfterA = yield* readySvc.isReady(taskC.id)

        expect(bReadyAfterA._tag).toBe("Ready")    // A is done, B unblocked
        expect(cReadyAfterA._tag).toBe("Blocked")  // B still blocks C

        // Step 6: Complete B
        yield* taskSvc.update(taskB.id, { status: "done" })

        // Step 7: Now C should be ready
        const cReadyAfterB = yield* readySvc.isReady(taskC.id)
        expect(cReadyAfterB._tag).toBe("Ready") // B is done, C unblocked

        return { taskA, taskB, taskC }
      }).pipe(Effect.provide(layer))
    )

    expect(result.taskA.id).toBeDefined()
    expect(result.taskB.id).toBeDefined()
    expect(result.taskC.id).toBeDefined()
  })

  it("parallel dependencies: C blocked by both A and B", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const readySvc = yield* ReadyService

        // Create tasks
        const taskA = yield* taskSvc.create({ title: "Task A", score: 800 })
        const taskB = yield* taskSvc.create({ title: "Task B", score: 700 })
        const taskC = yield* taskSvc.create({ title: "Task C - Depends on A and B", score: 600 })

        // C is blocked by both A and B
        yield* depSvc.addBlocker(taskC.id, taskA.id)
        yield* depSvc.addBlocker(taskC.id, taskB.id)

        // Verify C is blocked
        const cWithDeps = yield* taskSvc.getWithDeps(taskC.id)
        expect(cWithDeps.blockedBy).toHaveLength(2)
        expect(cWithDeps.blockedBy).toContain(taskA.id)
        expect(cWithDeps.blockedBy).toContain(taskB.id)
        expect(cWithDeps.isReady).toBe(false)

        // Complete only A - C should still be blocked
        yield* taskSvc.update(taskA.id, { status: "done" })
        const cAfterA = yield* readySvc.isReady(taskC.id)
        expect(cAfterA._tag).toBe("Blocked") // Still blocked by B

        // Complete B - now C should be ready
        yield* taskSvc.update(taskB.id, { status: "done" })
        const cAfterBoth = yield* readySvc.isReady(taskC.id)
        expect(cAfterBoth._tag).toBe("Ready") // Both blockers done

        return { taskA, taskB, taskC }
      }).pipe(Effect.provide(layer))
    )

    expect(result.taskC.id).toBeDefined()
  })

  it("unblock removes dependency", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const readySvc = yield* ReadyService

        // Create tasks
        const taskA = yield* taskSvc.create({ title: "Task A", score: 800 })
        const taskB = yield* taskSvc.create({ title: "Task B", score: 600 })

        // A blocks B
        yield* depSvc.addBlocker(taskB.id, taskA.id)
        expect((yield* readySvc.isReady(taskB.id))._tag).toBe("Blocked")

        // Remove the blocker
        yield* depSvc.removeBlocker(taskB.id, taskA.id)

        // B should now be ready
        expect((yield* readySvc.isReady(taskB.id))._tag).toBe("Ready")

        // Verify blockedBy is empty
        const bWithDeps = yield* taskSvc.getWithDeps(taskB.id)
        expect(bWithDeps.blockedBy).toHaveLength(0)

        return { taskA, taskB }
      }).pipe(Effect.provide(layer))
    )

    expect(result.taskB.id).toBeDefined()
  })
})

// =============================================================================
// Golden Path: Dependency Constraints
// =============================================================================

describe("Golden Path: Dependency Constraints", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("rejects self-blocking (Rule 4)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const depSvc = yield* DependencyService

        // Try to make a task block itself
        const error = yield* depSvc.addBlocker(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT).pipe(
          Effect.flip
        )

        return { error }
      }).pipe(Effect.provide(layer))
    )

    expect((result.error as any)._tag).toBe("ValidationError")
  })

  it("rejects circular dependencies (Rule 4)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const depSvc = yield* DependencyService

        // TASK_JWT blocks TASK_BLOCKED (from seedFixtures)
        // Try to make TASK_BLOCKED block TASK_JWT (circular)
        const error = yield* depSvc.addBlocker(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED).pipe(
          Effect.flip
        )

        return { error }
      }).pipe(Effect.provide(layer))
    )

    expect((result.error as any)._tag).toBe("CircularDependencyError")
  })

  it("detects longer circular chains", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService

        // Create: A → B → C
        const taskA = yield* taskSvc.create({ title: "A", score: 100 })
        const taskB = yield* taskSvc.create({ title: "B", score: 100 })
        const taskC = yield* taskSvc.create({ title: "C", score: 100 })

        yield* depSvc.addBlocker(taskB.id, taskA.id) // A blocks B
        yield* depSvc.addBlocker(taskC.id, taskB.id) // B blocks C

        // Try to make C block A (would create A → B → C → A cycle)
        const error = yield* depSvc.addBlocker(taskA.id, taskC.id).pipe(Effect.flip)

        return { error, taskA, taskB, taskC }
      }).pipe(Effect.provide(layer))
    )

    expect((result.error as any)._tag).toBe("CircularDependencyError")
  })
})

// =============================================================================
// Golden Path: Blocks vs BlockedBy
// =============================================================================

describe("Golden Path: Blocks vs BlockedBy", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("blockedBy and blocks are correctly populated", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        // TASK_JWT blocks TASK_BLOCKED (from seedFixtures)
        const jwtWithDeps = yield* taskSvc.getWithDeps(FIXTURES.TASK_JWT)
        const blockedWithDeps = yield* taskSvc.getWithDeps(FIXTURES.TASK_BLOCKED)

        // JWT should show it blocks TASK_BLOCKED
        expect(jwtWithDeps.blocks).toContain(FIXTURES.TASK_BLOCKED)
        expect(jwtWithDeps.blockedBy).toHaveLength(0)

        // BLOCKED should show it's blocked by JWT
        expect(blockedWithDeps.blockedBy).toContain(FIXTURES.TASK_JWT)
        expect(blockedWithDeps.blockedBy).toContain(FIXTURES.TASK_LOGIN) // Also blocked by LOGIN

        return { jwtWithDeps, blockedWithDeps }
      }).pipe(Effect.provide(layer))
    )

    expect(result.jwtWithDeps.blocks.length).toBeGreaterThan(0)
    expect(result.blockedWithDeps.blockedBy.length).toBe(2)
  })

  it("ready list only includes tasks with no open blockers", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const readySvc = yield* ReadyService

        const ready = yield* readySvc.getReady()

        // All ready tasks should have isReady = true and no open blockers
        for (const task of ready) {
          expect(task.isReady).toBe(true)
          // blockedBy contains blocker IDs, but all blockers should be done
          // for task to be in ready list
        }

        // TASK_BLOCKED should NOT be in ready (has open blockers)
        expect(ready.find(t => t.id === FIXTURES.TASK_BLOCKED)).toBeUndefined()

        return ready
      }).pipe(Effect.provide(layer))
    )

    expect(result.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// Golden Path: Complex Dependency Scenarios
// =============================================================================

describe("Golden Path: Complex Dependency Scenarios", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeTestLayer(db)
  })

  it("diamond dependency pattern", async () => {
    /**
     * Diamond pattern:
     *        A
     *       / \
     *      B   C
     *       \ /
     *        D
     *
     * D is blocked by both B and C
     * B and C are blocked by A
     */
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const readySvc = yield* ReadyService

        // Create tasks
        const a = yield* taskSvc.create({ title: "A - Top", score: 1000 })
        const b = yield* taskSvc.create({ title: "B - Middle Left", score: 800 })
        const c = yield* taskSvc.create({ title: "C - Middle Right", score: 800 })
        const d = yield* taskSvc.create({ title: "D - Bottom", score: 600 })

        // Set up diamond
        yield* depSvc.addBlocker(b.id, a.id) // A blocks B
        yield* depSvc.addBlocker(c.id, a.id) // A blocks C
        yield* depSvc.addBlocker(d.id, b.id) // B blocks D
        yield* depSvc.addBlocker(d.id, c.id) // C blocks D

        // Only A should be ready
        const readyBefore = yield* readySvc.getReady()
        expect(readyBefore.map(t => t.id)).toContain(a.id)
        expect(readyBefore.find(t => t.id === b.id)).toBeUndefined()
        expect(readyBefore.find(t => t.id === c.id)).toBeUndefined()
        expect(readyBefore.find(t => t.id === d.id)).toBeUndefined()

        // Complete A
        yield* taskSvc.update(a.id, { status: "done" })

        // Now B and C should be ready
        const readyAfterA = yield* readySvc.getReady()
        expect(readyAfterA.find(t => t.id === b.id)).toBeDefined()
        expect(readyAfterA.find(t => t.id === c.id)).toBeDefined()
        expect(readyAfterA.find(t => t.id === d.id)).toBeUndefined() // Still blocked

        // Complete B (but not C)
        yield* taskSvc.update(b.id, { status: "done" })

        // D should still be blocked (needs C)
        expect((yield* readySvc.isReady(d.id))._tag).toBe("Blocked")

        // Complete C
        yield* taskSvc.update(c.id, { status: "done" })

        // Now D should be ready
        expect((yield* readySvc.isReady(d.id))._tag).toBe("Ready")

        return { a, b, c, d }
      }).pipe(Effect.provide(layer))
    )

    expect(result.d.id).toBeDefined()
  })

  it("wide dependency pattern (many blockers)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const readySvc = yield* ReadyService

        // Create main task and 5 blockers
        const main = yield* taskSvc.create({ title: "Main Task", score: 1000 })
        const blockers = []
        for (let i = 0; i < 5; i++) {
          const blocker = yield* taskSvc.create({ title: `Blocker ${i + 1}`, score: 800 })
          yield* depSvc.addBlocker(main.id, blocker.id)
          blockers.push(blocker)
        }

        // Main should be blocked by all 5
        const mainWithDeps = yield* taskSvc.getWithDeps(main.id)
        expect(mainWithDeps.blockedBy).toHaveLength(5)
        expect(mainWithDeps.isReady).toBe(false)

        // Complete 4 of 5 blockers
        for (let i = 0; i < 4; i++) {
          yield* taskSvc.update(blockers[i].id, { status: "done" })
        }

        // Main should still be blocked
        expect((yield* readySvc.isReady(main.id))._tag).toBe("Blocked")

        // Complete the last blocker
        yield* taskSvc.update(blockers[4].id, { status: "done" })

        // Now main should be ready
        expect((yield* readySvc.isReady(main.id))._tag).toBe("Ready")

        return { main, blockers }
      }).pipe(Effect.provide(layer))
    )

    expect(result.blockers).toHaveLength(5)
  })
})
