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
  raceWorkers,
  delayedClaim,
  fixtureId as chaosFixtureId,
  type TestDatabase
} from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  DependencyRepository,
  TaskServiceLive,
  TaskService,
  DependencyServiceLive,
  DependencyService,
  ReadyServiceLive,
  ReadyService,
  HierarchyServiceLive,
  WorkerRepositoryLive,
  WorkerRepository,
  ClaimRepositoryLive,
  ClaimRepository,
  ClaimServiceLive,
  ClaimService,
  OrchestratorStateRepositoryLive,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

// Create test layer for task and dependency services
function makeTaskTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  const baseServices = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(Layer.provide(Layer.merge(repos, AutoSyncServiceNoop)))
  return Layer.mergeAll(baseServices, repos)
}

// Create test layer for claim services
function makeClaimTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    WorkerRepositoryLive,
    ClaimRepositoryLive,
    OrchestratorStateRepositoryLive
  ).pipe(Layer.provide(infra))
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    ClaimServiceLive
  ).pipe(Layer.provide(Layer.merge(repos, AutoSyncServiceNoop)))
  return Layer.mergeAll(services, repos)
}


// =============================================================================
// RACE CONDITION TESTS
// =============================================================================

describe("Race Conditions: Claim Contention", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeClaimTestLayer>
  const raceTaskId = fixtureId("race-task")

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)

    // Create a task for workers to race for
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, datetime('now'), datetime('now'), '{}')`
    ).run(raceTaskId, "Task to Race For")

    layer = makeClaimTestLayer(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("only one worker wins when 5 workers race for the same task", async () => {
    const result = await raceWorkers({
      count: 5,
      taskId: raceTaskId,
      db: db
    })

    // CRITICAL: Only one worker should successfully claim
    expect(result.successfulClaims).toBe(1)
    expect(result.winner).not.toBeNull()
    expect(result.workers.length).toBe(5)
    expect(result.losers.length).toBe(4)

    // No duplicate claim errors (race handling should be clean)
    const duplicateErrors = result.errors.filter(e => e.error.includes("Duplicate"))
    expect(duplicateErrors.length).toBe(0)
  })

  it("only one worker wins when 10 workers race for the same task", async () => {
    const result = await raceWorkers({
      count: 10,
      taskId: raceTaskId,
      db: db
    })

    // Even with more contention, only one should win
    expect(result.successfulClaims).toBe(1)
    expect(result.winner).not.toBeNull()
    expect(result.losers.length).toBe(9)
  })

  it("winner's claim is valid and active", async () => {
    const result = await raceWorkers({
      count: 5,
      taskId: raceTaskId,
      db: db
    })

    // Verify via service that winner has valid active claim
    const activeClaim = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ClaimService
        return yield* svc.getActiveClaim(raceTaskId)
      }).pipe(Effect.provide(layer))
    )

    expect(activeClaim).not.toBeNull()
    expect(activeClaim!.workerId).toBe(result.winner)
    expect(activeClaim!.status).toBe("active")
  })

  it("all workers are properly registered after race", async () => {
    const result = await raceWorkers({
      count: 5,
      taskId: raceTaskId,
      db: db
    })

    // All workers should be registered
    const workers = db.db.prepare("SELECT id FROM workers").all() as Array<{ id: string }>
    expect(workers.length).toBe(5)
    expect(workers.map(w => w.id)).toEqual(expect.arrayContaining(result.workers))
  })

  it("staggered claims still result in single winner", async () => {
    // Add delay between worker attempts to simulate real-world scenarios
    const result = await raceWorkers({
      count: 5,
      taskId: raceTaskId,
      db: db,
      delayBetweenMs: 10
    })

    expect(result.successfulClaims).toBe(1)
    expect(result.winner).not.toBeNull()
  })

  it("service-level claim rejects already-claimed task", async () => {
    // First, create workers via service
    const worker1Id = chaosFixtureId("service-worker-1")
    const worker2Id = chaosFixtureId("service-worker-2")

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository
        const _taskRepo = yield* TaskService

        // Register workers
        yield* workerRepo.insert({
          id: worker1Id,
          name: "Worker 1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: worker2Id,
          name: "Worker 2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims first
        yield* claimSvc.claim(raceTaskId, worker1Id)

        // Worker 2 tries to claim same task - should fail
        return yield* claimSvc.claim(raceTaskId, worker2Id).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("AlreadyClaimedError")
    expect((error as any).claimedByWorkerId).toBe(worker1Id)
  })
})

describe("Race Conditions: Delayed Claim Detection", () => {
  let db: TestDatabase
  const delayTaskId = fixtureId("delay-task")
  const slowWorkerId = chaosFixtureId("slow-worker")

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)

    // Create task and worker
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, datetime('now'), datetime('now'), '{}')`
    ).run(delayTaskId, "Delay Test Task")

    db.db.prepare(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), '[]', '{}')`
    ).run(slowWorkerId, "Slow Worker", "localhost", process.pid, "idle")
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("slow worker detects race when fast worker claims first", async () => {
    const fastWorkerId = chaosFixtureId("fast-worker")

    // Register fast worker
    db.db.prepare(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), '[]', '{}')`
    ).run(fastWorkerId, "Fast Worker", "localhost", process.pid, "idle")

    // Start slow claim
    const delayedPromise = delayedClaim({
      taskId: delayTaskId,
      workerId: slowWorkerId,
      db: db,
      delayMs: 100,
      checkRace: true
    })

    // Fast worker claims during the delay
    await new Promise(resolve => setTimeout(resolve, 20))
    db.db.prepare(
      `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
       VALUES (?, ?, datetime('now'), datetime('now', '+30 minutes'), 0, 'active')`
    ).run(delayTaskId, fastWorkerId)

    const result = await delayedPromise

    expect(result.raceDetected).toBe(true)
    expect(result.claimed).toBe(false)
    expect(result.claimedBy).toBe(fastWorkerId)
  })

  it("slow worker successfully claims when no competition", async () => {
    const result = await delayedClaim({
      taskId: delayTaskId,
      workerId: slowWorkerId,
      db: db,
      delayMs: 50,
      checkRace: true
    })

    expect(result.claimed).toBe(true)
    expect(result.claimedBy).toBe(slowWorkerId)
    expect(result.raceDetected).toBe(false)
  })

  it("wait time is accurate", async () => {
    const result = await delayedClaim({
      taskId: delayTaskId,
      workerId: slowWorkerId,
      db: db,
      delayMs: 100,
      checkRace: false
    })

    expect(result.waitedMs).toBeGreaterThanOrEqual(100)
    expect(result.waitedMs).toBeLessThan(200) // Reasonable upper bound
  })
})

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

  it("ready detection respects dependency chain", async () => {
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

// =============================================================================
// CLAIM CONFLICT RESOLUTION TESTS
// =============================================================================

describe("Claim Conflicts: Resolution and Recovery", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeClaimTestLayer>
  const conflictTaskId = fixtureId("conflict-task")
  const worker1Id = chaosFixtureId("conflict-worker-1")
  const worker2Id = chaosFixtureId("conflict-worker-2")

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)

    // Create task for conflict testing
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, datetime('now'), datetime('now'), '{}')`
    ).run(conflictTaskId, "Conflict Test Task")

    layer = makeClaimTestLayer(db)
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("released claim allows new claim by different worker", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository

        // Register workers
        yield* workerRepo.insert({
          id: worker1Id,
          name: "Worker 1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: worker2Id,
          name: "Worker 2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims and releases
        yield* claimSvc.claim(conflictTaskId, worker1Id)
        yield* claimSvc.release(conflictTaskId, worker1Id)

        // Worker 2 should now be able to claim
        const newClaim = yield* claimSvc.claim(conflictTaskId, worker2Id)
        return newClaim
      }).pipe(Effect.provide(layer))
    )

    expect(result.taskId).toBe(conflictTaskId)
    expect(result.workerId).toBe(worker2Id)
    expect(result.status).toBe("active")
  })

  it("expired claim allows new claim", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const claimRepo = yield* ClaimRepository
        const workerRepo = yield* WorkerRepository

        // Register workers
        yield* workerRepo.insert({
          id: worker1Id,
          name: "Worker 1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: worker2Id,
          name: "Worker 2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims
        const claim = yield* claimSvc.claim(conflictTaskId, worker1Id)

        // Manually expire the claim (simulating time passage)
        yield* claimRepo.update({
          ...claim,
          leaseExpiresAt: new Date(Date.now() - 60000) // 1 minute ago
        })

        // Expire the claim via service
        yield* claimSvc.expire(claim.id)

        // Worker 2 should now be able to claim
        const newClaim = yield* claimSvc.claim(conflictTaskId, worker2Id)
        return newClaim
      }).pipe(Effect.provide(layer))
    )

    expect(result.taskId).toBe(conflictTaskId)
    expect(result.workerId).toBe(worker2Id)
  })

  it("renew fails when another worker holds the claim", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository

        // Register workers
        yield* workerRepo.insert({
          id: worker1Id,
          name: "Worker 1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: worker2Id,
          name: "Worker 2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims
        yield* claimSvc.claim(conflictTaskId, worker1Id)

        // Worker 2 tries to renew (shouldn't work - not the owner)
        return yield* claimSvc.renew(conflictTaskId, worker2Id).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  it("release fails when different worker tries to release", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository

        // Register workers
        yield* workerRepo.insert({
          id: worker1Id,
          name: "Worker 1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: worker2Id,
          name: "Worker 2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims
        yield* claimSvc.claim(conflictTaskId, worker1Id)

        // Worker 2 tries to release (shouldn't work)
        return yield* claimSvc.release(conflictTaskId, worker2Id).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  it("releaseByWorker clears all claims for a worker", async () => {
    // Create additional tasks directly in DB (we need specific IDs for claims)
    const task2Id = fixtureId("conflict-task-2")
    const task3Id = fixtureId("conflict-task-3")

    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, datetime('now'), datetime('now'), '{}')`
    ).run(task2Id, "Conflict Task 2")
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, datetime('now'), datetime('now'), '{}')`
    ).run(task3Id, "Conflict Task 3")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository

        // Register workers
        yield* workerRepo.insert({
          id: worker1Id,
          name: "Worker 1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: worker2Id,
          name: "Worker 2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Worker 1 claims multiple tasks
        yield* claimSvc.claim(conflictTaskId, worker1Id)
        yield* claimSvc.claim(task2Id, worker1Id)

        // Worker 2 claims one task
        yield* claimSvc.claim(task3Id, worker2Id)

        // Release all of worker 1's claims
        const released = yield* claimSvc.releaseByWorker(worker1Id)

        // Check remaining active claims
        const claim1 = yield* claimSvc.getActiveClaim(conflictTaskId)
        const claim2 = yield* claimSvc.getActiveClaim(task2Id)
        const claim3 = yield* claimSvc.getActiveClaim(task3Id)

        return { released, claim1, claim2, claim3 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.released).toBe(2)
    expect(result.claim1).toBeNull() // Released
    expect(result.claim2).toBeNull() // Released
    expect(result.claim3).not.toBeNull() // Worker 2's claim remains
  })

  it("multiple workers can claim different tasks concurrently", async () => {
    // Create additional task directly in DB (we need specific ID)
    const task2Id = fixtureId("conflict-task-2-concurrent")
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, datetime('now'), datetime('now'), '{}')`
    ).run(task2Id, "Conflict Task 2")

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const claimSvc = yield* ClaimService
        const workerRepo = yield* WorkerRepository

        // Register workers
        yield* workerRepo.insert({
          id: worker1Id,
          name: "Worker 1",
          hostname: "localhost",
          pid: 1001,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })
        yield* workerRepo.insert({
          id: worker2Id,
          name: "Worker 2",
          hostname: "localhost",
          pid: 1002,
          status: "idle",
          registeredAt: new Date(),
          lastHeartbeatAt: new Date(),
          currentTaskId: null,
          capabilities: [],
          metadata: {}
        })

        // Both workers claim different tasks (should both succeed)
        const claim1 = yield* claimSvc.claim(conflictTaskId, worker1Id)
        const claim2 = yield* claimSvc.claim(task2Id, worker2Id)

        return { claim1, claim2 }
      }).pipe(Effect.provide(layer))
    )

    expect(results.claim1.taskId).toBe(conflictTaskId)
    expect(results.claim1.workerId).toBe(worker1Id)
    expect(results.claim2.taskId).toBe(fixtureId("conflict-task-2-concurrent"))
    expect(results.claim2.workerId).toBe(worker2Id)
  })
})

