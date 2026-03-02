/**
 * Sync Export/Import All Integration Tests
 *
 * Tests the expanded JSONL sync for learnings, file-learnings, and attempts.
 * Verifies round-trip export/import, content-hash dedup, and exportAll/importAll orchestration.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { existsSync, unlinkSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"

import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  LearningRepositoryLive,
  LearningRepository,
  FileLearningRepositoryLive,
  FileLearningRepository,
  AttemptRepositoryLive,
  AttemptRepository,
  PinRepositoryLive,
  AnchorRepositoryLive,
  AnchorRepository,
  EdgeRepositoryLive,
  EdgeRepository,
  DocRepositoryLive,
  DocRepository,
  TaskService,
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  SyncServiceLive,
  SyncService,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"

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
    AttemptRepositoryLive,
    PinRepositoryLive,
    AnchorRepositoryLive,
    EdgeRepositoryLive,
    DocRepositoryLive
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

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

let tempCounter = 0

function createTempDir(): string {
  const tempDir = join(tmpdir(), `tx-test-sync-all-${Date.now()}-${++tempCounter}`)
  mkdirSync(tempDir, { recursive: true })
  return tempDir
}

function cleanupTempFile(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

// -----------------------------------------------------------------------------
// Learnings Export/Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Learnings Export/Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export learnings to JSONL", async () => {
    const filePath = join(tempDir, "learnings.jsonl")

    // Insert test learnings
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Always use Effect.gen", sourceType: "manual", keywords: ["effect", "patterns"] })
        yield* repo.insert({ content: "SQLite WAL mode is fast", sourceType: "run", sourceRef: "run-123", category: "database" })
      }).pipe(Effect.provide(layer))
    )

    // Export
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.exportLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.opCount).toBe(2)
    expect(result.path).toBe(filePath)
    expect(existsSync(filePath)).toBe(true)

    // Verify JSONL content
    const content = readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(2)

    const op1 = JSON.parse(lines[0])
    expect(op1.v).toBe(1)
    expect(op1.op).toBe("learning_upsert")
    expect(op1.contentHash).toBeTruthy()
    expect(op1.data.content).toBeTruthy()
    expect(op1.data.sourceType).toBeTruthy()

    cleanupTempFile(filePath)
  })

  it("should import learnings from JSONL with content-hash dedup", async () => {
    const filePath = join(tempDir, "learnings.jsonl")

    // Insert a learning and export
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Test learning 1", sourceType: "manual" })
        yield* repo.insert({ content: "Test learning 2", sourceType: "run" })

        const sync = yield* SyncService
        yield* sync.exportLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Clear learnings table (simulate fresh clone)
    db.exec("DELETE FROM learnings")

    // Import
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)

    // Verify data restored
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(2)
    const contents = learnings.map(l => l.content).sort()
    expect(contents).toEqual(["Test learning 1", "Test learning 2"])

    cleanupTempFile(filePath)
  })

  it("should skip duplicate learnings on import (content-hash dedup)", async () => {
    const filePath = join(tempDir, "learnings.jsonl")

    // Insert learnings and export
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Existing learning", sourceType: "manual" })

        const sync = yield* SyncService
        yield* sync.exportLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Import again (learning already exists)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)

    // Verify no duplicates
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )
    expect(learnings).toHaveLength(1)

    cleanupTempFile(filePath)
  })

  it("should return empty result for non-existent file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLearnings("/nonexistent/path.jsonl")
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it("should export empty file for empty learnings table", async () => {
    const filePath = join(tempDir, "learnings-empty.jsonl")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.exportLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.opCount).toBe(0)
    expect(existsSync(filePath)).toBe(true)

    cleanupTempFile(filePath)
  })

  it("should preserve learning fields through round-trip", async () => {
    const filePath = join(tempDir, "learnings-roundtrip.jsonl")

    // Create learning with all fields
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({
          content: "Full learning content",
          sourceType: "compaction",
          sourceRef: "compact-run-42",
          keywords: ["test", "roundtrip", "full"],
          category: "testing"
        })

        const sync = yield* SyncService
        yield* sync.exportLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Clear and reimport
    db.exec("DELETE FROM learnings")

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.importLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(1)
    const l = learnings[0]
    expect(l.content).toBe("Full learning content")
    expect(l.sourceType).toBe("compaction")
    expect(l.sourceRef).toBe("compact-run-42")
    expect(l.keywords).toEqual(["test", "roundtrip", "full"])
    expect(l.category).toBe("testing")

    cleanupTempFile(filePath)
  })
})

// -----------------------------------------------------------------------------
// File Learnings Export/Import Tests
// -----------------------------------------------------------------------------

describe("SyncService File Learnings Export/Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export file learnings to JSONL", async () => {
    const filePath = join(tempDir, "file-learnings.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* FileLearningRepository
        yield* repo.insert({ filePattern: "src/**/*.ts", note: "Always use strict mode" })
        yield* repo.insert({ filePattern: "test/*.test.ts", note: "Use vitest assertions" })
      }).pipe(Effect.provide(layer))
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.exportFileLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.opCount).toBe(2)
    expect(existsSync(filePath)).toBe(true)

    const content = readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(2)

    const op1 = JSON.parse(lines[0])
    expect(op1.op).toBe("file_learning_upsert")
    expect(op1.contentHash).toBeTruthy()

    cleanupTempFile(filePath)
  })

  it("should round-trip file learnings through export/import", async () => {
    const filePath = join(tempDir, "file-learnings-rt.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* FileLearningRepository
        yield* repo.insert({ filePattern: "src/utils/*.ts", note: "Pure functions only" })

        const sync = yield* SyncService
        yield* sync.exportFileLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    db.exec("DELETE FROM file_learnings")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importFileLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)

    const fls = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* FileLearningRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )

    expect(fls).toHaveLength(1)
    expect(fls[0].filePattern).toBe("src/utils/*.ts")
    expect(fls[0].note).toBe("Pure functions only")

    cleanupTempFile(filePath)
  })

  it("should skip duplicate file learnings on import", async () => {
    const filePath = join(tempDir, "file-learnings-dup.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* FileLearningRepository
        yield* repo.insert({ filePattern: "*.md", note: "Use frontmatter" })

        const sync = yield* SyncService
        yield* sync.exportFileLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Import again without clearing — should skip
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importFileLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)

    cleanupTempFile(filePath)
  })
})

