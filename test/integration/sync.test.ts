/**
 * Sync Service Integration Tests
 *
 * Tests the JSONL sync service for round-trip export/import functionality.
 * Verifies that tasks and dependencies can be exported to JSONL and
 * re-imported correctly with proper conflict resolution.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { existsSync, unlinkSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"

import { createTestDb, seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
import { SqliteClient } from "../../src/db.js"
import { TaskRepositoryLive } from "../../src/repo/task-repo.js"
import { DependencyRepositoryLive, DependencyRepository } from "../../src/repo/dep-repo.js"
import { TaskServiceLive, TaskService } from "../../src/services/task-service.js"
import { DependencyServiceLive } from "../../src/services/dep-service.js"
import { ReadyServiceLive } from "../../src/services/ready-service.js"
import { HierarchyServiceLive } from "../../src/services/hierarchy-service.js"
import { SyncServiceLive, SyncService } from "../../src/services/sync-service.js"

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

// Additional sync-specific fixture IDs
const SYNC_FIXTURES = {
  SYNC_TASK_A: fixtureId("sync-task-a"),
  SYNC_TASK_B: fixtureId("sync-task-b"),
  SYNC_TASK_C: fixtureId("sync-task-c"),
} as const

// -----------------------------------------------------------------------------
// Test Layer Factory
// -----------------------------------------------------------------------------

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as Database.Database)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  const baseServices = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(
    Layer.provide(repos)
  )
  // SyncService needs TaskService, TaskRepository, and DependencyRepository
  const syncService = SyncServiceLive.pipe(
    Layer.provide(baseServices),
    Layer.provide(repos)
  )
  return Layer.mergeAll(baseServices, syncService, repos)
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Creates a unique temporary file path for test JSONL files.
 */
