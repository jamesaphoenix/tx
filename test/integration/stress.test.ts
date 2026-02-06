/**
 * Stress Tests for Batch Operations
 *
 * Per DD-007: Tests scale behavior of tx operations.
 * These tests are SKIPPED by default - run with STRESS=1 to execute.
 *
 * Test scenarios:
 * 1. TaskRepository.findByIds with 1000+ IDs
 * 2. BM25 search with 10,000+ learnings
 * 3. Sync export/import with 5000+ tasks
 * 4. Dependency graph with deep chains (100+ levels)
 * 5. Batch embedding generation (100+ texts)
 *
 * Metrics captured: execution time, memory delta
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { existsSync, unlinkSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepository,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  LearningRepositoryLive,
  FileLearningRepositoryLive,
  AttemptRepositoryLive,
  TaskServiceLive,
  TaskService,
  DependencyServiceLive,
  ReadyServiceLive,
  ReadyService,
  HierarchyServiceLive,
  HierarchyService,
  LearningServiceLive,
  LearningService,
  SyncServiceLive,
  SyncService,
  EmbeddingService,
  EmbeddingServiceNoop,
  AutoSyncServiceNoop,
  QueryExpansionServiceNoop,
  RerankerServiceNoop
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

// Skip unless STRESS=1 environment variable is set
const SKIP_STRESS = !process.env["STRESS"]

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  FIND_BY_IDS_1000: 1000,     // 1000 IDs should complete in < 1s
  BM25_SEARCH_10K: 5000,       // Search in 10k learnings < 5s
  SYNC_EXPORT_5K: 10000,       // Export 5k tasks < 10s
  SYNC_IMPORT_5K: 15000,       // Import 5k tasks < 15s
  DEEP_HIERARCHY_100: 2000,    // 100 level hierarchy traversal < 2s
  BATCH_EMBED_100: 5000,       // 100 embeddings (mock) < 5s
}

// Stress test fixture IDs
const stressFixtureId = (name: string, index: number): TaskId =>
  fixtureId(`stress-${name}-${index}`)

/**
 * Measure execution time and memory delta for an async operation.
 */
async function measurePerformance<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number; memoryDeltaMb: number }> {
  const memBefore = process.memoryUsage().heapUsed
  const start = performance.now()

  const result = await fn()

  const durationMs = performance.now() - start
  const memAfter = process.memoryUsage().heapUsed
  const memoryDeltaMb = (memAfter - memBefore) / 1024 / 1024

  return { result, durationMs, memoryDeltaMb }
}

/**
 * Create test layer for task/dependency/hierarchy services
 */
function makeTaskTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db.db as Database)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(
    Layer.provide(Layer.merge(repos, AutoSyncServiceNoop))
  )
  return Layer.mergeAll(services, repos)
}

/**
 * Create test layer for learning services
 */
function makeLearningTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db.db as Database)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, AutoSyncServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop))
  )
  return services
}

/**
 * Create test layer for sync services
 */
function makeSyncTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db.db as Database)
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
    Layer.provide(Layer.merge(repos, AutoSyncServiceNoop))
  )
  const syncService = SyncServiceLive.pipe(
    Layer.provide(Layer.merge(infra, repos))
  )
  return Layer.mergeAll(baseServices, syncService, repos)
}

/**
 * Seed N tasks into the database directly (bypasses service for speed)
 */
function seedBulkTasks(db: Database, count: number, prefix: string = "bulk"): TaskId[] {
  const now = new Date().toISOString()
  const insert = db.db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const ids: TaskId[] = []
  const transaction = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = stressFixtureId(prefix, i)
      insert.run(id, `Task ${i}`, `Description for task ${i}`, "backlog", null, 500 + i, now, now, null, "{}")
      ids.push(id)
    }
  })
  transaction()

  return ids
}

/**
 * Seed N learnings into the database directly
 */