// -----------------------------------------------------------------------------
// Attempts Export/Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Attempts Export/Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export attempts to JSONL", async () => {
    const filePath = join(tempDir, "attempts.jsonl")
    const taskId = fixtureId("attempt-task")

    // Create a task first (attempts reference tasks)
    await Effect.runPromise(
      Effect.gen(function* () {
        // Insert task directly via SQL to control the ID
        db.prepare("INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata) VALUES (?, ?, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')").run(taskId, "Attempt test task")

        const repo = yield* AttemptRepository
        yield* repo.insert({ taskId, approach: "Try approach A", outcome: "failed", reason: "Timed out" })
        yield* repo.insert({ taskId, approach: "Try approach B", outcome: "succeeded" })
      }).pipe(Effect.provide(layer))
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.exportAttempts(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.opCount).toBe(2)
    expect(existsSync(filePath)).toBe(true)

    const content = readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(2)

    const op1 = JSON.parse(lines[0])
    expect(op1.op).toBe("attempt_upsert")
    expect(op1.data.taskId).toBe(taskId)

    cleanupTempFile(filePath)
  })

  it("should round-trip attempts through export/import", async () => {
    const filePath = join(tempDir, "attempts-rt.jsonl")
    const taskId = fixtureId("attempt-rt-task")

    await Effect.runPromise(
      Effect.gen(function* () {
        db.prepare("INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata) VALUES (?, ?, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')").run(taskId, "Roundtrip attempt task")

        const repo = yield* AttemptRepository
        yield* repo.insert({ taskId, approach: "First try", outcome: "failed", reason: "Missing dependency" })

        const sync = yield* SyncService
        yield* sync.exportAttempts(filePath)
      }).pipe(Effect.provide(layer))
    )

    db.exec("DELETE FROM attempts")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importAttempts(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)

    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(1)
    expect(attempts[0].taskId).toBe(taskId)
    expect(attempts[0].approach).toBe("First try")
    expect(attempts[0].outcome).toBe("failed")
    expect(attempts[0].reason).toBe("Missing dependency")

    cleanupTempFile(filePath)
  })

  it("should skip duplicate attempts on import", async () => {
    const filePath = join(tempDir, "attempts-dup.jsonl")
    const taskId = fixtureId("attempt-dup-task")

    await Effect.runPromise(
      Effect.gen(function* () {
        db.prepare("INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata) VALUES (?, ?, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')").run(taskId, "Dup attempt task")

        const repo = yield* AttemptRepository
        yield* repo.insert({ taskId, approach: "Same approach", outcome: "succeeded" })

        const sync = yield* SyncService
        yield* sync.exportAttempts(filePath)
      }).pipe(Effect.provide(layer))
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importAttempts(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)

    cleanupTempFile(filePath)
  })
})

