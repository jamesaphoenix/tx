/**
 * Sync Service Integration Tests
 *
 * Tests the JSONL sync service for round-trip export/import functionality.
 * Verifies that tasks and dependencies can be exported to JSONL and
 * re-imported correctly with proper conflict resolution.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { existsSync, unlinkSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
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
  ReadyServiceLive,
  HierarchyServiceLive,
  SyncServiceLive,
  SyncService,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"

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
  // Build base services first (SyncServiceLive depends on TaskService)
  const baseServices = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, AutoSyncServiceNoop))
  )
  // Build SyncService on top of base services
  const syncService = SyncServiceLive.pipe(
    Layer.provide(Layer.mergeAll(baseServices, repos, infra))
  )
  // Return all services and repos (for DependencyRepository access in tests)
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
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
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
      expect(op.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
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
      expect(op.blockerId).toMatch(/^tx-[a-z0-9]{6,12}$/)
      expect(op.blockedId).toMatch(/^tx-[a-z0-9]{6,12}$/)
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
    const emptyShared = await createSharedTestLayer()
    const emptyLayer = makeTestLayer(emptyShared.getDb())

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

    await emptyShared.close()
  })
})

// -----------------------------------------------------------------------------
// Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
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

  it("imports parent-child tasks correctly when child has earlier timestamp than parent", async () => {
    // This is the critical test case: child timestamp < parent timestamp
    // Without topological sorting, this would fail with foreign key constraint error
    const childTs = "2024-01-01T00:00:00.000Z"  // Earlier
    const parentTs = "2024-01-02T00:00:00.000Z" // Later

    const parentId = fixtureId("topo-parent")
    const childId = fixtureId("topo-child")

    // JSONL with child operation first (simulating timestamp order)
    const jsonl = [
      // Child has earlier timestamp - would be processed first without topo sort
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: childTs,
        id: childId,
        data: {
          title: "Child Task",
          description: "I have an earlier timestamp",
          status: "backlog",
          score: 50,
          parentId: parentId,  // References parent that hasn't been imported yet
          metadata: {}
        }
      }),
      // Parent has later timestamp - would be processed second without topo sort
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: parentTs,
        id: parentId,
        data: {
          title: "Parent Task",
          description: "I have a later timestamp",
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {}
        }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // This should succeed with topological sorting
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Both tasks should be imported
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.conflicts).toBe(0)

    // Verify both tasks exist and have correct parent-child relationship
    const [parent, child] = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          return yield* taskSvc.get(parentId)
        }).pipe(Effect.provide(layer))
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          return yield* taskSvc.get(childId)
        }).pipe(Effect.provide(layer))
      )
    ])

    expect(parent.id).toBe(parentId)
    expect(parent.title).toBe("Parent Task")
    expect(parent.parentId).toBeNull()

    expect(child.id).toBe(childId)
    expect(child.title).toBe("Child Task")
    expect(child.parentId).toBe(parentId)
  })

  it("imports deeply nested hierarchy when timestamps are reversed", async () => {
    // Test with 3 levels: grandparent -> parent -> child
    // With timestamps in reverse order (child earliest, grandparent latest)
    const grandchildTs = "2024-01-01T00:00:00.000Z"
    const childTs = "2024-01-02T00:00:00.000Z"
    const parentTs = "2024-01-03T00:00:00.000Z"

    const grandparentId = fixtureId("topo-gp")
    const parentId = fixtureId("topo-p")
    const grandchildId = fixtureId("topo-gc")

    // JSONL ordered by timestamp (wrong order for FK constraints)
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: grandchildTs,
        id: grandchildId,
        data: { title: "Grandchild", description: "", status: "backlog", score: 25, parentId: parentId, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: childTs,
        id: parentId,
        data: { title: "Parent", description: "", status: "backlog", score: 50, parentId: grandparentId, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: parentTs,
        id: grandparentId,
        data: { title: "Grandparent", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // All three tasks should be imported
    expect(result.imported).toBe(3)

    // Verify hierarchy
    const grandchild = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(grandchildId)
      }).pipe(Effect.provide(layer))
    )

    expect(grandchild.parentId).toBe(parentId)

    const parent = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(parentId)
      }).pipe(Effect.provide(layer))
    )

    expect(parent.parentId).toBe(grandparentId)
  })

  it("nullifies orphaned parentId references instead of failing with FK violation", async () => {
    // Task references a parent that doesn't exist in DB and isn't in the import set
    const ts = "2024-01-01T00:00:00.000Z"
    const orphanedParentRef = fixtureId("nonexistent-parent")
    const childId = fixtureId("orphan-child")

    const jsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts,
      id: childId,
      data: {
        title: "Orphaned Child",
        description: "My parent doesn't exist",
        status: "backlog",
        score: 50,
        parentId: orphanedParentRef,
        metadata: {}
      }
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Should succeed (not throw FK violation)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)

    // Verify the task was imported with parentId set to null
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(childId)
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toBe(childId)
    expect(task.title).toBe("Orphaned Child")
    expect(task.parentId).toBeNull()
  })

  it("nullifies orphaned parentId on update when parent no longer exists", async () => {
    // First, create a task in the DB with no parent
    const createTs = "2024-01-01T00:00:00.000Z"
    const updateTs = "2024-01-02T00:00:00.000Z"
    const taskId = fixtureId("orphan-update")
    const missingParent = fixtureId("missing-parent")

    // Create the task first
    const createJsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: createTs,
      id: taskId,
      data: { title: "Task", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
    })
    writeFileSync(tempPath, createJsonl + "\n", "utf-8")

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Now update referencing a non-existent parent
    const updateJsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: updateTs,
      id: taskId,
      data: { title: "Task Updated", description: "", status: "ready", score: 100, parentId: missingParent, metadata: {} }
    })
    writeFileSync(tempPath, updateJsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)

    // Verify updated with null parent
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        return yield* taskSvc.get(taskId)
      }).pipe(Effect.provide(layer))
    )

    expect(task.title).toBe("Task Updated")
    expect(task.parentId).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// Round-Trip Tests
// -----------------------------------------------------------------------------

/**
 * Seed fixtures with sequential timestamps to ensure proper import order.
 * Parents must have earlier timestamps than children to satisfy FK constraints.
 */
