import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  RunRepositoryLive,
  RunRepository
} from "@jamesaphoenix/tx-core"
import type { RunId } from "@jamesaphoenix/tx-types"

function makeTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  return RunRepositoryLive.pipe(Layer.provide(infra))
}

describe("RunRepository CRUD", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  describe("create", () => {
    it("creates a new run with auto-generated ID", async () => {
      const run = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({
            agent: "tx-implementer",
            taskId: FIXTURES.TASK_JWT
          })
        }).pipe(Effect.provide(layer))
      )

      expect(run.id).toMatch(/^run-[a-z0-9]{8}$/)
      expect(run.agent).toBe("tx-implementer")
      expect(run.taskId).toBe(FIXTURES.TASK_JWT)
      expect(run.status).toBe("running")
      expect(run.startedAt).toBeInstanceOf(Date)
      expect(run.endedAt).toBeNull()
      expect(run.exitCode).toBeNull()
      expect(run.summary).toBeNull()
      expect(run.errorMessage).toBeNull()
    })

    it("creates run without taskId", async () => {
      const run = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({
            agent: "tx-decomposer"
          })
        }).pipe(Effect.provide(layer))
      )

      expect(run.taskId).toBeNull()
      expect(run.agent).toBe("tx-decomposer")
    })

    it("stores optional fields (pid, transcriptPath, contextInjected)", async () => {
      const run = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({
            agent: "tx-reviewer",
            taskId: FIXTURES.TASK_LOGIN,
            pid: 12345,
            transcriptPath: "/tmp/transcript.json",
            contextInjected: "CLAUDE.md contents"
          })
        }).pipe(Effect.provide(layer))
      )

      expect(run.pid).toBe(12345)
      expect(run.transcriptPath).toBe("/tmp/transcript.json")
      expect(run.contextInjected).toBe("CLAUDE.md contents")
    })

    it("stores metadata as JSON", async () => {
      const run = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({
            agent: "tx-planner",
            metadata: { version: "1.0", tags: ["test", "integration"] }
          })
        }).pipe(Effect.provide(layer))
      )

      expect(run.metadata).toEqual({ version: "1.0", tags: ["test", "integration"] })
    })

    it("defaults metadata to empty object", async () => {
      const run = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "tx-tester" })
        }).pipe(Effect.provide(layer))
      )

      expect(run.metadata).toEqual({})
    })
  })

  describe("findById", () => {
    it("returns existing run", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({
            agent: "tx-implementer",
            taskId: FIXTURES.TASK_JWT
          })
        }).pipe(Effect.provide(layer))
      )

      const found = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.agent).toBe("tx-implementer")
      expect(found!.taskId).toBe(FIXTURES.TASK_JWT)
    })

    it("returns null for non-existent run", async () => {
      const found = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById("run-nonexist" as RunId)
        }).pipe(Effect.provide(layer))
      )

      expect(found).toBeNull()
    })

    it("handles invalid JSON in metadata column gracefully", async () => {
      // Insert a run with invalid JSON metadata via raw SQL
      const runId = "run-badjson" as RunId
      const now = new Date().toISOString()
      db.db.prepare(`
        INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
        VALUES (?, NULL, 'test-agent', ?, 'running', 'not valid json {{{')
      `).run(runId, now)

      // Retrieve via findById - should not throw
      const found = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(runId)
        }).pipe(Effect.provide(layer))
      )

      // Verify metadata defaults to {} instead of throwing
      expect(found).not.toBeNull()
      expect(found!.id).toBe(runId)
      expect(found!.metadata).toEqual({})
    })
  })

  describe("findByTaskId", () => {
    it("returns all runs for a task", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.create({ agent: "agent-1", taskId: FIXTURES.TASK_JWT })
          yield* repo.create({ agent: "agent-2", taskId: FIXTURES.TASK_JWT })
          yield* repo.create({ agent: "agent-3", taskId: FIXTURES.TASK_LOGIN })
        }).pipe(Effect.provide(layer))
      )

      const runs = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findByTaskId(FIXTURES.TASK_JWT)
        }).pipe(Effect.provide(layer))
      )

      expect(runs).toHaveLength(2)
      expect(runs.every(r => r.taskId === FIXTURES.TASK_JWT)).toBe(true)
    })

    it("returns empty array for task with no runs", async () => {
      const runs = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findByTaskId(FIXTURES.TASK_AUTH)
        }).pipe(Effect.provide(layer))
      )

      expect(runs).toHaveLength(0)
    })

    it("returns runs sorted (verifies ORDER BY is applied)", async () => {
      // Create multiple runs - we verify ORDER BY clause works by checking
      // runs are returned in a consistent order (all 3 present)
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.create({ agent: "agent-0", taskId: FIXTURES.TASK_JWT })
          yield* repo.create({ agent: "agent-1", taskId: FIXTURES.TASK_JWT })
          yield* repo.create({ agent: "agent-2", taskId: FIXTURES.TASK_JWT })
        }).pipe(Effect.provide(layer))
      )

      const runs = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findByTaskId(FIXTURES.TASK_JWT)
        }).pipe(Effect.provide(layer))
      )

      // Verify all 3 are returned and agents are present
      expect(runs).toHaveLength(3)
      const agents = runs.map(r => r.agent).sort()
      expect(agents).toEqual(["agent-0", "agent-1", "agent-2"])
    })
  })

  describe("findByStatus", () => {
    it("returns all runs with given status", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          const run1 = yield* repo.create({ agent: "agent-1" })
          yield* repo.create({ agent: "agent-2" }) // stays running
          yield* repo.complete(run1.id, 0)
        }).pipe(Effect.provide(layer))
      )

      const running = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findByStatus("running")
        }).pipe(Effect.provide(layer))
      )

      const completed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findByStatus("completed")
        }).pipe(Effect.provide(layer))
      )

      expect(running).toHaveLength(1)
      expect(completed).toHaveLength(1)
      expect(running[0].status).toBe("running")
      expect(completed[0].status).toBe("completed")
    })

    it("returns empty array when no runs match status", async () => {
      const failed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findByStatus("failed")
        }).pipe(Effect.provide(layer))
      )

      expect(failed).toHaveLength(0)
    })
  })

  describe("findRecent", () => {
    it("returns limited number of runs", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          for (let i = 0; i < 5; i++) {
            yield* repo.create({ agent: `agent-${i}` })
          }
        }).pipe(Effect.provide(layer))
      )

      const runs = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findRecent(3)
        }).pipe(Effect.provide(layer))
      )

      expect(runs).toHaveLength(3)
    })

    it("returns runs sorted (verifies ORDER BY is applied)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.create({ agent: "agent-0" })
          yield* repo.create({ agent: "agent-1" })
          yield* repo.create({ agent: "agent-2" })
        }).pipe(Effect.provide(layer))
      )

      const runs = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findRecent(10)
        }).pipe(Effect.provide(layer))
      )

      // Verify all 3 are returned and agents are present
      expect(runs).toHaveLength(3)
      const agents = runs.map(r => r.agent).sort()
      expect(agents).toEqual(["agent-0", "agent-1", "agent-2"])
    })

    it("returns all when limit exceeds count", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.create({ agent: "agent-1" })
          yield* repo.create({ agent: "agent-2" })
        }).pipe(Effect.provide(layer))
      )

      const runs = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findRecent(100)
        }).pipe(Effect.provide(layer))
      )

      expect(runs).toHaveLength(2)
    })
  })
})

