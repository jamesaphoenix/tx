import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import {
  SqliteClient,
  CompactionRepositoryLive,
  CompactionRepository,
  CompactionService,
  CompactionServiceNoop,
  CompactionServiceAuto
} from "@jamesaphoenix/tx-core"
import { existsSync, unlinkSync, readFileSync } from "node:fs"

/**
 * Create a minimal test layer for CompactionService tests
 */
function makeCompactionTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = CompactionRepositoryLive.pipe(Layer.provide(infra))
  return Layer.merge(infra, repos)
}

/**
 * Insert a completed task into the test database
 */
function insertCompletedTask(
  db: TestDatabase,
  id: string,
  title: string,
  completedAt: string,
  parentId?: string
) {
  const now = new Date().toISOString()
  db.db.prepare(`
    INSERT INTO tasks (id, title, status, score, created_at, updated_at, completed_at, parent_id)
    VALUES (?, ?, 'done', 500, ?, ?, ?, ?)
  `).run(
    id,
    title,
    new Date(Date.now() - 86400000).toISOString(), // created yesterday
    now,
    completedAt,
    parentId ?? null
  )
}

/**
 * Insert an incomplete task into the test database
 */
function insertIncompleteTask(
  db: TestDatabase,
  id: string,
  title: string,
  status: string = "active"
) {
  const now = new Date().toISOString()
  db.db.prepare(`
    INSERT INTO tasks (id, title, status, score, created_at, updated_at)
    VALUES (?, ?, ?, 500, ?, ?)
  `).run(id, title, status, now, now)
}

// Helper to run effects with the noop layer
async function runWithNoop<A>(db: TestDatabase, effect: Effect.Effect<A, any, any>): Promise<A> {
  const baseLayer = makeCompactionTestLayer(db)
  const noopLayer = CompactionServiceNoop.pipe(Layer.provide(baseLayer))
  return Effect.runPromise(effect.pipe(Effect.provide(noopLayer)) as Effect.Effect<A, never, never>)
}

// Helper to run effects with the auto layer
async function runWithAuto<A>(db: TestDatabase, effect: Effect.Effect<A, any, any>): Promise<A> {
  const baseLayer = makeCompactionTestLayer(db)
  const autoLayer = CompactionServiceAuto.pipe(Layer.provide(baseLayer))
  return Effect.runPromise(effect.pipe(Effect.provide(autoLayer)) as Effect.Effect<A, never, never>)
}

// Helper to run effects with just the repo layer
async function runWithRepo<A>(db: TestDatabase, effect: Effect.Effect<A, any, any>): Promise<A> {
  const baseLayer = makeCompactionTestLayer(db)
  return Effect.runPromise(effect.pipe(Effect.provide(baseLayer)) as Effect.Effect<A, never, never>)
}