// -----------------------------------------------------------------------------
// ExportAll / ImportAll Orchestration Tests
// -----------------------------------------------------------------------------

describe("SyncService ExportAll/ImportAll", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export all entity types", async () => {
    const taskId = fixtureId("export-all-task")

    // Seed data across all entity types
    db.prepare("INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata) VALUES (?, ?, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')").run(taskId, "Export all test")

    await Effect.runPromise(
      Effect.gen(function* () {
        const learningRepo = yield* LearningRepository
        yield* learningRepo.insert({ content: "Learn something", sourceType: "manual" })

        const flRepo = yield* FileLearningRepository
        yield* flRepo.insert({ filePattern: "src/*.ts", note: "Type safety" })

        const attemptRepo = yield* AttemptRepository
        yield* attemptRepo.insert({ taskId, approach: "Attempt it", outcome: "succeeded" })
      }).pipe(Effect.provide(layer))
    )

    // Override default paths to use temp dir
    const tasksPath = join(tempDir, "tasks.jsonl")
    const learningsPath = join(tempDir, "learnings.jsonl")
    const fileLearningsPath = join(tempDir, "file-learnings.jsonl")
    const attemptsPath = join(tempDir, "attempts.jsonl")

    // Export individually (exportAll uses default paths, so test individually)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        const tasks = yield* sync.export(tasksPath)
        const learnings = yield* sync.exportLearnings(learningsPath)
        const fileLearnings = yield* sync.exportFileLearnings(fileLearningsPath)
        const attempts = yield* sync.exportAttempts(attemptsPath)
        return { tasks, learnings, fileLearnings, attempts }
      }).pipe(Effect.provide(layer))
    )

    // Verify all files created with correct counts
    // Tasks: seedFixtures creates some + our test task
    expect(result.tasks.opCount).toBeGreaterThan(0)
    expect(result.learnings.opCount).toBe(1)
    expect(result.fileLearnings.opCount).toBe(1)
    expect(result.attempts.opCount).toBe(1)

    expect(existsSync(tasksPath)).toBe(true)
    expect(existsSync(learningsPath)).toBe(true)
    expect(existsSync(fileLearningsPath)).toBe(true)
    expect(existsSync(attemptsPath)).toBe(true)

    cleanupTempFile(tasksPath)
    cleanupTempFile(learningsPath)
    cleanupTempFile(fileLearningsPath)
    cleanupTempFile(attemptsPath)
  })

  it("should full round-trip: export all → wipe → import all", async () => {
    const taskId = fixtureId("roundtrip-all-task")

    // Seed all entity types
    db.prepare("INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata) VALUES (?, ?, '', 'backlog', 0, datetime('now'), datetime('now'), '{}')").run(taskId, "Roundtrip all test")

    await Effect.runPromise(
      Effect.gen(function* () {
        const learningRepo = yield* LearningRepository
        yield* learningRepo.insert({ content: "RT learning", sourceType: "manual", keywords: ["rt"] })

        const flRepo = yield* FileLearningRepository
        yield* flRepo.insert({ filePattern: "**/*.md", note: "RT file learning" })

        const attemptRepo = yield* AttemptRepository
        yield* attemptRepo.insert({ taskId, approach: "RT approach", outcome: "failed", reason: "RT reason" })
      }).pipe(Effect.provide(layer))
    )

    const tasksPath = join(tempDir, "tasks-rt.jsonl")
    const learningsPath = join(tempDir, "learnings-rt.jsonl")
    const fileLearningsPath = join(tempDir, "file-learnings-rt.jsonl")
    const attemptsPath = join(tempDir, "attempts-rt.jsonl")

    // Export
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.export(tasksPath)
        yield* sync.exportLearnings(learningsPath)
        yield* sync.exportFileLearnings(fileLearningsPath)
        yield* sync.exportAttempts(attemptsPath)
      }).pipe(Effect.provide(layer))
    )

    // Wipe non-task tables (tasks import handles its own wipe via upsert)
    db.exec("DELETE FROM attempts")
    db.exec("DELETE FROM file_learnings")
    db.exec("DELETE FROM learnings")

    // Import all
    const importResult = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        const learnings = yield* sync.importLearnings(learningsPath)
        const fileLearnings = yield* sync.importFileLearnings(fileLearningsPath)
        const attempts = yield* sync.importAttempts(attemptsPath)
        return { learnings, fileLearnings, attempts }
      }).pipe(Effect.provide(layer))
    )

    expect(importResult.learnings.imported).toBe(1)
    expect(importResult.fileLearnings.imported).toBe(1)
    expect(importResult.attempts.imported).toBe(1)

    // Verify data integrity
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )
    expect(learnings).toHaveLength(1)
    expect(learnings[0].content).toBe("RT learning")
    expect(learnings[0].keywords).toEqual(["rt"])

    const fls = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* FileLearningRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )
    expect(fls).toHaveLength(1)
    expect(fls[0].filePattern).toBe("**/*.md")

    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0].approach).toBe("RT approach")
    expect(attempts[0].reason).toBe("RT reason")

    cleanupTempFile(tasksPath)
    cleanupTempFile(learningsPath)
    cleanupTempFile(fileLearningsPath)
    cleanupTempFile(attemptsPath)
  })

  it("should not create duplicates on double import", async () => {
    const filePath = join(tempDir, "learnings-double.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Double import test", sourceType: "manual" })

        const sync = yield* SyncService
        yield* sync.exportLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    db.exec("DELETE FROM learnings")

    // Import twice
    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.importLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    const result2 = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLearnings(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result2.imported).toBe(0)
    expect(result2.skipped).toBe(1)

    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )
    expect(learnings).toHaveLength(1)

    cleanupTempFile(filePath)
  })

  it("should handle selective export via options", async () => {
    // Seed a learning
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* LearningRepository
        yield* repo.insert({ content: "Selective test", sourceType: "manual" })
      }).pipe(Effect.provide(layer))
    )

    // exportAll with learnings=false should skip learnings
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.exportAll({ learnings: false, fileLearnings: false, attempts: false })
      }).pipe(Effect.provide(layer))
    )

    expect(result.tasks).toBeDefined()
    expect(result.learnings).toBeUndefined()
    expect(result.fileLearnings).toBeUndefined()
    expect(result.attempts).toBeUndefined()
  })
})