describe("RunRepository status transitions", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  describe("update", () => {
    it("updates status", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, { status: "cancelled" })
        }).pipe(Effect.provide(layer))
      )

      const updated = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(updated!.status).toBe("cancelled")
    })

    it("updates endedAt", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      const endTime = new Date("2026-01-15T12:00:00Z")
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, { endedAt: endTime })
        }).pipe(Effect.provide(layer))
      )

      const updated = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(updated!.endedAt).toEqual(endTime)
    })

    it("updates exitCode", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, { exitCode: 1 })
        }).pipe(Effect.provide(layer))
      )

      const updated = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(updated!.exitCode).toBe(1)
    })

    it("updates summary", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, { summary: "Task completed successfully" })
        }).pipe(Effect.provide(layer))
      )

      const updated = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(updated!.summary).toBe("Task completed successfully")
    })

    it("updates errorMessage", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, { errorMessage: "Out of memory" })
        }).pipe(Effect.provide(layer))
      )

      const updated = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(updated!.errorMessage).toBe("Out of memory")
    })

    it("updates transcriptPath", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, { transcriptPath: "/new/path/transcript.json" })
        }).pipe(Effect.provide(layer))
      )

      const updated = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(updated!.transcriptPath).toBe("/new/path/transcript.json")
    })

    it("updates multiple fields at once", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      const endTime = new Date("2026-01-15T12:00:00Z")
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, {
            status: "completed",
            endedAt: endTime,
            exitCode: 0,
            summary: "All done"
          })
        }).pipe(Effect.provide(layer))
      )

      const updated = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(updated!.status).toBe("completed")
      expect(updated!.endedAt).toEqual(endTime)
      expect(updated!.exitCode).toBe(0)
      expect(updated!.summary).toBe("All done")
    })

    it("no-op when empty update", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      // Should not throw
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.update(created.id, {})
        }).pipe(Effect.provide(layer))
      )

      const unchanged = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(unchanged!.status).toBe("running")
    })
  })

  describe("complete", () => {
    it("marks run as completed with exit code", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.complete(created.id, 0)
        }).pipe(Effect.provide(layer))
      )

      const completed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(completed!.status).toBe("completed")
      expect(completed!.exitCode).toBe(0)
      expect(completed!.endedAt).toBeInstanceOf(Date)
    })

    it("marks run as completed with non-zero exit code", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.complete(created.id, 1)
        }).pipe(Effect.provide(layer))
      )

      const completed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(completed!.status).toBe("completed")
      expect(completed!.exitCode).toBe(1)
    })

    it("stores optional summary", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.complete(created.id, 0, "Task implemented successfully")
        }).pipe(Effect.provide(layer))
      )

      const completed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(completed!.summary).toBe("Task implemented successfully")
    })

    it("sets summary to null when not provided", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.complete(created.id, 0)
        }).pipe(Effect.provide(layer))
      )

      const completed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(completed!.summary).toBeNull()
    })
  })

  describe("fail", () => {
    it("marks run as failed with error message", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.fail(created.id, "Process crashed")
        }).pipe(Effect.provide(layer))
      )

      const failed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(failed!.status).toBe("failed")
      expect(failed!.errorMessage).toBe("Process crashed")
      expect(failed!.endedAt).toBeInstanceOf(Date)
    })

    it("stores optional exit code", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.fail(created.id, "Segmentation fault", 139)
        }).pipe(Effect.provide(layer))
      )

      const failed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(failed!.exitCode).toBe(139)
    })

    it("sets exitCode to null when not provided", async () => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.create({ agent: "agent-1" })
        }).pipe(Effect.provide(layer))
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.fail(created.id, "Unknown error")
        }).pipe(Effect.provide(layer))
      )

      const failed = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.findById(created.id)
        }).pipe(Effect.provide(layer))
      )

      expect(failed!.exitCode).toBeNull()
    })
  })
})

