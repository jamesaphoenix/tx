/**
 * AutoSyncService Integration Tests
 *
 * Tests the background fiber-based auto-sync functionality:
 * - Export failures in background fiber (should log, not throw)
 * - Race conditions when multiple mutations trigger concurrent exports
 * - Fiber cleanup on service shutdown
 * - Config toggle during active export
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 * Per task tx-ae35ec58: Critical tests for untested background service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Effect, Layer, Duration } from "effect"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  GuardRepositoryLive,
  LearningRepositoryLive,
  FileLearningRepositoryLive,
  AttemptRepositoryLive,
  PinRepositoryLive,
  AnchorRepositoryLive,
  EdgeRepositoryLive,
  DocRepositoryLive,
  TaskServiceLive,
  StreamServiceLive,
  SyncServiceLive,
  SyncService,
  AutoSyncServiceLive,
  AutoSyncService,
  DatabaseError
} from "@jamesaphoenix/tx-core"

type SyncServiceStub = Parameters<typeof SyncService.of>[0]

const MOCK_STREAM_ID = "01H00000000000000000000000"
const MOCK_STREAM_PATH = ".tx/streams/mock/events-2026-03-05.jsonl"
const EMPTY_DEPENDENCY_IMPORT_RESULT = { added: 0, removed: 0, skipped: 0, failures: [] as const }
const EMPTY_SYNC_EXPORT_RESULT = { eventCount: 0, opCount: 0, streamId: MOCK_STREAM_ID, path: MOCK_STREAM_PATH }
const EMPTY_SYNC_IMPORT_RESULT = {
  importedEvents: 0,
  appliedEvents: 0,
  streamCount: 0,
  imported: 0,
  skipped: 0,
  conflicts: 0,
  dependencies: EMPTY_DEPENDENCY_IMPORT_RESULT
}

const makeBaseSyncServiceStub = (): SyncServiceStub => ({
  export: () => Effect.succeed(EMPTY_SYNC_EXPORT_RESULT),
  status: () => Effect.succeed({ dbTaskCount: 0, eventOpCount: 0, lastExport: null, lastImport: null, isDirty: false, autoSyncEnabled: false }),
  enableAutoSync: () => Effect.void,
  disableAutoSync: () => Effect.void,
  isAutoSyncEnabled: () => Effect.succeed(false),
  import: () => Effect.succeed(EMPTY_SYNC_IMPORT_RESULT),
  hydrate: () => Effect.succeed({ importedEvents: 0, appliedEvents: 0, streamCount: 0, rebuilt: true }),
  compact: () => Effect.succeed({ before: 0, after: 0, path: ".tx/tasks.jsonl" }),
  stream: () => Effect.succeed({ streamId: MOCK_STREAM_ID, nextSeq: 1, lastSeq: 0, eventsDir: ".tx/streams/mock", configPath: ".tx/stream.json", knownStreams: [] })
})

const makeSyncServiceStub = (overrides: Partial<SyncServiceStub> = {}): SyncServiceStub => ({
  ...makeBaseSyncServiceStub(),
  ...overrides,
})

// -----------------------------------------------------------------------------
// Test Layer Factory
// -----------------------------------------------------------------------------

/**
 * Creates a test layer with a mock SyncService that can be configured to fail.
 */
function makeMockSyncServiceLayer(
  db: TestDatabase,
  options: {
    exportShouldFail?: boolean
    exportDelay?: number
    onExportCalled?: () => void
  } = {}
) {
  const infra = Layer.succeed(SqliteClient, db.db as Database)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive
  ).pipe(Layer.provide(infra))

  // Mock SyncService
  const mockSyncService = Layer.succeed(
    SyncService,
    SyncService.of(makeSyncServiceStub({
      export: () =>
        Effect.gen(function* () {
          options.onExportCalled?.()

          if (options.exportDelay) {
            yield* Effect.sleep(Duration.millis(options.exportDelay))
          }

          if (options.exportShouldFail) {
            return yield* Effect.fail(new DatabaseError({ cause: new Error("Mock export failure") }))
          }

          return EMPTY_SYNC_EXPORT_RESULT
        }),
    }))
  )

  // Build AutoSyncService with mock SyncService
  const autoSyncService = AutoSyncServiceLive.pipe(
    Layer.provide(Layer.mergeAll(mockSyncService, infra))
  )

  return Layer.mergeAll(autoSyncService, mockSyncService, repos, infra)
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Enable auto-sync in the database directly.
 */
