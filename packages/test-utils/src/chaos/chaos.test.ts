/**
 * Chaos Engineering Utilities Integration Tests
 *
 * Tests all chaos utilities using real in-memory SQLite per Rule 3.
 *
 * @module @tx/test-utils/chaos/chaos.test
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { createTestDatabase, type TestDatabase } from "../database/index.js"
import { fixtureId } from "../fixtures/index.js"
import {
  crashAfter,
  CrashSimulationError,
  killHeartbeat,
  WorkerHeartbeatController,
  raceWorkers,
  corruptState,
  replayJSONL,
  doubleComplete,
  partialWrite,
  delayedClaim,
  stressLoad
} from "./chaos-utilities.js"

describe("Chaos Engineering Utilities Integration", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  // ===========================================================================
  // crashAfter tests
  // ===========================================================================

  describe("crashAfter", () => {
    it("returns completed=true when operation finishes before timeout", async () => {
      const result = await crashAfter({ ms: 100 }, async () => {
        return "success"
      })

      expect(result.completed).toBe(true)
      expect(result.value).toBe("success")
      expect(result.elapsedMs).toBeLessThan(100)
    })

    it("returns completed=false when timeout occurs first", async () => {
      const result = await crashAfter({ ms: 50 }, async () => {
        await sleep(200)
        return "should not get here"
      })

      expect(result.completed).toBe(false)
      expect(result.value).toBeUndefined()
      expect(result.elapsedMs).toBeGreaterThanOrEqual(50)
      expect(result.elapsedMs).toBeLessThan(200)
    })

    it("calls beforeCrash callback when crash occurs", async () => {
      let callbackCalled = false

      await crashAfter(
        {
          ms: 50,
          beforeCrash: () => {
            callbackCalled = true
          }
        },
        async () => {
          await sleep(200)
        }
      )

      expect(callbackCalled).toBe(true)
    })

    it("throws CrashSimulationError when throwOnCrash is true", async () => {
      await expect(
        crashAfter({ ms: 50, throwOnCrash: true }, async () => {
          await sleep(200)
        })
      ).rejects.toBeInstanceOf(CrashSimulationError)
    })

    it("captures operation errors", async () => {
      const result = await crashAfter({ ms: 1000 }, async () => {
        throw new Error("operation failed")
      })

      expect(result.completed).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe("operation failed")
    })
  })

  // ===========================================================================
  // killHeartbeat tests
  // ===========================================================================

  describe("killHeartbeat / WorkerHeartbeatController", () => {
    const workerId = fixtureId("heartbeat-worker")

    beforeEach(() => {
      // Create a worker for testing
      const now = new Date()
      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [workerId, "Test Worker", "localhost", process.pid, "idle", now.toISOString(), now.toISOString(), "[]", "{}"]
      )
    })

    it("creates a controller with killHeartbeat", () => {
      const controller = killHeartbeat({ workerId, db })
      expect(controller).toBeInstanceOf(WorkerHeartbeatController)
      expect(controller.isKilled()).toBe(false)
    })

    it("kill sets heartbeat to past time", () => {
      const controller = killHeartbeat({ workerId, db })
      controller.kill(60)

      expect(controller.isKilled()).toBe(true)

      const worker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [workerId]
      )[0]

      const heartbeatTime = new Date(worker.last_heartbeat_at)
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

      expect(heartbeatTime.getTime()).toBeLessThanOrEqual(hourAgo.getTime() + 60000)
    })

    it("restore restores original heartbeat", () => {
      const originalWorker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [workerId]
      )[0]

      const controller = killHeartbeat({ workerId, db })
      controller.kill()
      controller.restore()

      const restoredWorker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [workerId]
      )[0]

      expect(restoredWorker.last_heartbeat_at).toBe(originalWorker.last_heartbeat_at)
      expect(controller.isKilled()).toBe(false)
    })

    it("revive sets heartbeat to current time", () => {
      const controller = killHeartbeat({ workerId, db })
      controller.kill()

      const beforeRevive = Date.now()
      controller.revive()
      const afterRevive = Date.now()

      const worker = db.query<{ last_heartbeat_at: string }>(
        "SELECT last_heartbeat_at FROM workers WHERE id = ?",
        [workerId]
      )[0]

      const heartbeatTime = new Date(worker.last_heartbeat_at).getTime()
      expect(heartbeatTime).toBeGreaterThanOrEqual(beforeRevive - 1000)
      expect(heartbeatTime).toBeLessThanOrEqual(afterRevive + 1000)
    })
  })

  // ===========================================================================
  // raceWorkers tests
  // ===========================================================================

  describe("raceWorkers", () => {
    const taskId = fixtureId("race-task")

    beforeEach(() => {
      // Create a task for workers to claim
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
        [taskId, "Task to Race For"]
      )
    })

    it("only one worker wins the race", async () => {
      const result = await raceWorkers({
        count: 5,
        taskId,
        db
      })

      expect(result.successfulClaims).toBe(1)
      expect(result.winner).not.toBeNull()
      expect(result.workers.length).toBe(5)
      expect(result.losers.length).toBe(4)
    })

    it("registers all workers", async () => {
      const result = await raceWorkers({
        count: 3,
        taskId,
        db
      })

      const workers = db.query<{ id: string }>("SELECT id FROM workers")
      expect(workers.length).toBe(3)
      expect(workers.map(w => w.id)).toEqual(expect.arrayContaining(result.workers))
    })

    it("winner has active claim", async () => {
      const result = await raceWorkers({
        count: 3,
        taskId,
        db
      })

      const claim = db.query<{ worker_id: string; status: string }>(
        "SELECT worker_id, status FROM task_claims WHERE task_id = ? AND status = 'active'",
        [taskId]
      )[0]

      expect(claim).toBeDefined()
      expect(claim.worker_id).toBe(result.winner)
      expect(claim.status).toBe("active")
    })

    it("respects delay between workers", async () => {
      const startTime = Date.now()

      await raceWorkers({
        count: 3,
        taskId,
        db,
        delayBetweenMs: 20
      })

      const elapsedMs = Date.now() - startTime
      expect(elapsedMs).toBeGreaterThanOrEqual(40) // At least (n-1) * delay
    })
  })

  // ===========================================================================
  // corruptState tests
  // ===========================================================================

  describe("corruptState", () => {
    const taskId = fixtureId("corrupt-task")

    beforeEach(() => {
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
        [taskId, "Task to Corrupt"]
      )
    })

    it("injects invalid_status corruption", () => {
      const result = corruptState({
        table: "tasks",
        type: "invalid_status",
        db,
        rowId: taskId
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ status: string }>(
        "SELECT status FROM tasks WHERE id = ?",
        [taskId]
      )[0]

      expect(task.status).toBe("INVALID_STATUS")
    })

    it("injects invalid_json corruption", () => {
      const result = corruptState({
        table: "tasks",
        type: "invalid_json",
        db,
        rowId: taskId
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ metadata: string }>(
        "SELECT metadata FROM tasks WHERE id = ?",
        [taskId]
      )[0]

      expect(() => JSON.parse(task.metadata)).toThrow()
    })

    it("injects negative_score corruption", () => {
      const result = corruptState({
        table: "tasks",
        type: "negative_score",
        db,
        rowId: taskId
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ score: number }>(
        "SELECT score FROM tasks WHERE id = ?",
        [taskId]
      )[0]

      expect(task.score).toBe(-1000)
    })

    it("injects future_timestamp corruption", () => {
      const result = corruptState({
        table: "tasks",
        type: "future_timestamp",
        db,
        rowId: taskId
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ created_at: string }>(
        "SELECT created_at FROM tasks WHERE id = ?",
        [taskId]
      )[0]

      const createdAt = new Date(task.created_at)
      expect(createdAt.getTime()).toBeGreaterThan(Date.now())
    })

    it("injects self_reference corruption", () => {
      const result = corruptState({
        table: "tasks",
        type: "self_reference",
        db,
        rowId: taskId
      })

      expect(result.corrupted).toBe(true)

      const task = db.query<{ parent_id: string | null }>(
        "SELECT parent_id FROM tasks WHERE id = ?",
        [taskId]
      )[0]

      expect(task.parent_id).toBe(taskId)
    })

    it("creates new row when rowId not provided", () => {
      const result = corruptState({
        table: "tasks",
        type: "invalid_status",
        db
      })

      expect(result.corrupted).toBe(true)
      expect(result.rowId).toMatch(/^tx-/)

      const task = db.query<{ status: string }>(
        "SELECT status FROM tasks WHERE id = ?",
        [result.rowId]
      )[0]

      expect(task.status).toBe("INVALID_STATUS")
    })
  })

  // ===========================================================================
  // replayJSONL tests
  // ===========================================================================

  describe("replayJSONL", () => {
    it("replays task upsert operations", () => {
      const jsonl = `
        {"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"tx-replay1","data":{"title":"Task 1","status":"backlog","score":500,"description":"","parentId":null,"metadata":{}}}
        {"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"tx-replay2","data":{"title":"Task 2","status":"active","score":600,"description":"","parentId":null,"metadata":{}}}
      `

      const result = replayJSONL({ db, content: jsonl })

      expect(result.opsReplayed).toBe(2)
      expect(result.tasksCreated).toBe(2)

      const tasks = db.query<{ id: string; title: string }>("SELECT id, title FROM tasks ORDER BY id")
      expect(tasks.length).toBe(2)
    })

    it("updates existing tasks on replay", () => {
      // Create initial task
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES ('tx-existing', 'Original Title', '', 'backlog', 100, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', '{}')`,
        []
      )

      const jsonl = `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"tx-existing","data":{"title":"Updated Title","status":"active","score":200,"description":"","parentId":null,"metadata":{}}}`

      const result = replayJSONL({ db, content: jsonl })

      expect(result.tasksUpdated).toBe(1)

      const task = db.query<{ title: string; score: number }>(
        "SELECT title, score FROM tasks WHERE id = 'tx-existing'"
      )[0]

      expect(task.title).toBe("Updated Title")
      expect(task.score).toBe(200)
    })

    it("handles dependency operations", () => {
      // Create tasks first
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES ('tx-blocker', 'Blocker', '', 'active', 500, datetime('now'), datetime('now'), '{}')`,
        []
      )
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES ('tx-blocked', 'Blocked', '', 'backlog', 400, datetime('now'), datetime('now'), '{}')`,
        []
      )

      const jsonl = `{"v":1,"op":"dep_add","ts":"2024-01-01T00:00:00Z","blockerId":"tx-blocker","blockedId":"tx-blocked"}`

      const result = replayJSONL({ db, content: jsonl })

      expect(result.depsAdded).toBe(1)

      const dep = db.query<{ blocker_id: string; blocked_id: string }>(
        "SELECT blocker_id, blocked_id FROM task_dependencies WHERE blocker_id = 'tx-blocker'"
      )[0]

      expect(dep.blocked_id).toBe("tx-blocked")
    })

    it("clears data when clearFirst is true", () => {
      // Create existing task
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES ('tx-oldtask', 'Old Task', '', 'backlog', 100, datetime('now'), datetime('now'), '{}')`,
        []
      )

      const jsonl = `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"tx-newtask","data":{"title":"New Task","status":"backlog","score":500,"description":"","parentId":null,"metadata":{}}}`

      replayJSONL({ db, content: jsonl, clearFirst: true })

      const tasks = db.query<{ id: string }>("SELECT id FROM tasks")
      expect(tasks.length).toBe(1)
      expect(tasks[0].id).toBe("tx-newtask")
    })

    it("handles invalid JSON lines gracefully", () => {
      const jsonl = `
        {"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"tx-valid1","data":{"title":"Valid Task","status":"backlog","score":500,"description":"","parentId":null,"metadata":{}}}
        not valid json
        {"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"tx-valid2","data":{"title":"Valid Task 2","status":"backlog","score":600,"description":"","parentId":null,"metadata":{}}}
      `

      const result = replayJSONL({ db, content: jsonl })

      expect(result.errors.length).toBe(1)
      expect(result.tasksCreated).toBe(2)
    })
  })

  // ===========================================================================
  // doubleComplete tests
  // ===========================================================================

  describe("doubleComplete", () => {
    const taskId = fixtureId("double-complete-task")

    beforeEach(() => {
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'active', 500, datetime('now'), datetime('now'), '{}')`,
        [taskId, "Task to Complete Twice"]
      )
    })

    it("first completion succeeds", () => {
      const result = doubleComplete({ taskId, db })

      expect(result.firstCompleted).toBe(true)
      expect(result.originalStatus).toBe("active")
      expect(result.finalStatus).toBe("done")
    })

    it("tracks original status", () => {
      const result = doubleComplete({ taskId, db })

      expect(result.originalStatus).toBe("active")
    })

    it("returns task not found error for missing task", () => {
      const result = doubleComplete({ taskId: "tx-nonexistent", db })

      expect(result.firstCompleted).toBe(false)
      expect(result.secondError).toBe("Task not found")
    })

    it("handles already-done tasks", () => {
      // Complete the task first
      db.run("UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?", [taskId])

      const result = doubleComplete({ taskId, db })

      expect(result.firstCompleted).toBe(true) // Already done counts as completed
      expect(result.originalStatus).toBe("done")
      expect(result.finalStatus).toBe("done")
    })
  })

  // ===========================================================================
  // partialWrite tests
  // ===========================================================================

  describe("partialWrite", () => {
    it("writes rows up to failure point without transaction", () => {
      const result = partialWrite({
        table: "tasks",
        db,
        rowCount: 10,
        failAtRow: 5,
        useTransaction: false
      })

      expect(result.rowsWritten).toBe(4) // Rows 1-4 succeed
      expect(result.rowsFailed).toBe(6) // Rows 5-10 fail
      expect(result.rolledBack).toBe(false)
      expect(result.error).toContain("Simulated failure at row 5")

      const tasks = db.query<{ id: string }>("SELECT id FROM tasks WHERE title LIKE 'Partial Write%'")
      expect(tasks.length).toBe(4)
    })

    it("rolls back all rows with transaction", () => {
      const result = partialWrite({
        table: "tasks",
        db,
        rowCount: 10,
        failAtRow: 5,
        useTransaction: true
      })

      expect(result.rowsWritten).toBe(0)
      expect(result.rolledBack).toBe(true)
      expect(result.writtenIds.length).toBe(0)
      expect(result.error).toContain("Simulated failure at row 5")

      const tasks = db.query<{ id: string }>("SELECT id FROM tasks WHERE title LIKE 'Partial Write%'")
      expect(tasks.length).toBe(0)
    })

    it("succeeds when failAtRow > rowCount", () => {
      const result = partialWrite({
        table: "tasks",
        db,
        rowCount: 5,
        failAtRow: 10,
        useTransaction: false
      })

      expect(result.rowsWritten).toBe(5)
      expect(result.rowsFailed).toBe(0)
      expect(result.error).toBeUndefined()
    })
  })

  // ===========================================================================
  // delayedClaim tests
  // ===========================================================================

  describe("delayedClaim", () => {
    const taskId = fixtureId("delayed-claim-task")
    const slowWorker = fixtureId("slow-worker")

    beforeEach(() => {
      // Create task
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 500, datetime('now'), datetime('now'), '{}')`,
        [taskId, "Task to Claim"]
      )
      // Create worker
      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), '[]', '{}')`,
        [slowWorker, "Slow Worker", "localhost", process.pid, "idle"]
      )
    })

    it("successfully claims when no competition", async () => {
      const result = await delayedClaim({
        taskId,
        workerId: slowWorker,
        db,
        delayMs: 50
      })

      expect(result.claimed).toBe(true)
      expect(result.claimedBy).toBe(slowWorker)
      expect(result.raceDetected).toBe(false)
      expect(result.waitedMs).toBeGreaterThanOrEqual(50)
    })

    it("detects race when another worker claims during delay", async () => {
      const fastWorker = fixtureId("fast-worker")

      // Register fast worker first (required for foreign key constraint)
      db.run(
        `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), '[]', '{}')`,
        [fastWorker, "Fast Worker", "localhost", process.pid, "idle"]
      )

      // Start delayed claim
      const delayedPromise = delayedClaim({
        taskId,
        workerId: slowWorker,
        db,
        delayMs: 100,
        checkRace: true
      })

      // Wait a bit then claim immediately with fast worker
      await sleep(20)
      db.run(
        `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
         VALUES (?, ?, datetime('now'), datetime('now', '+30 minutes'), 0, 'active')`,
        [taskId, fastWorker]
      )

      const result = await delayedPromise

      expect(result.raceDetected).toBe(true)
      expect(result.claimed).toBe(false)
      expect(result.claimedBy).toBe(fastWorker)
    })

    it("returns correct wait time", async () => {
      const result = await delayedClaim({
        taskId,
        workerId: slowWorker,
        db,
        delayMs: 100
      })

      expect(result.waitedMs).toBeGreaterThanOrEqual(100)
      expect(result.waitedMs).toBeLessThan(200)
    })
  })

  // ===========================================================================
  // stressLoad tests
  // ===========================================================================

  describe("stressLoad", () => {
    it("creates specified number of tasks", () => {
      const result = stressLoad({
        taskCount: 100,
        db
      })

      expect(result.tasksCreated).toBe(100)
      expect(result.taskIds.length).toBe(100)

      const count = db.query<{ count: number }>("SELECT COUNT(*) as count FROM tasks")[0]
      expect(count.count).toBe(100)
    })

    it("creates tasks with mixed statuses when enabled", () => {
      const result = stressLoad({
        taskCount: 70,
        db,
        mixedStatuses: true
      })

      expect(result.tasksCreated).toBe(70)

      const statuses = db.query<{ status: string; count: number }>(
        "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
      )

      // Should have multiple different statuses
      expect(statuses.length).toBeGreaterThan(1)
    })

    it("creates dependencies when requested", () => {
      const result = stressLoad({
        taskCount: 50,
        db,
        withDependencies: true,
        dependencyRatio: 0.3
      })

      expect(result.tasksCreated).toBe(50)
      expect(result.depsCreated).toBeGreaterThan(0)

      const depCount = db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM task_dependencies"
      )[0]

      expect(depCount.count).toBe(result.depsCreated)
    })

    it("reports performance metrics", () => {
      const result = stressLoad({
        taskCount: 100,
        db
      })

      expect(result.elapsedMs).toBeGreaterThan(0)
      expect(result.tasksPerSecond).toBeGreaterThan(0)
    })

    it("handles batch size correctly", () => {
      const result = stressLoad({
        taskCount: 250,
        db,
        batchSize: 100
      })

      expect(result.tasksCreated).toBe(250)
    })
  })
})

// Helper function
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