describe("CompactionServiceNoop", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  describe("compact", () => {
    it("fails with ExtractionUnavailableError", async () => {
      const result = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* Effect.either(svc.compact({ before: new Date() }))
      }))

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ExtractionUnavailableError")
        expect((result.left as any).reason).toContain("ANTHROPIC_API_KEY")
      }
    })
  })

  describe("preview", () => {
    it("returns empty array when no tasks exist", async () => {
      const tasks = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* svc.preview(new Date())
      }))

      expect(tasks).toEqual([])
    })

    it("returns completed tasks before the date", async () => {
      // Insert some tasks
      const oldDate = new Date(Date.now() - 7 * 86400000).toISOString() // 7 days ago
      const recentDate = new Date(Date.now() - 86400000).toISOString() // yesterday

      insertCompletedTask(db, "tx-old00001", "Old Task 1", oldDate)
      insertCompletedTask(db, "tx-old00002", "Old Task 2", oldDate)
      insertCompletedTask(db, "tx-recent01", "Recent Task", recentDate)

      // Preview with cutoff 3 days ago
      const cutoff = new Date(Date.now() - 3 * 86400000)

      const tasks = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* svc.preview(cutoff)
      }))

      expect(tasks).toHaveLength(2)
      expect(tasks.map(t => t.id)).toContain("tx-old00001")
      expect(tasks.map(t => t.id)).toContain("tx-old00002")
      expect(tasks.map(t => t.id)).not.toContain("tx-recent01")
    })

    it("excludes tasks with incomplete children", async () => {
      const oldDate = new Date(Date.now() - 7 * 86400000).toISOString()

      // Parent task that's done
      insertCompletedTask(db, "tx-parent01", "Parent Task", oldDate)
      // Child task that's NOT done
      insertIncompleteTask(db, "tx-child001", "Child Task", "active")
      // Update child to have parent_id
      db.db.prepare("UPDATE tasks SET parent_id = ? WHERE id = ?").run("tx-parent01", "tx-child001")

      // Another parent with all children done
      insertCompletedTask(db, "tx-parent02", "Parent Task 2", oldDate)
      insertCompletedTask(db, "tx-child002", "Child Task 2", oldDate, "tx-parent02")

      const cutoff = new Date()

      const tasks = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* svc.preview(cutoff)
      }))

      // Only parent02 and child002 should be included
      // parent01 has incomplete child
      expect(tasks.map(t => t.id)).not.toContain("tx-parent01")
      expect(tasks.map(t => t.id)).toContain("tx-parent02")
      expect(tasks.map(t => t.id)).toContain("tx-child002")
    })
  })

  describe("getSummaries", () => {
    it("returns empty array when no compactions exist", async () => {
      const summaries = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* svc.getSummaries()
      }))

      expect(summaries).toEqual([])
    })

    it("returns compaction history", async () => {
      // Insert a compaction log entry directly
      db.db.prepare(`
        INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        new Date().toISOString(),
        5,
        "Test summary",
        JSON.stringify(["tx-test0001", "tx-test0002"]),
        "CLAUDE.md"
      )

      const summaries = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* svc.getSummaries()
      }))

      expect(summaries).toHaveLength(1)
      expect(summaries[0].taskCount).toBe(5)
      expect(summaries[0].summary).toBe("Test summary")
    })
  })

  describe("exportLearnings", () => {
    const testFile = "/tmp/test-learnings-export.md"

    afterEach(() => {
      if (existsSync(testFile)) {
        unlinkSync(testFile)
      }
    })

    it("creates new file with learnings", async () => {
      await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        yield* svc.exportLearnings("- Learning 1\n- Learning 2", testFile)
      }))

      expect(existsSync(testFile)).toBe(true)
      const content = readFileSync(testFile, "utf-8")
      expect(content).toContain("Learning 1")
      expect(content).toContain("Learning 2")
      expect(content).toContain("## Agent Learnings")
    })

    it("appends to existing file", async () => {
      // Create initial file
      const { writeFileSync } = await import("node:fs")
      writeFileSync(testFile, "# Existing Content\n\nSome stuff here.\n")

      await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        yield* svc.exportLearnings("- New learning", testFile)
      }))

      const content = readFileSync(testFile, "utf-8")
      expect(content).toContain("# Existing Content")
      expect(content).toContain("New learning")
      expect(content).toContain("## Agent Learnings")
    })

    it("fails with DatabaseError on invalid path (regression: file export must fail before DB records)", async () => {
      // CRITICAL REGRESSION TEST: This ensures that file export failures are properly
      // propagated as errors. In the compact() flow, if exportLearningsToFile fails,
      // the DB transaction should never run (preventing false positive records).
      // See task tx-b2aa12e1 for the original bug.
      const invalidPath = "/nonexistent-dir-abc123/cannot-write-here/learnings.md"

      const result = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* Effect.either(svc.exportLearnings("- Test learning", invalidPath))
      }))

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("DatabaseError")
      }
    })
  })

  describe("isAvailable", () => {
    it("returns false", async () => {
      const available = await runWithNoop(db, Effect.gen(function* () {
        const svc = yield* CompactionService
        return yield* svc.isAvailable()
      }))

      expect(available).toBe(false)
    })
  })
})

describe("CompactionServiceAuto", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("uses Noop when ANTHROPIC_API_KEY is not set", async () => {
    const result = await runWithAuto(db, Effect.gen(function* () {
      const svc = yield* CompactionService
      return yield* Effect.either(svc.compact({ before: new Date() }))
    }))

    // Without API key, should fail like Noop
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ExtractionUnavailableError")
    }
  })

  it("isAvailable returns false when no API key set", async () => {
    const available = await runWithAuto(db, Effect.gen(function* () {
      const svc = yield* CompactionService
      return yield* svc.isAvailable()
    }))

    expect(available).toBe(false)
  })

  it("preview still works without API key", async () => {
    // Insert a completed task
    const oldDate = new Date(Date.now() - 7 * 86400000).toISOString()
    insertCompletedTask(db, "tx-auto0001", "Auto Test Task", oldDate)

    const tasks = await runWithAuto(db, Effect.gen(function* () {
      const svc = yield* CompactionService
      return yield* svc.preview(new Date())
    }))

    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe("Auto Test Task")
  })
})

describe("CompactionRepository", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  describe("insert", () => {
    it("inserts a compaction log entry with learnings", async () => {
      const entry = await runWithRepo(db, Effect.gen(function* () {
        const repo = yield* CompactionRepository
        return yield* repo.insert({
          taskCount: 10,
          summary: "Compaction summary",
          taskIds: ["tx-test0001", "tx-test0002"],
          learningsExportedTo: "CLAUDE.md",
          learnings: "- Learning 1\n- Learning 2"
        })
      }))

      expect(entry.id).toBeGreaterThan(0)
      expect(entry.taskCount).toBe(10)
      expect(entry.summary).toBe("Compaction summary")
      expect(entry.taskIds).toEqual(["tx-test0001", "tx-test0002"])
      expect(entry.learningsExportedTo).toBe("CLAUDE.md")
      expect(entry.learnings).toBe("- Learning 1\n- Learning 2")
    })
  })

  describe("findAll", () => {
    it("returns entries ordered by compacted_at desc", async () => {
      // Insert entries with different timestamps
      const now = Date.now()
      db.db.prepare(`
        INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        new Date(now - 86400000).toISOString(),
        1,
        "Old",
        "[]",
        "CLAUDE.md"
      )
      db.db.prepare(`
        INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        new Date(now).toISOString(),
        2,
        "New",
        "[]",
        "CLAUDE.md"
      )

      const entries = await runWithRepo(db, Effect.gen(function* () {
        const repo = yield* CompactionRepository
        return yield* repo.findAll()
      }))

      expect(entries).toHaveLength(2)
      expect(entries[0].summary).toBe("New")
      expect(entries[1].summary).toBe("Old")
    })
  })

  describe("findRecent", () => {
    it("limits the number of entries returned", async () => {
      // Insert 5 entries
      for (let i = 0; i < 5; i++) {
        db.db.prepare(`
          INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          new Date(Date.now() - i * 86400000).toISOString(),
          i + 1,
          `Entry ${i}`,
          "[]",
          "CLAUDE.md"
        )
      }

      const entries = await runWithRepo(db, Effect.gen(function* () {
        const repo = yield* CompactionRepository
        return yield* repo.findRecent(3)
      }))

      expect(entries).toHaveLength(3)
    })
  })

  describe("count", () => {
    it("returns total count of entries", async () => {
      // Insert entries
      for (let i = 0; i < 3; i++) {
        db.db.prepare(`
          INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to)
          VALUES (?, ?, ?, ?, ?)
        `).run(new Date().toISOString(), 1, "Entry", "[]", "CLAUDE.md")
      }

      const count = await runWithRepo(db, Effect.gen(function* () {
        const repo = yield* CompactionRepository
        return yield* repo.count()
      }))

      expect(count).toBe(3)
    })
  })
})

describe("Compaction date filtering", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("handles edge case: task completed exactly at cutoff time", async () => {
    const cutoffTime = new Date(Date.now() - 3 * 86400000)
    const exactTime = cutoffTime.toISOString()

    insertCompletedTask(db, "tx-exact001", "Exact Time Task", exactTime)

    const tasks = await runWithNoop(db, Effect.gen(function* () {
      const svc = yield* CompactionService
      return yield* svc.preview(cutoffTime)
    }))

    // Task at exact cutoff should NOT be included (< not <=)
    expect(tasks.map(t => t.id)).not.toContain("tx-exact001")
  })

  it("handles ISO date strings correctly", async () => {
    // Insert task with specific ISO timestamp
    const taskDate = "2024-01-15T10:30:00.000Z"
    insertCompletedTask(db, "tx-iso00001", "ISO Date Task", taskDate)

    // Preview with cutoff after the task date
    const cutoff = new Date("2024-01-16T00:00:00.000Z")

    const tasks = await runWithNoop(db, Effect.gen(function* () {
      const svc = yield* CompactionService
      return yield* svc.preview(cutoff)
    }))

    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe("tx-iso00001")
  })
})