function seedFixturesWithSequentialTimestamps(db: Database): void {
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
  let sourceShared: SharedTestLayerResult
  let targetShared: SharedTestLayerResult
  let sourceDb: Database
  let targetDb: Database
  let sourceLayer: ReturnType<typeof makeTestLayer>
  let targetLayer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    sourceShared = await createSharedTestLayer()
    targetShared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    sourceDb = sourceShared.getDb()
    // Use sequential timestamps to ensure proper import order
    seedFixturesWithSequentialTimestamps(sourceDb)
    sourceLayer = makeTestLayer(sourceDb)

    targetDb = targetShared.getDb()
    targetLayer = makeTestLayer(targetDb)

    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await sourceShared.reset()
    await targetShared.reset()
  })

  afterAll(async () => {
    await sourceShared.close()
    await targetShared.close()
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
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
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
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
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

  it("reports isDirty: true when dependencies are added after export", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // Export current state
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(defaultPath)
      }).pipe(Effect.provide(layer))
    )

    // Verify clean after export
    const statusBefore = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )
    expect(statusBefore.isDirty).toBe(false)

    // Wait a small amount to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10))

    // Add a new dependency (between two existing tasks that don't have a dependency)
    await Effect.runPromise(
      Effect.gen(function* () {
        const depRepo = yield* DependencyRepository
        // Add dep: TASK_DONE blocks TASK_ROOT (not in the original fixtures)
        yield* depRepo.insert(FIXTURES.TASK_DONE, FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    // Check that status now reports dirty
    const statusAfter = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )
    expect(statusAfter.isDirty).toBe(true)

    // Cleanup default path
    cleanupTempFile(defaultPath)
  })

  it("reports isDirty: false when no changes after export", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // Export current state
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(defaultPath)
      }).pipe(Effect.provide(layer))
    )

    // Check that status reports not dirty
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )
    expect(status.isDirty).toBe(false)

    // Cleanup default path
    cleanupTempFile(defaultPath)
  })

  it("reports isDirty: true when task is deleted after export", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // Export current state (6 tasks)
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(defaultPath)
      }).pipe(Effect.provide(layer))
    )

    // Verify clean after export
    const statusBefore = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )
    expect(statusBefore.isDirty).toBe(false)
    expect(statusBefore.dbTaskCount).toBe(6)

    // Delete a task directly in the database
    // Use TASK_DONE since it has no children or dependencies blocking other tasks
    db.prepare("DELETE FROM tasks WHERE id = ?").run(FIXTURES.TASK_DONE)

    // Check that status now reports dirty (5 tasks in DB, 6 in JSONL)
    const statusAfter = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )
    expect(statusAfter.isDirty).toBe(true)
    expect(statusAfter.dbTaskCount).toBe(5)

    // Cleanup default path
    cleanupTempFile(defaultPath)
  })

  it("reports isDirty: true when dependency is removed after export", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // Export current state (2 dependencies)
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(defaultPath)
      }).pipe(Effect.provide(layer))
    )

    // Verify clean after export
    const statusBefore = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )
    expect(statusBefore.isDirty).toBe(false)

    // Remove a dependency directly in the database
    // JWT -> BLOCKED is one of the fixture dependencies
    db.prepare("DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?")
      .run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED)

    // Check that status now reports dirty (1 dep in DB, 2 in JSONL)
    const statusAfter = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )
    expect(statusAfter.isDirty).toBe(true)

    // Cleanup default path
    cleanupTempFile(defaultPath)
  })
})

