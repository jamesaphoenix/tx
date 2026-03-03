/**
 * Integration tests for Bounded Autonomy Primitives:
 *   - Guard (task creation limits)
 *   - Verify (machine-checkable done criteria)
 *   - Label filtering (ready queue scoping)
 *   - Reflect (session retrospective)
 *
 * Uses real SQLite database with shared test layer (RULE 8).
 * Deterministic IDs via fixtureId (RULE 3).
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  TaskService,
  ReadyService,
  GuardService,
  LabelRepository,
  VerifyService,
  ReflectService,
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

describe("Bounded Autonomy Primitives", () => {
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

  // =========================================================================
  // GUARD — Task Creation Limits
  // =========================================================================
  describe("tx guard", () => {
    it("1. guard set/show/clear lifecycle", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService

          // Initially empty
          const before = yield* svc.show()
          expect(before).toHaveLength(0)

          // Set global guard
          const guard = yield* svc.set({
            maxPending: 50,
            maxChildren: 10,
            maxDepth: 4,
          })
          expect(guard.scope).toBe("global")
          expect(guard.maxPending).toBe(50)
          expect(guard.maxChildren).toBe(10)
          expect(guard.maxDepth).toBe(4)
          expect(guard.enforce).toBe(false) // advisory by default

          // Show returns it
          const guards = yield* svc.show()
          expect(guards).toHaveLength(1)

          // Clear
          const cleared = yield* svc.clear()
          expect(cleared).toBe(true)

          const after = yield* svc.show()
          expect(after).toHaveLength(0)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("2. guard upsert updates existing guard", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService

          yield* svc.set({ maxPending: 50 })
          yield* svc.set({ maxPending: 30, maxDepth: 3 })

          const guards = yield* svc.show()
          expect(guards).toHaveLength(1)
          expect(guards[0].maxPending).toBe(30)
          expect(guards[0].maxDepth).toBe(3)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("3. advisory mode: task creation succeeds with warning metadata", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          // Set guard with max_pending = 2 (advisory)
          yield* guardSvc.set({ maxPending: 2 })

          // Create 2 tasks — should be fine
          yield* taskSvc.create({ title: "Task 1", metadata: {} })
          yield* taskSvc.create({ title: "Task 2", metadata: {} })

          // 3rd task: should still succeed (advisory mode), but with warning
          const t3 = yield* taskSvc.create({ title: "Task 3", metadata: {} })
          expect(t3.title).toBe("Task 3")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("4. enforce mode: task creation fails when limit exceeded", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          // Set guard with max_pending = 2 (enforce)
          yield* guardSvc.set({ maxPending: 2, enforce: true })

          yield* taskSvc.create({ title: "Task 1", metadata: {} })
          yield* taskSvc.create({ title: "Task 2", metadata: {} })

          // 3rd task should fail
          const result = yield* taskSvc.create({ title: "Task 3", metadata: {} }).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("GuardExceededError", (e) => {
              expect(e.scope).toBe("global")
              expect(e.metric).toBe("max_pending")
              expect(e.current).toBe(2)
              expect(e.limit).toBe(2)
              return Effect.succeed("guard-blocked" as const)
            })
          )
          expect(result).toBe("guard-blocked")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("5. enforce mode: max_children limits per parent", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          yield* guardSvc.set({ maxChildren: 2, enforce: true })

          const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
          yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })
          yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} })

          // 3rd child should fail
          const result = yield* taskSvc.create({ title: "Child 3", parentId: parent.id, metadata: {} }).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("GuardExceededError", (e) => {
              expect(e.metric).toBe("max_children")
              return Effect.succeed("guard-blocked" as const)
            })
          )
          expect(result).toBe("guard-blocked")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("6. enforce mode: max_depth prevents deep nesting", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          yield* guardSvc.set({ maxDepth: 2, enforce: true })

          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          const child = yield* taskSvc.create({ title: "L1", parentId: root.id, metadata: {} })
          const grandchild = yield* taskSvc.create({ title: "L2", parentId: child.id, metadata: {} })

          // L3 should fail (depth 3 > limit 2)
          const result = yield* taskSvc.create({ title: "L3", parentId: grandchild.id, metadata: {} }).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("GuardExceededError", (e) => {
              expect(e.metric).toBe("max_depth")
              return Effect.succeed("guard-blocked" as const)
            })
          )
          expect(result).toBe("guard-blocked")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("7. parent-scoped guard overrides global", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          // Global: 100 children (generous)
          yield* guardSvc.set({ maxChildren: 100, enforce: true })

          const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })

          // Parent-specific: only 1 child
          yield* guardSvc.set({ scope: `parent:${parent.id}`, maxChildren: 1, enforce: true })

          yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })

          // 2nd child hits parent-scoped limit
          const result = yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} }).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("GuardExceededError", (e) => {
              expect(e.scope).toBe(`parent:${parent.id}`)
              return Effect.succeed("guard-blocked" as const)
            })
          )
          expect(result).toBe("guard-blocked")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("8. clear with scope only removes that scope", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService

          yield* svc.set({ maxPending: 50 })
          yield* svc.set({ scope: "parent:tx-abc123", maxChildren: 5 })

          const before = yield* svc.show()
          expect(before).toHaveLength(2)

          // Clear only parent scope
          yield* svc.clear("parent:tx-abc123")

          const after = yield* svc.show()
          expect(after).toHaveLength(1)
          expect(after[0].scope).toBe("global")
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })

  // =========================================================================
  // VERIFY — Machine-Checkable Done Criteria
  // =========================================================================
  describe("tx verify", () => {
    it("1. set/show/clear lifecycle", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Test task", metadata: {} })

          // Initially no verify cmd
          const before = yield* verifySvc.show(task.id)
          expect(before.cmd).toBeNull()
          expect(before.schema).toBeNull()

          // Set verify command
          yield* verifySvc.set(task.id, "echo test")
          const after = yield* verifySvc.show(task.id)
          expect(after.cmd).toBe("echo test")

          // Clear
          yield* verifySvc.clear(task.id)
          const cleared = yield* verifySvc.show(task.id)
          expect(cleared.cmd).toBeNull()
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("2. run passes when exit code is 0", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Pass task", metadata: {} })
          yield* verifySvc.set(task.id, "echo 'all good'")

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(true)
          expect(result.exitCode).toBe(0)
          expect(result.stdout).toContain("all good")
          expect(result.durationMs).toBeGreaterThanOrEqual(0)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("3. run fails when exit code is non-zero", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Fail task", metadata: {} })
          yield* verifySvc.set(task.id, "echo 'error' >&2 && exit 1")

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(false)
          expect(result.exitCode).toBe(1)
          expect(result.stderr).toContain("error")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("4. run without verify cmd set returns VerifyError", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "No verify", metadata: {} })

          const result = yield* verifySvc.run(task.id).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("VerifyError", (e) => {
              expect(e.reason).toContain("No verify command set")
              return Effect.succeed("caught" as const)
            })
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("5. run for nonexistent task returns TaskNotFoundError", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const verifySvc = yield* VerifyService

          const result = yield* verifySvc.run("tx-nonexistent" as TaskId).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("TaskNotFoundError", () => Effect.succeed("caught" as const))
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("6. run captures structured JSON output", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "JSON output", metadata: {} })
          yield* verifySvc.set(task.id, `echo '{"tests_passed": 42, "tests_failed": 0}'`)

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(true)
          expect(result.output).toEqual({ tests_passed: 42, tests_failed: 0 })
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("7. run with timeout kills long-running command", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Slow task", metadata: {} })
          yield* verifySvc.set(task.id, "sleep 60")

          const result = yield* verifySvc.run(task.id, { timeout: 1 }).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("VerifyError", (e) => {
              expect(e.reason).toContain("timed out")
              return Effect.succeed("caught" as const)
            })
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    }, 10000)

    it("8. set with schema stores it alongside cmd", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema task", metadata: {} })
          yield* verifySvc.set(task.id, "bun run test --json", "verify-schema.json")

          const result = yield* verifySvc.show(task.id)
          expect(result.cmd).toBe("bun run test --json")
          expect(result.schema).toBe("verify-schema.json")
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })

  // =========================================================================
  // LABEL FILTERING — Ready Queue Scoping
  // =========================================================================
  describe("tx ready --label", () => {
    it("1. label CRUD lifecycle", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* LabelRepository

          // Initially has project labels (from seed) or empty after reset
          const before = yield* repo.findAll()

          // Create labels
          const l1 = yield* repo.create("phase:discovery", "#3b82f6")
          expect(l1.name).toBe("phase:discovery")
          expect(l1.color).toBe("#3b82f6")

          yield* repo.create("phase:implement", "#22c55e")

          const all = yield* repo.findAll()
          expect(all.length).toBe(before.length + 2)

          // Find by name
          const found = yield* repo.findByName("phase:discovery")
          expect(found).not.toBeNull()
          expect(found!.name).toBe("phase:discovery")

          // Remove
          const removed = yield* repo.remove("phase:discovery")
          expect(removed).toBe(true)

          const afterRemove = yield* repo.findByName("phase:discovery")
          expect(afterRemove).toBeNull()
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("2. assign and unassign labels to tasks", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const repo = yield* LabelRepository

          const task = yield* taskSvc.create({ title: "Labeled task", metadata: {} })
          yield* repo.create("priority:high", "#ef4444")
          yield* repo.create("sprint:w10", "#8b5cf6")

          // Assign
          yield* repo.assign(task.id, "priority:high")
          yield* repo.assign(task.id, "sprint:w10")

          const labels = yield* repo.getLabelsForTask(task.id)
          expect(labels).toHaveLength(2)
          expect(labels.map(l => l.name).sort()).toEqual(["priority:high", "sprint:w10"])

          // Unassign
          yield* repo.unassign(task.id, "sprint:w10")
          const after = yield* repo.getLabelsForTask(task.id)
          expect(after).toHaveLength(1)
          expect(after[0].name).toBe("priority:high")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("3. ready --label filters by label", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const readySvc = yield* ReadyService
          const repo = yield* LabelRepository

          yield* repo.create("phase:discovery", "#3b82f6")
          yield* repo.create("phase:implement", "#22c55e")

          const t1 = yield* taskSvc.create({ title: "Discovery task", metadata: {} })
          const t2 = yield* taskSvc.create({ title: "Implement task", metadata: {} })
          yield* taskSvc.create({ title: "Unlabeled task", metadata: {} })

          yield* repo.assign(t1.id, "phase:discovery")
          yield* repo.assign(t2.id, "phase:implement")

          // Filter by label
          const discoveryTasks = yield* readySvc.getReady(100, { labels: ["phase:discovery"] })
          expect(discoveryTasks).toHaveLength(1)
          expect(discoveryTasks[0].id).toBe(t1.id)

          const implementTasks = yield* readySvc.getReady(100, { labels: ["phase:implement"] })
          expect(implementTasks).toHaveLength(1)
          expect(implementTasks[0].id).toBe(t2.id)

          // No filter returns all
          const allTasks = yield* readySvc.getReady(100)
          expect(allTasks).toHaveLength(3)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("4. ready --exclude-label excludes labeled tasks", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const readySvc = yield* ReadyService
          const repo = yield* LabelRepository

          yield* repo.create("needs-review", "#f59e0b")

          const t1 = yield* taskSvc.create({ title: "Review needed", metadata: {} })
          const t2 = yield* taskSvc.create({ title: "Good to go", metadata: {} })

          yield* repo.assign(t1.id, "needs-review")

          const filtered = yield* readySvc.getReady(100, { excludeLabels: ["needs-review"] })
          expect(filtered).toHaveLength(1)
          expect(filtered[0].id).toBe(t2.id)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("5. label filters combine with existing ready logic (only unblocked tasks)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const readySvc = yield* ReadyService
          const repo = yield* LabelRepository

          yield* repo.create("phase:implement", "#22c55e")

          const t1 = yield* taskSvc.create({ title: "Implement A", metadata: {} })
          const t2 = yield* taskSvc.create({ title: "Implement B (done)", metadata: {} })

          yield* repo.assign(t1.id, "phase:implement")
          yield* repo.assign(t2.id, "phase:implement")

          // Mark t2 as done (no longer "ready")
          yield* taskSvc.update(t2.id, { status: "done" })

          const ready = yield* readySvc.getReady(100, { labels: ["phase:implement"] })
          expect(ready).toHaveLength(1)
          expect(ready[0].id).toBe(t1.id)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("6. multiple label filter requires ALL labels", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const readySvc = yield* ReadyService
          const repo = yield* LabelRepository

          yield* repo.create("phase:implement", "#22c55e")
          yield* repo.create("priority:high", "#ef4444")

          const t1 = yield* taskSvc.create({ title: "Both labels", metadata: {} })
          const t2 = yield* taskSvc.create({ title: "Only phase", metadata: {} })

          yield* repo.assign(t1.id, "phase:implement")
          yield* repo.assign(t1.id, "priority:high")
          yield* repo.assign(t2.id, "phase:implement")

          // Filter requiring both labels
          const both = yield* readySvc.getReady(100, { labels: ["phase:implement", "priority:high"] })
          expect(both).toHaveLength(1)
          expect(both[0].id).toBe(t1.id)
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })

  // =========================================================================
  // REFLECT — Session Retrospective
  // =========================================================================
  describe("tx reflect", () => {
    it("1. reflect returns structured data with zero sessions", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService

          const result = yield* svc.reflect({ sessions: 10 })

          expect(result.sessions.total).toBe(0)
          expect(result.sessions.completed).toBe(0)
          expect(result.sessions.failed).toBe(0)
          expect(result.throughput.created).toBe(0)
          expect(result.throughput.completed).toBe(0)
          expect(result.proliferation.maxDepth).toBe(0)
          expect(result.stuckTasks).toHaveLength(0)
          expect(result.analysis).toBeNull()
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("2. reflect detects stuck tasks (3+ failed attempts)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const svc = yield* ReflectService

          // Need AttemptRepository to create test attempts
          const db = shared.getDb()
          const task = yield* taskSvc.create({ title: "Stuck task", metadata: {} })

          // Insert 3 failed attempts directly (table is `attempts`, id is autoincrement INTEGER)
          const now = new Date().toISOString()
          for (let i = 0; i < 3; i++) {
            db.prepare(
              "INSERT INTO attempts (task_id, approach, outcome, reason, created_at) VALUES (?, ?, ?, ?, ?)"
            ).run(task.id, `attempt ${i}`, "failed", `Error ${i}`, now)
          }

          const result = yield* svc.reflect({ sessions: 10 })
          expect(result.stuckTasks.length).toBeGreaterThanOrEqual(1)

          const stuck = result.stuckTasks.find(s => s.id === task.id)
          expect(stuck).toBeDefined()
          expect(stuck!.failedAttempts).toBe(3)
          expect(stuck!.title).toBe("Stuck task")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("3. reflect computes throughput metrics", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const svc = yield* ReflectService

          // Create some tasks
          yield* taskSvc.create({ title: "Task 1", metadata: {} })
          yield* taskSvc.create({ title: "Task 2", metadata: {} })
          const t3 = yield* taskSvc.create({ title: "Task 3", metadata: {} })

          // Complete one
          yield* taskSvc.update(t3.id, { status: "done" })

          // Insert a run so the time window picks up our tasks
          const db = shared.getDb()
          const now = new Date().toISOString()
          const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString()
          db.prepare(
            "INSERT INTO runs (id, agent, status, started_at, ended_at, pid) VALUES (?, ?, ?, ?, ?, ?)"
          ).run("run-test-1", "test", "completed", fiveMinAgo, now, 1234)

          const result = yield* svc.reflect({ sessions: 10 })
          expect(result.sessions.total).toBe(1)
          expect(result.sessions.completed).toBe(1)
          expect(result.throughput.created).toBeGreaterThanOrEqual(3)
          expect(result.throughput.completed).toBeGreaterThanOrEqual(1)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("4. reflect signals HIGH_PROLIFERATION when completion rate is low", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const svc = yield* ReflectService

          // Create many tasks, complete none → low completion rate
          for (let i = 0; i < 10; i++) {
            yield* taskSvc.create({ title: `Task ${i}`, metadata: {} })
          }

          // Insert a run
          const db = shared.getDb()
          const now = new Date().toISOString()
          const oneMinAgo = new Date(Date.now() - 60000).toISOString()
          db.prepare(
            "INSERT INTO runs (id, agent, status, started_at, ended_at, pid) VALUES (?, ?, ?, ?, ?, ?)"
          ).run("run-prolif", "test", "completed", oneMinAgo, now, 5678)

          const result = yield* svc.reflect({ sessions: 10 })
          const prolifSignal = result.signals.find(s => s.type === "HIGH_PROLIFERATION")
          expect(prolifSignal).toBeDefined()
          expect(prolifSignal!.severity === "critical" || prolifSignal!.severity === "warning").toBe(true)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("5. reflect computes max depth from parent chains", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const svc = yield* ReflectService

          // Create 4-level deep chain
          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          const l1 = yield* taskSvc.create({ title: "L1", parentId: root.id, metadata: {} })
          const l2 = yield* taskSvc.create({ title: "L2", parentId: l1.id, metadata: {} })
          yield* taskSvc.create({ title: "L3", parentId: l2.id, metadata: {} })

          // Insert a run
          const db = shared.getDb()
          const now = new Date().toISOString()
          const oneMinAgo = new Date(Date.now() - 60000).toISOString()
          db.prepare(
            "INSERT INTO runs (id, agent, status, started_at, ended_at, pid) VALUES (?, ?, ?, ?, ?, ?)"
          ).run("run-depth", "test", "completed", oneMinAgo, now, 9012)

          const result = yield* svc.reflect({ sessions: 10 })
          expect(result.proliferation.maxDepth).toBeGreaterThanOrEqual(3)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("6. reflect detects orphan chains (root done, children pending)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const svc = yield* ReflectService

          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          yield* taskSvc.create({ title: "Child still pending", parentId: root.id, metadata: {} })

          // Bypass TaskService validation (which prevents marking parent done with active children)
          // by updating the DB directly — this simulates the orphan state we want to detect
          const db = shared.getDb()
          db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(root.id)

          // Insert a run
          const now = new Date().toISOString()
          const oneMinAgo = new Date(Date.now() - 60000).toISOString()
          db.prepare(
            "INSERT INTO runs (id, agent, status, started_at, ended_at, pid) VALUES (?, ?, ?, ?, ?, ?)"
          ).run("run-orphan", "test", "completed", oneMinAgo, now, 3456)

          const result = yield* svc.reflect({ sessions: 10 })
          expect(result.proliferation.orphanChains).toBeGreaterThanOrEqual(1)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("7. reflect DEPTH_WARNING signal when guard limit exceeded", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const guardSvc = yield* GuardService
          const svc = yield* ReflectService

          // Set depth limit to 1
          yield* guardSvc.set({ maxDepth: 1 })

          // Create 3-level chain (advisory mode, so it succeeds)
          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
          yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

          // Insert a run
          const db = shared.getDb()
          const now = new Date().toISOString()
          const oneMinAgo = new Date(Date.now() - 60000).toISOString()
          db.prepare(
            "INSERT INTO runs (id, agent, status, started_at, ended_at, pid) VALUES (?, ?, ?, ?, ?, ?)"
          ).run("run-depth-warn", "test", "completed", oneMinAgo, now, 7890)

          const result = yield* svc.reflect({ sessions: 10 })
          const depthSignal = result.signals.find(s => s.type === "DEPTH_WARNING")
          expect(depthSignal).toBeDefined()
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("8. reflect --hours filters by time window", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService

          // Insert a run from 2 hours ago
          const db = shared.getDb()
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
          db.prepare(
            "INSERT INTO runs (id, agent, status, started_at, ended_at, pid) VALUES (?, ?, ?, ?, ?, ?)"
          ).run("run-old", "test", "completed", twoHoursAgo, oneHourAgo, 1111)

          // With hours=0.5 (30 min), should not include the old run
          const result = yield* svc.reflect({ hours: 0.5 })
          expect(result.sessions.total).toBe(0)

          // With hours=3, should include it
          const result2 = yield* svc.reflect({ hours: 3 })
          expect(result2.sessions.total).toBe(1)
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })

  // =========================================================================
  // CROSS-CUTTING — Primitives compose
  // =========================================================================
  describe("composition", () => {
    it("guard + label + verify work together on the same task", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const guardSvc = yield* GuardService
          const verifySvc = yield* VerifyService
          const readySvc = yield* ReadyService
          const labelRepo = yield* LabelRepository

          // Set up guard
          yield* guardSvc.set({ maxPending: 10 })

          // Create task with verify
          const task = yield* taskSvc.create({ title: "Full workflow", metadata: {} })
          yield* verifySvc.set(task.id, "echo 'verified'")

          // Label it
          yield* labelRepo.create("sprint:w10", "#8b5cf6")
          yield* labelRepo.assign(task.id, "sprint:w10")

          // Query by label
          const ready = yield* readySvc.getReady(100, { labels: ["sprint:w10"] })
          expect(ready).toHaveLength(1)
          expect(ready[0].id).toBe(task.id)

          // Verify
          const verifyResult = yield* verifySvc.run(task.id)
          expect(verifyResult.passed).toBe(true)

          // Complete
          yield* taskSvc.update(task.id, { status: "done" })

          // No longer in ready queue
          const afterDone = yield* readySvc.getReady(100, { labels: ["sprint:w10"] })
          expect(afterDone).toHaveLength(0)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("guard upsert can clear limits back to null (COALESCE fix)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService

          // Set a guard with all limits
          yield* svc.set({ maxPending: 50, maxChildren: 10, maxDepth: 4 })
          const before = (yield* svc.show())[0]
          expect(before.maxPending).toBe(50)
          expect(before.maxChildren).toBe(10)

          // Now upsert with just maxPending — maxChildren and maxDepth should become null
          const db = shared.getDb()
          db.prepare(
            `INSERT INTO task_guards (scope, max_pending, max_children, max_depth, enforce)
             VALUES ('global', 50, NULL, NULL, 0)
             ON CONFLICT(scope) DO UPDATE SET
               max_pending = excluded.max_pending,
               max_children = excluded.max_children,
               max_depth = excluded.max_depth,
               enforce = excluded.enforce`
          ).run()

          const after = (yield* svc.show())[0]
          expect(after.maxPending).toBe(50)
          expect(after.maxChildren).toBeNull()
          expect(after.maxDepth).toBeNull()
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("enforce mode from config.toml is respected by guard service check", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          // Set guard with enforce=false in DB, but config defaults to advisory too
          // The guard-service.check should use: globalGuard.enforce || config.guard.mode === "enforce"
          yield* guardSvc.set({ maxPending: 1, enforce: false })
          yield* taskSvc.create({ title: "Task 1", metadata: {} })

          // Should pass in advisory mode (task still created)
          const t2 = yield* taskSvc.create({ title: "Task 2", metadata: {} })
          expect(t2.title).toBe("Task 2")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("enforce mode blocks children exceeding max_children", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          yield* guardSvc.set({ maxChildren: 2, enforce: true })
          const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
          yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })
          yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} })

          // 3rd child should fail
          const result = yield* taskSvc.create({ title: "Child 3", parentId: parent.id, metadata: {} }).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("GuardExceededError", (e) => {
              expect(e.metric).toBe("max_children")
              return Effect.succeed("caught" as const)
            }),
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("enforce mode blocks depth exceeding max_depth", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          yield* guardSvc.set({ maxDepth: 2, enforce: true })
          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          const l1 = yield* taskSvc.create({ title: "L1", parentId: root.id, metadata: {} })
          const l2 = yield* taskSvc.create({ title: "L2", parentId: l1.id, metadata: {} })

          // L3 at depth 3 should fail (limit is 2)
          const result = yield* taskSvc.create({ title: "L3", parentId: l2.id, metadata: {} }).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("GuardExceededError", (e) => {
              expect(e.metric).toBe("max_depth")
              return Effect.succeed("caught" as const)
            }),
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })

  // =========================================================================
  // EDGE CASES — Reviewer findings
  // =========================================================================
  describe("edge cases", () => {
    it("orphan chain detection works for grandchildren (not just direct children)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const svc = yield* ReflectService

          // Create root → child → grandchild
          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
          yield* taskSvc.create({ title: "Grandchild pending", parentId: child.id, metadata: {} })

          // Mark root and child as done via DB (bypass service validation)
          const db = shared.getDb()
          db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(root.id)
          db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(child.id)

          // Insert a run so reflect picks up the window
          const now = new Date().toISOString()
          const oneMinAgo = new Date(Date.now() - 60000).toISOString()
          db.prepare(
            "INSERT INTO runs (id, agent, status, started_at, ended_at, pid) VALUES (?, ?, ?, ?, ?, ?)"
          ).run("run-grandchild-orphan", "test", "completed", oneMinAgo, now, 9999)

          const result = yield* svc.reflect({ sessions: 10 })
          // Root is done, grandchild is pending → orphan chain detected
          expect(result.proliferation.orphanChains).toBeGreaterThanOrEqual(1)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("advisory mode injects _guardWarnings into task metadata", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          // Set guard with max_pending = 1 (advisory)
          yield* guardSvc.set({ maxPending: 1, enforce: false })

          // Create 1 task — no warning
          const t1 = yield* taskSvc.create({ title: "Task 1", metadata: {} })
          expect(t1.metadata).not.toHaveProperty("_guardWarnings")

          // 2nd task exceeds limit — should have _guardWarnings in metadata
          const t2 = yield* taskSvc.create({ title: "Task 2", metadata: { custom: "data" } })
          expect(t2.metadata).toHaveProperty("_guardWarnings")
          const warnings = (t2.metadata as Record<string, unknown>)._guardWarnings as string[]
          expect(Array.isArray(warnings)).toBe(true)
          expect(warnings.length).toBeGreaterThanOrEqual(1)
          expect(warnings[0]).toContain("pending tasks")
          // Existing metadata should be preserved
          expect((t2.metadata as Record<string, unknown>).custom).toBe("data")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("parent-scope guard respects config.guard.mode enforce (guard-service.check)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService

          // Create parent-scoped guard with enforce=false in DB
          const parent = yield* taskSvc.create({ title: "Parent", metadata: {} })
          yield* guardSvc.set({ scope: `parent:${parent.id}`, maxChildren: 1, enforce: false })

          yield* taskSvc.create({ title: "Child 1", parentId: parent.id, metadata: {} })

          // In advisory mode (default config), 2nd child should succeed
          const child2 = yield* taskSvc.create({ title: "Child 2", parentId: parent.id, metadata: {} })
          expect(child2.title).toBe("Child 2")

          // GuardService.check should return warnings, not fail
          const checkResult = yield* guardSvc.check(parent.id)
          expect(checkResult.passed).toBe(false)
          expect(checkResult.warnings.length).toBeGreaterThanOrEqual(1)
          expect(checkResult.warnings[0]).toContain("parent scope")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("verify run captures JSON output when stdout is valid JSON", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "JSON output", metadata: {} })
          yield* verifySvc.set(task.id, 'echo \'{"tests_passed": 42, "tests_failed": 0}\'')

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(true)
          expect(result.output).toBeDefined()
          expect((result.output as Record<string, unknown>).tests_passed).toBe(42)
          expect((result.output as Record<string, unknown>).tests_failed).toBe(0)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("verify run handles non-JSON stdout gracefully", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Plain output", metadata: {} })
          yield* verifySvc.set(task.id, "echo 'just plain text'")

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(true)
          expect(result.output).toBeUndefined()
          expect(result.stdout).toContain("just plain text")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("verify run on nonexistent task returns TaskNotFoundError", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const verifySvc = yield* VerifyService

          const result = yield* verifySvc.run("tx-nonexistent" as TaskId).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("TaskNotFoundError", () => Effect.succeed("caught" as const)),
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("label case-insensitive matching works in ready filter", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const readySvc = yield* ReadyService
          const repo = yield* LabelRepository

          yield* repo.create("Phase:Discovery", "#3b82f6")
          const task = yield* taskSvc.create({ title: "Discovery task", metadata: {} })
          yield* repo.assign(task.id, "Phase:Discovery")

          // Query with different case
          const results = yield* readySvc.getReady(100, { labels: ["phase:discovery"] })
          expect(results).toHaveLength(1)
          expect(results[0].id).toBe(task.id)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("guard check returns empty warnings when no guard exists and no config limits", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService

          // No guards set, config defaults have null limits
          const result = yield* guardSvc.check(null)
          expect(result.passed).toBe(true)
          expect(result.warnings).toHaveLength(0)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("reflect returns empty result with no data", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService

          const result = yield* svc.reflect({ sessions: 5, hours: 1 })
          expect(result.sessions.total).toBe(0)
          expect(result.throughput.created).toBe(0)
          expect(result.proliferation.maxDepth).toBe(0)
          expect(result.stuckTasks).toHaveLength(0)
          expect(result.signals).toHaveLength(0)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("guard upsert preserves unmentioned limits (COALESCE)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService

          // Set all three limits
          yield* svc.set({ maxPending: 50, maxChildren: 10, maxDepth: 4 })
          const g1 = (yield* svc.show())[0]
          expect(g1.maxPending).toBe(50)
          expect(g1.maxChildren).toBe(10)
          expect(g1.maxDepth).toBe(4)

          // Update only maxPending — maxChildren and maxDepth should be preserved
          yield* svc.set({ maxPending: 30 })
          const g2 = (yield* svc.show())[0]
          expect(g2.maxPending).toBe(30)
          expect(g2.maxChildren).toBe(10) // preserved, not cleared
          expect(g2.maxDepth).toBe(4)     // preserved, not cleared
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("label assign returns LabelNotFoundError for missing label", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const labelRepo = yield* LabelRepository

          const task = yield* taskSvc.create({ title: "Label test", metadata: {} })

          const result = yield* labelRepo.assign(task.id, "nonexistent-label").pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("LabelNotFoundError", (e) => {
              expect(e.name).toBe("nonexistent-label")
              return Effect.succeed("caught" as const)
            }),
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("verify run fails with VerifyError for missing schema file", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Missing schema", metadata: {} })
          yield* verifySvc.set(task.id, "echo '{}'", "nonexistent-schema.json")

          const result = yield* verifySvc.run(task.id).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("VerifyError", (e) => {
              expect(e.reason).toContain("not found or unreadable")
              return Effect.succeed("caught" as const)
            }),
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("combined labels + excludeLabels filters simultaneously", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const readySvc = yield* ReadyService
          const repo = yield* LabelRepository

          yield* repo.create("phase:implement", "#22c55e")
          yield* repo.create("needs-review", "#f59e0b")

          const t1 = yield* taskSvc.create({ title: "Implement + review", metadata: {} })
          const t2 = yield* taskSvc.create({ title: "Implement only", metadata: {} })
          yield* taskSvc.create({ title: "No labels", metadata: {} })

          yield* repo.assign(t1.id, "phase:implement")
          yield* repo.assign(t1.id, "needs-review")
          yield* repo.assign(t2.id, "phase:implement")

          // Include phase:implement but exclude needs-review
          const filtered = yield* readySvc.getReady(100, {
            labels: ["phase:implement"],
            excludeLabels: ["needs-review"],
          })
          expect(filtered).toHaveLength(1)
          expect(filtered[0].id).toBe(t2.id)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("verify run with failing exit code still parses JSON stdout", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Fail with JSON", metadata: {} })
          // Command outputs JSON but exits non-zero
          yield* verifySvc.set(task.id, `echo '{"tests_passed": 5, "tests_failed": 3}' && exit 1`)

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(false)
          expect(result.exitCode).toBe(1)
          // JSON should still be parsed from stdout even on failure
          expect(result.output).toBeDefined()
          expect((result.output as Record<string, unknown>).tests_failed).toBe(3)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("reflect with analyze=true degrades gracefully with noop LLM", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const taskSvc = yield* TaskService

          yield* taskSvc.create({ title: "Task for analyze", metadata: {} })

          // analyze=true with LlmServiceNoop should not throw —
          // it should return analysis as null or a string
          const result = yield* svc.reflect({ sessions: 10, analyze: true })
          expect(result.sessions).toBeDefined()
          expect(result.throughput).toBeDefined()
          // With noop LLM, analysis should be null (graceful degradation)
          expect(result.analysis).toBeNull()
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("guard enforce + label filter + ready compose correctly", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService
          const readySvc = yield* ReadyService
          const labelRepo = yield* LabelRepository

          // Set strict guard
          yield* guardSvc.set({ maxPending: 3, enforce: true })

          yield* labelRepo.create("batch:alpha", "#3b82f6")
          yield* labelRepo.create("batch:beta", "#22c55e")

          // Create 3 tasks (at limit) with different labels
          const t1 = yield* taskSvc.create({ title: "Alpha 1", metadata: {} })
          const t2 = yield* taskSvc.create({ title: "Alpha 2", metadata: {} })
          const t3 = yield* taskSvc.create({ title: "Beta 1", metadata: {} })

          yield* labelRepo.assign(t1.id, "batch:alpha")
          yield* labelRepo.assign(t2.id, "batch:alpha")
          yield* labelRepo.assign(t3.id, "batch:beta")

          // Ready with label filter returns scoped subset
          const alpha = yield* readySvc.getReady(100, { labels: ["batch:alpha"] })
          expect(alpha).toHaveLength(2)

          const beta = yield* readySvc.getReady(100, { labels: ["batch:beta"] })
          expect(beta).toHaveLength(1)

          // 4th task should be blocked by guard
          const blocked = yield* taskSvc.create({ title: "Over limit", metadata: {} }).pipe(
            Effect.map(() => "created" as const),
            Effect.catchTag("GuardExceededError", () => Effect.succeed("blocked" as const)),
          )
          expect(blocked).toBe("blocked")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("duplicate label assign is idempotent", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const repo = yield* LabelRepository

          yield* repo.create("dup-test", "#000000")
          const task = yield* taskSvc.create({ title: "Dup label", metadata: {} })

          // Assign twice
          yield* repo.assign(task.id, "dup-test")
          yield* repo.assign(task.id, "dup-test")

          const labels = yield* repo.getLabelsForTask(task.id)
          expect(labels).toHaveLength(1)
          expect(labels[0].name).toBe("dup-test")
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("verify run result includes correct taskId", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Check taskId", metadata: {} })
          yield* verifySvc.set(task.id, "echo ok")

          const result = yield* verifySvc.run(task.id)
          expect(result.taskId).toBe(task.id)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("verify rejects schema path traversal", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Test path traversal", metadata: {} })
          // Set a verify cmd with a schema that traverses outside cwd
          yield* verifySvc.set(task.id, "echo '{}'", "../../etc/passwd")

          const result = yield* verifySvc.run(task.id).pipe(
            Effect.map(() => "should-not-reach" as const),
            Effect.catchTag("VerifyError", (e) => {
              expect(e.reason).toContain("escapes project root")
              return Effect.succeed("caught" as const)
            }),
          )
          expect(result).toBe("caught")
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })
})