function seedBulkLearnings(db: Database, count: number): number[] {
  const now = new Date().toISOString()
  const insert = db.db.prepare(
    `INSERT INTO learnings (content, source_type, source_ref, created_at, keywords, category)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  const ids: number[] = []
  const categories = ["database", "api", "testing", "security", "performance"]
  const transaction = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const category = categories[i % categories.length]
      const result = insert.run(
        `Learning content ${i}: This is about ${category} best practices and patterns for software development`,
        "manual",
        null,
        now,
        JSON.stringify([category, "development", `term${i}`]),
        category
      )
      ids.push(Number(result.lastInsertRowid))
    }
  })
  transaction()

  return ids
}

/**
 * Create a deep hierarchy chain: task0 -> task1 -> task2 -> ... -> taskN
 */
function seedDeepHierarchy(db: Database, depth: number): TaskId[] {
  const now = new Date().toISOString()
  const insert = db.db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const ids: TaskId[] = []
  const transaction = db.transaction(() => {
    for (let i = 0; i < depth; i++) {
      const id = stressFixtureId("deep", i)
      const parentId = i === 0 ? null : ids[i - 1]
      insert.run(id, `Deep Task ${i}`, `Level ${i}`, "backlog", parentId, 1000 - i, now, now, null, "{}")
      ids.push(id)
    }
  })
  transaction()

  return ids
}

/**
 * Create a deep dependency chain: task0 blocks task1 blocks task2 blocks ... blocks taskN
 */
function seedDeepDependencyChain(db: Database, depth: number): TaskId[] {
  const now = new Date().toISOString()
  const insertTask = db.db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertDep = db.db.prepare(
    `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
  )

  const ids: TaskId[] = []
  const transaction = db.transaction(() => {
    // Create all tasks first
    for (let i = 0; i < depth; i++) {
      const id = stressFixtureId("depchain", i)
      insertTask.run(id, `Chain Task ${i}`, `Dep level ${i}`, "backlog", null, 1000 - i, now, now, null, "{}")
      ids.push(id)
    }

    // Create dependency chain: task[i] blocks task[i+1]
    for (let i = 0; i < depth - 1; i++) {
      insertDep.run(ids[i], ids[i + 1], now)
    }
  })
  transaction()

  return ids
}

/**
 * Create temp file path for sync tests
 */
function createTempJsonlPath(): string {
  const tempDir = join(tmpdir(), "tx-stress-test")
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
// STRESS TEST SUITES
// =============================================================================

describe.skipIf(SKIP_STRESS)("Stress: TaskRepository.findByIds", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTaskTestLayer>
  let taskIds: TaskId[]

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeTaskTestLayer(db)
    taskIds = seedBulkTasks(db, 1000, "findbyids")
  })

  it("handles 1000+ IDs within threshold", async () => {
    const { result: tasks, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TaskRepository
          return yield* repo.findByIds(taskIds)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`findByIds(1000): ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    expect(tasks).toHaveLength(1000)
    expect(durationMs).toBeLessThan(THRESHOLDS.FIND_BY_IDS_1000)
  })

  it("handles 5000 IDs", async () => {
    // Seed more tasks
    const moreIds = seedBulkTasks(db, 4000, "findbyids-more")
    const allIds = [...taskIds, ...moreIds]

    const { result: tasks, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TaskRepository
          return yield* repo.findByIds(allIds)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`findByIds(5000): ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    expect(tasks).toHaveLength(5000)
    // 5000 should be < 5x the 1000 threshold
    expect(durationMs).toBeLessThan(THRESHOLDS.FIND_BY_IDS_1000 * 5)
  })

  it("handles empty ID array efficiently", async () => {
    const { result: tasks, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TaskRepository
          return yield* repo.findByIds([])
        }).pipe(Effect.provide(layer))
      )
    )

    expect(tasks).toHaveLength(0)
    expect(durationMs).toBeLessThan(10) // Empty array should be instant
  })

  it("handles mixed existing and non-existing IDs", async () => {
    const mixedIds = [
      ...taskIds.slice(0, 500),
      ...Array.from({ length: 500 }, (_, i) => `tx-nonexist${i}` as TaskId)
    ]

    const { result: tasks, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TaskRepository
          return yield* repo.findByIds(mixedIds)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`findByIds(mixed 1000): ${durationMs.toFixed(2)}ms`)

    expect(tasks).toHaveLength(500) // Only existing tasks returned
    expect(durationMs).toBeLessThan(THRESHOLDS.FIND_BY_IDS_1000)
  })
})