// -----------------------------------------------------------------------------
// Status Dirty Detection Edge Cases (Requires Fresh DB without fixtures)
// -----------------------------------------------------------------------------

describe("SyncService Status Dirty Detection Edge Cases", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    // Fresh DB WITHOUT fixtures - these tests need precise control over data
    db = shared.getDb()
    layer = makeTestLayer(db)
  })

  afterEach(async () => {
    cleanupTempFile(".tx/tasks.jsonl")
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("reports isDirty: false when JSONL has duplicate upserts for same task (git merge scenario)", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // Timestamps: DB task must have timestamp <= lastExport to avoid timestamp-based dirty detection
    const earlier = "2024-01-01T00:00:00.000Z"
    const later = "2024-01-02T00:00:00.000Z"
    const exportTs = "2024-01-03T00:00:00.000Z"

    // Create a single task in DB with timestamp BEFORE lastExport
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Task A", "", "ready", 100, null, later, later, null, "{}")

    // Manually create a JSONL file with DUPLICATE upserts for the same task (simulating git merge)
    // This was the bug: raw counting would give jsonlTaskCount=2 vs dbTaskCount=1 → false positive
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: earlier,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A (old)", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: later,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      })
    ].join("\n")
    writeFileSync(defaultPath, jsonl + "\n", "utf-8")

    // Set last export to after the latest operation
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.setLastExport(new Date(exportTs))
      }).pipe(Effect.provide(layer))
    )

    // Status should NOT report dirty - the effective count is 1 task in JSONL, matching 1 in DB
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.dbTaskCount).toBe(1)
    expect(status.isDirty).toBe(false) // Should NOT be a false positive

    // Cleanup
    cleanupTempFile(defaultPath)
  })

  it("reports isDirty: false when JSONL has task created then deleted", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // DB is empty (no tasks)

    // JSONL has a task that was created then deleted (delete has later timestamp)
    // Effective count should be 0 tasks
    const createTs = "2024-01-01T00:00:00.000Z"
    const deleteTs = "2024-01-02T00:00:00.000Z"
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: createTs,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "delete",
        ts: deleteTs,
        id: SYNC_FIXTURES.SYNC_TASK_A
      })
    ].join("\n")
    writeFileSync(defaultPath, jsonl + "\n", "utf-8")

    // Set last export to after the delete
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.setLastExport(new Date("2024-01-03T00:00:00.000Z"))
      }).pipe(Effect.provide(layer))
    )

    // Status should NOT report dirty - effective count is 0 in JSONL, 0 in DB
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.dbTaskCount).toBe(0)
    expect(status.isDirty).toBe(false)

    // Cleanup
    cleanupTempFile(defaultPath)
  })

  it("reports isDirty: false when JSONL has dep_add then dep_remove", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // Timestamps: DB tasks must have timestamp <= lastExport to avoid timestamp-based dirty detection
    const baseTs = "2024-01-01T00:00:00.000Z"
    const removeTs = "2024-01-02T00:00:00.000Z"
    const exportTs = "2024-01-03T00:00:00.000Z"

    // Create two tasks in DB with no dependency between them (timestamp before lastExport)
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Task A", "", "ready", 100, null, baseTs, baseTs, null, "{}")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_B, "Task B", "", "backlog", 50, null, baseTs, baseTs, null, "{}")

    // JSONL has dep added then removed (remove has later timestamp)
    // Effective count should be 0 deps
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: baseTs,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: baseTs,
        id: SYNC_FIXTURES.SYNC_TASK_B,
        data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "dep_add",
        ts: baseTs,
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
    writeFileSync(defaultPath, jsonl + "\n", "utf-8")

    // Set last export to after the remove
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.setLastExport(new Date(exportTs))
      }).pipe(Effect.provide(layer))
    )

    // Status should NOT report dirty - effective count is 0 deps in JSONL, 0 in DB
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.dbTaskCount).toBe(2)
    expect(status.isDirty).toBe(false) // 0 deps in DB matches 0 effective deps in JSONL

    // Cleanup
    cleanupTempFile(defaultPath)
  })

  it("reports isDirty: true when JSONL effective count differs from DB count", async () => {
    const defaultPath = ".tx/tasks.jsonl"

    // Timestamps: DB tasks have timestamp <= lastExport so only count mismatch triggers dirty
    const baseTs = "2024-01-01T00:00:00.000Z"
    const exportTs = "2024-01-03T00:00:00.000Z"

    // Create two tasks in DB (timestamp before lastExport)
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Task A", "", "ready", 100, null, baseTs, baseTs, null, "{}")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_B, "Task B", "", "backlog", 50, null, baseTs, baseTs, null, "{}")

    // JSONL has only one task (Task A is not in JSONL - simulating out-of-sync state)
    const jsonl = JSON.stringify({
      v: 1,
      op: "upsert",
      ts: baseTs,
      id: SYNC_FIXTURES.SYNC_TASK_B,
      data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
    })
    writeFileSync(defaultPath, jsonl + "\n", "utf-8")

    // Set last export to after the operations
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.setLastExport(new Date(exportTs))
      }).pipe(Effect.provide(layer))
    )

    // Status SHOULD report dirty - 2 tasks in DB but only 1 in JSONL (count mismatch)
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.dbTaskCount).toBe(2)
    expect(status.isDirty).toBe(true) // Real mismatch detected

    // Cleanup
    cleanupTempFile(defaultPath)
  })
})