function createTempJsonlPath(): string {
  const tempDir = join(tmpdir(), "tx-test-sync")
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }
  return join(tempDir, `tasks-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
}

/**
 * Cleans up a temp file if it exists.
 */
function cleanupTempFile(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

// -----------------------------------------------------------------------------
// Export Tests
// -----------------------------------------------------------------------------

describe("SyncService Export", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("exports tasks to JSONL file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.path).toBe(tempPath)
    expect(result.opCount).toBeGreaterThan(0)
    expect(existsSync(tempPath)).toBe(true)
  })

  it("exports correct number of operations (tasks + dependencies)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Fixtures have 6 tasks and 2 dependencies
    expect(result.opCount).toBe(8)
  })

  it("produces valid JSONL format (one JSON object per line)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it("exports task upsert operations with correct structure", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")
    const ops = lines.map(line => JSON.parse(line))

    const upsertOps = ops.filter(op => op.op === "upsert")
    expect(upsertOps.length).toBe(6) // 6 tasks in fixtures

    for (const op of upsertOps) {
      expect(op.v).toBe(1)
      expect(op.op).toBe("upsert")
      expect(op.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(op.id).toMatch(/^tx-[a-z0-9]{8}$/)
      expect(op.data).toHaveProperty("title")
      expect(op.data).toHaveProperty("description")
      expect(op.data).toHaveProperty("status")
      expect(op.data).toHaveProperty("score")
      expect(op.data).toHaveProperty("parentId")
      expect(op.data).toHaveProperty("metadata")
    }
  })

  it("exports dependency add operations with correct structure", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")
    const ops = lines.map(line => JSON.parse(line))

    const depOps = ops.filter(op => op.op === "dep_add")
    expect(depOps.length).toBe(2) // 2 dependencies in fixtures

    for (const op of depOps) {
      expect(op.v).toBe(1)
      expect(op.op).toBe("dep_add")
      expect(op.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(op.blockerId).toMatch(/^tx-[a-z0-9]{8}$/)
      expect(op.blockedId).toMatch(/^tx-[a-z0-9]{8}$/)
    }
  })

  it("exports specific fixture tasks correctly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")
    const ops = lines.map(line => JSON.parse(line))

    const upsertOps = ops.filter(op => op.op === "upsert")
    const ids = upsertOps.map(op => op.id)

    expect(ids).toContain(FIXTURES.TASK_ROOT)
    expect(ids).toContain(FIXTURES.TASK_AUTH)
    expect(ids).toContain(FIXTURES.TASK_LOGIN)
    expect(ids).toContain(FIXTURES.TASK_JWT)
    expect(ids).toContain(FIXTURES.TASK_BLOCKED)
    expect(ids).toContain(FIXTURES.TASK_DONE)
  })

  it("exports specific fixture dependencies correctly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")
    const ops = lines.map(line => JSON.parse(line))

    const depOps = ops.filter(op => op.op === "dep_add")

    // JWT -> BLOCKED and LOGIN -> BLOCKED
    const jwtBlocksBlocked = depOps.find(
      op => op.blockerId === FIXTURES.TASK_JWT && op.blockedId === FIXTURES.TASK_BLOCKED
    )
    const loginBlocksBlocked = depOps.find(
      op => op.blockerId === FIXTURES.TASK_LOGIN && op.blockedId === FIXTURES.TASK_BLOCKED
    )

    expect(jwtBlocksBlocked).toBeDefined()
    expect(loginBlocksBlocked).toBeDefined()
  })

  it("handles empty database gracefully", async () => {
    const emptyDb = createTestDb()
    const emptyLayer = makeTestLayer(emptyDb)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.export(tempPath)
      }).pipe(Effect.provide(emptyLayer))
    )

    expect(result.opCount).toBe(0)
    expect(existsSync(tempPath)).toBe(true)
    const content = readFileSync(tempPath, "utf-8")
    expect(content).toBe("")
  })
})

// -----------------------------------------------------------------------------
// Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Import", () => {
  let db: InstanceType<typeof Database>
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

  it("returns zero counts for missing file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import("/nonexistent/path/file.jsonl")
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.conflicts).toBe(0)
  })

  it("returns zero counts for empty file", async () => {
    writeFileSync(tempPath, "", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.conflicts).toBe(0)
  })

  it("imports task upsert operations into empty database", async () => {
    const now = new Date().toISOString()
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: now,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: {
          title: "Sync Task A",
          description: "Description A",
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {}
        }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.conflicts).toBe(0)

    // Verify task was created
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(SYNC_FIXTURES.SYNC_TASK_A)
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toBe(SYNC_FIXTURES.SYNC_TASK_A)
    expect(task.title).toBe("Sync Task A")
    expect(task.description).toBe("Description A")
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(100)
  })

  it("imports dependency operations", async () => {
    const now = new Date().toISOString()
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: now,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: now,
        id: SYNC_FIXTURES.SYNC_TASK_B,
        data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "dep_add",
        ts: now,
        blockerId: SYNC_FIXTURES.SYNC_TASK_A,
        blockedId: SYNC_FIXTURES.SYNC_TASK_B
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Verify dependency was created
    const blockerIds = await Effect.runPromise(
      Effect.gen(function* () {
        const depRepo = yield* DependencyRepository
        return yield* depRepo.getBlockerIds(SYNC_FIXTURES.SYNC_TASK_B)
      }).pipe(Effect.provide(layer))
    )

    expect(blockerIds).toContain(SYNC_FIXTURES.SYNC_TASK_A)
  })

  it("validates JSONL schema and rejects invalid operations", async () => {
    const invalidJsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: "not-a-valid-timestamp",
      id: "invalid-id-format",
      data: { title: "Test" }
    })
    writeFileSync(tempPath, invalidJsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })

  it("handles multiple operations for same entity (later timestamp wins)", async () => {
    const earlier = "2024-01-01T00:00:00.000Z"
    const later = "2024-01-02T00:00:00.000Z"

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: earlier,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Old Title", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: later,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "New Title", description: "", status: "ready", score: 200, parentId: null, metadata: {} }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(SYNC_FIXTURES.SYNC_TASK_A)
      }).pipe(Effect.provide(layer))
    )

    // Later timestamp should win
    expect(task.title).toBe("New Title")
    expect(task.status).toBe("ready")
    expect(task.score).toBe(200)
  })
})

// -----------------------------------------------------------------------------
// Round-Trip Tests
// -----------------------------------------------------------------------------

/**
 * Seed fixtures with sequential timestamps to ensure proper import order.
 * Parents must have earlier timestamps than children to satisfy FK constraints.
 */
function seedFixturesWithSequentialTimestamps(db: InstanceType<typeof Database>): void {
  const baseTime = new Date("2024-01-01T00:00:00.000Z")
  const insert = db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const insertDep = db.prepare(
    `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
  )

  // Insert in order: parents before children, with increasing timestamps
  // Level 0: ROOT (no parent) - t=0
  const t0 = new Date(baseTime.getTime()).toISOString()
  insert.run(FIXTURES.TASK_ROOT, "Root project", "The root task", "backlog", null, 1000, t0, t0, null, "{}")

  // Level 1: AUTH (parent: ROOT) - t=1
  const t1 = new Date(baseTime.getTime() + 1000).toISOString()
  insert.run(FIXTURES.TASK_AUTH, "Implement auth", "Authentication system", "backlog", FIXTURES.TASK_ROOT, 800, t1, t1, null, "{}")

  // Level 2: All children of AUTH - t=2, t=3, t=4, t=5
  const t2 = new Date(baseTime.getTime() + 2000).toISOString()
  insert.run(FIXTURES.TASK_LOGIN, "Login page", "Build login UI", "ready", FIXTURES.TASK_AUTH, 600, t2, t2, null, "{}")

  const t3 = new Date(baseTime.getTime() + 3000).toISOString()
  insert.run(FIXTURES.TASK_JWT, "JWT validation", "Validate JWT tokens", "ready", FIXTURES.TASK_AUTH, 700, t3, t3, null, "{}")

  const t4 = new Date(baseTime.getTime() + 4000).toISOString()
  insert.run(FIXTURES.TASK_BLOCKED, "Integration tests", "Test everything", "backlog", FIXTURES.TASK_AUTH, 500, t4, t4, null, "{}")

  const t5 = new Date(baseTime.getTime() + 5000).toISOString()
  insert.run(FIXTURES.TASK_DONE, "Setup project", "Initial setup", "done", FIXTURES.TASK_AUTH, 900, t5, t5, t5, "{}")

  // Dependencies - must be after tasks exist - t=6
  const t6 = new Date(baseTime.getTime() + 6000).toISOString()
  insertDep.run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, t6)
  insertDep.run(FIXTURES.TASK_LOGIN, FIXTURES.TASK_BLOCKED, t6)
}

