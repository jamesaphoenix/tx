import { makeMinimalLayerFromInfra } from "@jamesaphoenix/tx"
/**
 * Concurrency Breaker Integration Tests
 *
 * Tests tx resilience against concurrency issues:
 * - Race conditions: Multiple workers claiming the same task
 * - Deadlocks: Circular dependency detection
 * - Claim conflicts: Handling competing claims
 *
 * Uses chaos engineering utilities from @tx/test-utils.
 *
 * @see DD-007 Testing Strategy
 * @see tx-440aa4fb Agent swarm: concurrency breaker
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import {
  createTestDatabase,
  type TestDatabase
} from "@jamesaphoenix/tx/testing"
import { fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  DependencyRepository,
  DependencyService,
  ReadyService,
} from "@jamesaphoenix/tx"
import type { TaskId } from "@jamesaphoenix/tx/types"

// Create test layer for task and dependency services
function makeTaskTestLayer(db: TestDatabase) { return makeMinimalLayerFromInfra(Layer.succeed(SqliteClient, db.db as any)) }

// =============================================================================
// DEADLOCK DETECTION TESTS
// =============================================================================

describe("Deadlock Detection: Circular Dependencies", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTaskTestLayer>

  // Tasks for cycle testing
  const CYCLE_A = fixtureId("cycle-a")
  const CYCLE_B = fixtureId("cycle-b")
  const CYCLE_C = fixtureId("cycle-c")

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeTaskTestLayer(db)

    // Create tasks for cycle testing
    const now = new Date().toISOString()
    const insert = db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    )
    insert.run(CYCLE_A, "Cycle Task A", now, now)
    insert.run(CYCLE_B, "Cycle Task B", now, now)
    insert.run(CYCLE_C, "Cycle Task C", now, now)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("hasPath detects direct path A -> B", async () => {
    // Create dependency: A blocks B
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_A, CYCLE_B)

    const hasPath = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(CYCLE_B, CYCLE_A)
      }).pipe(Effect.provide(layer))
    )

    // B is blocked by A, so there's a path from B to A in the blocker graph
    expect(hasPath).toBe(true)
  })

  it("hasPath detects transitive path A -> B -> C", async () => {
    // Create chain: A blocks B, B blocks C
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_A, CYCLE_B)
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_B, CYCLE_C)

    const hasPathToA = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(CYCLE_C, CYCLE_A)
      }).pipe(Effect.provide(layer))
    )

    expect(hasPathToA).toBe(true)
  })

  it("hasPath returns false for no path", async () => {
    // Create chain: A blocks B (but C is independent)
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_A, CYCLE_B)

    const hasPath = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(CYCLE_C, CYCLE_A)
      }).pipe(Effect.provide(layer))
    )

    expect(hasPath).toBe(false)
  })

  it("hasPath handles deep dependency chains (10+ levels) efficiently", async () => {
    // Create a deep chain: 1 -> 2 -> 3 -> ... -> 10 -> 11
    // This tests that the recursive CTE handles deep chains without N+1 queries
    const chainTasks = Array.from({ length: 11 }, (_, i) => fixtureId(`chain-${i}`))

    // Insert chain tasks
    const now = new Date().toISOString()
    const insertTask = db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    )
    for (let i = 0; i < chainTasks.length; i++) {
      insertTask.run(chainTasks[i], `Chain Task ${i}`, now, now)
    }

    // Create dependencies: task[i] blocks task[i+1]
    for (let i = 0; i < chainTasks.length - 1; i++) {
      db.db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
      ).run(chainTasks[i], chainTasks[i + 1])
    }

    // Test: hasPath from task[10] to task[0] should find the path through all 10 levels
    const hasPathDeep = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(chainTasks[10], chainTasks[0])
      }).pipe(Effect.provide(layer))
    )

    expect(hasPathDeep).toBe(true)

    // Test: hasPath from task[5] to task[0] should find partial path
    const hasPathPartial = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(chainTasks[5], chainTasks[0])
      }).pipe(Effect.provide(layer))
    )

    expect(hasPathPartial).toBe(true)

    // Test: hasPath from task[0] to task[10] should NOT find path (wrong direction)
    const hasPathReverse = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(chainTasks[0], chainTasks[10])
      }).pipe(Effect.provide(layer))
    )

    expect(hasPathReverse).toBe(false)
  })

  it("hasPath respects depth limit on very deep chains (>100 levels)", async () => {
    // Create a chain deeper than MAX_DEPENDENCY_DEPTH (100)
    // This verifies the depth limit clause prevents unbounded recursion
    const chainLength = 105
    const deepChainTasks = Array.from({ length: chainLength }, (_, i) => fixtureId(`deep-chain-${i}`))

    const now = new Date().toISOString()
    const insertTask = db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    )
    for (let i = 0; i < deepChainTasks.length; i++) {
      insertTask.run(deepChainTasks[i], `Deep Chain Task ${i}`, now, now)
    }

    // Create dependencies: task[i] blocks task[i+1]
    const insertDep = db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    )
    for (let i = 0; i < deepChainTasks.length - 1; i++) {
      insertDep.run(deepChainTasks[i], deepChainTasks[i + 1])
    }

    // Path within depth limit (90 levels) should be found
    const hasPathWithinLimit = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(deepChainTasks[90], deepChainTasks[0])
      }).pipe(Effect.provide(layer))
    )
    expect(hasPathWithinLimit).toBe(true)

    // Path beyond depth limit (104 levels) may not be found due to depth cutoff
    // The important thing is it doesn't crash or hit SQLite's internal limit
    const hasPathBeyondLimit = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.hasPath(deepChainTasks[104], deepChainTasks[0])
      }).pipe(Effect.provide(layer))
    )
    // With depth limit = 100, we can only traverse 100 levels from task[104]
    // which reaches task[4], not task[0]. So path is not found.
    expect(hasPathBeyondLimit).toBe(false)
  })

  it("insertWithCycleCheck works correctly at depth boundary", async () => {
    // Create a chain of exactly 99 levels (within limit)
    const chainLength = 100
    const boundaryTasks = Array.from({ length: chainLength }, (_, i) => fixtureId(`boundary-${i}`))

    const now = new Date().toISOString()
    const insertTask = db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    )
    for (let i = 0; i < boundaryTasks.length; i++) {
      insertTask.run(boundaryTasks[i], `Boundary Task ${i}`, now, now)
    }

    // Create chain: task[0] -> task[1] -> ... -> task[99] (99 dependency edges)
    const insertDep = db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    )
    for (let i = 0; i < boundaryTasks.length - 1; i++) {
      insertDep.run(boundaryTasks[i], boundaryTasks[i + 1])
    }

    // Attempt to add task[99] blocks task[0] — would create 100-level cycle
    // At depth limit, cycle detection may not find the path back
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.insertWithCycleCheck(boundaryTasks[99], boundaryTasks[0])
      }).pipe(Effect.provide(layer))
    )

    // The cycle check traverses from task[0] following blockers:
    // task[0] is blocked by nothing directly in the "blocked_id = ?" direction,
    // but task[99] blocks task[0] means we check if task[0] can reach task[99].
    // The chain goes task[0] <- task[1] <- ... <- task[99], so from task[99]'s
    // perspective as blocked_id, we walk blocker_id chain. At 99 edges this is
    // within the 100-level depth limit, so cycle should be detected.
    expect(result._tag).toBe("wouldCycle")
  })

  it("service block rejects self-blocking", async () => {
    // Attempting to make a task block itself should fail
    // addBlocker(taskId, blockerId) - add blockerId as a blocker of taskId
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(CYCLE_A as TaskId, CYCLE_A as TaskId).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    // Should fail due to constraint or service-level validation
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("service detects and rejects 2-node cycle", async () => {
    // Create: A blocks B (B is blocked by A)
    // addBlocker(B, A) - add A as a blocker of B
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(CYCLE_B as TaskId, CYCLE_A as TaskId)
      }).pipe(Effect.provide(layer))
    )

    // Attempt to create: B blocks A (would create A -> B -> A cycle)
    // addBlocker(A, B) - add B as a blocker of A
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(CYCLE_A as TaskId, CYCLE_B as TaskId).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    // Should fail due to cycle detection
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("CircularDependencyError")
    }
  })

  it("service detects and rejects 3-node cycle", async () => {
    // Create chain: A blocks B, B blocks C
    // A -> B: addBlocker(B, A)
    // B -> C: addBlocker(C, B)
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(CYCLE_B as TaskId, CYCLE_A as TaskId)
        yield* svc.addBlocker(CYCLE_C as TaskId, CYCLE_B as TaskId)
      }).pipe(Effect.provide(layer))
    )

    // Attempt to create: C blocks A (would create A -> B -> C -> A cycle)
    // addBlocker(A, C) - add C as a blocker of A
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(CYCLE_A as TaskId, CYCLE_C as TaskId).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("CircularDependencyError")
    }
  })

  it("service allows valid dependency chains", async () => {
    // Valid chain: A blocks B, B blocks C (no cycles)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(CYCLE_B as TaskId, CYCLE_A as TaskId)
        yield* svc.addBlocker(CYCLE_C as TaskId, CYCLE_B as TaskId)

        const repo = yield* DependencyRepository
        return yield* repo.getAll()
      }).pipe(Effect.provide(layer))
    )

    expect(result.length).toBe(2)
  })

  it("sequential addBlocker calls that would create cycle - second fails", async () => {
    // This tests DOCTRINE RULE 4 - atomic cycle detection.
    // When two addBlocker calls would create a cycle, the second must fail.
    // The atomicity ensures that the cycle check and insert happen together,
    // preventing any interleaving that could allow a cycle to be created.

    const RACE_A = fixtureId("race-cycle-a")
    const RACE_B = fixtureId("race-cycle-b")

    // Create fresh tasks for this test
    const now = new Date().toISOString()
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    ).run(RACE_A, "Race Task A", now, now)
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    ).run(RACE_B, "Race Task B", now, now)

    // First call: A blocks B (should succeed)
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(RACE_B as TaskId, RACE_A as TaskId)
      }).pipe(Effect.provide(layer))
    )

    // Second call: B blocks A (should fail - would create cycle)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(RACE_A as TaskId, RACE_B as TaskId).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    // Should fail with CircularDependencyError
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("CircularDependencyError")
    }

    // Verify no circular dependency exists in the database
    const deps = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.getAll()
      }).pipe(Effect.provide(layer))
    )

    const raceDeps = deps.filter(
      d => [RACE_A, RACE_B].includes(d.blockerId) && [RACE_A, RACE_B].includes(d.blockedId)
    )

    // Should only have one dependency (A->B), not two
    expect(raceDeps.length).toBe(1)
    expect(raceDeps[0].blockerId).toBe(RACE_A)
    expect(raceDeps[0].blockedId).toBe(RACE_B)
  })

  it("insertWithCycleCheck returns wouldCycle when cycle would be created", async () => {
    // Directly test the repository method to verify the atomic operation
    // correctly detects cycles
    const ATOMIC_A = fixtureId("atomic-cycle-a")
    const ATOMIC_B = fixtureId("atomic-cycle-b")

    const now = new Date().toISOString()
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    ).run(ATOMIC_A, "Atomic Task A", now, now)
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    ).run(ATOMIC_B, "Atomic Task B", now, now)

    // First insert: A blocks B (should succeed)
    const result1 = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.insertWithCycleCheck(ATOMIC_A, ATOMIC_B)
      }).pipe(Effect.provide(layer))
    )
    expect(result1._tag).toBe("inserted")

    // Second insert: B blocks A (should detect cycle)
    const result2 = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.insertWithCycleCheck(ATOMIC_B, ATOMIC_A)
      }).pipe(Effect.provide(layer))
    )
    expect(result2._tag).toBe("wouldCycle")

    // Verify only one dependency exists
    const deps = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.getAll()
      }).pipe(Effect.provide(layer))
    )

    const atomicDeps = deps.filter(
      d => [ATOMIC_A, ATOMIC_B].includes(d.blockerId) && [ATOMIC_A, ATOMIC_B].includes(d.blockedId)
    )
    expect(atomicDeps.length).toBe(1)
  })

  it("insertWithCycleCheck detects self-cycle", async () => {
    // Test that self-blocking is detected
    const SELF_TASK = fixtureId("self-cycle-task")

    const now = new Date().toISOString()
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 500, ?, ?, '{}')`
    ).run(SELF_TASK, "Self Cycle Task", now, now)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* DependencyRepository
        return yield* repo.insertWithCycleCheck(SELF_TASK, SELF_TASK)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("wouldCycle")
  })

  it("task ready detection respects dependency chain", async () => {
    // Create chain: A blocks B blocks C
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_A, CYCLE_B)
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_B, CYCLE_C)

    const readyTasks = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    // Only A (head of chain) should be ready among our cycle tasks
    const cycleReady = readyTasks.filter(t => [CYCLE_A, CYCLE_B, CYCLE_C].includes(t.id))
    expect(cycleReady.length).toBe(1)
    expect(cycleReady[0].id).toBe(CYCLE_A)
  })

  it("completing head of chain unblocks next task", async () => {
    // Create chain: A blocks B blocks C
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_A, CYCLE_B)
    db.db.prepare(
      "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(CYCLE_B, CYCLE_C)

    // Complete A
    db.db.prepare("UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?").run(CYCLE_A)

    const readyTasks = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    // Now B should be ready (A is done)
    const cycleReady = readyTasks.filter(t => [CYCLE_A, CYCLE_B, CYCLE_C].includes(t.id))
    expect(cycleReady.length).toBe(1)
    expect(cycleReady[0].id).toBe(CYCLE_B)
  })
})