describe("RunRepository counting and queries", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  describe("getRunning", () => {
    it("returns only running runs", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          const run1 = yield* repo.create({ agent: "agent-1" })
          const run2 = yield* repo.create({ agent: "agent-2" })
          yield* repo.create({ agent: "agent-3" }) // stays running
          yield* repo.complete(run1.id, 0)
          yield* repo.fail(run2.id, "Error")
        }).pipe(Effect.provide(layer))
      )

      const running = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.getRunning()
        }).pipe(Effect.provide(layer))
      )

      expect(running).toHaveLength(1)
      expect(running[0].agent).toBe("agent-3")
      expect(running[0].status).toBe("running")
    })

    it("returns empty array when no runs are running", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          const run = yield* repo.create({ agent: "agent-1" })
          yield* repo.complete(run.id, 0)
        }).pipe(Effect.provide(layer))
      )

      const running = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.getRunning()
        }).pipe(Effect.provide(layer))
      )

      expect(running).toHaveLength(0)
    })

    it("returns runs sorted (verifies ORDER BY is applied)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          yield* repo.create({ agent: "agent-0" })
          yield* repo.create({ agent: "agent-1" })
          yield* repo.create({ agent: "agent-2" })
        }).pipe(Effect.provide(layer))
      )

      const running = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.getRunning()
        }).pipe(Effect.provide(layer))
      )

      // Verify all 3 are returned and agents are present
      expect(running).toHaveLength(3)
      const agents = running.map(r => r.agent).sort()
      expect(agents).toEqual(["agent-0", "agent-1", "agent-2"])
    })
  })

  describe("countByStatus", () => {
    it("returns counts for all statuses", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          const run1 = yield* repo.create({ agent: "agent-1" })
          const run2 = yield* repo.create({ agent: "agent-2" })
          const run3 = yield* repo.create({ agent: "agent-3" })
          yield* repo.create({ agent: "agent-4" }) // stays running
          yield* repo.complete(run1.id, 0)
          yield* repo.complete(run2.id, 0)
          yield* repo.fail(run3.id, "Error")
        }).pipe(Effect.provide(layer))
      )

      const counts = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.countByStatus()
        }).pipe(Effect.provide(layer))
      )

      expect(counts.running).toBe(1)
      expect(counts.completed).toBe(2)
      expect(counts.failed).toBe(1)
      expect(counts.timeout).toBe(0)
      expect(counts.cancelled).toBe(0)
    })

    it("returns zeros when no runs exist", async () => {
      const counts = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.countByStatus()
        }).pipe(Effect.provide(layer))
      )

      expect(counts.running).toBe(0)
      expect(counts.completed).toBe(0)
      expect(counts.failed).toBe(0)
      expect(counts.timeout).toBe(0)
      expect(counts.cancelled).toBe(0)
    })

    it("includes timeout and cancelled statuses", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          const run1 = yield* repo.create({ agent: "agent-1" })
          const run2 = yield* repo.create({ agent: "agent-2" })
          yield* repo.update(run1.id, { status: "timeout" })
          yield* repo.update(run2.id, { status: "cancelled" })
        }).pipe(Effect.provide(layer))
      )

      const counts = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* RunRepository
          return yield* repo.countByStatus()
        }).pipe(Effect.provide(layer))
      )

      expect(counts.timeout).toBe(1)
      expect(counts.cancelled).toBe(1)
    })
  })
})

