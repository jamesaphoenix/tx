/**
 * Integration tests for tx sync claude — Claude Code task directory writer.
 *
 * Per DD-007: Uses real SQLite database and deterministic SHA256 fixtures.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSharedTestLayer, fixtureId, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { TaskService, buildClaudeTaskFiles } from "@jamesaphoenix/tx-core"
import type { Database } from "bun:sqlite"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const FX = {
  ACTIVE:         fixtureId("sync-claude:active"),
  DONE:           fixtureId("sync-claude:done"),
  TASK_A:         fixtureId("sync-claude:task-a"),
  TASK_B:         fixtureId("sync-claude:task-b"),
  TASK_C:         fixtureId("sync-claude:task-c"),
  BLOCKER:        fixtureId("sync-claude:blocker"),
  BLOCKED:        fixtureId("sync-claude:blocked"),
  DONE_BLOCKER:   fixtureId("sync-claude:done-blocker"),
  BLOCKED_TASK:   fixtureId("sync-claude:blocked-task"),
  BACKLOG:        fixtureId("sync-claude:backlog"),
  ACTIVE_STATUS:  fixtureId("sync-claude:active-status"),
  REVIEW:         fixtureId("sync-claude:review"),
  LOW_READY:      fixtureId("sync-claude:low-ready"),
  HIGH_READY:     fixtureId("sync-claude:high-ready"),
  SORT_BLOCKER:   fixtureId("sync-claude:sort-blocker"),
  SORT_BLOCKED:   fixtureId("sync-claude:sort-blocked"),
  CTX_TASK:       fixtureId("sync-claude:ctx-task"),
  ACTIVEFORM:     fixtureId("sync-claude:activeform-task"),
  ALPHA:          fixtureId("sync-claude:alpha"),
  BETA:           fixtureId("sync-claude:beta"),
  GAMMA:          fixtureId("sync-claude:gamma"),
  NO_DESC:        fixtureId("sync-claude:no-desc"),
  DESC_BLOCKER:   fixtureId("sync-claude:desc-blocker"),
  DESC_BLOCKED:   fixtureId("sync-claude:desc-blocked"),
  SPECIAL:        fixtureId("sync-claude:special"),
  WRITE_A:        fixtureId("sync-claude:write-a"),
  WRITE_B:        fixtureId("sync-claude:write-b"),
  STALE_A:        fixtureId("sync-claude:stale-a"),
  STALE_B:        fixtureId("sync-claude:stale-b"),
  CHAIN_A:        fixtureId("sync-claude:chain-a"),
  CHAIN_B:        fixtureId("sync-claude:chain-b"),
  CHAIN_C:        fixtureId("sync-claude:chain-c"),
} as const

// Helper to insert a task row with deterministic ID (bypasses service ID generation)
function insertTask(
  db: Database,
  id: string,
  title: string,
  opts: { score?: number; status?: string; description?: string; parentId?: string | null } = {},
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    title,
    opts.description ?? "",
    opts.status ?? "backlog",
    opts.parentId ?? null,
    opts.score ?? 500,
    now,
    now,
    opts.status === "done" ? now : null,
    "{}",
  )
}

// Helper to insert a dependency row
function insertDep(db: Database, blockerId: string, blockedId: string): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`,
  ).run(blockerId, blockedId, now)
}

describe("buildClaudeTaskFiles", () => {
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

  it("returns empty result when no tasks exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.files).toHaveLength(0)
    expect(result.highwatermark).toBe(1)
    expect(result.txIdMap.size).toBe(0)
  })

  it("excludes done tasks", async () => {
    const db = shared.getDb()
    insertTask(db, FX.ACTIVE, "Active task")
    insertTask(db, FX.DONE, "Done task", { status: "done" })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.files).toHaveLength(1)
    expect(result.files[0].subject).toBe("Active task")
  })

  it("assigns sequential numeric IDs", async () => {
    const db = shared.getDb()
    insertTask(db, FX.TASK_A, "Task A", { score: 900 })
    insertTask(db, FX.TASK_B, "Task B", { score: 800 })
    insertTask(db, FX.TASK_C, "Task C", { score: 700 })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.files).toHaveLength(3)
    expect(result.files[0].id).toBe("1")
    expect(result.files[1].id).toBe("2")
    expect(result.files[2].id).toBe("3")
    expect(result.highwatermark).toBe(4)
  })

  it("maps dependencies to numeric IDs", async () => {
    const db = shared.getDb()
    insertTask(db, FX.BLOCKER, "Blocker", { score: 900 })
    insertTask(db, FX.BLOCKED, "Blocked", { score: 800 })
    insertDep(db, FX.BLOCKER, FX.BLOCKED)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.files).toHaveLength(2)
    // Blocker is ready + higher score, gets ID "1"
    const blockerFile = result.files.find(f => f.subject === "Blocker")!
    const blockedFile = result.files.find(f => f.subject === "Blocked")!

    expect(blockerFile.blocks).toContain(blockedFile.id)
    expect(blockedFile.blockedBy).toContain(blockerFile.id)
  })

  it("filters out deps referencing done tasks", async () => {
    const db = shared.getDb()
    insertTask(db, FX.DONE_BLOCKER, "Done blocker", { status: "done" })
    insertTask(db, FX.BLOCKED_TASK, "Blocked task")
    insertDep(db, FX.DONE_BLOCKER, FX.BLOCKED_TASK)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.files).toHaveLength(1)
    expect(result.files[0].subject).toBe("Blocked task")
    // Done blocker is excluded, so blockedBy should be empty
    expect(result.files[0].blockedBy).toHaveLength(0)
  })

  it("maps statuses correctly", async () => {
    const db = shared.getDb()
    insertTask(db, FX.BACKLOG, "Backlog task", { status: "backlog" })
    insertTask(db, FX.ACTIVE_STATUS, "Active task", { status: "active" })
    insertTask(db, FX.REVIEW, "Review task", { status: "review" })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    const backlog = result.files.find(f => f.subject === "Backlog task")!
    const active = result.files.find(f => f.subject === "Active task")!
    const review = result.files.find(f => f.subject === "Review task")!

    expect(backlog.status).toBe("pending")
    expect(active.status).toBe("in_progress")
    expect(review.status).toBe("in_progress")
  })

  it("sorts ready tasks first with highest score first", async () => {
    const db = shared.getDb()
    insertTask(db, FX.LOW_READY, "Low priority ready", { score: 100 })
    insertTask(db, FX.HIGH_READY, "High priority ready", { score: 900 })
    insertTask(db, FX.SORT_BLOCKER, "Blocker", { score: 500 })
    insertTask(db, FX.SORT_BLOCKED, "Blocked high score", { score: 950 })
    insertDep(db, FX.SORT_BLOCKER, FX.SORT_BLOCKED)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    // Ready tasks first (sorted by score desc), then non-ready
    expect(result.files[0].subject).toBe("High priority ready")
    expect(result.files[1].subject).toBe("Blocker")
    expect(result.files[2].subject).toBe("Low priority ready")
    // Blocked task is last (not ready, despite high score)
    expect(result.files[3].subject).toBe("Blocked high score")
  })

  it("includes tx context and done hints in description", async () => {
    const db = shared.getDb()
    insertTask(db, FX.CTX_TASK, "Test task", { description: "Some work" })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    const file = result.files[0]
    expect(file.description).toContain("Some work")
    expect(file.description).toContain(`tx context ${FX.CTX_TASK}`)
    expect(file.description).toContain(`tx done ${FX.CTX_TASK}`)
  })

  it("includes tx ID in activeForm", async () => {
    const db = shared.getDb()
    insertTask(db, FX.ACTIVEFORM, "Implement feature")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    const file = result.files[0]
    expect(file.activeForm).toContain(FX.ACTIVEFORM)
    expect(file.activeForm).toContain("Implement feature")
  })

  it("deterministic ordering when scores are equal", async () => {
    const db = shared.getDb()
    insertTask(db, FX.ALPHA, "Alpha", { score: 500 })
    insertTask(db, FX.BETA, "Beta", { score: 500 })
    insertTask(db, FX.GAMMA, "Gamma", { score: 500 })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        // Run buildClaudeTaskFiles twice on same input — order must be identical
        const r1 = buildClaudeTaskFiles(tasks)
        const r2 = buildClaudeTaskFiles(tasks)
        return { r1, r2 }
      }).pipe(Effect.provide(shared.layer))
    )

    const titles1 = result.r1.files.map(f => f.subject)
    const titles2 = result.r2.files.map(f => f.subject)
    expect(titles1).toEqual(titles2)

    // All 3 should be present with unique IDs
    expect(result.r1.files).toHaveLength(3)
    const ids = result.r1.files.map(f => f.id)
    expect(new Set(ids).size).toBe(3)
  })

  it("handles task with no description gracefully", async () => {
    const db = shared.getDb()
    insertTask(db, FX.NO_DESC, "No description task")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    const file = result.files[0]
    // Should NOT start with a blank line — description starts with separator
    expect(file.description).toMatch(/^---\n/)
    expect(file.description).toContain("tx context")
    expect(file.description).toContain("tx done")
  })

  it("description shows both numeric and tx IDs for deps", async () => {
    const db = shared.getDb()
    insertTask(db, FX.DESC_BLOCKER, "Blocker", { score: 900 })
    insertTask(db, FX.DESC_BLOCKED, "Blocked", { score: 800 })
    insertDep(db, FX.DESC_BLOCKER, FX.DESC_BLOCKED)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    const blockedFile = result.files.find(f => f.subject === "Blocked")!
    // Description should reference both the numeric ID and tx ID
    expect(blockedFile.description).toContain(`#1 (${FX.DESC_BLOCKER})`)
  })

  it("handles special characters in title and description", async () => {
    const db = shared.getDb()
    insertTask(db, FX.SPECIAL, 'Fix "quotes" & <tags>', {
      description: "Line 1\nLine 2\n\nCode: `foo()`\nUnicode: \u2603\u2764",
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    const file = result.files[0]
    expect(file.subject).toBe('Fix "quotes" & <tags>')
    expect(file.description).toContain("Line 1\nLine 2")
    expect(file.description).toContain("`foo()`")
    expect(file.description).toContain("\u2603")

    // Verify it produces valid JSON
    const json = JSON.stringify(file)
    const parsed = JSON.parse(json)
    expect(parsed.subject).toBe(file.subject)
  })

  it("writes valid JSON files to a directory", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tx-sync-claude-"))

    try {
      const db = shared.getDb()
      insertTask(db, FX.WRITE_A, "Task A", { score: 900 })
      insertTask(db, FX.WRITE_B, "Task B", { score: 800 })

      const { files, highwatermark } = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const tasks = yield* taskSvc.listWithDeps()
          return buildClaudeTaskFiles(tasks)
        }).pipe(Effect.provide(shared.layer))
      )

      // Simulate the file writing that syncClaude does
      for (const file of files) {
        writeFileSync(join(tempDir, `${file.id}.json`), JSON.stringify(file, null, 2))
      }
      writeFileSync(join(tempDir, ".highwatermark"), String(highwatermark))

      // Verify files
      const written = readdirSync(tempDir).filter(f => f.endsWith(".json"))
      expect(written).toHaveLength(2)

      const task1 = JSON.parse(readFileSync(join(tempDir, "1.json"), "utf-8"))
      expect(task1.id).toBe("1")
      expect(task1.subject).toBe("Task A")
      expect(task1.status).toBe("pending")
      expect(task1.blocks).toEqual([])
      expect(task1.blockedBy).toEqual([])

      const hwm = readFileSync(join(tempDir, ".highwatermark"), "utf-8")
      expect(hwm).toBe("3")
    } finally {
      rmSync(tempDir, { recursive: true })
    }
  })

  it("stale file cleanup: simulates re-sync removing old files", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tx-sync-claude-stale-"))

    try {
      // Simulate a previous sync that wrote 5 task files
      for (let i = 1; i <= 5; i++) {
        writeFileSync(
          join(tempDir, `${i}.json`),
          JSON.stringify({ id: String(i), subject: `Old task ${i}` }),
        )
      }
      writeFileSync(join(tempDir, ".highwatermark"), "6")
      writeFileSync(join(tempDir, ".lock"), "")

      // Now simulate a re-sync where only 2 tasks remain
      const db = shared.getDb()
      insertTask(db, FX.STALE_A, "Remaining A", { score: 900 })
      insertTask(db, FX.STALE_B, "Remaining B", { score: 800 })

      const { files, highwatermark } = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const tasks = yield* taskSvc.listWithDeps()
          return buildClaudeTaskFiles(tasks)
        }).pipe(Effect.provide(shared.layer))
      )

      // Cleanup stale files (same logic as syncClaude CLI)
      const { unlinkSync } = await import("node:fs")
      const newIds = new Set(files.map(f => `${f.id}.json`))
      const existing = readdirSync(tempDir).filter(f => /^\d+\.json$/.test(f))
      for (const stale of existing) {
        if (!newIds.has(stale)) {
          unlinkSync(join(tempDir, stale))
        }
      }
      for (const file of files) {
        writeFileSync(join(tempDir, `${file.id}.json`), JSON.stringify(file, null, 2))
      }
      writeFileSync(join(tempDir, ".highwatermark"), String(highwatermark))

      // Verify: only 2 task files remain, old ones are gone
      const remaining = readdirSync(tempDir).filter(f => /^\d+\.json$/.test(f))
      expect(remaining.sort()).toEqual(["1.json", "2.json"])

      // Old files 3-5 should not exist
      expect(readdirSync(tempDir)).not.toContain("3.json")
      expect(readdirSync(tempDir)).not.toContain("4.json")
      expect(readdirSync(tempDir)).not.toContain("5.json")

      // .lock and .highwatermark should still exist
      expect(readdirSync(tempDir)).toContain(".lock")
      expect(readdirSync(tempDir)).toContain(".highwatermark")
      expect(readFileSync(join(tempDir, ".highwatermark"), "utf-8")).toBe("3")
    } finally {
      rmSync(tempDir, { recursive: true })
    }
  })

  it("blocks/blockedBy are symmetric after mapping", async () => {
    const db = shared.getDb()
    // A blocks B, B blocks C (chain: A -> B -> C)
    insertTask(db, FX.CHAIN_A, "A", { score: 900 })
    insertTask(db, FX.CHAIN_B, "B", { score: 800 })
    insertTask(db, FX.CHAIN_C, "C", { score: 700 })
    insertDep(db, FX.CHAIN_A, FX.CHAIN_B)
    insertDep(db, FX.CHAIN_B, FX.CHAIN_C)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.listWithDeps()
        return buildClaudeTaskFiles(tasks)
      }).pipe(Effect.provide(shared.layer))
    )

    const fileA = result.files.find(f => f.subject === "A")!
    const fileB = result.files.find(f => f.subject === "B")!
    const fileC = result.files.find(f => f.subject === "C")!

    // A blocks B — verify both sides
    expect(fileA.blocks).toContain(fileB.id)
    expect(fileB.blockedBy).toContain(fileA.id)

    // B blocks C — verify both sides
    expect(fileB.blocks).toContain(fileC.id)
    expect(fileC.blockedBy).toContain(fileB.id)

    // A does NOT directly block C
    expect(fileA.blocks).not.toContain(fileC.id)
    expect(fileC.blockedBy).not.toContain(fileA.id)
  })
})