// -----------------------------------------------------------------------------
// Anchors Export/Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Anchors Export/Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export anchors to JSONL", async () => {
    const filePath = join(tempDir, "anchors.jsonl")

    // Create a learning first (anchors reference learnings)
    await Effect.runPromise(
      Effect.gen(function* () {
        const learningRepo = yield* LearningRepository
        yield* learningRepo.insert({ content: "Anchor test learning", sourceType: "manual" })

        // Get the learning ID
        const learnings = yield* learningRepo.findAll()
        const learningId = learnings[0].id as number

        // Create an anchor referencing the learning
        const anchorRepo = yield* AnchorRepository
        yield* anchorRepo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "src/main.ts",
          filePath: "src/main.ts",
          contentHash: "abc123"
        })
      }).pipe(Effect.provide(layer))
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.exportAnchors(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.opCount).toBe(1)
    expect(existsSync(filePath)).toBe(true)

    const content = readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(1)

    const op = JSON.parse(lines[0])
    expect(op.op).toBe("anchor_upsert")
    expect(op.contentHash).toBeTruthy()
    expect(op.data.anchorType).toBe("glob")
    expect(op.data.filePath).toBe("src/main.ts")
    expect(op.data.learningContentHash).toBeTruthy()

    cleanupTempFile(filePath)
  })

  it("should round-trip anchors through export/import", async () => {
    const anchorsPath = join(tempDir, "anchors-rt.jsonl")
    const learningsPath = join(tempDir, "learnings-rt.jsonl")

    // Create learning + anchor
    await Effect.runPromise(
      Effect.gen(function* () {
        const learningRepo = yield* LearningRepository
        yield* learningRepo.insert({ content: "RT anchor learning", sourceType: "manual" })

        const learnings = yield* learningRepo.findAll()
        const learningId = learnings[0].id as number

        const anchorRepo = yield* AnchorRepository
        yield* anchorRepo.create({
          learningId,
          anchorType: "symbol",
          anchorValue: "MyClass.myMethod",
          filePath: "src/service.ts",
          symbolFqname: "MyClass.myMethod",
          lineStart: 10,
          lineEnd: 20,
          contentHash: "def456",
          contentPreview: "function myMethod() {"
        })

        // Export both learnings (needed for anchor import) and anchors
        const sync = yield* SyncService
        yield* sync.exportLearnings(learningsPath)
        yield* sync.exportAnchors(anchorsPath)
      }).pipe(Effect.provide(layer))
    )

    // Clear DB tables
    db.exec("DELETE FROM learning_anchors")
    db.exec("DELETE FROM learnings")

    // Import learnings first (anchors reference them), then anchors
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.importLearnings(learningsPath)
        return yield* sync.importAnchors(anchorsPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)

    // Verify anchor data
    const anchors = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )

    expect(anchors).toHaveLength(1)
    expect(anchors[0].anchorType).toBe("symbol")
    expect(anchors[0].anchorValue).toBe("MyClass.myMethod")
    expect(anchors[0].filePath).toBe("src/service.ts")
    expect(anchors[0].symbolFqname).toBe("MyClass.myMethod")
    expect(anchors[0].lineStart).toBe(10)
    expect(anchors[0].lineEnd).toBe(20)

    cleanupTempFile(anchorsPath)
    cleanupTempFile(learningsPath)
  })

  it("should skip duplicate anchors on import", async () => {
    const anchorsPath = join(tempDir, "anchors-dup.jsonl")
    const learningsPath = join(tempDir, "learnings-dup.jsonl")

    // Create learning + anchor and export
    await Effect.runPromise(
      Effect.gen(function* () {
        const learningRepo = yield* LearningRepository
        yield* learningRepo.insert({ content: "Dup anchor learning", sourceType: "manual" })

        const learnings = yield* learningRepo.findAll()
        const learningId = learnings[0].id as number

        const anchorRepo = yield* AnchorRepository
        yield* anchorRepo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "src/dup.ts",
          filePath: "src/dup.ts"
        })

        const sync = yield* SyncService
        yield* sync.exportLearnings(learningsPath)
        yield* sync.exportAnchors(anchorsPath)
      }).pipe(Effect.provide(layer))
    )

    // Import again without clearing — should skip
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importAnchors(anchorsPath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)

    cleanupTempFile(anchorsPath)
    cleanupTempFile(learningsPath)
  })

  it("should skip orphaned anchors when learning is missing", async () => {
    const anchorsPath = join(tempDir, "anchors-orphan.jsonl")

    // Create learning + anchor and export
    await Effect.runPromise(
      Effect.gen(function* () {
        const learningRepo = yield* LearningRepository
        yield* learningRepo.insert({ content: "Orphan anchor learning", sourceType: "manual" })

        const learnings = yield* learningRepo.findAll()
        const learningId = learnings[0].id as number

        const anchorRepo = yield* AnchorRepository
        yield* anchorRepo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "src/orphan.ts",
          filePath: "src/orphan.ts"
        })

        const sync = yield* SyncService
        yield* sync.exportAnchors(anchorsPath)
      }).pipe(Effect.provide(layer))
    )

    // Clear both tables — learning is gone so anchor should be skipped
    db.exec("DELETE FROM learning_anchors")
    db.exec("DELETE FROM learnings")

    // Import anchors WITHOUT importing learnings — should drop due to missing learning FK
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importAnchors(anchorsPath)
      }).pipe(Effect.provide(layer))
    )

    // Orphaned anchors (missing learning) are counted as skipped alongside dedup-skipped
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)

    // Verify no anchors were created
    const anchors = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )
    expect(anchors).toHaveLength(0)

    cleanupTempFile(anchorsPath)
  })
})