// -----------------------------------------------------------------------------
// Delete Operation Tests
// -----------------------------------------------------------------------------

describe("SyncService Delete Operations", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
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

// -----------------------------------------------------------------------------
// Dependency Import Statistics Tests
// -----------------------------------------------------------------------------

describe("SyncService Dependency Import Statistics", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns dependency statistics in ImportResult", async () => {
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

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(2)
    expect(result.dependencies).toBeDefined()
    expect(result.dependencies.added).toBe(1)
    expect(result.dependencies.removed).toBe(0)
    expect(result.dependencies.skipped).toBe(0)
    expect(result.dependencies.failures).toHaveLength(0)
  })

  it("tracks skipped dependencies when already exists", async () => {
    // Create tasks and existing dependency
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

    // Import the same dependency again
    const jsonl = JSON.stringify({
      v: 1,
      op: "dep_add",
      ts: now,
      blockerId: SYNC_FIXTURES.SYNC_TASK_A,
      blockedId: SYNC_FIXTURES.SYNC_TASK_B
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.dependencies.added).toBe(0)
    expect(result.dependencies.skipped).toBe(1)
    expect(result.dependencies.failures).toHaveLength(0)
  })

  it("tracks removed dependencies", async () => {
    // Create tasks and existing dependency
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

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.dependencies.added).toBe(0)
    expect(result.dependencies.removed).toBe(1)
    expect(result.dependencies.skipped).toBe(0)
    expect(result.dependencies.failures).toHaveLength(0)
  })

  it("tracks skipped dep_remove when dependency does not exist", async () => {
    // Create tasks but no dependency
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Task A", "", "ready", 100, null, now, now, null, "{}")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_B, "Task B", "", "backlog", 50, null, now, now, null, "{}")

    // Import dep_remove for non-existent dependency
    const jsonl = JSON.stringify({
      v: 1,
      op: "dep_remove",
      ts: now,
      blockerId: SYNC_FIXTURES.SYNC_TASK_A,
      blockedId: SYNC_FIXTURES.SYNC_TASK_B
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.dependencies.removed).toBe(0)
    expect(result.dependencies.skipped).toBe(1)
    expect(result.dependencies.failures).toHaveLength(0)
  })

  it("rolls back entire import when dependency insert fails", async () => {
    // Create only Task A, not Task B
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(SYNC_FIXTURES.SYNC_TASK_A, "Task A", "", "ready", 100, null, now, now, null, "{}")

    // Try to import dependency to non-existent task
    const jsonl = JSON.stringify({
      v: 1,
      op: "dep_add",
      ts: now,
      blockerId: SYNC_FIXTURES.SYNC_TASK_A,
      blockedId: SYNC_FIXTURES.SYNC_TASK_B // This task doesn't exist
    })
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Import should fail with DatabaseError and rollback
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = exit.cause
      // The error should be a DatabaseError wrapping the dep failure details
      expect(String(error)).toContain("dependency failure")
    }
  })

  it("returns zero dependencies for missing file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import("/nonexistent/path/file.jsonl")
      }).pipe(Effect.provide(layer))
    )

    expect(result.dependencies).toBeDefined()
    expect(result.dependencies.added).toBe(0)
    expect(result.dependencies.removed).toBe(0)
    expect(result.dependencies.skipped).toBe(0)
    expect(result.dependencies.failures).toHaveLength(0)
  })

  it("returns zero dependencies for empty file", async () => {
    writeFileSync(tempPath, "", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.dependencies).toBeDefined()
    expect(result.dependencies.added).toBe(0)
    expect(result.dependencies.removed).toBe(0)
    expect(result.dependencies.skipped).toBe(0)
    expect(result.dependencies.failures).toHaveLength(0)
  })
})

