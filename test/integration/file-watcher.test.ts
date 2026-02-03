/**
 * FileWatcherService Integration Tests
 *
 * Tests file watching capabilities with real temp directories and chokidar.
 * Covers file add/change/delete detection, debounce behavior, and lifecycle.
 *
 * @see PRD-015 for daemon specification
 * @see DD-015 for daemon architecture
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Queue } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { fixtureId } from "@jamesaphoenix/tx-test-utils"
import {
  FileWatcherService,
  FileWatcherServiceLive,
  FileWatcherServiceNoop,
  type FileEvent
} from "@jamesaphoenix/tx-core/services"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const FIXTURES = {
  // File names for test files
  FILE_SESSION_1: fixtureId("file-watcher:session-1") + ".jsonl",
  FILE_SESSION_2: fixtureId("file-watcher:session-2") + ".jsonl",
  FILE_LOG: fixtureId("file-watcher:log") + ".log",
  FILE_TXT: fixtureId("file-watcher:text") + ".txt",

  // Test content
  JSONL_LINE_1: '{"type":"user","content":"Hello"}',
  JSONL_LINE_2: '{"type":"assistant","content":"Hi there"}',
  JSONL_LINE_3: '{"type":"tool_call","tool":"Read"}'
} as const

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create temp directory for test files.
 */
const createTempDir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tx-file-watcher-test-"))
}

/**
 * Clean up temp directory.
 */
const cleanupTempDir = (tempDir: string): void => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Wait for a specific file event type from the queue.
 * Returns when matching event is found or timeout.
 */
const waitForEvent = (
  queue: Queue.Queue<FileEvent>,
  filter: (event: FileEvent) => boolean,
  timeoutMs: number = 5000
): Effect.Effect<FileEvent | null> =>
  Effect.gen(function* () {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      // Try to take with a short timeout
      const result = yield* Queue.poll(queue)

      if (result._tag === "Some") {
        const event = result.value
        if (filter(event)) {
          return event
        }
      }

      // Small delay before trying again
      yield* Effect.sleep(50)
    }

    return null
  })

/**
 * Collect all events from queue within a time window.
 */
const collectEvents = (
  queue: Queue.Queue<FileEvent>,
  durationMs: number = 1000
): Effect.Effect<FileEvent[]> =>
  Effect.gen(function* () {
    const events: FileEvent[] = []
    const endTime = Date.now() + durationMs

    while (Date.now() < endTime) {
      const result = yield* Queue.poll(queue)
      if (result._tag === "Some") {
        events.push(result.value)
      }
      yield* Effect.sleep(50)
    }

    return events
  })

/**
 * Wait for the watcher to stabilize after starting.
 */
const waitForReady = (ms: number = 500): Effect.Effect<void> =>
  Effect.sleep(ms)

// =============================================================================
// FileWatcherServiceNoop Tests
// =============================================================================

describe("FileWatcherServiceNoop", () => {
  it("start succeeds without actually watching", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({ patterns: ["/tmp/*.jsonl"] })

          return yield* watcher.isRunning()
        }).pipe(Effect.provide(FileWatcherServiceNoop))
      )
    )

    // Noop returns false for isRunning
    expect(result).toBe(false)
  })

  it("stop succeeds without error", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService
          yield* watcher.stop()
        }).pipe(Effect.provide(FileWatcherServiceNoop))
      )
    )
    // No error thrown = success
    expect(true).toBe(true)
  })

  it("getWatchedPaths returns empty array", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService
          return yield* watcher.getWatchedPaths()
        }).pipe(Effect.provide(FileWatcherServiceNoop))
      )
    )

    expect(result).toEqual([])
  })

  it("status returns not running", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService
          return yield* watcher.status()
        }).pipe(Effect.provide(FileWatcherServiceNoop))
      )
    )

    expect(result.running).toBe(false)
    expect(result.watchedPaths).toEqual([])
    expect(result.startedAt).toBeNull()
    expect(result.eventsProcessed).toBe(0)
  })

  it("getEventQueue returns empty queue", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService
          const queue = yield* watcher.getEventQueue()
          return yield* Queue.size(queue)
        }).pipe(Effect.provide(FileWatcherServiceNoop))
      )
    )

    expect(result).toBe(0)
  })
})

// =============================================================================
// FileWatcherServiceLive - Lifecycle Tests
// =============================================================================

