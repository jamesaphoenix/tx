/**
 * Golden Path: Sync Workflow Integration Tests
 *
 * Tests the complete sync workflow: export → import → round-trip.
 * Verifies that tasks and dependencies are preserved through sync cycles.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 * Per DD-009: JSONL Git Sync
 *
 * @see DD-009: JSONL Git Sync
 * @see PRD-010: Sync and Persistence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { Database } from "bun:sqlite"
import { existsSync, unlinkSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  DependencyRepository,
  LearningRepositoryLive,
  FileLearningRepositoryLive,
  AttemptRepositoryLive,
  TaskServiceLive,
  TaskService,
  DependencyServiceLive,
  DependencyService,
  ReadyServiceLive,
  HierarchyServiceLive,
  SyncServiceLive,
  SyncService,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"
import { fixtureId } from "@jamesaphoenix/tx-test-utils"
import { createTestDb } from "../fixtures.js"

// =============================================================================
// Test Layer Factory
// =============================================================================

function makeTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as Database)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )
  const baseServices = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, AutoSyncServiceNoop))
  )
  const syncService = SyncServiceLive.pipe(
    Layer.provide(Layer.mergeAll(baseServices, repos, infra))
  )
  return Layer.mergeAll(baseServices, syncService, repos)
}

// =============================================================================
// Test Fixtures
// =============================================================================

const SYNC_FIXTURES = {
  TASK_ROOT: fixtureId("sync-workflow:root"),
  TASK_CHILD_1: fixtureId("sync-workflow:child-1"),
  TASK_CHILD_2: fixtureId("sync-workflow:child-2"),
  TASK_BLOCKED: fixtureId("sync-workflow:blocked"),
} as const

// =============================================================================
// Helper Functions
// =============================================================================

function createTempJsonlPath(): string {
  const tempDir = join(tmpdir(), "tx-golden-sync")
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }
  return join(tempDir, `tasks-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
}

function cleanupTempFile(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

// =============================================================================
// Golden Path: Basic Export/Import
// =============================================================================

describe("Golden Path: Basic Export/Import", () => {
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeEach(() => {
    db = createTestDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("export creates valid JSONL file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const syncSvc = yield* SyncService

        // Create tasks to export
        yield* taskSvc.create({ title: "Task 1", score: 800 })
        yield* taskSvc.create({ title: "Task 2", score: 600 })
        yield* taskSvc.create({ title: "Task 3", score: 400 })

        // Export
        const exportResult = yield* syncSvc.export(tempPath)

        return exportResult
      }).pipe(Effect.provide(layer))
    )

    // Verify export
    expect(result.opCount).toBe(3)
    expect(result.path).toBe(tempPath)
    expect(existsSync(tempPath)).toBe(true)

    // Verify JSONL format
    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(3)

    for (const line of lines) {
      const op = JSON.parse(line)
      expect(op.v).toBe(1) // Version
      expect(op.op).toBe("upsert")
      expect(op.id).toMatch(/^tx-[a-z0-9]{8}$/)
      expect(op.data).toHaveProperty("title")
    }
  })

  it("import restores tasks from JSONL", async () => {
    const targetDb = createTestDb()
    const targetLayer = makeTestLayer(targetDb)

    // Create and export tasks from source
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const syncSvc = yield* SyncService

        yield* taskSvc.create({ title: "Exported Task 1", score: 800 })
        yield* taskSvc.create({ title: "Exported Task 2", score: 600 })

        yield* syncSvc.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Import into target
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const syncSvc = yield* SyncService
        const taskSvc = yield* TaskService

        const importResult = yield* syncSvc.import(tempPath)
        const tasks = yield* taskSvc.list()

        return { importResult, tasks }
      }).pipe(Effect.provide(targetLayer))
    )

    expect(result.importResult.imported).toBe(2)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.map(t => t.title)).toContain("Exported Task 1")
    expect(result.tasks.map(t => t.title)).toContain("Exported Task 2")
  })
})

// =============================================================================
// Golden Path: Round-Trip Preservation
// =============================================================================

describe("Golden Path: Round-Trip Preservation", () => {
  let sourceDb: Database
  let targetDb: Database
  let sourceLayer: ReturnType<typeof makeTestLayer>
  let targetLayer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeEach(() => {
    sourceDb = createTestDb()
    targetDb = createTestDb()
    sourceLayer = makeTestLayer(sourceDb)
    targetLayer = makeTestLayer(targetDb)
    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("preserves task hierarchy through round-trip", async () => {
    // Create hierarchy in source
    const sourceIds = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const syncSvc = yield* SyncService

        const parent = yield* taskSvc.create({ title: "Parent Task", score: 1000 })
        const child1 = yield* taskSvc.create({ title: "Child 1", parentId: parent.id, score: 800 })
        const child2 = yield* taskSvc.create({ title: "Child 2", parentId: parent.id, score: 600 })

        yield* syncSvc.export(tempPath)

        return { parentId: parent.id, child1Id: child1.id, child2Id: child2.id }
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import into target and verify hierarchy
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const syncSvc = yield* SyncService
        const taskSvc = yield* TaskService

        yield* syncSvc.import(tempPath)

        const parent = yield* taskSvc.getWithDeps(sourceIds.parentId)
        const child1 = yield* taskSvc.get(sourceIds.child1Id)
        const child2 = yield* taskSvc.get(sourceIds.child2Id)

        return { parent, child1, child2 }
      }).pipe(Effect.provide(targetLayer))
    )

    expect(result.parent.children).toHaveLength(2)
    expect(result.parent.children).toContain(sourceIds.child1Id)
    expect(result.parent.children).toContain(sourceIds.child2Id)
    expect(result.child1.parentId).toBe(sourceIds.parentId)
    expect(result.child2.parentId).toBe(sourceIds.parentId)
  })

  it("preserves dependencies through round-trip", async () => {
    // Create tasks with dependencies in source
    const sourceIds = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const syncSvc = yield* SyncService

        const blocker = yield* taskSvc.create({ title: "Blocker Task", score: 800 })
        const blocked = yield* taskSvc.create({ title: "Blocked Task", score: 600 })

        yield* depSvc.addBlocker(blocked.id, blocker.id)

        yield* syncSvc.export(tempPath)

        return { blockerId: blocker.id, blockedId: blocked.id }
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import into target and verify dependencies
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const syncSvc = yield* SyncService
        const taskSvc = yield* TaskService
        const depRepo = yield* DependencyRepository

        yield* syncSvc.import(tempPath)

        const blocked = yield* taskSvc.getWithDeps(sourceIds.blockedId)
        const blockerIds = yield* depRepo.getBlockerIds(sourceIds.blockedId)

        return { blocked, blockerIds }
      }).pipe(Effect.provide(targetLayer))
    )

    expect(result.blocked.blockedBy).toContain(sourceIds.blockerId)
    expect(result.blockerIds).toContain(sourceIds.blockerId)
  })

  it("preserves TaskWithDeps info through round-trip (Rule 1)", async () => {
    // Create complex task state in source
    const sourceIds = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const depSvc = yield* DependencyService
        const syncSvc = yield* SyncService

        const parent = yield* taskSvc.create({ title: "Parent", score: 1000 })
        const blocker = yield* taskSvc.create({ title: "Blocker", parentId: parent.id, score: 800 })
        const blocked = yield* taskSvc.create({ title: "Blocked", parentId: parent.id, score: 600 })

        yield* depSvc.addBlocker(blocked.id, blocker.id)
        yield* syncSvc.export(tempPath)

        return { parentId: parent.id, blockerId: blocker.id, blockedId: blocked.id }
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import and verify full TaskWithDeps info
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const syncSvc = yield* SyncService
        const taskSvc = yield* TaskService

        yield* syncSvc.import(tempPath)

        const parent = yield* taskSvc.getWithDeps(sourceIds.parentId)
        const blocker = yield* taskSvc.getWithDeps(sourceIds.blockerId)
        const blocked = yield* taskSvc.getWithDeps(sourceIds.blockedId)

        return { parent, blocker, blocked }
      }).pipe(Effect.provide(targetLayer))
    )

    // Verify Rule 1: Every API response MUST include full dependency information
    // Parent should have children
    expect(result.parent).toHaveProperty("blockedBy")
    expect(result.parent).toHaveProperty("blocks")
    expect(result.parent).toHaveProperty("children")
    expect(result.parent).toHaveProperty("isReady")
    expect(result.parent.children).toHaveLength(2)

    // Blocker should show it blocks something
    expect(result.blocker.blocks).toContain(sourceIds.blockedId)
    expect(result.blocker.blockedBy).toHaveLength(0)

    // Blocked should show it's blocked
    expect(result.blocked.blockedBy).toContain(sourceIds.blockerId)
    expect(result.blocked.isReady).toBe(false)
  })
})

// =============================================================================
// Golden Path: Conflict Resolution
// =============================================================================

describe("Golden Path: Conflict Resolution", () => {
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeEach(() => {
    db = createTestDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("newer JSONL timestamp wins over older local data", async () => {
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    // Create local task with old timestamp
    const oldTs = "2024-01-01T00:00:00.000Z"
    insert.run(SYNC_FIXTURES.TASK_ROOT, "Old Title", "", "backlog", 100, null, oldTs, oldTs, null, "{}")

    // Create JSONL with newer timestamp
    const newTs = "2024-01-02T00:00:00.000Z"
    const jsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: newTs,
      id: SYNC_FIXTURES.TASK_ROOT,
      data: {
        title: "New Title",
        description: "Updated",
        status: "ready",
        score: 999,
        parentId: null,
        metadata: {}
      }
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Import - newer should win
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const syncSvc = yield* SyncService
        const taskSvc = yield* TaskService

        yield* syncSvc.import(tempPath)
        const task = yield* taskSvc.get(SYNC_FIXTURES.TASK_ROOT as TaskId)

        return { task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.task.title).toBe("New Title")
    expect(result.task.score).toBe(999)
  })

  it("older JSONL timestamp reports conflict", async () => {
    const insert = db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    // Create local task with new timestamp
    const newTs = "2024-01-02T00:00:00.000Z"
    insert.run(SYNC_FIXTURES.TASK_ROOT, "Local Title", "", "ready", 999, null, newTs, newTs, null, "{}")

    // Create JSONL with older timestamp
    const oldTs = "2024-01-01T00:00:00.000Z"
    const jsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: oldTs,
      id: SYNC_FIXTURES.TASK_ROOT,
      data: {
        title: "Old Title",
        description: "",
        status: "backlog",
        score: 100,
        parentId: null,
        metadata: {}
      }
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Import - local should win, conflict reported
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const syncSvc = yield* SyncService
        const taskSvc = yield* TaskService

        const importResult = yield* syncSvc.import(tempPath)
        const task = yield* taskSvc.get(SYNC_FIXTURES.TASK_ROOT as TaskId)

        return { importResult, task }
      }).pipe(Effect.provide(layer))
    )

    expect(result.importResult.conflicts).toBe(1)
    expect(result.task.title).toBe("Local Title") // Local unchanged
  })
})

// =============================================================================
// Golden Path: Status and Compact
// =============================================================================

describe("Golden Path: Status and Compact", () => {
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeEach(() => {
    db = createTestDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("status reports correct sync state", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const syncSvc = yield* SyncService

        // Create some tasks
        yield* taskSvc.create({ title: "Task 1", score: 800 })
        yield* taskSvc.create({ title: "Task 2", score: 600 })

        const status = yield* syncSvc.status()

        return status
      }).pipe(Effect.provide(layer))
    )

    expect(result.dbTaskCount).toBe(2)
    expect(result.isDirty).toBe(true) // No export yet
  })

  it("compact removes duplicate operations", async () => {
    // Create JSONL with duplicate upserts for same task
    const earlier = "2024-01-01T00:00:00.000Z"
    const later = "2024-01-02T00:00:00.000Z"
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: earlier,
        id: SYNC_FIXTURES.TASK_ROOT,
        data: { title: "Old Title", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: later,
        id: SYNC_FIXTURES.TASK_ROOT,
        data: { title: "New Title", description: "", status: "ready", score: 200, parentId: null, metadata: {} }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const syncSvc = yield* SyncService
        return yield* syncSvc.compact(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.before).toBe(2)
    expect(result.after).toBe(1)

    // Verify compacted content has newer version
    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(1)
    const op = JSON.parse(lines[0])
    expect(op.data.title).toBe("New Title")
  })
})