// -----------------------------------------------------------------------------
// Auto-Sync Tests
// -----------------------------------------------------------------------------

describe("SyncService Auto-Sync", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("auto-sync is disabled by default", async () => {
    const enabled = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.isAutoSyncEnabled()
      }).pipe(Effect.provide(layer))
    )

    expect(enabled).toBe(false)
  })

  it("can enable auto-sync", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.enableAutoSync()
      }).pipe(Effect.provide(layer))
    )

    const enabled = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.isAutoSyncEnabled()
      }).pipe(Effect.provide(layer))
    )

    expect(enabled).toBe(true)
  })

  it("can disable auto-sync after enabling", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.enableAutoSync()
        yield* sync.disableAutoSync()
      }).pipe(Effect.provide(layer))
    )

    const enabled = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.isAutoSyncEnabled()
      }).pipe(Effect.provide(layer))
    )

    expect(enabled).toBe(false)
  })

  it("status includes autoSyncEnabled field", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.enableAutoSync()
      }).pipe(Effect.provide(layer))
    )

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.status()
      }).pipe(Effect.provide(layer))
    )

    expect(status.autoSyncEnabled).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Compact Tests
// -----------------------------------------------------------------------------

describe("SyncService Compact", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns zero counts for missing file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.compact("/nonexistent/path/file.jsonl")
      }).pipe(Effect.provide(layer))
    )

    expect(result.before).toBe(0)
    expect(result.after).toBe(0)
  })

  it("compacts duplicate upserts for same task (keeps latest)", async () => {
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

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.compact(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.before).toBe(2)
    expect(result.after).toBe(1)

    // Verify compacted content has the newer version
    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(1)

    const op = JSON.parse(lines[0])
    expect(op.data.title).toBe("New Title")
    expect(op.ts).toBe(later)
  })

  it("removes deleted tasks (tombstones) from compacted output", async () => {
    const createTs = "2024-01-01T00:00:00.000Z"
    const deleteTs = "2024-01-02T00:00:00.000Z"

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: createTs,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "delete",
        ts: deleteTs,
        id: SYNC_FIXTURES.SYNC_TASK_A
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.compact(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.before).toBe(2)
    expect(result.after).toBe(0)

    // Verify file is empty (deleted task is removed)
    const content = readFileSync(tempPath, "utf-8")
    expect(content.trim()).toBe("")
  })

  it("removes removed dependencies from compacted output", async () => {
    const addTs = "2024-01-01T00:00:00.000Z"
    const removeTs = "2024-01-02T00:00:00.000Z"

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: addTs,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts: addTs,
        id: SYNC_FIXTURES.SYNC_TASK_B,
        data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
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

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.compact(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.before).toBe(4)
    expect(result.after).toBe(2) // Only 2 task upserts remain

    // Verify no dep_add operations remain
    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)
    const ops = lines.map(line => JSON.parse(line))
    const depOps = ops.filter(op => op.op === "dep_add" || op.op === "dep_remove")
    expect(depOps).toHaveLength(0)
  })

  it("preserves active dependencies in compacted output", async () => {
    const ts = "2024-01-01T00:00:00.000Z"

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: SYNC_FIXTURES.SYNC_TASK_A,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: SYNC_FIXTURES.SYNC_TASK_B,
        data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "dep_add",
        ts,
        blockerId: SYNC_FIXTURES.SYNC_TASK_A,
        blockedId: SYNC_FIXTURES.SYNC_TASK_B
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.compact(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.before).toBe(3)
    expect(result.after).toBe(3) // All preserved

    // Verify dep_add is preserved
    const content = readFileSync(tempPath, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)
    const ops = lines.map(line => JSON.parse(line))
    const depOps = ops.filter(op => op.op === "dep_add")
    expect(depOps).toHaveLength(1)
  })
})