function enableAutoSyncInDb(db: TestDatabase): void {
  db.db.prepare(
    "INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES ('auto_sync', 'true', datetime('now'))"
  ).run()
}

/**
 * Disable auto-sync in the database directly.
 */
function disableAutoSyncInDb(db: TestDatabase): void {
  db.db.prepare(
    "INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES ('auto_sync', 'false', datetime('now'))"
  ).run()
}

/**
 * Build a real (no-mock) layer for AutoSyncService + SyncService integration tests.
 */
function makeRealAutoSyncLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as Database)

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    GuardRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive,
    PinRepositoryLive,
    AnchorRepositoryLive,
    EdgeRepositoryLive,
    DocRepositoryLive,
  ).pipe(Layer.provide(infra))

  const taskServiceForSync = TaskServiceLive.pipe(Layer.provide(repos))
  const streamService = StreamServiceLive.pipe(Layer.provide(infra))
  const syncService = SyncServiceLive.pipe(
    Layer.provide(Layer.mergeAll(infra, repos, taskServiceForSync, streamService))
  )
  const autoSyncService = AutoSyncServiceLive.pipe(
    Layer.provide(Layer.merge(infra, syncService))
  )

  return Layer.mergeAll(infra, repos, taskServiceForSync, streamService, syncService, autoSyncService)
}

// -----------------------------------------------------------------------------
// Export Failure Tests
// -----------------------------------------------------------------------------

describe("AutoSyncService Export Failures", () => {
  let db: TestDatabase
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(async () => {
    consoleErrorSpy.mockRestore()
    await Effect.runPromise(db.close())
  })

  it("logs errors when export fails in background but does not throw", async () => {
    const layer = makeMockSyncServiceLayer(db, { exportShouldFail: true })
    enableAutoSyncInDb(db)

    // Trigger auto-sync - this should NOT throw even though export fails
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        // Trigger the mutation hook
        yield* autoSync.afterTaskMutation()

        // Give the background fiber time to execute
        yield* Effect.sleep(Duration.millis(50))

        return "completed"
      }).pipe(Effect.provide(layer))
    )

    // The effect should complete successfully (not throw)
    expect(result).toBe("completed")

    // The error should have been logged
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("[auto-sync]")
  })

  it("does not log errors when auto-sync is disabled", async () => {
    const layer = makeMockSyncServiceLayer(db, { exportShouldFail: true })
    disableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))
      }).pipe(Effect.provide(layer))
    )

    // No export should have been attempted, so no errors
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("continues processing subsequent mutations after export failure", async () => {
    let exportCallCount = 0
    const layer = makeMockSyncServiceLayer(db, {
      exportShouldFail: true,
      onExportCalled: () => { exportCallCount++ }
    })
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        // Trigger multiple mutations
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))
      }).pipe(Effect.provide(layer))
    )

    // All three mutations should have triggered exports
    expect(exportCallCount).toBe(3)

    // All three should have logged errors
    expect(consoleErrorSpy).toHaveBeenCalledTimes(3)
  })
})

// -----------------------------------------------------------------------------
// Concurrent Export Tests
// -----------------------------------------------------------------------------

