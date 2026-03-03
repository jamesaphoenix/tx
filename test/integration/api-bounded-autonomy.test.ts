/**
 * Integration tests for REST API bounded autonomy endpoints:
 *   - Guard (task creation limits)
 *   - Verify (machine-checkable done criteria)
 *   - Reflect (session retrospective)
 *
 * Tests the route handlers at the service level (same pattern as api-claim tests).
 * The REST handlers delegate to GuardService, VerifyService, ReflectService
 * and serialize results (Date -> ISO strings, readonly -> mutable arrays).
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  GuardService,
  VerifyService,
  ReflectService,
  TaskService,
  AttemptService,
  RunRepository,
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// Helpers — mirror serialization from route handlers
// =============================================================================

const serializeGuard = (g: {
  id: number
  scope: string
  maxPending: number | null
  maxChildren: number | null
  maxDepth: number | null
  enforce: boolean | number
  createdAt: string | Date
}) => ({
  id: g.id,
  scope: g.scope,
  maxPending: g.maxPending ?? null,
  maxChildren: g.maxChildren ?? null,
  maxDepth: g.maxDepth ?? null,
  enforce: Boolean(g.enforce),
  createdAt: typeof g.createdAt === "string" ? g.createdAt : (g.createdAt instanceof Date ? g.createdAt.toISOString() : String(g.createdAt)),
})

// =============================================================================
// Tests
// =============================================================================

describe("API Bounded Autonomy Endpoints Integration", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // =========================================================================
  // GUARD ENDPOINTS
  // =========================================================================
  describe("Guard endpoints", () => {
    // 1. POST /api/guards — setGuard
    it("setGuard returns serialized guard with correct fields", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          const guard = yield* svc.set({
            maxPending: 50,
            maxChildren: 10,
            maxDepth: 4,
            enforce: true,
          })
          return serializeGuard(guard)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.scope).toBe("global")
      expect(result.maxPending).toBe(50)
      expect(result.maxChildren).toBe(10)
      expect(result.maxDepth).toBe(4)
      expect(result.enforce).toBe(true)
      expect(typeof result.id).toBe("number")
      expect(typeof result.createdAt).toBe("string")
    })

    // 2. POST /api/guards with custom scope
    it("setGuard with parent scope returns scoped guard", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          const guard = yield* svc.set({
            scope: "parent:tx-abc123",
            maxChildren: 5,
          })
          return serializeGuard(guard)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.scope).toBe("parent:tx-abc123")
      expect(result.maxChildren).toBe(5)
      expect(result.maxPending).toBeNull()
      expect(result.enforce).toBe(false)
    })

    // 3. GET /api/guards — listGuards
    it("listGuards returns all guards serialized", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          yield* svc.set({ maxPending: 50 })
          yield* svc.set({ scope: "parent:tx-xyz", maxChildren: 3 })

          const guards = yield* svc.show()
          return { guards: guards.map(serializeGuard) }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.guards.length).toBe(2)
      const scopes = result.guards.map(g => g.scope).sort()
      expect(scopes).toEqual(["global", "parent:tx-xyz"])
    })

    // 4. GET /api/guards — listGuards empty
    it("listGuards returns empty array when no guards exist", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          const guards = yield* svc.show()
          return { guards: guards.map(serializeGuard) }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.guards).toEqual([])
    })

    // 5. DELETE /api/guards — clearGuards
    it("clearGuards removes all guards and returns cleared=true", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          yield* svc.set({ maxPending: 50 })
          const cleared = yield* svc.clear()
          return { cleared }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.cleared).toBe(true)
    })

    // 6. DELETE /api/guards?scope=... — clearGuards with scope
    it("clearGuards with specific scope removes only that scope", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          yield* svc.set({ maxPending: 50 })
          yield* svc.set({ scope: "parent:tx-abc", maxChildren: 5 })

          const cleared = yield* svc.clear("parent:tx-abc")
          const remaining = yield* svc.show()
          return { cleared, remaining: remaining.map(serializeGuard) }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.cleared).toBe(true)
      expect(result.remaining.length).toBe(1)
      expect(result.remaining[0].scope).toBe("global")
    })

    // 7. GET /api/guards/check — checkGuard
    it("checkGuard returns passed=true when no guards are set", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          const check = yield* svc.check(null)
          return { passed: check.passed, warnings: [...check.warnings] }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.passed).toBe(true)
      expect(result.warnings).toEqual([])
    })

    // 8. GET /api/guards/check — checkGuard with violations
    it("checkGuard returns warnings when limits exceeded (advisory)", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* GuardService
          const taskSvc = yield* TaskService

          yield* svc.set({ maxPending: 2, enforce: false })
          yield* taskSvc.create({ title: "Task 1", metadata: {} })
          yield* taskSvc.create({ title: "Task 2", metadata: {} })

          const check = yield* svc.check(null)
          return { passed: check.passed, warnings: [...check.warnings] }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.passed).toBe(false)
      expect(result.warnings.length).toBeGreaterThanOrEqual(1)
      expect(result.warnings[0]).toContain("pending")
    })
  })

  // =========================================================================
  // VERIFY ENDPOINTS
  // =========================================================================
  describe("Verify endpoints", () => {
    // 1. PUT /api/tasks/:id/verify — setVerify
    it("setVerify stores command and returns message", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Verifiable", metadata: {} })
          yield* verifySvc.set(task.id, "echo PASS")
          return { message: `Verify command set for task ${task.id}` }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.message).toContain("Verify command set")
    })

    // 2. GET /api/tasks/:id/verify — showVerify
    it("showVerify returns cmd and schema", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Show verify", metadata: {} })
          yield* verifySvc.set(task.id, "bun test", "schema.json")
          return yield* verifySvc.show(task.id)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.cmd).toBe("bun test")
      expect(result.schema).toBe("schema.json")
    })

    // 3. GET /api/tasks/:id/verify — showVerify when no cmd set
    it("showVerify returns null cmd when nothing set", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "No verify", metadata: {} })
          return yield* verifySvc.show(task.id)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.cmd).toBeNull()
      expect(result.schema).toBeNull()
    })

    // 4. POST /api/tasks/:id/verify/run — runVerify (passing)
    it("runVerify returns passed=true with exit code 0", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Run verify pass", metadata: {} })
          yield* verifySvc.set(task.id, "echo OK")
          const run = yield* verifySvc.run(task.id)
          return {
            taskId: run.taskId,
            exitCode: run.exitCode,
            passed: run.passed,
            stdout: run.stdout,
            stderr: run.stderr,
            durationMs: run.durationMs,
            output: run.output,
            schemaValid: run.schemaValid,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.passed).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe("OK")
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(typeof result.taskId).toBe("string")
    })

    // 5. POST /api/tasks/:id/verify/run — runVerify (failing)
    it("runVerify returns passed=false with non-zero exit code", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Run verify fail", metadata: {} })
          yield* verifySvc.set(task.id, "exit 1")
          const run = yield* verifySvc.run(task.id)
          return {
            taskId: run.taskId,
            exitCode: run.exitCode,
            passed: run.passed,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.passed).toBe(false)
      expect(result.exitCode).toBe(1)
    })

    // 6. POST /api/tasks/:id/verify/run — JSON output parsing
    it("runVerify parses JSON stdout as structured output", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "JSON output", metadata: {} })
          yield* verifySvc.set(task.id, `echo '{"tests": 42, "passed": true}'`)
          const run = yield* verifySvc.run(task.id)
          return {
            passed: run.passed,
            output: run.output,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.passed).toBe(true)
      expect(result.output).toBeDefined()
      expect(result.output!.tests).toBe(42)
    })

    // 7. DELETE /api/tasks/:id/verify — clearVerify
    it("clearVerify removes the verify command", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Clear verify", metadata: {} })
          yield* verifySvc.set(task.id, "echo test")
          yield* verifySvc.clear(task.id)
          return yield* verifySvc.show(task.id)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.cmd).toBeNull()
    })

    // 8. Error: runVerify on nonexistent task
    it("runVerify fails with TaskNotFoundError for nonexistent task", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const verifySvc = yield* VerifyService
          return yield* verifySvc.run("tx-nonexist" as TaskId).pipe(
            Effect.map(() => "ok" as const),
            Effect.catchTag("TaskNotFoundError", () => Effect.succeed("not_found" as const))
          )
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBe("not_found")
    })

    // 9. Error: runVerify when no command is set
    it("runVerify fails with VerifyError when no command set", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "No cmd", metadata: {} })
          return yield* verifySvc.run(task.id).pipe(
            Effect.map(() => "ok" as const),
            Effect.catchTag("VerifyError", () => Effect.succeed("no_cmd" as const))
          )
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toBe("no_cmd")
    })
  })

  // =========================================================================
  // REFLECT ENDPOINTS
  // =========================================================================
  describe("Reflect endpoints", () => {
    // 1. GET /api/reflect — empty state
    it("reflect returns zero metrics when no data exists", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const r = yield* svc.reflect()
          return {
            sessions: r.sessions,
            throughput: r.throughput,
            proliferation: r.proliferation,
            stuckTasks: [...r.stuckTasks],
            signals: [...r.signals],
            analysis: r.analysis,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.sessions.total).toBe(0)
      expect(result.throughput.created).toBe(0)
      expect(result.throughput.completed).toBe(0)
      expect(result.throughput.completionRate).toBe(0)
      expect(result.stuckTasks).toEqual([])
      expect(result.signals).toEqual([])
      expect(result.analysis).toBeNull()
    })

    // 2. GET /api/reflect?sessions=5 — with data
    it("reflect returns correct session and throughput metrics", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const taskSvc = yield* TaskService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })
          const t1 = yield* taskSvc.create({ title: "T1", metadata: {} })
          yield* taskSvc.create({ title: "T2", metadata: {} })
          yield* taskSvc.update(t1.id, { status: "done" }, { actor: "human" })

          const r = yield* svc.reflect({ sessions: 5 })
          return {
            sessions: r.sessions,
            throughput: r.throughput,
            proliferation: r.proliferation,
            stuckTasks: [...r.stuckTasks],
            signals: [...r.signals],
            analysis: r.analysis,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.sessions.total).toBe(1)
      expect(result.throughput.created).toBe(2)
      expect(result.throughput.completed).toBe(1)
      expect(result.throughput.net).toBe(1)
      expect(result.throughput.completionRate).toBe(0.5)
    })

    // 3. GET /api/reflect — stuck tasks with signals
    it("reflect returns stuck tasks and STUCK_TASKS signal", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const taskSvc = yield* TaskService
          const attemptSvc = yield* AttemptService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })
          const task = yield* taskSvc.create({ title: "Stuck task", metadata: {} })

          yield* attemptSvc.create(task.id, "A1", "failed", "Error 1")
          yield* attemptSvc.create(task.id, "A2", "failed", "Error 2")
          yield* attemptSvc.create(task.id, "A3", "failed", "Error 3")

          const r = yield* svc.reflect({ sessions: 10 })
          return {
            stuckTasks: [...r.stuckTasks],
            signals: [...r.signals],
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.stuckTasks.length).toBe(1)
      expect(result.stuckTasks[0].failedAttempts).toBe(3)
      expect(result.stuckTasks[0].lastError).toBe("Error 3")

      const signal = result.signals.find(s => s.type === "STUCK_TASKS")
      expect(signal).toBeDefined()
      expect(signal!.severity).toBe("warning")
    })

    // 4. GET /api/reflect — proliferation signal
    it("reflect returns HIGH_PROLIFERATION signal when rate < 40%", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const taskSvc = yield* TaskService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })

          // Create 10, complete 1 = 10% rate (< 20% → critical)
          const tasks: TaskId[] = []
          for (let i = 0; i < 10; i++) {
            const t = yield* taskSvc.create({ title: `T${i}`, metadata: {} })
            tasks.push(t.id)
          }
          yield* taskSvc.update(tasks[0], { status: "done" }, { actor: "human" })

          const r = yield* svc.reflect({ sessions: 10 })
          return { signals: [...r.signals] }
        }).pipe(Effect.provide(shared.layer))
      )

      const signal = result.signals.find(s => s.type === "HIGH_PROLIFERATION")
      expect(signal).toBeDefined()
      expect(signal!.severity).toBe("critical")
    })

    // 5. GET /api/reflect — PENDING_HIGH signal
    it("reflect returns PENDING_HIGH signal when near guard limit", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })
          yield* guardSvc.set({ maxPending: 5 })

          for (let i = 0; i < 5; i++) {
            yield* taskSvc.create({ title: `T${i}`, metadata: {} })
          }

          const r = yield* svc.reflect({ sessions: 10 })
          return { signals: [...r.signals] }
        }).pipe(Effect.provide(shared.layer))
      )

      const signal = result.signals.find(s => s.type === "PENDING_HIGH")
      expect(signal).toBeDefined()
      expect(signal!.severity).toBe("critical")
      expect(signal!.message).toContain("5/5")
    })

    // 6. GET /api/reflect — depth and proliferation metrics
    it("reflect calculates proliferation maxDepth correctly", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const taskSvc = yield* TaskService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })

          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
          yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

          const r = yield* svc.reflect({ sessions: 10 })
          return { proliferation: r.proliferation }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.proliferation.maxDepth).toBe(2)
    })

    // 7. GET /api/reflect — analysis is null without --analyze
    it("reflect analysis is null when analyze=false", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const r = yield* svc.reflect({ analyze: false })
          return { analysis: r.analysis }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.analysis).toBeNull()
    })

    // 8. GET /api/reflect?hours=1 — hours filter
    it("reflect with hours filter produces valid result", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const taskSvc = yield* TaskService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })
          yield* taskSvc.create({ title: "Recent", metadata: {} })

          const r = yield* svc.reflect({ hours: 1 })
          return {
            sessions: r.sessions,
            throughput: r.throughput,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.sessions).toBeDefined()
      expect(result.throughput).toBeDefined()
      expect(result.throughput.created).toBeGreaterThanOrEqual(1)
    })
  })

  // =========================================================================
  // CROSS-CUTTING: Guard + Reflect interaction
  // =========================================================================
  describe("Guard + Reflect interaction", () => {
    it("DEPTH_WARNING signal fires when depth reaches guard limit", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })
          yield* guardSvc.set({ maxDepth: 2, enforce: false })

          const root = yield* taskSvc.create({ title: "Root", metadata: {} })
          const child = yield* taskSvc.create({ title: "Child", parentId: root.id, metadata: {} })
          yield* taskSvc.create({ title: "Grandchild", parentId: child.id, metadata: {} })

          const r = yield* svc.reflect({ sessions: 10 })
          return { signals: [...r.signals] }
        }).pipe(Effect.provide(shared.layer))
      )

      const signal = result.signals.find(s => s.type === "DEPTH_WARNING")
      expect(signal).toBeDefined()
      expect(signal!.message).toContain("max depth 2")
      expect(signal!.message).toContain("guard limit: 2")
    })

    it("guard enforce blocks creation, reflected as no proliferation", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReflectService
          const guardSvc = yield* GuardService
          const taskSvc = yield* TaskService
          const runRepo = yield* RunRepository

          yield* runRepo.create({ agent: "test" })
          yield* guardSvc.set({ maxPending: 2, enforce: true })

          yield* taskSvc.create({ title: "T1", metadata: {} })
          yield* taskSvc.create({ title: "T2", metadata: {} })

          // Third should be blocked
          yield* taskSvc.create({ title: "T3", metadata: {} }).pipe(
            Effect.catchTag("GuardExceededError", () => Effect.succeed(null))
          )

          const r = yield* svc.reflect({ sessions: 10 })
          return { throughput: r.throughput }
        }).pipe(Effect.provide(shared.layer))
      )

      // Only 2 tasks created (3rd was blocked)
      expect(result.throughput.created).toBe(2)
    })
  })

  // =========================================================================
  // CROSS-CUTTING: Verify + Task lifecycle
  // =========================================================================
  describe("Verify + Task lifecycle", () => {
    it("full lifecycle: create task, set verify, run verify, done", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Full lifecycle", metadata: {} })
          yield* verifySvc.set(task.id, "echo PASS")

          const verifyResult = yield* verifySvc.run(task.id)
          if (verifyResult.passed) {
            yield* taskSvc.update(task.id, { status: "done" }, { actor: "human" })
          }

          const final = yield* taskSvc.get(task.id)
          return {
            verified: verifyResult.passed,
            taskStatus: final.status,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.verified).toBe(true)
      expect(result.taskStatus).toBe("done")
    })

    it("verify gate: failing verify prevents done", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Gated task", metadata: {} })
          yield* verifySvc.set(task.id, "exit 1")

          const verifyResult = yield* verifySvc.run(task.id)
          // Orchestrator pattern: only mark done if verify passes
          if (!verifyResult.passed) {
            return { verified: false, taskStatus: task.status }
          }

          yield* taskSvc.update(task.id, { status: "done" }, { actor: "human" })
          return { verified: true, taskStatus: "done" }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.verified).toBe(false)
      expect(result.taskStatus).toBe("backlog")
    })
  })
})