describe("FileWatcherServiceLive Lifecycle", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("starts and stops successfully", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          // Start watching
          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const runningAfterStart = yield* watcher.isRunning()

          // Stop watching
          yield* watcher.stop()
          const runningAfterStop = yield* watcher.isRunning()

          return { runningAfterStart, runningAfterStop }
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result.runningAfterStart).toBe(true)
    expect(result.runningAfterStop).toBe(false)
  })

  it("fails to start when already running", async () => {
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            ignoreInitial: true
          })

          yield* waitForReady()

          // Try to start again
          return yield* watcher.start({
            patterns: [path.join(tempDir, "*.txt")]
          }).pipe(Effect.flip)
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(error._tag).toBe("WatcherAlreadyRunningError")
  })

  it("fails to stop when not running", async () => {
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          // Try to stop without starting
          return yield* watcher.stop().pipe(Effect.flip)
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(error._tag).toBe("WatcherNotRunningError")
  })

  it("returns correct status when running", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "**/*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const status = yield* watcher.status()
          yield* watcher.stop()

          return status
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result.running).toBe(true)
    expect(result.watchedPaths.length).toBeGreaterThan(0)
    expect(result.startedAt).toBeInstanceOf(Date)
    expect(result.eventsProcessed).toBeGreaterThanOrEqual(0)
  })

  it("returns watched paths", async () => {
    const pattern = path.join(tempDir, "**/*.jsonl")

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [pattern],
            ignoreInitial: true
          })

          yield* waitForReady()

          const paths = yield* watcher.getWatchedPaths()
          yield* watcher.stop()

          return paths
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result.length).toBe(1)
    // The path should be expanded (no tilde)
    expect(result[0]).not.toContain("~")
  })

  it("cleans up on scope finalization", async () => {
    // This test verifies the watcher is properly cleaned up when scope ends
    let wasRunning = false

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            ignoreInitial: true
          })

          yield* waitForReady()

          wasRunning = yield* watcher.isRunning()
          // Don't explicitly stop - let scope cleanup handle it
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(wasRunning).toBe(true)
    // Scope has ended, watcher should be cleaned up (we can't verify this directly)
  })
})

// =============================================================================
// FileWatcherServiceLive - File Add Detection Tests
// =============================================================================

describe("FileWatcherServiceLive File Add Detection", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("detects new file creation", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Create a new file
          const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
          fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

          // Wait for event
          const event = yield* waitForEvent(
            queue,
            (e) => e.type === "add" && e.path === filePath
          )

          yield* watcher.stop()

          return event
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result).not.toBeNull()
    expect(result!.type).toBe("add")
    expect(result!.path).toContain(FIXTURES.FILE_SESSION_1)
    expect(result!.timestamp).toBeInstanceOf(Date)
  })

  it("detects multiple file creations", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Create multiple files
          const file1 = path.join(tempDir, FIXTURES.FILE_SESSION_1)
          const file2 = path.join(tempDir, FIXTURES.FILE_SESSION_2)

          fs.writeFileSync(file1, FIXTURES.JSONL_LINE_1)
          yield* Effect.sleep(200) // Small delay between creations
          fs.writeFileSync(file2, FIXTURES.JSONL_LINE_2)

          // Collect events
          const events = yield* collectEvents(queue, 3000)

          yield* watcher.stop()

          return events.filter((e) => e.type === "add")
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result.length).toBeGreaterThanOrEqual(2)
    const paths = result.map((e) => e.path)
    expect(paths.some((p) => p.includes(FIXTURES.FILE_SESSION_1))).toBe(true)
    expect(paths.some((p) => p.includes(FIXTURES.FILE_SESSION_2))).toBe(true)
  })

  it("ignores files not matching pattern", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Create a .txt file (should be ignored)
          const txtFile = path.join(tempDir, FIXTURES.FILE_TXT)
          fs.writeFileSync(txtFile, "some text")

          // Wait a bit and collect events
          const events = yield* collectEvents(queue, 1500)

          yield* watcher.stop()

          return events.filter((e) => e.path.includes(FIXTURES.FILE_TXT))
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    // Should not have any events for the .txt file
    expect(result.length).toBe(0)
  })

  it("detects files in nested directories with glob pattern", async () => {
    const nestedDir = path.join(tempDir, "projects", "myapp")
    fs.mkdirSync(nestedDir, { recursive: true })

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "**/*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Create a file in nested directory
          const filePath = path.join(nestedDir, "session.jsonl")
          fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

          // Wait for event
          const event = yield* waitForEvent(
            queue,
            (e) => e.type === "add" && e.path.includes("session.jsonl")
          )

          yield* watcher.stop()

          return event
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result).not.toBeNull()
    expect(result!.type).toBe("add")
    expect(result!.path).toContain("session.jsonl")
  })
})