describe("SyncService Round-Trip", () => {
  let sourceDb: InstanceType<typeof Database>
  let targetDb: InstanceType<typeof Database>
  let sourceLayer: ReturnType<typeof makeTestLayer>
  let targetLayer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeEach(() => {
    sourceDb = createTestDb()
    // Use sequential timestamps to ensure proper import order
    seedFixturesWithSequentialTimestamps(sourceDb)
    sourceLayer = makeTestLayer(sourceDb)

    targetDb = createTestDb()
    targetLayer = makeTestLayer(targetDb)

    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("preserves all tasks through export → import cycle", async () => {
    // Export from source
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import to target
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(targetLayer))
    )

    expect(result.imported).toBe(6) // 6 tasks

    // Verify all tasks exist in target
    const targetTasks = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.list()
      }).pipe(Effect.provide(targetLayer))
    )

    expect(targetTasks).toHaveLength(6)
    const ids = targetTasks.map(t => t.id)
    expect(ids).toContain(FIXTURES.TASK_ROOT)
    expect(ids).toContain(FIXTURES.TASK_AUTH)
    expect(ids).toContain(FIXTURES.TASK_LOGIN)
    expect(ids).toContain(FIXTURES.TASK_JWT)
    expect(ids).toContain(FIXTURES.TASK_BLOCKED)
    expect(ids).toContain(FIXTURES.TASK_DONE)
  })

  it("preserves task data (title, description, status, score) through round-trip", async () => {
    // Export from source
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import to target
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(targetLayer))
    )

    // Compare specific task data
    const [sourceJwt, targetJwt] = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          return yield* taskSvc.get(FIXTURES.TASK_JWT)
        }).pipe(Effect.provide(sourceLayer))
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          return yield* taskSvc.get(FIXTURES.TASK_JWT)
        }).pipe(Effect.provide(targetLayer))
      )
    ])

    expect(targetJwt.title).toBe(sourceJwt.title)
    expect(targetJwt.description).toBe(sourceJwt.description)
    expect(targetJwt.status).toBe(sourceJwt.status)
    expect(targetJwt.score).toBe(sourceJwt.score)
  })

  it("preserves task hierarchy (parent-child relationships) through round-trip", async () => {
    // Export from source
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import to target
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(targetLayer))
    )

    // Verify hierarchy
    const targetJwt = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(targetLayer))
    )

    expect(targetJwt.parentId).toBe(FIXTURES.TASK_AUTH)

    const targetAuth = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(targetLayer))
    )

    expect(targetAuth.parentId).toBe(FIXTURES.TASK_ROOT)
  })

  it("preserves dependencies through round-trip", async () => {
    // Export from source
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import to target
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(targetLayer))
    )

    // Verify dependencies
    const blockerIds = await Effect.runPromise(
      Effect.gen(function* () {
        const depRepo = yield* DependencyRepository
        return yield* depRepo.getBlockerIds(FIXTURES.TASK_BLOCKED)
      }).pipe(Effect.provide(targetLayer))
    )

    expect(blockerIds).toHaveLength(2)
    expect(blockerIds).toContain(FIXTURES.TASK_JWT)
    expect(blockerIds).toContain(FIXTURES.TASK_LOGIN)
  })

  it("preserves TaskWithDeps information after round-trip", async () => {
    // Export from source
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(sourceLayer))
    )

    // Import to target
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(targetLayer))
    )

    // Verify TaskWithDeps info is correct on target
    const [sourceBlocked, targetBlocked] = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          return yield* taskSvc.getWithDeps(FIXTURES.TASK_BLOCKED)
        }).pipe(Effect.provide(sourceLayer))
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          return yield* taskSvc.getWithDeps(FIXTURES.TASK_BLOCKED)
        }).pipe(Effect.provide(targetLayer))
      )
    ])

    // blockedBy should match
    expect(targetBlocked.blockedBy.sort()).toEqual(sourceBlocked.blockedBy.sort())
    // isReady should match
    expect(targetBlocked.isReady).toBe(sourceBlocked.isReady)
  })
})