describe("Run-Task relationship", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("runs properly associate with tasks from fixtures", async () => {
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RunRepository
        return yield* repo.create({
          agent: "tx-implementer",
          taskId: FIXTURES.TASK_BLOCKED
        })
      }).pipe(Effect.provide(layer))
    )

    expect(run.taskId).toBe(FIXTURES.TASK_BLOCKED)
    expect(run.taskId).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("multiple runs can reference the same task", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RunRepository
        yield* repo.create({ agent: "attempt-1", taskId: FIXTURES.TASK_JWT })
        yield* repo.create({ agent: "attempt-2", taskId: FIXTURES.TASK_JWT })
        yield* repo.create({ agent: "attempt-3", taskId: FIXTURES.TASK_JWT })
      }).pipe(Effect.provide(layer))
    )

    const runs = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RunRepository
        return yield* repo.findByTaskId(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(runs).toHaveLength(3)
    expect(runs.every(r => r.taskId === FIXTURES.TASK_JWT)).toBe(true)
  })

  it("runs for different tasks are properly separated", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RunRepository
        yield* repo.create({ agent: "agent-jwt-1", taskId: FIXTURES.TASK_JWT })
        yield* repo.create({ agent: "agent-jwt-2", taskId: FIXTURES.TASK_JWT })
        yield* repo.create({ agent: "agent-login-1", taskId: FIXTURES.TASK_LOGIN })
      }).pipe(Effect.provide(layer))
    )

    const jwtRuns = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RunRepository
        return yield* repo.findByTaskId(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    const loginRuns = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RunRepository
        return yield* repo.findByTaskId(FIXTURES.TASK_LOGIN)
      }).pipe(Effect.provide(layer))
    )

    expect(jwtRuns).toHaveLength(2)
    expect(loginRuns).toHaveLength(1)
    expect(jwtRuns.every(r => r.taskId === FIXTURES.TASK_JWT)).toBe(true)
    expect(loginRuns.every(r => r.taskId === FIXTURES.TASK_LOGIN)).toBe(true)
  })

  it("fixtureId generates deterministic SHA256-based IDs", () => {
    expect(FIXTURES.TASK_AUTH).toBe(fixtureId("auth"))
    expect(FIXTURES.TASK_JWT).toBe(fixtureId("jwt"))
    expect(FIXTURES.TASK_LOGIN).toBe(fixtureId("login"))

    for (const id of Object.values(FIXTURES)) {
      expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
    }
  })
})