// =============================================================================
// FileWatcherServiceLive - File Change Detection Tests
// =============================================================================

describe("FileWatcherServiceLive File Change Detection", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("detects file content changes", async () => {
    // Create file before starting watcher
    const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
    fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Modify the file
          fs.appendFileSync(filePath, "\n" + FIXTURES.JSONL_LINE_2)

          // Wait for change event
          const event = yield* waitForEvent(
            queue,
            (e) => e.type === "change" && e.path === filePath
          )

          yield* watcher.stop()

          return event
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result).not.toBeNull()
    expect(result!.type).toBe("change")
    expect(result!.path).toBe(filePath)
  })

  it("detects multiple sequential changes", async () => {
    const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
    fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Make multiple changes
          fs.appendFileSync(filePath, "\n" + FIXTURES.JSONL_LINE_2)
          yield* Effect.sleep(300)
          fs.appendFileSync(filePath, "\n" + FIXTURES.JSONL_LINE_3)

          // Collect events
          const events = yield* collectEvents(queue, 3000)

          yield* watcher.stop()

          return events.filter((e) => e.type === "change")
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    // Should have at least one change event (may be debounced)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].type).toBe("change")
  })
})

// =============================================================================
// FileWatcherServiceLive - File Delete Detection Tests
// =============================================================================

describe("FileWatcherServiceLive File Delete Detection", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("detects file deletion", async () => {
    // Create file before starting watcher
    const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
    fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Delete the file
          fs.unlinkSync(filePath)

          // Wait for delete event
          const event = yield* waitForEvent(
            queue,
            (e) => e.type === "delete" && e.path === filePath
          )

          yield* watcher.stop()

          return event
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result).not.toBeNull()
    expect(result!.type).toBe("delete")
    expect(result!.path).toBe(filePath)
  })

  it("detects multiple file deletions", async () => {
    // Create files before starting watcher
    const file1 = path.join(tempDir, FIXTURES.FILE_SESSION_1)
    const file2 = path.join(tempDir, FIXTURES.FILE_SESSION_2)
    fs.writeFileSync(file1, FIXTURES.JSONL_LINE_1)
    fs.writeFileSync(file2, FIXTURES.JSONL_LINE_2)

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Delete both files
          fs.unlinkSync(file1)
          yield* Effect.sleep(200)
          fs.unlinkSync(file2)

          // Collect events
          const events = yield* collectEvents(queue, 3000)

          yield* watcher.stop()

          return events.filter((e) => e.type === "delete")
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result.length).toBeGreaterThanOrEqual(2)
    const paths = result.map((e) => e.path)
    expect(paths.some((p) => p === file1)).toBe(true)
    expect(paths.some((p) => p === file2)).toBe(true)
  })
})

// =============================================================================
// FileWatcherServiceLive - Debounce Behavior Tests
// =============================================================================

describe("FileWatcherServiceLive Debounce Behavior", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("debounces rapid file changes", async () => {
    const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
    fs.writeFileSync(filePath, "initial")

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          // Use longer debounce for this test
          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 500,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Make rapid changes (faster than debounce)
          for (let i = 0; i < 5; i++) {
            fs.appendFileSync(filePath, `\nline${i}`)
            yield* Effect.sleep(50) // 50ms between changes
          }

          // Collect events over time
          const events = yield* collectEvents(queue, 2000)

          yield* watcher.stop()

          return events.filter((e) => e.type === "change")
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    // Due to debouncing, we should have fewer events than the number of changes
    // With 500ms debounce and 50ms between changes, most changes should be coalesced
    expect(result.length).toBeLessThan(5)
  })

  it("respects awaitWriteFinish stabilityThreshold", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 1000, // 1 second stabilization
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
          const writeStart = Date.now()

          // Write file
          fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

          // Wait for add event
          const event = yield* waitForEvent(queue, (e) => e.type === "add", 5000)
          const eventTime = event ? event.timestamp.getTime() : Date.now()

          yield* watcher.stop()

          return {
            event,
            delay: eventTime - writeStart
          }
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result.event).not.toBeNull()
    // The event should come after the debounce period
    expect(result.delay).toBeGreaterThanOrEqual(800) // Some margin for timing
  })
})

// =============================================================================
// FileWatcherServiceLive - Events Processed Counter Tests
// =============================================================================

describe("FileWatcherServiceLive Events Counter", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("increments eventsProcessed counter", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          const statusBefore = yield* watcher.status()

          // Create a file
          const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
          fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

          // Wait for event to be processed
          yield* waitForEvent(queue, (e) => e.type === "add")

          // Small delay for counter update
          yield* Effect.sleep(100)

          const statusAfter = yield* watcher.status()

          yield* watcher.stop()

          return { before: statusBefore.eventsProcessed, after: statusAfter.eventsProcessed }
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result.after).toBeGreaterThan(result.before)
  })
})