// =============================================================================
// STRESS TESTS FOR CONCURRENCY
// =============================================================================

describe("Concurrency Stress: High Contention", () => {
  let db: TestDatabase
  const stressTaskId = fixtureId("stress-task")

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)

    // Create task for stress testing
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'ready', 500, datetime('now'), datetime('now'), '{}')`
    ).run(stressTaskId, "Stress Test Task")
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("handles 20 workers racing for same task", async () => {
    const result = await raceWorkers({
      count: 20,
      taskId: stressTaskId,
      db: db
    })

    // Still only one winner
    expect(result.successfulClaims).toBe(1)
    expect(result.losers.length).toBe(19)
    expect(result.errors.filter(e => e.error.includes("Duplicate")).length).toBe(0)
  })

  it("handles rapid sequential claims on same task", async () => {
    // First worker claims and releases, second worker claims
    // Repeat multiple times
    const iterations = 10
    let allSuccessful = true

    for (let i = 0; i < iterations; i++) {
      const workerId = chaosFixtureId(`rapid-worker-${i}`)

      // Register worker
      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), '[]', '{}')`,
        [workerId, `Worker ${i}`, "localhost", process.pid, "idle"]
      )

      // Claim
      try {
        const leaseExpiresAt = new Date(Date.now() + 30 * 60 * 1000)
        db.run(
          `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
           VALUES (?, ?, datetime('now'), ?, 0, 'active')`,
          [stressTaskId, workerId, leaseExpiresAt.toISOString()]
        )

        // Release
        db.run(
          `UPDATE task_claims SET status = 'released' WHERE task_id = ? AND worker_id = ?`,
          [stressTaskId, workerId]
        )
      } catch {
        allSuccessful = false
      }
    }

    expect(allSuccessful).toBe(true)

    // Verify clean state (no active claims)
    const activeClaims = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM task_claims WHERE task_id = ? AND status = 'active'",
      [stressTaskId]
    )
    expect(activeClaims[0].count).toBe(0)
  })
})