describe("AutoSyncService Concurrent Exports", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Effect.runPromise(db.close())
  })

  it("rapid mutations coalesce — only last export completes", async () => {
    let exportCompletedCount = 0

    const infra = Layer.succeed(SqliteClient, db.db as Database)
    const mockSyncService = Layer.succeed(
      SyncService,
      SyncService.of(makeSyncServiceStub({
        export: () =>
          Effect.gen(function* () {
            // Simulate async work — this is the yield point where interruption occurs
            yield* Effect.sleep(Duration.millis(50))
            // Only reached if fiber was NOT interrupted
            exportCompletedCount++
            return EMPTY_SYNC_EXPORT_RESULT
          }),
      }))
    )
    const autoSyncService = AutoSyncServiceLive.pipe(
      Layer.provide(Layer.mergeAll(mockSyncService, infra))
    )
    const layer = Layer.mergeAll(autoSyncService, mockSyncService, infra)
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        // Trigger 5 rapid mutations — each interrupts the previous export fiber
        yield* autoSync.afterTaskMutation()
        yield* autoSync.afterTaskMutation()
        yield* autoSync.afterTaskMutation()
        yield* autoSync.afterTaskMutation()
        yield* autoSync.afterTaskMutation()

        // Wait for the last export to complete
        yield* Effect.sleep(Duration.millis(200))
      }).pipe(Effect.provide(layer))
    )

    // Only the last export should have completed; previous ones were interrupted
    expect(exportCompletedCount).toBe(1)
  })

  it("spaced mutations each complete their own export even when some fail", async () => {
    let successCount = 0
    let failCount = 0
    let callIndex = 0

    // Create a layer where every other export fails
    const infra = Layer.succeed(SqliteClient, db.db as Database)
    const repos = Layer.mergeAll(
      TaskRepositoryLive,
      DependencyRepositoryLive,
      LearningRepositoryLive,
      FileLearningRepositoryLive,
      AttemptRepositoryLive
    ).pipe(Layer.provide(infra))

    const mockSyncService = Layer.succeed(
      SyncService,
      SyncService.of(makeSyncServiceStub({
        export: () =>
          Effect.gen(function* () {
            const idx = callIndex++
            yield* Effect.sleep(Duration.millis(10))

            if (idx % 2 === 0) {
              failCount++
              return yield* Effect.fail(new DatabaseError({ cause: new Error("Alternating failure") }))
            }

            successCount++
            return EMPTY_SYNC_EXPORT_RESULT
          }),
      }))
    )

    const autoSyncService = AutoSyncServiceLive.pipe(
      Layer.provide(Layer.mergeAll(mockSyncService, infra))
    )

    const layer = Layer.mergeAll(autoSyncService, mockSyncService, repos, infra)
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        // Spaced mutations — each export completes before the next mutation
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))
      }).pipe(Effect.provide(layer))
    )

    // 2 should succeed, 2 should fail (indices 0, 2 fail; 1, 3 succeed)
    expect(successCount).toBe(2)
    expect(failCount).toBe(2)
  })

  it("mutation hooks return immediately without waiting for export", async () => {
    let exportCompleted = false

    const layer = makeMockSyncServiceLayer(db, {
      exportDelay: 500,
      onExportCalled: () => {
        // Export completion is tracked after delay
        setTimeout(() => { exportCompleted = true }, 500)
      }
    })
    enableAutoSyncInDb(db)

    const startTime = Date.now()

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterTaskMutation()
      }).pipe(Effect.provide(layer))
    )

    const endTime = Date.now()

    // The mutation hook should return almost immediately (< 100ms)
    // not wait for the 500ms export
    expect(endTime - startTime).toBeLessThan(100)

    // Export should NOT have completed yet
    expect(exportCompleted).toBe(false)

    // Wait for export to actually complete
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(exportCompleted).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Config Toggle Tests
// -----------------------------------------------------------------------------

describe("AutoSyncService Config Changes", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Effect.runPromise(db.close())
  })

  it("respects config when auto-sync is disabled", async () => {
    let exportCalled = false
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCalled = true }
    })
    disableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))
      }).pipe(Effect.provide(layer))
    )

    expect(exportCalled).toBe(false)
  })

  it("respects config when auto-sync is enabled", async () => {
    let exportCalled = false
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCalled = true }
    })
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))
      }).pipe(Effect.provide(layer))
    )

    expect(exportCalled).toBe(true)
  })

  it("disabling config mid-session stops new exports", async () => {
    let exportCallCount = 0
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCallCount++ }
    })
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        // First mutation with auto-sync enabled
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        // Disable auto-sync mid-session
        disableAutoSyncInDb(db)

        // Second mutation with auto-sync disabled
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        // Third mutation
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))
      }).pipe(Effect.provide(layer))
    )

    // Only the first mutation should have triggered an export
    expect(exportCallCount).toBe(1)
  })

  it("enabling config mid-session starts exports", async () => {
    let exportCallCount = 0
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCallCount++ }
    })
    disableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        // First mutation with auto-sync disabled
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        // Enable auto-sync mid-session
        enableAutoSyncInDb(db)

        // Second and third mutations with auto-sync enabled
        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))

        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(50))
      }).pipe(Effect.provide(layer))
    )

    // Only the second and third mutations should have triggered exports
    expect(exportCallCount).toBe(2)
  })

  it("handles database errors when checking config gracefully", async () => {
    // Create a layer where checking isEnabled fails
    const infra = Layer.succeed(SqliteClient, db.db as Database)

    // Close the database to cause errors
    db.db.close()

    const mockSyncService = Layer.succeed(
      SyncService,
      SyncService.of(makeSyncServiceStub())
    )

    const autoSyncService = AutoSyncServiceLive.pipe(
      Layer.provide(Layer.mergeAll(mockSyncService, infra))
    )

    const layer = Layer.mergeAll(autoSyncService, mockSyncService, infra)

    // This should not throw even though the database is closed
    // The isEnabled check should catch the error and return false
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterTaskMutation()
        return "completed"
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe("completed")
  })
})