// -----------------------------------------------------------------------------
// Conflict Resolution Tests
// -----------------------------------------------------------------------------

describe("SyncService Conflict Resolution", () => {
  let db: InstanceType<typeof Database>
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

  it("updates existing task when JSONL timestamp is newer", async () => {
    // Create a task with old timestamp
    const oldTs = "2024-01-01T00:00:00.000Z"
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Old Title", "", "backlog", 100, null, oldTs, oldTs, null, "{}")

    // Import with newer timestamp
    const newTs = "2024-01-02T00:00:00.000Z"
    const jsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: newTs,
      id: SYNC_FIXTURES.SYNC_TASK_A,
      data: { title: "New Title", description: "Updated", status: "ready", score: 200, parentId: null, metadata: {} }
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.conflicts).toBe(0)

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(SYNC_FIXTURES.SYNC_TASK_A)
      }).pipe(Effect.provide(layer))
    )

    expect(task.title).toBe("New Title")
    expect(task.description).toBe("Updated")
    expect(task.status).toBe("ready")
    expect(task.score).toBe(200)
  })

  it("reports conflict when local timestamp is newer than JSONL", async () => {
    // Create a task with new timestamp
    const newTs = "2024-01-02T00:00:00.000Z"
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Local Title", "", "ready", 200, null, newTs, newTs, null, "{}")

    // Import with older timestamp
    const oldTs = "2024-01-01T00:00:00.000Z"
    const jsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: oldTs,
      id: SYNC_FIXTURES.SYNC_TASK_A,
      data: { title: "Old Title", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.conflicts).toBe(1)

    // Local task should be unchanged
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(SYNC_FIXTURES.SYNC_TASK_A)
      }).pipe(Effect.provide(layer))
    )

    expect(task.title).toBe("Local Title")
    expect(task.status).toBe("ready")
  })

  it("skips when timestamps are identical", async () => {
    // Create a task with exact timestamp
    const ts = "2024-01-01T00:00:00.000Z"
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Same Title", "", "backlog", 100, null, ts, ts, null, "{}")

    // Import with same timestamp
    const jsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: ts,
      id: SYNC_FIXTURES.SYNC_TASK_A,
      data: { title: "Same Title", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.conflicts).toBe(0)
  })
})