describe.skipIf(SKIP_STRESS)("Stress: BM25 Search with 10,000+ learnings", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeLearningTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeLearningTestLayer(db)
    seedBulkLearnings(db, 10000)
  })

  it("searches 10,000 learnings within threshold", async () => {
    const { result: results, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.search({ query: "database best practices", limit: 20, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`BM25 search (10k learnings): ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(20)
    expect(durationMs).toBeLessThan(THRESHOLDS.BM25_SEARCH_10K)
  })

  it("handles multiple sequential searches", async () => {
    const queries = ["database patterns", "api security", "testing strategies", "performance optimization"]

    const { durationMs } = await measurePerformance(async () => {
      for (const query of queries) {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* LearningService
            return yield* svc.search({ query, limit: 10, minScore: 0 })
          }).pipe(Effect.provide(layer))
        )
      }
    })

    console.log(`4 sequential BM25 searches: ${durationMs.toFixed(2)}ms`)

    // Should complete 4 searches in reasonable time
    expect(durationMs).toBeLessThan(THRESHOLDS.BM25_SEARCH_10K * 2)
  })

  it("search with no results is fast", async () => {
    const { result: results, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.search({ query: "xyznonexistent123abc", limit: 20, minScore: 0 })
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`BM25 search (no results): ${durationMs.toFixed(2)}ms`)

    expect(results).toHaveLength(0)
    expect(durationMs).toBeLessThan(500) // No-results should be fast
  })
})

describe.skipIf(SKIP_STRESS)("Stress: Sync Export/Import with 5000+ tasks", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeSyncTestLayer>
  let tempPath: string

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeSyncTestLayer(db)
    tempPath = createTempJsonlPath()
  })

  afterEach(() => {
    cleanupTempFile(tempPath)
  })

  it("exports 5000 tasks within threshold", async () => {
    seedBulkTasks(db, 5000, "sync-export")

    const { result, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const sync = yield* SyncService
          return yield* sync.export(tempPath)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`Export 5000 tasks: ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    expect(result.opCount).toBe(5000)
    expect(durationMs).toBeLessThan(THRESHOLDS.SYNC_EXPORT_5K)

    // Verify file was written
    expect(existsSync(tempPath)).toBe(true)
    const lines = readFileSync(tempPath, "utf-8").trim().split("\n")
    expect(lines).toHaveLength(5000)
  })

  it("imports 5000 tasks within threshold", async () => {
    // First export tasks from a seeded database
    const sourceDb = await Effect.runPromise(createTestDatabase())
    const sourceLayer = makeSyncTestLayer(sourceDb)
    seedBulkTasks(sourceDb, 5000, "sync-import")

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tempPath)
      }).pipe(Effect.provide(sourceLayer))
    )

    // Now import into fresh database
    const { result, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const sync = yield* SyncService
          return yield* sync.import(tempPath)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`Import 5000 tasks: ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    expect(result.imported).toBe(5000)
    expect(durationMs).toBeLessThan(THRESHOLDS.SYNC_IMPORT_5K)

    // Verify tasks were imported
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const tasks = yield* taskSvc.list()
        return tasks.length
      }).pipe(Effect.provide(layer))
    )
    expect(count).toBe(5000)
  })

  it("handles export with dependencies", async () => {
    const ids = seedBulkTasks(db, 1000, "sync-deps")

    // Add some dependencies (every 10th task blocks the next)
    const insertDep = db.db.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
    )
    const now = new Date().toISOString()
    for (let i = 0; i < 990; i += 10) {
      insertDep.run(ids[i], ids[i + 1], now)
    }

    const { result, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const sync = yield* SyncService
          return yield* sync.export(tempPath)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`Export 1000 tasks + 99 deps: ${durationMs.toFixed(2)}ms`)

    expect(result.opCount).toBe(1099) // 1000 tasks + 99 deps
  })
})

describe.skipIf(SKIP_STRESS)("Stress: Deep Dependency Chains (100+ levels)", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTaskTestLayer>
  let chainIds: TaskId[]

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeTaskTestLayer(db)
    chainIds = seedDeepDependencyChain(db, 100)
  })

  it("traverses deep dependency chain for ready detection", async () => {
    // The last task in chain (index 99) should NOT be ready (blocked by all predecessors)
    const { result: readyTasks, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady()
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`Ready detection (100-deep chain): ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    // Only the first task (no blockers) should be ready
    expect(readyTasks).toHaveLength(1)
    expect(readyTasks[0]!.id).toBe(chainIds[0])
    expect(durationMs).toBeLessThan(THRESHOLDS.DEEP_HIERARCHY_100)
  })

  it("getWithDeps on deeply blocked task shows all blockers", async () => {
    const lastTaskId = chainIds[chainIds.length - 1]!

    const { result: task, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* TaskService
          return yield* svc.getWithDeps(lastTaskId)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`getWithDeps (deep chain): ${durationMs.toFixed(2)}ms`)

    expect(task.blockedBy).toHaveLength(1) // Direct blocker only
    expect(task.isReady).toBe(false)
    expect(durationMs).toBeLessThan(500)
  })

  it("completing blockers propagates through chain", async () => {
    // Complete first 50 tasks
    const completeStmt = db.db.prepare(
      "UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?"
    )
    const now = new Date().toISOString()
    for (let i = 0; i < 50; i++) {
      completeStmt.run(now, chainIds[i])
    }

    const { result: readyTasks, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ReadyService
          return yield* svc.getReady()
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`Ready after completing 50 blockers: ${durationMs.toFixed(2)}ms`)

    // Task 50 should now be ready (task 49 is done)
    expect(readyTasks).toHaveLength(1)
    expect(readyTasks[0]!.id).toBe(chainIds[50])
    expect(durationMs).toBeLessThan(THRESHOLDS.DEEP_HIERARCHY_100)
  })
})