// -----------------------------------------------------------------------------
// Transaction Atomicity Tests
// -----------------------------------------------------------------------------

describe("SyncService Import Transaction Atomicity", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("nullifies orphaned parentId instead of causing FK violation rollback", async () => {
    // When a task references a parentId that doesn't exist in DB or import set,
    // the import should still succeed with parentId set to null.

    const ts = "2024-01-01T00:00:00.000Z"
    const validTaskId = fixtureId("tx-valid-task")
    const invalidParentTaskId = fixtureId("tx-child-bad-parent")
    const nonExistentParentId = fixtureId("tx-nonexistent")

    // JSONL with two tasks:
    // 1. A valid task with no parent
    // 2. A task with a parentId that doesn't exist in the import or database
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: validTaskId,
        data: { title: "Valid Task", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: invalidParentTaskId,
        data: {
          title: "Task with Invalid Parent",
          description: "",
          status: "backlog",
          score: 50,
          parentId: nonExistentParentId, // This parent doesn't exist!
          metadata: {}
        }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Count tasks before import
    const countBefore = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(countBefore.count).toBe(0)

    // Import should succeed - orphaned parentId is nullified instead of causing FK violation
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(2)

    // Both tasks should be imported
    const countAfter = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(countAfter.count).toBe(2)

    // The task with the invalid parent should have parentId set to null
    const badParentTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(invalidParentTaskId) as { parent_id: string | null } | undefined
    expect(badParentTask).toBeDefined()
    expect(badParentTask?.parent_id).toBeNull()
  })

  it("imports tasks and dependencies even when one task has orphaned parent", async () => {
    // All tasks and dependencies should import successfully, with the
    // orphaned parentId nullified instead of causing a rollback

    const ts = "2024-01-01T00:00:00.000Z"
    const taskA = fixtureId("tx-rollback-a")
    const taskB = fixtureId("tx-rollback-b")
    const taskWithBadParent = fixtureId("tx-rollback-bad")
    const nonExistentParent = fixtureId("tx-rollback-ghost")

    // JSONL with three tasks and a dependency:
    // 1. Task A (valid)
    // 2. Task B (valid)
    // 3. Dependency: A -> B
    // 4. Task with invalid parent (will cause FK violation)
    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskA,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskB,
        data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "dep_add",
        ts,
        blockerId: taskA,
        blockedId: taskB
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskWithBadParent,
        data: {
          title: "Bad Parent Task",
          description: "",
          status: "backlog",
          score: 25,
          parentId: nonExistentParent,
          metadata: {}
        }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Count before
    const taskCountBefore = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    const depCountBefore = db.prepare("SELECT COUNT(*) as count FROM task_dependencies").get() as { count: number }
    expect(taskCountBefore.count).toBe(0)
    expect(depCountBefore.count).toBe(0)

    // Import should succeed - orphaned parentId is nullified
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // All 3 tasks imported, 1 dependency added
    expect(result.imported).toBe(3)
    expect(result.dependencies.added).toBe(1)

    const taskCountAfter = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    const depCountAfter = db.prepare("SELECT COUNT(*) as count FROM task_dependencies").get() as { count: number }
    expect(taskCountAfter.count).toBe(3)
    expect(depCountAfter.count).toBe(1)

    // The task with bad parent should have null parentId
    const badTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskWithBadParent) as { parent_id: string | null } | undefined
    expect(badTask?.parent_id).toBeNull()
  })

  it("does not roll back on successful import", async () => {
    // Verify that successful imports actually persist
    const ts = "2024-01-01T00:00:00.000Z"
    const taskA = fixtureId("tx-success-a")
    const taskB = fixtureId("tx-success-b")

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskA,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskB,
        data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "dep_add",
        ts,
        blockerId: taskA,
        blockedId: taskB
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(2)

    // Verify data persisted
    const taskCount = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    const depCount = db.prepare("SELECT COUNT(*) as count FROM task_dependencies").get() as { count: number }
    expect(taskCount.count).toBe(2)
    expect(depCount.count).toBe(1)
  })

  it("preserves existing data and imports new tasks with orphaned parents nullified", async () => {
    // First, add some existing data
    const existingTs = "2024-01-01T00:00:00.000Z"
    const existingTask = fixtureId("tx-existing")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, parent_id, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(existingTask, "Existing Task", "", "ready", 100, null, existingTs, existingTs, null, "{}")

    // Now try to import with a bad task
    const ts = "2024-01-02T00:00:00.000Z"
    const newTask = fixtureId("tx-new-task")
    const badTask = fixtureId("tx-bad-import")
    const ghostParent = fixtureId("tx-ghost-parent")

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: newTask,
        data: { title: "New Task", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: badTask,
        data: { title: "Bad Task", description: "", status: "backlog", score: 25, parentId: ghostParent, metadata: {} }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Import should succeed - orphaned parentId is nullified
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(2)

    // Existing data should still be there
    const existingData = db.prepare("SELECT * FROM tasks WHERE id = ?").get(existingTask) as { title: string } | undefined
    expect(existingData).toBeDefined()
    expect(existingData?.title).toBe("Existing Task")

    // New task should be imported
    const newData = db.prepare("SELECT * FROM tasks WHERE id = ?").get(newTask) as { title: string } | undefined
    expect(newData).toBeDefined()
    expect(newData?.title).toBe("New Task")

    // Bad task should be imported with null parent
    const badData = db.prepare("SELECT * FROM tasks WHERE id = ?").get(badTask) as { parent_id: string | null } | undefined
    expect(badData).toBeDefined()
    expect(badData?.parent_id).toBeNull()

    // Total count should be 3 (existing + 2 new)
    const taskCount = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(taskCount.count).toBe(3)
  })

  it("rolls back all tasks when a dependency insert fails mid-import", async () => {
    // Import tasks A and B, plus a dependency from A to a non-existent task C.
    // The dep failure should cause ALL changes (including tasks A and B) to rollback.

    const ts = "2024-01-01T00:00:00.000Z"
    const taskA = fixtureId("tx-atomicity-a")
    const taskB = fixtureId("tx-atomicity-b")
    const nonExistentTask = fixtureId("tx-atomicity-ghost")

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskA,
        data: { title: "Task A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskB,
        data: { title: "Task B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
      }),
      JSON.stringify({
        v: 1,
        op: "dep_add",
        ts,
        blockerId: taskA,
        blockedId: nonExistentTask // This task doesn't exist — FK violation
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Verify database is empty before import
    const countBefore = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(countBefore.count).toBe(0)

    // Import should fail
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(Exit.isFailure(exit)).toBe(true)

    // Verify ALL changes were rolled back — no tasks should be in the database
    const countAfter = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(countAfter.count).toBe(0)

    // No dependencies either
    const depCount = db.prepare("SELECT COUNT(*) as count FROM task_dependencies").get() as { count: number }
    expect(depCount.count).toBe(0)
  })
})

// -----------------------------------------------------------------------------
// Concurrent Modification Detection Tests (TOCTOU protection)
// -----------------------------------------------------------------------------

describe("SyncService Import Concurrent Modification Detection", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempPath: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    layer = makeTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(async () => {
    cleanupTempFile(tempPath)
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("rolls back import when JSONL file is modified during transaction", async () => {
    // Write initial JSONL file with one task
    const ts = "2024-01-01T00:00:00.000Z"
    const taskA = fixtureId("tx-concurrent-a")

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskA,
        data: { title: "Task A", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Monkey-patch the db.exec to simulate a concurrent export modifying the file
    // right after BEGIN IMMEDIATE but before COMMIT.
    // The original exec runs the SQL, then we modify the file after BEGIN IMMEDIATE.
    const originalExec = db.exec.bind(db)
    let beginCalled = false
    db.exec = (sql: string) => {
      const result = originalExec(sql)
      if (sql === "BEGIN IMMEDIATE" && !beginCalled) {
        beginCalled = true
        // Simulate concurrent export: modify the JSONL file while transaction is active
        const newTask = fixtureId("tx-concurrent-b")
        const modifiedJsonl = [
          jsonl,
          JSON.stringify({
            v: 1,
            op: "upsert",
            ts: "2024-01-02T00:00:00.000Z",
            id: newTask,
            data: { title: "Task B from concurrent export", description: "", status: "ready", score: 200, parentId: null, metadata: {} }
          })
        ].join("\n")
        writeFileSync(tempPath, modifiedJsonl + "\n", "utf-8")
      }
      return result
    }

    // Verify database is empty before import
    const countBefore = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(countBefore.count).toBe(0)

    // Import should fail because the JSONL file was modified during the transaction
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    // Restore original exec
    db.exec = originalExec

    expect(Exit.isFailure(exit)).toBe(true)

    // Verify all changes were rolled back — no tasks in the database
    const countAfter = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(countAfter.count).toBe(0)
  })

  it("succeeds when JSONL file is not modified during transaction", async () => {
    // Write JSONL file with one task
    const ts = "2024-01-01T00:00:00.000Z"
    const taskA = fixtureId("tx-no-concurrent-a")

    const jsonl = [
      JSON.stringify({
        v: 1,
        op: "upsert",
        ts,
        id: taskA,
        data: { title: "Task A", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
      })
    ].join("\n")
    writeFileSync(tempPath, jsonl + "\n", "utf-8")

    // Import should succeed when file is unchanged
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.import(tempPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)

    // Task should be in the database
    const taskCount = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
    expect(taskCount.count).toBe(1)
  })
})