// -----------------------------------------------------------------------------
// Status Tests
// -----------------------------------------------------------------------------

describe("SyncService Status", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("reports correct task count from database", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.dbTaskCount).toBe(6) // 6 seeded tasks
  })

  it("reports isDirty: true when JSONL file does not exist", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.isDirty).toBe(true)
  })

  it("reports correct operation count from JSONL file", async () => {
    // Export first
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Recreate layer pointing to temp path for status check
    // (status checks default path, so we write to that)
    const defaultPath = ".tx/tasks.jsonl"
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(defaultPath)
      }).pipe(Effect.provide(layer))
    )

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.jsonlOpCount).toBe(8) // 6 tasks + 2 deps

    // Cleanup default path
    cleanupTempFile(defaultPath)
  })
})

// -----------------------------------------------------------------------------
// Delete Operation Tests
// -----------------------------------------------------------------------------

describe("SyncService Delete Operations", () => {
  let db: InstanceType<typeof Database>
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

  it("handles delete operation to remove existing task", async () => {
    // First create a task
    const createTs = "2024-01-01T00:00:00.000Z"
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "To Delete", "", "backlog", 100, null, createTs, createTs, null, "{}")

    // Import delete operation
    const deleteTs = "2024-01-02T00:00:00.000Z"
    const jsonl = JSON.stringify({
      v: 1,
      op: "delete",
      ts: deleteTs,
      id: SYNC_FIXTURES.SYNC_TASK_A
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1) // Delete counts as imported

    // Verify task was deleted
    const getResult = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(SYNC_FIXTURES.SYNC_TASK_A)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(getResult._tag).toBe("Left")
  })

  it("handles dep_remove operation", async () => {
    // Create tasks and dependency
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Task A", "", "ready", 100, null, now, now, null, "{}")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_B, "Task B", "", "backlog", 50, null, now, now, null, "{}")
    db.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, SYNC_FIXTURES.SYNC_TASK_B, now)

    // Import dep_remove operation
    const removeTs = new Date(Date.now() + 1000).toISOString()
    const jsonl = JSON.stringify({
      v: 1,
      op: "dep_remove",
      ts: removeTs,
      blockerId: SYNC_FIXTURES.SYNC_TASK_A,
      blockedId: SYNC_FIXTURES.SYNC_TASK_B
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Verify dependency was removed
    const blockerIds = await Effect.runPromise(
      Effect.gen(function* () {
        const depRepo = yield* DependencyRepository
        return yield* depRepo.getBlockerIds(SYNC_FIXTURES.SYNC_TASK_B)
      }).pipe(Effect.provide(layer))
    )

    expect(blockerIds).not.toContain(SYNC_FIXTURES.SYNC_TASK_A)
  })

  it("last operation wins for same dependency (add then remove)", async () => {
    // Create tasks
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Task A", "", "ready", 100, null, now, now, null, "{}")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_B, "Task B", "", "backlog", 50, null, now, now, null, "{}")

    // Import add then remove (remove has later timestamp)
    const addTs = "2024-01-01T00:00:00.000Z"
    const removeTs = "2024-01-02T00:00:00.000Z"
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "dep_add",
        ts: addTs,
        blockerId: SYNC_FIXTURES.SYNC_TASK_A,
        blockedId: SYNC_FIXTURES.SYNC_TASK_B
      }),
      JSON.stringify({
        v: 1,
        op: "dep_remove",
        ts: removeTs,
        blockerId: SYNC_FIXTURES.SYNC_TASK_A,
        blockedId: SYNC_FIXTURES.SYNC_TASK_B
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Dependency should NOT exist (remove was later)
    const blockerIds = await Effect.runPromise(
      Effect.gen(function* () {
        const depRepo = yield* DependencyRepository
        return yield* depRepo.getBlockerIds(SYNC_FIXTURES.SYNC_TASK_B)
      }).pipe(Effect.provide(layer))
    )

    expect(blockerIds).not.toContain(SYNC_FIXTURES.SYNC_TASK_A)
  })
})
