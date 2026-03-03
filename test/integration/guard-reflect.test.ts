/**
 * Integration tests for Guard and Reflect bounded autonomy primitives.
 *
 * Tests guard enforcement, advisory mode, config fallbacks, reflect metrics,
 * signals, and the interaction between guards and reflect reporting.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  TaskService,
  GuardService,
  ReflectService,
  AttemptService,
  RunRepository,
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

describe("Guard + Reflect integration", () => {
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

  // ===== Guard: Advisory Mode =====

  it("advisory guard allows task creation and attaches warning metadata", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        // Set an advisory guard with max_pending=2
        yield* guard.set({ maxPending: 2, enforce: false })

        // Create 2 tasks — should be fine
        yield* taskSvc.create({ title: "Task 1", metadata: {} })
        yield* taskSvc.create({ title: "Task 2", metadata: {} })

        // 3rd task exceeds limit — should still succeed (advisory) but have warning metadata
        const task3 = yield* taskSvc.create({ title: "Task 3", metadata: {} })
        expect(task3.metadata).toHaveProperty("_guardWarnings")
        expect((task3.metadata as Record<string, unknown>)._guardWarnings).toBeInstanceOf(Array)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("advisory guard does not fail task creation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxPending: 1, enforce: false })
        yield* taskSvc.create({ title: "First", metadata: {} })

        // This should NOT throw even though we're over the limit
        const second = yield* taskSvc.create({ title: "Second", metadata: {} })
        expect(second.title).toBe("Second")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Guard: Enforce Mode =====

  it("enforce guard blocks task creation when max_pending exceeded", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxPending: 2, enforce: true })
        yield* taskSvc.create({ title: "Task 1", metadata: {} })
        yield* taskSvc.create({ title: "Task 2", metadata: {} })

        // 3rd task should fail
        return yield* taskSvc.create({ title: "Task 3", metadata: {} }).pipe(
          Effect.map(() => "created" as const),
          Effect.catchTag("GuardExceededError", (e) =>
            Effect.succeed(`blocked:${e.metric}` as const)
          )
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("blocked:max_pending")
  })

  it("enforce guard blocks when max_children exceeded", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxChildren: 2, enforce: true })
        const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })

        yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })
        yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} })

        // 3rd child should fail
        return yield* taskSvc.create({ title: "Child 3", parentId: parent.id, metadata: {} }).pipe(
          Effect.map(() => "created" as const),
          Effect.catchTag("GuardExceededError", (e) =>
            Effect.succeed(`blocked:${e.metric}` as const)
          )
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("blocked:max_children")
  })

  it("enforce guard blocks when max_depth exceeded", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxDepth: 2, enforce: true })
        const root = yield* taskSvc.create({ title: "Root", metadata: {} })
        const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
        const grandchild = yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

        // Great-grandchild (depth 3) should fail
        return yield* taskSvc.create({ title: "Great-grandchild", parentId: grandchild.id, metadata: {} }).pipe(
          Effect.map(() => "created" as const),
          Effect.catchTag("GuardExceededError", (e) =>
            Effect.succeed(`blocked:${e.metric}` as const)
          )
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("blocked:max_depth")
  })

  // ===== Guard: DB enforce takes precedence over config =====

  it("DB advisory guard is NOT escalated by config enforce mode", async () => {
    // This tests the fix: config mode=enforce should NOT override DB enforce=false
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        // Set DB guard as advisory explicitly
        yield* guard.set({ maxPending: 1, enforce: false })
        yield* taskSvc.create({ title: "First", metadata: {} })

        // Even if config says enforce, the DB row says advisory — should succeed
        const second = yield* taskSvc.create({ title: "Second", metadata: {} })
        expect(second.title).toBe("Second")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Guard: Show and Clear =====

  it("guard show returns all guards", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        yield* guard.set({ maxPending: 50 })
        yield* guard.set({ scope: "parent:tx-abc123", maxChildren: 5 })

        const all = yield* guard.show()
        expect(all.length).toBe(2)
        expect(all.map(g => g.scope).sort()).toEqual(["global", "parent:tx-abc123"])
        // Verify stored limit values, not just scope names
        const globalGuard = all.find(g => g.scope === "global")!
        expect(globalGuard.maxPending).toBe(50)
        const parentGuard = all.find(g => g.scope === "parent:tx-abc123")!
        expect(parentGuard.maxChildren).toBe(5)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard clear removes all guards and returns true", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        yield* guard.set({ maxPending: 50 })

        const cleared = yield* guard.clear()
        expect(cleared).toBe(true)

        const all = yield* guard.show()
        expect(all.length).toBe(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard clear returns false when no guards exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const cleared = yield* guard.clear()
        expect(cleared).toBe(false)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard set preserves existing enforce when not specified", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService

        // Set with enforce=true
        yield* guard.set({ maxPending: 50, enforce: true })

        // Update limits without specifying enforce
        const updated = yield* guard.set({ maxPending: 100 })
        expect(updated.enforce).toBe(true)
        expect(updated.maxPending).toBe(100)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard set with explicit null clears individual limits", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService

        // Set all limits
        yield* guard.set({ maxPending: 50, maxChildren: 10, maxDepth: 4, enforce: false })
        const initial = yield* guard.show()
        expect(initial[0].maxPending).toBe(50)
        expect(initial[0].maxChildren).toBe(10)
        expect(initial[0].maxDepth).toBe(4)

        // Clear just maxPending by passing explicit null, keep others
        yield* guard.set({ maxPending: null as unknown as undefined })
        const afterClear = yield* guard.show()
        expect(afterClear[0].maxPending).toBeNull()
        // Other limits should be preserved (undefined → COALESCE keeps existing)
        expect(afterClear[0].maxChildren).toBe(10)
        expect(afterClear[0].maxDepth).toBe(4)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard set with undefined preserves existing limits", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService

        yield* guard.set({ maxPending: 50, maxChildren: 10, enforce: false })
        // Update only maxDepth — other fields should be preserved
        yield* guard.set({ maxDepth: 3 })
        const result = yield* guard.show()
        expect(result[0].maxPending).toBe(50)
        expect(result[0].maxChildren).toBe(10)
        expect(result[0].maxDepth).toBe(3)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Guard: Parent-specific scope =====

  it("parent-specific guard limits children independently of global", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        // Global allows many children, but parent-specific limits to 1
        yield* guard.set({ maxChildren: 100, enforce: true })
        const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
        yield* guard.set({ scope: `parent:${parent.id}`, maxChildren: 1, enforce: true })

        yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })

        return yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} }).pipe(
          Effect.map(() => "created" as const),
          Effect.catchTag("GuardExceededError", () => Effect.succeed("blocked" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("blocked")
  })

  // ===== Reflect: Basic metrics =====

  it("reflect returns zero metrics when no data exists", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const result = yield* reflect.reflect()

        expect(result.sessions.total).toBe(0)
        expect(result.throughput.created).toBe(0)
        expect(result.throughput.completed).toBe(0)
        expect(result.throughput.completionRate).toBe(0)
        expect(result.stuckTasks).toEqual([])
        expect(result.signals).toEqual([])
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("reflect calculates throughput from tasks in time window", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        // Create a run so there's a session
        yield* runRepo.create({ agent: "test" })

        // Create some tasks
        yield* taskSvc.create({ title: "Task 1", metadata: {} })
        yield* taskSvc.create({ title: "Task 2", metadata: {} })
        const t3 = yield* taskSvc.create({ title: "Task 3", metadata: {} })
        // Mark one as done
        yield* taskSvc.update(t3.id, { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.sessions.total).toBe(1)
        expect(result.throughput.created).toBe(3)
        // Cohort-based: 1 out of 3 tasks created in window is now done
        expect(result.throughput.completed).toBe(1)
        // Service rounds to 2dp, so exact match is appropriate
        expect(result.throughput.completionRate).toBe(0.33)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("reflect completionRate never exceeds 1.0", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Create 2 tasks and complete both
        const t1 = yield* taskSvc.create({ title: "Task 1", metadata: {} })
        const t2 = yield* taskSvc.create({ title: "Task 2", metadata: {} })
        yield* taskSvc.update(t1.id, { status: "done" }, { actor: "human" })
        yield* taskSvc.update(t2.id, { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.throughput.completionRate).toBeLessThanOrEqual(1.0)
        expect(result.throughput.completionRate).toBe(1.0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: --sessions 0 clamp =====

  it("reflect clamps sessions=0 to 1", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const runRepo = yield* RunRepository

        // Insert a run so we can verify clamping includes it
        yield* runRepo.create({ agent: "test" })

        // sessions=0 should be clamped to 1 (Math.max(1, 0))
        const result = yield* reflect.reflect({ sessions: 0 })
        // If clamped to 1, the run is fetched; if 0 was used literally, total would be 0
        expect(result.sessions.total).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: --hours 0 =====

  it("reflect with hours=0 produces valid result (not bypassed)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })
        yield* taskSvc.create({ title: "Recent task", metadata: {} })

        // hours=0 means "look back 0 hours" — very narrow window
        const result = yield* reflect.reflect({ hours: 0 })
        // Should produce a valid result, not skip entirely
        expect(result.sessions).toBeDefined()
        expect(result.throughput).toBeDefined()
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: STUCK_TASKS signal =====

  it("reflect emits STUCK_TASKS signal for tasks with 3+ failed attempts", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const attemptSvc = yield* AttemptService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })
        const task = yield* taskSvc.create({ title: "Stubborn task", metadata: {} })

        // Record 3 failed attempts
        yield* attemptSvc.create(task.id, "Approach A", "failed", "Error A")
        yield* attemptSvc.create(task.id, "Approach B", "failed", "Error B")
        yield* attemptSvc.create(task.id, "Approach C", "failed", "Error C")

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.stuckTasks.length).toBe(1)
        expect(result.stuckTasks[0].id).toBe(task.id)
        expect(result.stuckTasks[0].failedAttempts).toBe(3)
        // lastError should be the NEWEST failure (Error C), not oldest
        expect(result.stuckTasks[0].lastError).toBe("Error C")

        // Should have a STUCK_TASKS signal
        const stuckSignal = result.signals.find(s => s.type === "STUCK_TASKS")
        expect(stuckSignal).toBeDefined()
        expect(stuckSignal!.severity).toBe("warning")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("reflect STUCK_TASKS severity is critical when 3+ tasks are stuck", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const attemptSvc = yield* AttemptService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Create 3 tasks, each with 3+ failed attempts
        for (let i = 0; i < 3; i++) {
          const task = yield* taskSvc.create({ title: `Stuck ${i}`, metadata: {} })
          for (let j = 0; j < 3; j++) {
            yield* attemptSvc.create(task.id, `Approach ${j}`, "failed", `Error ${j}`)
          }
        }

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.stuckTasks.length).toBe(3)

        const stuckSignal = result.signals.find(s => s.type === "STUCK_TASKS")
        expect(stuckSignal).toBeDefined()
        expect(stuckSignal!.severity).toBe("critical")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: HIGH_PROLIFERATION signal =====

  it("reflect emits HIGH_PROLIFERATION signal when completion rate < 40%", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Create 10 tasks, complete only 1 (10% rate < 20% → critical)
        const tasks: TaskId[] = []
        for (let i = 0; i < 10; i++) {
          const t = yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
          tasks.push(t.id)
        }
        yield* taskSvc.update(tasks[0], { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        const signal = result.signals.find(s => s.type === "HIGH_PROLIFERATION")
        expect(signal).toBeDefined()
        // 10% rate (< 20%) → critical
        expect(signal!.severity).toBe("critical")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: PENDING_HIGH signal =====

  it("reflect emits PENDING_HIGH signal when near guard limit", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const guard = yield* GuardService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Set guard with max_pending=5
        yield* guard.set({ maxPending: 5 })

        // Create 5 tasks (100% of limit → > 80% threshold)
        for (let i = 0; i < 5; i++) {
          yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
        }

        const result = yield* reflect.reflect({ sessions: 10 })
        const signal = result.signals.find(s => s.type === "PENDING_HIGH")
        expect(signal).toBeDefined()
        expect(signal!.severity).toBe("critical")
        expect(signal!.message).toContain("5/5")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: DEPTH_WARNING signal =====

  it("reflect emits DEPTH_WARNING when depth exceeds guard limit", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const guard = yield* GuardService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Set guard with max_depth=2 (advisory)
        yield* guard.set({ maxDepth: 2, enforce: false })

        // Build depth-3 chain
        const root = yield* taskSvc.create({ title: "Root", metadata: {} })
        const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
        yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

        const result = yield* reflect.reflect({ sessions: 10 })
        const signal = result.signals.find(s => s.type === "DEPTH_WARNING")
        expect(signal).toBeDefined()
        expect(signal!.message).toContain("max depth 2")
        expect(signal!.message).toContain("guard limit: 2")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: Proliferation metrics =====

  it("reflect calculates maxDepth correctly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Build depth-3 chain
        const root = yield* taskSvc.create({ title: "Root", metadata: {} })
        const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
        yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

        // Also a flat task (depth 0)
        yield* taskSvc.create({ title: "Flat", metadata: {} })

        const result = yield* reflect.reflect({ sessions: 10 })
        // Depth chain: root(0) -> child(1) -> grandchild(2)
        // maxDepth should be exactly 2 (grandchild has 2 ancestors)
        expect(result.proliferation.maxDepth).toBe(2)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Guard: clear(scope) single-scope removal =====

  it("guard clear with specific scope removes only that scope", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService

        yield* guard.set({ maxPending: 50, enforce: false })
        yield* guard.set({ scope: "parent:tx-abc123", maxChildren: 5, enforce: false })

        // Clear only the parent scope
        const cleared = yield* guard.clear("parent:tx-abc123")
        expect(cleared).toBe(true)

        // Global should still exist
        const remaining = yield* guard.show()
        expect(remaining.length).toBe(1)
        expect(remaining[0].scope).toBe("global")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard clear with nonexistent scope returns false", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        yield* guard.set({ maxPending: 50, enforce: false })

        const cleared = yield* guard.clear("parent:tx-doesnotexist")
        expect(cleared).toBe(false)

        // Global still exists
        const remaining = yield* guard.show()
        expect(remaining.length).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: Session status breakdown =====

  it("reflect reports session status breakdown (completed, failed, timeout)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const runRepo = yield* RunRepository

        // Create 3 runs with different statuses
        const run1 = yield* runRepo.create({ agent: "test" })
        yield* runRepo.complete(run1.id, 0, "ok")

        const run2 = yield* runRepo.create({ agent: "test" })
        yield* runRepo.fail(run2.id, "something broke", 1)

        const run3 = yield* runRepo.create({ agent: "test" })
        yield* runRepo.update(run3.id, {
          status: "timeout",
          endedAt: new Date(),
        })

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.sessions.total).toBe(3)
        expect(result.sessions.completed).toBe(1)
        expect(result.sessions.failed).toBe(1)
        expect(result.sessions.timeout).toBe(1)
        // avgDurationMinutes should be >= 0 (all created/ended almost instantly)
        expect(result.sessions.avgDurationMinutes).toBeGreaterThanOrEqual(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: HIGH_PROLIFERATION warning severity (20-40% band) =====

  it("reflect emits HIGH_PROLIFERATION with warning severity for 20-40% completion", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Create 10 tasks, complete 3 (30% rate — in 20-40% band → warning)
        const tasks: TaskId[] = []
        for (let i = 0; i < 10; i++) {
          const t = yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
          tasks.push(t.id)
        }
        yield* taskSvc.update(tasks[0], { status: "done" }, { actor: "human" })
        yield* taskSvc.update(tasks[1], { status: "done" }, { actor: "human" })
        yield* taskSvc.update(tasks[2], { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        const signal = result.signals.find(s => s.type === "HIGH_PROLIFERATION")
        expect(signal).toBeDefined()
        // 30% rate (>= 20% but < 40%) → warning (not critical)
        expect(signal!.severity).toBe("warning")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("reflect counts orphan chains (root done, descendants pending)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Root marked done, but child is still pending
        const root = yield* taskSvc.create({ title: "Root", metadata: {} })
        yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
        yield* taskSvc.update(root.id, { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.proliferation.orphanChains).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== GuardService.check() direct call tests =====

  it("guard check() returns passed=true when no guards are set", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const result = yield* guard.check(null)
        expect(result.passed).toBe(true)
        expect(result.warnings).toEqual([])
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard check() advisory returns warnings when limits exceeded", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxPending: 2, enforce: false })
        yield* taskSvc.create({ title: "Task 1", metadata: {} })
        yield* taskSvc.create({ title: "Task 2", metadata: {} })

        // Now at limit — check should return warnings
        const result = yield* guard.check(null)
        expect(result.passed).toBe(false)
        expect(result.warnings.length).toBeGreaterThanOrEqual(1)
        expect(result.warnings[0]).toContain("2/2")
        expect(result.warnings[0]).toContain("pending")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard check() enforce throws GuardExceededError when limits exceeded", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxPending: 2, enforce: true })
        yield* taskSvc.create({ title: "Task 1", metadata: {} })
        yield* taskSvc.create({ title: "Task 2", metadata: {} })

        return yield* guard.check(null).pipe(
          Effect.map(() => "passed" as const),
          Effect.catchTag("GuardExceededError", (e) =>
            Effect.succeed(`blocked:${e.metric}` as const)
          )
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("blocked:max_pending")
  })

  it("guard check() with parentId checks max_children", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxChildren: 2, enforce: false })
        const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
        yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })
        yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} })

        // Check with parent's ID — should report max_children warning
        const result = yield* guard.check(parent.id)
        expect(result.passed).toBe(false)
        expect(result.warnings.some(w => w.includes("children"))).toBe(true)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("guard check() with parentId checks max_depth", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        yield* guard.set({ maxDepth: 2, enforce: true })
        const root = yield* taskSvc.create({ title: "Root", metadata: {} })
        const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
        const grandchild = yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

        // Check creating under grandchild (depth 3) — should fail
        return yield* guard.check(grandchild.id).pipe(
          Effect.map(() => "passed" as const),
          Effect.catchTag("GuardExceededError", (e) =>
            Effect.succeed(`blocked:${e.metric}` as const)
          )
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("blocked:max_depth")
  })

  // ===== Parent-specific advisory guard =====

  it("parent-specific advisory guard attaches _guardWarnings metadata", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
        // Set parent-specific advisory guard
        yield* guard.set({ scope: `parent:${parent.id}`, maxChildren: 1, enforce: false })

        yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })

        // 2nd child exceeds parent guard — advisory mode, should get warnings in metadata
        const child2 = yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} })
        expect(child2.metadata).toHaveProperty("_guardWarnings")
        const warnings = (child2.metadata as Record<string, unknown>)._guardWarnings as string[]
        expect(warnings.length).toBeGreaterThanOrEqual(1)
        expect(warnings[0]).toContain("parent scope")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== PENDING_HIGH severity band (80-99% = warning, >=100% = critical) =====

  it("reflect PENDING_HIGH is warning when at 80-99% of limit", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const guard = yield* GuardService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Set guard with max_pending=10
        yield* guard.set({ maxPending: 10 })

        // Create 9 tasks (90% of limit — > 80% but < 100%)
        for (let i = 0; i < 9; i++) {
          yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
        }

        const result = yield* reflect.reflect({ sessions: 10 })
        const signal = result.signals.find(s => s.type === "PENDING_HIGH")
        expect(signal).toBeDefined()
        // 90% utilization → warning (not critical)
        expect(signal!.severity).toBe("warning")
        expect(signal!.message).toContain("9/10")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== orphanChains mid-hierarchy (not just root tasks) =====

  it("reflect counts mid-hierarchy orphan chains", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Build 3-level chain: root → middle → leaf
        const root = yield* taskSvc.create({ title: "Root", metadata: {} })
        const middle = yield* taskSvc.create({ title: "Middle", parentId: root.id, metadata: {} })
        yield* taskSvc.create({ title: "Leaf", parentId: middle.id, metadata: {} })

        // Mark middle as done, but leaf is still pending
        // Root is NOT done — so this tests mid-hierarchy orphan detection
        yield* taskSvc.update(middle.id, { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        // Middle is done but has a pending descendant (leaf) → should count as orphan chain
        expect(result.proliferation.orphanChains).toBeGreaterThanOrEqual(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== DEPTH_WARNING fires at capacity (>= not just >) =====

  it("reflect DEPTH_WARNING fires when depth equals guard limit (at capacity)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const guard = yield* GuardService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Set guard with max_depth=2 (advisory)
        yield* guard.set({ maxDepth: 2, enforce: false })

        // Build exactly depth-2 chain: root(0) → child(1) → grandchild(2)
        const root = yield* taskSvc.create({ title: "Root", metadata: {} })
        const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
        yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

        const result = yield* reflect.reflect({ sessions: 10 })
        // maxDepth=2, guard limit=2 → should fire with >= (at capacity)
        const signal = result.signals.find(s => s.type === "DEPTH_WARNING")
        expect(signal).toBeDefined()
        expect(signal!.severity).toBe("warning")
        expect(signal!.message).toContain("max depth 2")
        expect(signal!.message).toContain("guard limit: 2")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Reflect: throughput net and proliferation metrics =====

  it("reflect throughput.net is positive when more created than completed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Create 5 tasks, complete 2
        const tasks: TaskId[] = []
        for (let i = 0; i < 5; i++) {
          const t = yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
          tasks.push(t.id)
        }
        yield* taskSvc.update(tasks[0], { status: "done" }, { actor: "human" })
        yield* taskSvc.update(tasks[1], { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.throughput.created).toBe(5)
        expect(result.throughput.completed).toBe(2)
        expect(result.throughput.net).toBe(3) // 5 - 2
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("reflect proliferation avgCreatedPerSession divides by session count", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        // Create 2 runs
        yield* runRepo.create({ agent: "test" })
        yield* runRepo.create({ agent: "test" })

        // Create 4 tasks
        for (let i = 0; i < 4; i++) {
          yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
        }

        const result = yield* reflect.reflect({ sessions: 10 })
        expect(result.sessions.total).toBe(2)
        // avgCreatedPerSession = 4 tasks / 2 sessions = 2.0
        expect(result.proliferation.avgCreatedPerSession).toBe(2)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Multiple simultaneous advisory violations =====

  it("guard check() returns multiple warnings for simultaneous violations", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        // Set advisory guard with both max_pending and max_children
        yield* guard.set({ maxPending: 2, maxChildren: 1, enforce: false })

        const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
        yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })

        // Now at max_pending=2 AND max_children=1 — both violated by next check
        const result = yield* guard.check(parent.id)
        expect(result.passed).toBe(false)
        // Should have at least 2 warnings (pending + children)
        expect(result.warnings.length).toBeGreaterThanOrEqual(2)
        expect(result.warnings.some(w => w.includes("pending"))).toBe(true)
        expect(result.warnings.some(w => w.includes("children"))).toBe(true)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== HIGH_PROLIFERATION boundary: no signal when completion >= 40% =====

  it("reflect does NOT emit HIGH_PROLIFERATION when completion >= 40%", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Create 10 tasks, complete 4 (40% rate — at the boundary, should NOT fire)
        const tasks: TaskId[] = []
        for (let i = 0; i < 10; i++) {
          const t = yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
          tasks.push(t.id)
        }
        for (let i = 0; i < 4; i++) {
          yield* taskSvc.update(tasks[i], { status: "done" }, { actor: "human" })
        }

        const result = yield* reflect.reflect({ sessions: 10 })
        const signal = result.signals.find(s => s.type === "HIGH_PROLIFERATION")
        // strict < 0.4, so exactly 40% must NOT trigger it
        expect(signal).toBeUndefined()
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== orphanChains: multi-level done chain counts as ONE chain =====

  it("reflect orphanChains does not double-count multi-level done chains", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const reflect = yield* ReflectService
        const taskSvc = yield* TaskService
        const runRepo = yield* RunRepository

        yield* runRepo.create({ agent: "test" })

        // Build: A(done) → B(done) → C(pending)
        const a = yield* taskSvc.create({ title: "A", metadata: {} })
        const b = yield* taskSvc.create({ title: "B", parentId: a.id, metadata: {} })
        yield* taskSvc.create({ title: "C", parentId: b.id, metadata: {} })

        yield* taskSvc.update(a.id, { status: "done" }, { actor: "human" })
        yield* taskSvc.update(b.id, { status: "done" }, { actor: "human" })

        const result = yield* reflect.reflect({ sessions: 10 })
        // Should count as 1 chain (A is the topmost done ancestor), NOT 2
        expect(result.proliferation.orphanChains).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Parent-scoped maxDepth is not enforced (documented limitation) =====

  it("parent-scope guard with maxDepth is not enforced (only maxChildren is)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* GuardService
        const taskSvc = yield* TaskService

        const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
        // Set a per-parent depth guard — NOT enforced by current implementation
        yield* guard.set({ scope: `parent:${parent.id}`, maxDepth: 0, enforce: true })

        // Should still succeed because parent-scoped maxDepth is not checked
        const child = yield* taskSvc.create({ title: "Child", parentId: parent.id, metadata: {} })
        expect(child.title).toBe("Child")
      }).pipe(Effect.provide(shared.layer))
    )
  })
})