// -----------------------------------------------------------------------------
// Edges Export/Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Edges Export/Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export edges to JSONL", async () => {
    const filePath = join(tempDir, "edges.jsonl")

    // Create an edge
    await Effect.runPromise(
      Effect.gen(function* () {
        const edgeRepo = yield* EdgeRepository
        yield* edgeRepo.create({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: "learning-1",
          targetType: "learning",
          targetId: "learning-2",
          weight: 0.85,
          metadata: { reason: "content overlap" }
        })
      }).pipe(Effect.provide(layer))
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.exportEdges(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.opCount).toBe(1)
    expect(existsSync(filePath)).toBe(true)

    const content = readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(1)

    const op = JSON.parse(lines[0])
    expect(op.op).toBe("edge_upsert")
    expect(op.contentHash).toBeTruthy()
    expect(op.data.edgeType).toBe("SIMILAR_TO")
    expect(op.data.sourceType).toBe("learning")
    expect(op.data.weight).toBe(0.85)
    expect(op.data.metadata).toEqual({ reason: "content overlap" })

    cleanupTempFile(filePath)
  })

  it("should round-trip edges through export/import", async () => {
    const filePath = join(tempDir, "edges-rt.jsonl")

    // Create edge
    await Effect.runPromise(
      Effect.gen(function* () {
        const edgeRepo = yield* EdgeRepository
        yield* edgeRepo.create({
          edgeType: "LINKS_TO",
          sourceType: "task",
          sourceId: fixtureId("edge-task-1"),
          targetType: "learning",
          targetId: "learning-42",
          weight: 0.7,
          metadata: { auto: true }
        })

        const sync = yield* SyncService
        yield* sync.exportEdges(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Clear edges
    db.exec("DELETE FROM learning_edges")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importEdges(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(1)

    // Verify edge data
    const edges = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* EdgeRepository
        return yield* repo.findAll()
      }).pipe(Effect.provide(layer))
    )

    expect(edges).toHaveLength(1)
    expect(edges[0].edgeType).toBe("LINKS_TO")
    expect(edges[0].sourceType).toBe("task")
    expect(edges[0].targetType).toBe("learning")
    expect(edges[0].weight).toBe(0.7)

    cleanupTempFile(filePath)
  })

  it("should skip duplicate edges on import", async () => {
    const filePath = join(tempDir, "edges-dup.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const edgeRepo = yield* EdgeRepository
        yield* edgeRepo.create({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: "dup-source",
          targetType: "learning",
          targetId: "dup-target",
          weight: 0.5
        })

        const sync = yield* SyncService
        yield* sync.exportEdges(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Import again without clearing — should skip
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importEdges(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)

    cleanupTempFile(filePath)
  })

  it("should not export invalidated edges", async () => {
    const filePath = join(tempDir, "edges-invalidated.jsonl")

    // Create an edge then invalidate it
    await Effect.runPromise(
      Effect.gen(function* () {
        const edgeRepo = yield* EdgeRepository
        const edge = yield* edgeRepo.create({
          edgeType: "SIMILAR_TO",
          sourceType: "learning",
          sourceId: "inv-source",
          targetType: "learning",
          targetId: "inv-target",
          weight: 0.9
        })
        yield* edgeRepo.invalidate(edge.id as number)

        const sync = yield* SyncService
        yield* sync.exportEdges(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Invalidated edge should not be exported
    const content = readFileSync(filePath, "utf-8").trim()
    expect(content).toBe("")

    cleanupTempFile(filePath)
  })
})

// -----------------------------------------------------------------------------
// Docs Export/Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Docs Export/Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export docs to JSONL", async () => {
    const filePath = join(tempDir, "docs-export.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        yield* docRepo.insert({
          hash: "abc123",
          kind: "overview",
          name: "test-feature",
          title: "Test Feature Overview",
          version: 1,
          filePath: "docs/overview/test-feature.md",
          parentDocId: null,
          metadata: "{}"
        })

        const sync = yield* SyncService
        yield* sync.exportDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, "utf-8").trim()
    const lines = content.split("\n")
    expect(lines.length).toBe(1)

    const op = JSON.parse(lines[0])
    expect(op.op).toBe("doc_upsert")
    expect(op.data.kind).toBe("overview")
    expect(op.data.name).toBe("test-feature")
    expect(op.data.title).toBe("Test Feature Overview")
    expect(op.data.version).toBe(1)
    expect(op.data.filePath).toBe("docs/overview/test-feature.md")

    cleanupTempFile(filePath)
  })

  it("should round-trip docs through export/import", async () => {
    const filePath = join(tempDir, "docs-roundtrip.jsonl")

    // Create docs
    await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        yield* docRepo.insert({
          hash: "hash1",
          kind: "overview",
          name: "feature-a",
          title: "Feature A Overview",
          version: 1,
          filePath: "docs/overview/feature-a.md",
          parentDocId: null,
          metadata: "{}"
        })
        yield* docRepo.insert({
          hash: "hash2",
          kind: "prd",
          name: "feature-a-prd",
          title: "Feature A PRD",
          version: 1,
          filePath: "docs/prd/feature-a.md",
          parentDocId: null,
          metadata: "{}"
        })

        const sync = yield* SyncService
        yield* sync.exportDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Wipe docs table
    db.run("DELETE FROM docs")

    // Import
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)

    // Verify docs exist
    const docs = await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        return yield* docRepo.findAll()
      }).pipe(Effect.provide(layer))
    )
    expect(docs.length).toBe(2)
    const names = docs.map(d => d.name).sort()
    expect(names).toEqual(["feature-a", "feature-a-prd"])

    cleanupTempFile(filePath)
  })

  it("should skip duplicate docs on import", async () => {
    const filePath = join(tempDir, "docs-dedup.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        yield* docRepo.insert({
          hash: "hash1",
          kind: "design",
          name: "dd-test",
          title: "DD Test",
          version: 1,
          filePath: "docs/design/dd-test.md",
          parentDocId: null,
          metadata: "{}"
        })

        const sync = yield* SyncService
        yield* sync.exportDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Import without clearing — should skip existing
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBeGreaterThanOrEqual(1)

    cleanupTempFile(filePath)
  })

  it("should export and import doc links", async () => {
    const filePath = join(tempDir, "docs-links.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        const overview = yield* docRepo.insert({
          hash: "oh1",
          kind: "overview",
          name: "linked-feature",
          title: "Linked Feature",
          version: 1,
          filePath: "docs/overview/linked.md",
          parentDocId: null,
          metadata: "{}"
        })
        const prd = yield* docRepo.insert({
          hash: "ph1",
          kind: "prd",
          name: "linked-feature-prd",
          title: "Linked Feature PRD",
          version: 1,
          filePath: "docs/prd/linked.md",
          parentDocId: null,
          metadata: "{}"
        })
        yield* docRepo.createLink(overview.id, prd.id, "overview_to_prd")

        const sync = yield* SyncService
        yield* sync.exportDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Verify doc link is in export
    const content = readFileSync(filePath, "utf-8").trim()
    const lines = content.split("\n")
    const linkOps = lines.map(l => JSON.parse(l)).filter(op => op.op === "doc_link_upsert")
    expect(linkOps.length).toBe(1)
    expect(linkOps[0].data.linkType).toBe("overview_to_prd")

    // Wipe and reimport
    db.run("DELETE FROM doc_links")
    db.run("DELETE FROM docs")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    // 2 docs + 1 doc link = 3 imported
    expect(result.imported).toBe(3)

    // Verify doc link exists
    const links = await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        return yield* docRepo.getAllLinks()
      }).pipe(Effect.provide(layer))
    )
    expect(links.length).toBe(1)
    expect(links[0].linkType).toBe("overview_to_prd")

    cleanupTempFile(filePath)
  })

  it("should export and import invariants", async () => {
    const filePath = join(tempDir, "docs-invariants.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        const doc = yield* docRepo.insert({
          hash: "invhash1",
          kind: "design",
          name: "inv-test-doc",
          title: "Invariant Test Doc",
          version: 1,
          filePath: "docs/design/inv-test.md",
          parentDocId: null,
          metadata: "{}"
        })
        yield* docRepo.upsertInvariant({
          id: "INV-TEST-001",
          rule: "All functions must have tests",
          enforcement: "integration_test",
          docId: doc.id,
          subsystem: "core",
          testRef: "test/core.test.ts"
        })

        const sync = yield* SyncService
        yield* sync.exportDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Verify invariant is in export
    const content = readFileSync(filePath, "utf-8").trim()
    const lines = content.split("\n")
    const invOps = lines.map(l => JSON.parse(l)).filter(op => op.op === "invariant_upsert")
    expect(invOps.length).toBe(1)
    expect(invOps[0].id).toBe("INV-TEST-001")
    expect(invOps[0].data.rule).toBe("All functions must have tests")

    // Wipe and reimport
    db.run("DELETE FROM invariants")
    db.run("DELETE FROM docs")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    // 1 doc + 1 invariant = 2 imported
    expect(result.imported).toBe(2)

    // Verify invariant exists
    const inv = await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        return yield* docRepo.findInvariantById("INV-TEST-001")
      }).pipe(Effect.provide(layer))
    )
    expect(inv).not.toBeNull()
    expect(inv!.rule).toBe("All functions must have tests")
    expect(inv!.enforcement).toBe("integration_test")
    expect(inv!.subsystem).toBe("core")

    cleanupTempFile(filePath)
  })

  it("should export lockedAt field for locked docs", async () => {
    const filePath = join(tempDir, "docs-locked.jsonl")

    await Effect.runPromise(
      Effect.gen(function* () {
        const docRepo = yield* DocRepository
        const doc = yield* docRepo.insert({
          hash: "lockhash1",
          kind: "design",
          name: "locked-doc",
          title: "Locked Doc",
          version: 1,
          filePath: "docs/design/locked.md",
          parentDocId: null,
          metadata: "{}"
        })
        yield* docRepo.lock(doc.id, new Date().toISOString())

        const sync = yield* SyncService
        yield* sync.exportDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    const content = readFileSync(filePath, "utf-8").trim()
    const op = JSON.parse(content.split("\n")[0])
    expect(op.data.status).toBe("locked")
    expect(op.data.lockedAt).not.toBeNull()

    cleanupTempFile(filePath)
  })

  it("should return empty result for non-existent docs file", async () => {
    const filePath = join(tempDir, "nonexistent-docs.jsonl")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importDocs(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
  })
})

// -----------------------------------------------------------------------------
// Labels Export/Import Tests
// -----------------------------------------------------------------------------

describe("SyncService Labels Export/Import", () => {
  let shared: SharedTestLayerResult
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>
  let tempDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = shared.getDb()
    seedFixtures({ db } as any)
    layer = makeTestLayer(db)
    tempDir = createTempDir()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("should export labels to JSONL", async () => {
    const filePath = join(tempDir, "labels-export.jsonl")

    // Insert labels via raw SQL (no repository layer)
    db.run("INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))", ["bug", "#FF0000"])
    db.run("INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))", ["feature", "#00FF00"])

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.exportLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, "utf-8").trim()
    const lines = content.split("\n")
    expect(lines.length).toBe(2)

    const ops = lines.map(l => JSON.parse(l))
    expect(ops.every(op => op.op === "label_upsert")).toBe(true)
    const names = ops.map(op => op.data.name).sort()
    expect(names).toEqual(["bug", "feature"])

    cleanupTempFile(filePath)
  })

  it("should round-trip labels through export/import", async () => {
    const filePath = join(tempDir, "labels-roundtrip.jsonl")

    db.run("INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))", ["urgent", "#FF0000"])
    db.run("INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))", ["low-priority", "#999999"])

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.exportLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Wipe labels
    db.run("DELETE FROM task_labels")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)

    // Verify labels exist
    const labels = db.prepare("SELECT * FROM task_labels ORDER BY name").all() as Array<{ name: string; color: string }>
    expect(labels.length).toBe(2)
    expect(labels[0].name).toBe("low-priority")
    expect(labels[0].color).toBe("#999999")
    expect(labels[1].name).toBe("urgent")
    expect(labels[1].color).toBe("#FF0000")

    cleanupTempFile(filePath)
  })

  it("should skip duplicate labels on import", async () => {
    const filePath = join(tempDir, "labels-dedup.jsonl")

    db.run("INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))", ["duplicate-label", "#AABBCC"])

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.exportLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Import without clearing — should skip
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBeGreaterThanOrEqual(1)

    // Verify no duplicates
    const count = (db.prepare("SELECT COUNT(*) as c FROM task_labels").get() as { c: number }).c
    expect(count).toBe(1)

    cleanupTempFile(filePath)
  })

  it("should export and import label assignments", async () => {
    const filePath = join(tempDir, "labels-assignments.jsonl")

    // Create a task first
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.create({ title: "Label test task", description: "test" })
      }).pipe(Effect.provide(layer))
    )

    const taskRow = db.prepare("SELECT id FROM tasks LIMIT 1").get() as { id: string }
    const taskId = taskRow.id

    // Create label and assignment
    db.run("INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))", ["assigned-label", "#112233"])
    const labelRow = db.prepare("SELECT id FROM task_labels WHERE name = ?").get("assigned-label") as { id: number }
    db.run("INSERT INTO task_label_assignments (task_id, label_id, created_at) VALUES (?, ?, datetime('now'))", [taskId, labelRow.id])

    await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        yield* sync.exportLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    // Verify assignment in export
    const content = readFileSync(filePath, "utf-8").trim()
    const lines = content.split("\n")
    const assignmentOps = lines.map(l => JSON.parse(l)).filter(op => op.op === "label_assignment_upsert")
    expect(assignmentOps.length).toBe(1)
    expect(assignmentOps[0].data.taskId).toBe(taskId)
    expect(assignmentOps[0].data.labelName).toBe("assigned-label")

    // Wipe and reimport
    db.run("DELETE FROM task_label_assignments")
    db.run("DELETE FROM task_labels")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    // 1 label + 1 assignment = 2 imported
    expect(result.imported).toBe(2)

    // Verify assignment exists
    const assignments = db.prepare("SELECT * FROM task_label_assignments WHERE task_id = ?").all(taskId) as Array<{ task_id: string; label_id: number }>
    expect(assignments.length).toBe(1)

    cleanupTempFile(filePath)
  })

  it("should return empty result for non-existent labels file", async () => {
    const filePath = join(tempDir, "nonexistent-labels.jsonl")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sync = yield* SyncService
        return yield* sync.importLabels(filePath)
      }).pipe(Effect.provide(layer))
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
  })
})