// -----------------------------------------------------------------------------
// Entity-Specific Mutation Tests
// -----------------------------------------------------------------------------

describe("AutoSyncService Entity Mutations", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Effect.runPromise(db.close())
  })

  it("afterLearningMutation triggers export", async () => {
    let exportCalled = false
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCalled = true }
    })
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterLearningMutation()
        // Poll until the background fiber fires (up to 500ms)
        for (let i = 0; i < 50 && !exportCalled; i++) {
          yield* Effect.sleep(Duration.millis(10))
        }
      }).pipe(Effect.provide(layer))
    )

    expect(exportCalled).toBe(true)
  })

  it("afterFileLearningMutation triggers export", async () => {
    let exportCalled = false
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCalled = true }
    })
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterFileLearningMutation()
        // Poll until the background fiber fires (up to 500ms)
        for (let i = 0; i < 50 && !exportCalled; i++) {
          yield* Effect.sleep(Duration.millis(10))
        }
      }).pipe(Effect.provide(layer))
    )

    expect(exportCalled).toBe(true)
  })

  it("afterAttemptMutation triggers export", async () => {
    let exportCalled = false
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCalled = true }
    })
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterAttemptMutation()
        for (let i = 0; i < 50 && !exportCalled; i++) {
          yield* Effect.sleep(Duration.millis(10))
        }
      }).pipe(Effect.provide(layer))
    )

    expect(exportCalled).toBe(true)
  })

  it("afterAnyMutation triggers export", async () => {
    let exportCalled = false
    const layer = makeMockSyncServiceLayer(db, {
      onExportCalled: () => { exportCalled = true }
    })
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        yield* autoSync.afterAnyMutation()
        for (let i = 0; i < 50 && !exportCalled; i++) {
          yield* Effect.sleep(Duration.millis(10))
        }
      }).pipe(Effect.provide(layer))
    )

    expect(exportCalled).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Performance Impact Tests
// -----------------------------------------------------------------------------

describe("AutoSyncService Performance", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Effect.runPromise(db.close())
  })

  it("mutation hooks add minimal latency to operations", async () => {
    const layer = makeMockSyncServiceLayer(db, {
      exportDelay: 1000 // Simulate slow export
    })
    enableAutoSyncInDb(db)

    const iterations = 100
    const startTime = Date.now()

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        for (let i = 0; i < iterations; i++) {
          yield* autoSync.afterTaskMutation()
        }
      }).pipe(Effect.provide(layer))
    )

    const endTime = Date.now()
    const totalTime = endTime - startTime
    const avgTimePerMutation = totalTime / iterations

    // Average time per mutation should be very low (< 5ms)
    // since the actual export runs in background
    expect(avgTimePerMutation).toBeLessThan(5)
  })

  it("background exports do not block caller", async () => {
    // Track timing of mutation vs export completion
    const mutationCompleteTimes: number[] = []
    let exportCompletedAt = 0
    const startTime = Date.now()

    const infra = Layer.succeed(SqliteClient, db.db as Database)
    const repos = Layer.mergeAll(
      TaskRepositoryLive,
      DependencyRepositoryLive,
      LearningRepositoryLive,
      FileLearningRepositoryLive,
      AttemptRepositoryLive
    ).pipe(Layer.provide(infra))

    const mockSyncService = Layer.succeed(
      SyncService,
      SyncService.of(makeSyncServiceStub({
        export: () =>
          Effect.gen(function* () {
            yield* Effect.sleep(Duration.millis(100))
            exportCompletedAt = Date.now() - startTime
            return EMPTY_SYNC_EXPORT_RESULT
          }),
      }))
    )

    const autoSyncService = AutoSyncServiceLive.pipe(
      Layer.provide(Layer.mergeAll(mockSyncService, infra))
    )

    const layer = Layer.mergeAll(autoSyncService, mockSyncService, repos, infra)
    enableAutoSyncInDb(db)

    await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService

        // Trigger 3 rapid mutations and record when they complete
        for (let i = 0; i < 3; i++) {
          yield* autoSync.afterTaskMutation()
          mutationCompleteTimes.push(Date.now() - startTime)
        }

        // Wait for the last export to complete
        yield* Effect.sleep(Duration.millis(300))
      }).pipe(Effect.provide(layer))
    )

    // All mutations should complete quickly (before the export)
    expect(mutationCompleteTimes.length).toBe(3)
    for (const t of mutationCompleteTimes) {
      expect(t).toBeLessThan(100)
    }

    // The export should have completed after the mutations
    // (only the last export runs due to deduplication)
    expect(exportCompletedAt).toBeGreaterThan(0)
    expect(exportCompletedAt).toBeGreaterThan(mutationCompleteTimes[2])
  })
})