// =============================================================================
// FileWatcherServiceLive - Polling Mode Tests
// =============================================================================

describe("FileWatcherServiceLive Polling Mode", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("works with polling enabled", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: true,
            pollInterval: 200 // Enable polling with 200ms interval
          })

          yield* waitForReady()

          const queue = yield* watcher.getEventQueue()

          // Create a file
          const filePath = path.join(tempDir, FIXTURES.FILE_SESSION_1)
          fs.writeFileSync(filePath, FIXTURES.JSONL_LINE_1)

          // Wait for event (may take longer with polling)
          const event = yield* waitForEvent(
            queue,
            (e) => e.type === "add",
            5000
          )

          yield* watcher.stop()

          return event
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    expect(result).not.toBeNull()
    expect(result!.type).toBe("add")
  })
})

// =============================================================================
// FileWatcherServiceLive - Tilde Expansion Tests
// =============================================================================

describe("FileWatcherServiceLive Tilde Expansion", () => {
  let testDir: string
  let uniqueId: string

  beforeEach(() => {
    uniqueId = `tx-test-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`
    testDir = path.join(os.homedir(), `.${uniqueId}`)
    fs.mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it("expands tilde in patterns", async () => {
    // Use the exact directory name in the pattern to avoid matching other directories
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          // Use exact directory name with tilde prefix
          yield* watcher.start({
            patterns: [`~/.${uniqueId}/*.jsonl`],
            debounceMs: 100,
            ignoreInitial: true
          })

          yield* waitForReady()

          const paths = yield* watcher.getWatchedPaths()
          yield* watcher.stop()

          return paths
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    // The paths should not contain tilde
    expect(result.every((p) => !p.includes("~"))).toBe(true)
    // Should contain home directory
    expect(result.some((p) => p.includes(os.homedir()))).toBe(true)
  })
})

// =============================================================================
// FileWatcherServiceLive - Initial File Detection Tests
// =============================================================================

describe("FileWatcherServiceLive Initial Files", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
  })

  it("emits events for existing files when ignoreInitial is false", async () => {
    // Create files before starting watcher
    const file1 = path.join(tempDir, FIXTURES.FILE_SESSION_1)
    const file2 = path.join(tempDir, FIXTURES.FILE_SESSION_2)
    fs.writeFileSync(file1, FIXTURES.JSONL_LINE_1)
    fs.writeFileSync(file2, FIXTURES.JSONL_LINE_2)

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const watcher = yield* FileWatcherService

          yield* watcher.start({
            patterns: [path.join(tempDir, "*.jsonl")],
            debounceMs: 100,
            ignoreInitial: false // Should emit events for existing files
          })

          const queue = yield* watcher.getEventQueue()

          // Collect events
          const events = yield* collectEvents(queue, 3000)

          yield* watcher.stop()

          return events.filter((e) => e.type === "add")
        }).pipe(Effect.provide(FileWatcherServiceLive))
      )
    )

    // Should have add events for existing files
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it("does not emit add events for existing files when ignoreInitial is true", async () => {
    // Create a new temp directory for this specific test to ensure isolation
    const isolatedTempDir = createTempDir()
    const file1 = path.join(isolatedTempDir, FIXTURES.FILE_SESSION_1)

    try {
      fs.writeFileSync(file1, FIXTURES.JSONL_LINE_1)

      // Wait for file to settle before starting watcher
      await new Promise((resolve) => setTimeout(resolve, 300))

      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const watcher = yield* FileWatcherService

            yield* watcher.start({
              patterns: [path.join(isolatedTempDir, "*.jsonl")],
              debounceMs: 50, // Shorter debounce for faster test
              ignoreInitial: true // Should NOT emit events for existing files
            })

            yield* waitForReady(300)

            const queue = yield* watcher.getEventQueue()

            // Collect events for a short time - should be empty for pre-existing files
            const events = yield* collectEvents(queue, 500)

            yield* watcher.stop()

            // Filter for add events for the pre-existing file
            return events.filter((e) => e.type === "add")
          }).pipe(Effect.provide(FileWatcherServiceLive))
        )
      )

      // With ignoreInitial: true, there should be no add events for pre-existing files
      // Note: Due to timing and awaitWriteFinish edge cases, we use <= 0 assertion
      expect(result.length).toBe(0)
    } finally {
      cleanupTempDir(isolatedTempDir)
    }
  })
})