describe.skipIf(SKIP_STRESS)("Stress: Deep Hierarchy (100+ levels)", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTaskTestLayer>
  let hierarchyIds: TaskId[]

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    layer = makeTaskTestLayer(db)
    hierarchyIds = seedDeepHierarchy(db, 100)
  })

  it("getAncestors traverses 100 levels", async () => {
    const deepestTaskId = hierarchyIds[hierarchyIds.length - 1]!

    const { result: ancestors, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getAncestors(deepestTaskId)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`getAncestors (100 levels): ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    expect(ancestors).toHaveLength(99) // 99 ancestors (excluding self)
    expect(durationMs).toBeLessThan(THRESHOLDS.DEEP_HIERARCHY_100)
  })

  it("getTree traverses deep hierarchy", async () => {
    const rootId = hierarchyIds[0]!

    const { result: tree, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(rootId, 100)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`getTree (100 levels): ${durationMs.toFixed(2)}ms`)

    // Count total nodes in tree
    let nodeCount = 0
    const countNodes = (node: { children: readonly unknown[] }) => {
      nodeCount++
      for (const child of node.children) {
        countNodes(child as { children: readonly unknown[] })
      }
    }
    countNodes(tree)

    expect(nodeCount).toBe(100)
    expect(durationMs).toBeLessThan(THRESHOLDS.DEEP_HIERARCHY_100)
  })

  it("getDepth calculates correctly for deep task", async () => {
    const deepestTaskId = hierarchyIds[hierarchyIds.length - 1]!

    const { result: depth, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getDepth(deepestTaskId)
        }).pipe(Effect.provide(layer))
      )
    )

    console.log(`getDepth (100 levels): ${durationMs.toFixed(2)}ms`)

    expect(depth).toBe(99) // 0-indexed, so depth 99 for 100th task
    expect(durationMs).toBeLessThan(THRESHOLDS.DEEP_HIERARCHY_100)
  })
})

describe.skipIf(SKIP_STRESS)("Stress: Batch Embedding Generation", () => {
  it("handles 100+ texts with mock embedding service", async () => {
    // Create mock embedding service layer for testing batch behavior
    const texts = Array.from({ length: 100 }, (_, i) =>
      `Learning content ${i}: This is test content for embedding generation`
    )

    // Create a mock embedding service that simulates batch processing
    const MockEmbeddingLayer = Layer.succeed(EmbeddingService, {
      embed: (_text: string) => Effect.succeed(new Float32Array(256).fill(0.1)),
      embedBatch: (texts: readonly string[]) =>
        Effect.succeed(texts.map(() => new Float32Array(256).fill(0.1))),
      isAvailable: () => Effect.succeed(true)
    })

    const { result, durationMs, memoryDeltaMb } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(texts)
        }).pipe(Effect.provide(MockEmbeddingLayer))
      )
    )

    console.log(`Batch embed 100 texts: ${durationMs.toFixed(2)}ms, memory delta: ${memoryDeltaMb.toFixed(2)}MB`)

    expect(result).toHaveLength(100)
    expect(result[0]).toBeInstanceOf(Float32Array)
    expect(result[0]!.length).toBe(256)
    expect(durationMs).toBeLessThan(THRESHOLDS.BATCH_EMBED_100)
  })

  it("handles 500 texts in batch", async () => {
    const texts = Array.from({ length: 500 }, (_, i) =>
      `Content ${i}: Extended learning text for stress testing`
    )

    const MockEmbeddingLayer = Layer.succeed(EmbeddingService, {
      embed: (_text: string) => Effect.succeed(new Float32Array(256).fill(0.1)),
      embedBatch: (textsInput: readonly string[]) =>
        Effect.succeed(textsInput.map(() => new Float32Array(256).fill(0.1))),
      isAvailable: () => Effect.succeed(true)
    })

    const { result, durationMs } = await measurePerformance(async () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* EmbeddingService
          return yield* svc.embedBatch(texts)
        }).pipe(Effect.provide(MockEmbeddingLayer))
      )
    )

    console.log(`Batch embed 500 texts: ${durationMs.toFixed(2)}ms`)

    expect(result).toHaveLength(500)
    // Should scale linearly, so 5x texts should be < 5x threshold
    expect(durationMs).toBeLessThan(THRESHOLDS.BATCH_EMBED_100 * 5)
  })
})

describe.skipIf(SKIP_STRESS)("Stress: Combined Operations", () => {
  let db: TestDatabase
  let taskLayer: ReturnType<typeof makeTaskTestLayer>
  let learningLayer: ReturnType<typeof makeLearningTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    taskLayer = makeTaskTestLayer(db)
    learningLayer = makeLearningTestLayer(db)
  })

  it("handles concurrent reads under load", async () => {
    // Seed data
    const taskIds = seedBulkTasks(db, 1000, "concurrent")
    seedBulkLearnings(db, 1000)

    // Run multiple operations concurrently
    const { durationMs } = await measurePerformance(async () => {
      await Promise.all([
        // Task operations
        Effect.runPromise(
          Effect.gen(function* () {
            const repo = yield* TaskRepository
            return yield* repo.findByIds(taskIds.slice(0, 500))
          }).pipe(Effect.provide(taskLayer))
        ),
        Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ReadyService
            return yield* svc.getReady()
          }).pipe(Effect.provide(taskLayer))
        ),
        // Learning operations
        Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* LearningService
            return yield* svc.search({ query: "database", limit: 20, minScore: 0 })
          }).pipe(Effect.provide(learningLayer))
        ),
        Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* LearningService
            return yield* svc.getRecent(50)
          }).pipe(Effect.provide(learningLayer))
        )
      ])
    })

    console.log(`4 concurrent operations: ${durationMs.toFixed(2)}ms`)

    // Concurrent operations should complete reasonably fast
    expect(durationMs).toBeLessThan(THRESHOLDS.BM25_SEARCH_10K)
  })

  it("handles repeated operations efficiently", async () => {
    seedBulkTasks(db, 500, "repeated")
    seedBulkLearnings(db, 500)

    const iterations = 10
    const { durationMs } = await measurePerformance(async () => {
      for (let i = 0; i < iterations; i++) {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ReadyService
            return yield* svc.getReady()
          }).pipe(Effect.provide(taskLayer))
        )
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* LearningService
            return yield* svc.search({ query: "testing", limit: 10, minScore: 0 })
          }).pipe(Effect.provide(learningLayer))
        )
      }
    })

    console.log(`${iterations * 2} repeated operations: ${durationMs.toFixed(2)}ms`)

    // Average time per operation should be reasonable
    const avgTime = durationMs / (iterations * 2)
    expect(avgTime).toBeLessThan(500) // Each operation < 500ms average
  })
})