// -----------------------------------------------------------------------------
// No-Mock Integration Tests
// -----------------------------------------------------------------------------

describe("AutoSyncService Real Integration (No Mocks)", () => {
  let db: TestDatabase
  let originalCwd: string
  let tempProjectDir: string

  const insertTask = (id: string, title: string) => {
    const now = new Date().toISOString()
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, title, "", "backlog", null, 100, now, now, null, "{}")
  }

  const updateTaskStatus = (id: string, status: string) => {
    db.db
      .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id)
  }

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "tx-auto-sync-real-"))
    process.chdir(tempProjectDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    if (existsSync(tempProjectDir)) {
      rmSync(tempProjectDir, { recursive: true, force: true })
    }
    await Effect.runPromise(db.close())
  })

  it("exports real stream events from afterTaskMutation when auto-sync is enabled", async () => {
    const layer = makeRealAutoSyncLayer(db)
    enableAutoSyncInDb(db)
    insertTask("tx-asr001", "auto-sync enabled")

    const eventCount = await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        const sqlite = yield* SqliteClient

        yield* autoSync.afterTaskMutation()

        for (let attempt = 0; attempt < 25; attempt++) {
          const row = sqlite.prepare("SELECT COUNT(*) AS c FROM sync_events").get() as { c: number }
          if (row.c > 0) {
            return row.c
          }
          yield* Effect.sleep(Duration.millis(20))
        }

        return 0
      }).pipe(Effect.provide(layer))
    )

    expect(eventCount).toBeGreaterThan(0)
    expect(existsSync(join(tempProjectDir, ".tx", "stream.json"))).toBe(true)
  })

  it("does not export events when auto-sync is disabled", async () => {
    const layer = makeRealAutoSyncLayer(db)
    disableAutoSyncInDb(db)
    insertTask("tx-asr002", "auto-sync disabled")

    const eventCount = await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        const sqlite = yield* SqliteClient

        yield* autoSync.afterTaskMutation()
        yield* Effect.sleep(Duration.millis(150))

        const row = sqlite.prepare("SELECT COUNT(*) AS c FROM sync_events").get() as { c: number }
        return row.c
      }).pipe(Effect.provide(layer))
    )

    expect(eventCount).toBe(0)
    expect(existsSync(join(tempProjectDir, ".tx", "stream.json"))).toBe(false)
  })

  it("preserves final task state after rapid real mutations and hydrate replay", async () => {
    const layer = makeRealAutoSyncLayer(db)
    enableAutoSyncInDb(db)
    insertTask("tx-asr003", "rapid real mutations")

    const restoredStatus = await Effect.runPromise(
      Effect.gen(function* () {
        const autoSync = yield* AutoSyncService
        const sqlite = yield* SqliteClient
        const syncService = yield* SyncService

        for (const status of ["ready", "active", "review", "done"]) {
          updateTaskStatus("tx-asr003", status)
          yield* autoSync.afterTaskMutation()
        }

        // Wait for background auto-sync export to complete.
        for (let attempt = 0; attempt < 30; attempt++) {
          const row = sqlite.prepare("SELECT COUNT(*) AS c FROM sync_events").get() as { c: number }
          if (row.c > 0) {
            break
          }
          yield* Effect.sleep(Duration.millis(20))
        }

        sqlite.prepare("DELETE FROM tasks WHERE id = ?").run("tx-asr003")
        yield* syncService.hydrate()

        const restored = sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get("tx-asr003") as { status?: string } | undefined
        return restored?.status ?? null
      }).pipe(Effect.provide(layer))
    )

    expect(restoredStatus).toBe("done")
  })
})
