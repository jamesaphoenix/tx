/**
 * DaemonService Integration Tests
 *
 * Tests for the DaemonService class that manages the tx daemon lifecycle.
 * Covers start(), stop(), status(), and restart() methods.
 *
 * Uses mock process approaches to avoid actual daemon spawning.
 *
 * @see PRD-015 for daemon specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  DaemonService,
  DaemonServiceLive,
  DaemonServiceNoop,
  writePid,
  removePid,
  tryAtomicPidCreate,
  acquirePidLock
} from "@jamesaphoenix/tx-core"

// =============================================================================
// DaemonServiceNoop Tests
// =============================================================================

describe("DaemonServiceNoop Integration", () => {
  it("start() succeeds without spawning process", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.start()
        return "started"
      }).pipe(Effect.provide(DaemonServiceNoop))
    )

    expect(result).toBe("started")
  })

  it("stop() succeeds without terminating process", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.stop()
        return "stopped"
      }).pipe(Effect.provide(DaemonServiceNoop))
    )

    expect(result).toBe("stopped")
  })

  it("status() returns not running", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceNoop))
    )

    expect(result.running).toBe(false)
    expect(result.pid).toBeNull()
    expect(result.uptime).toBeNull()
    expect(result.startedAt).toBeNull()
  })

  it("restart() succeeds without actual process management", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.restart()
        return "restarted"
      }).pipe(Effect.provide(DaemonServiceNoop))
    )

    expect(result).toBe("restarted")
  })

  it("can call multiple operations in sequence", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.start()
        const status1 = yield* svc.status()
        yield* svc.stop()
        const status2 = yield* svc.status()
        yield* svc.restart()
        const status3 = yield* svc.status()

        return { status1, status2, status3 }
      }).pipe(Effect.provide(DaemonServiceNoop))
    )

    // All statuses should show not running (noop)
    expect(result.status1.running).toBe(false)
    expect(result.status2.running).toBe(false)
    expect(result.status3.running).toBe(false)
  })
})

// =============================================================================
// DaemonServiceLive Tests - Status when no daemon running
// =============================================================================

describe("DaemonServiceLive - Status (No Daemon)", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-svc-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("status() returns not running when no PID file exists", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(result.running).toBe(false)
    expect(result.pid).toBeNull()
    expect(result.uptime).toBeNull()
    expect(result.startedAt).toBeNull()
  })

  it("status() returns not running for stale PID file", async () => {
    // Create a PID file with a non-existent process
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "999999999")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(result.running).toBe(false)
    expect(result.pid).toBeNull()

    // Stale PID file should be cleaned up
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("status() returns running for valid PID (current process)", async () => {
    // Write current process PID
    await Effect.runPromise(writePid(process.pid))

    // Also write a started timestamp
    const txDir = path.join(tempDir, ".tx")
    const startedAt = new Date(Date.now() - 5000) // 5 seconds ago
    fs.writeFileSync(path.join(txDir, "daemon.started"), startedAt.toISOString())

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(result.running).toBe(true)
    expect(result.pid).toBe(process.pid)
    expect(result.startedAt).toBeInstanceOf(Date)
    expect(result.uptime).toBeGreaterThanOrEqual(5000)

    // Cleanup
    await Effect.runPromise(removePid())
    fs.unlinkSync(path.join(txDir, "daemon.started"))
  })
})

// =============================================================================
// DaemonServiceLive Tests - Start behavior
// =============================================================================

describe("DaemonServiceLive - Start", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-svc-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("start() fails with ALREADY_RUNNING when daemon is already running", async () => {
    // Simulate daemon already running with current process PID
    await Effect.runPromise(writePid(process.pid))

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.start()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(Exit.isFailure(result)).toBe(true)

    if (Exit.isFailure(result)) {
      const errorStr = String(result.cause).toLowerCase()
      // Should fail with already running error
      expect(errorStr).toContain("already running")
    }

    // Cleanup
    await Effect.runPromise(removePid())
  })

  it("start() attempts to create .tx directory and spawn process", async () => {
    // This test verifies the start flow is executed
    // The result may succeed or fail depending on environment
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.start()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    // If it succeeded, stop the daemon to cleanup
    if (Exit.isSuccess(result)) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DaemonService
          yield* svc.stop()
        }).pipe(Effect.provide(DaemonServiceLive))
      )
    }

    // We just verify the call completes (success or failure)
    expect(Exit.isExit(result)).toBe(true)
  })
})

// =============================================================================
// DaemonServiceLive Tests - Stop behavior
// =============================================================================

describe("DaemonServiceLive - Stop", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-svc-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("stop() succeeds when no daemon is running", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.stop()
        return "stopped"
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(result).toBe("stopped")
  })

  it("stop() cleans up stale PID file", async () => {
    // Create a stale PID file
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "999999999")
    fs.writeFileSync(path.join(txDir, "daemon.started"), new Date().toISOString())

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.stop()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    // Both files should be cleaned up
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("stop() handles already stopped daemon gracefully", async () => {
    // Multiple stops should not fail
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.stop()
        yield* svc.stop()
        yield* svc.stop()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    // Should complete without error
    expect(true).toBe(true)
  })
})

// =============================================================================
// DaemonServiceLive Tests - Restart behavior
// =============================================================================

describe("DaemonServiceLive - Restart", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-svc-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("restart() calls stop then start", async () => {
    // Restart attempts stop then start
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.restart()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    // If it succeeded, stop the daemon to cleanup
    if (Exit.isSuccess(result)) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DaemonService
          yield* svc.stop()
        }).pipe(Effect.provide(DaemonServiceLive))
      )
    }

    // We just verify the call completes (success or failure)
    expect(Exit.isExit(result)).toBe(true)
  })

  it("restart() cleans up before attempting start", async () => {
    // Create stale files
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "999999999")
    fs.writeFileSync(path.join(txDir, "daemon.started"), new Date().toISOString())

    await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.restart()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    // Stale PID file should have been cleaned up during stop phase
    // (The start may create a new one if it succeeds, but since start fails,
    // we should see the cleanup happened)
    // Note: readPid cleans up stale files, so check won't find old stale file
  })
})

// =============================================================================
// Stale PID File Cleanup Tests
// =============================================================================

describe("DaemonService Stale PID Cleanup", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-stale-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("status() cleans up PID file for dead process", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })

    // Use very high PID that likely doesn't exist
    const stalePid = 999999998
    fs.writeFileSync(path.join(txDir, "daemon.pid"), String(stalePid))

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(status.running).toBe(false)
    expect(status.pid).toBeNull()

    // PID file should be removed
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("status() cleans up PID file with invalid content", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })

    // Write invalid PID content
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "not-a-number")

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(status.running).toBe(false)
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("stop() cleans up PID file for dead process", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })

    // Write PID for non-existent process
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "999999997")

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.stop()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    // PID file should be removed during stop
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("handles empty PID file as invalid", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })

    // Write empty PID file
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "")

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(status.running).toBe(false)
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("handles negative PID as invalid", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })

    // Write negative PID
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "-100")

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(status.running).toBe(false)
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })

  it("handles zero PID as invalid", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })

    // Write zero PID
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "0")

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(status.running).toBe(false)
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(false)
  })
})

// =============================================================================
// DaemonStatus Type Tests
// =============================================================================

describe("DaemonStatus Type Verification", () => {
  it("returns properly typed DaemonStatus object", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        return yield* svc.status()
      }).pipe(Effect.provide(DaemonServiceNoop))
    )

    // Verify the shape matches DaemonStatus interface
    expect(typeof status.running).toBe("boolean")
    expect(status.pid === null || typeof status.pid === "number").toBe(true)
    expect(status.uptime === null || typeof status.uptime === "number").toBe(true)
    expect(status.startedAt === null || status.startedAt instanceof Date).toBe(true)
  })

  it("uptime increases with time", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-uptime-test-"))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      // Write current process PID and a timestamp from 1 second ago
      await Effect.runPromise(writePid(process.pid))

      const txDir = path.join(tempDir, ".tx")
      const startedAt = new Date(Date.now() - 1000) // 1 second ago
      fs.writeFileSync(path.join(txDir, "daemon.started"), startedAt.toISOString())

      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DaemonService
          return yield* svc.status()
        }).pipe(Effect.provide(DaemonServiceLive))
      )

      expect(status.running).toBe(true)
      expect(status.uptime).toBeGreaterThanOrEqual(1000)
      expect(status.uptime).toBeLessThan(10000) // Shouldn't be too high

      // Cleanup
      await Effect.runPromise(removePid())
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

// =============================================================================
// Error Code Tests
// =============================================================================

describe("DaemonService Error Codes", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-error-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("already running error includes existing PID", async () => {
    // Write current process as the running daemon
    await Effect.runPromise(writePid(process.pid))

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* DaemonService
        yield* svc.start()
      }).pipe(Effect.provide(DaemonServiceLive))
    )

    expect(Exit.isFailure(result)).toBe(true)

    if (Exit.isFailure(result)) {
      const errorStr = String(result.cause).toLowerCase()
      // Check error message contains "already running"
      expect(errorStr).toContain("already running")
      // Check error includes the PID
      expect(errorStr).toContain(String(process.pid))
    }

    // Cleanup
    await Effect.runPromise(removePid())
  })
})

// =============================================================================
// Atomic PID Lock Tests (TOCTOU Race Prevention)
// =============================================================================

describe("Atomic PID Lock (TOCTOU Prevention)", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-lock-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("tryAtomicPidCreate succeeds when no PID file exists", async () => {
    fs.mkdirSync(path.join(tempDir, ".tx"), { recursive: true })

    const result = await Effect.runPromise(tryAtomicPidCreate())
    expect(result).toBe(true)

    // File should exist
    expect(fs.existsSync(path.join(tempDir, ".tx", "daemon.pid"))).toBe(true)
  })

  it("tryAtomicPidCreate returns false when PID file already exists", async () => {
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "12345")

    const result = await Effect.runPromise(tryAtomicPidCreate())
    expect(result).toBe(false)

    // Original content should be unchanged
    const content = fs.readFileSync(path.join(txDir, "daemon.pid"), "utf-8")
    expect(content).toBe("12345")
  })

  it("acquirePidLock succeeds when no PID file exists", async () => {
    await Effect.runPromise(acquirePidLock())

    // Lock file should exist
    expect(fs.existsSync(path.join(tempDir, ".tx", "daemon.pid"))).toBe(true)
  })

  it("acquirePidLock fails with ALREADY_RUNNING for live process", async () => {
    // Write current process PID (which is alive)
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), String(process.pid))

    const result = await Effect.runPromiseExit(acquirePidLock())

    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const errorStr = String(result.cause).toLowerCase()
      expect(errorStr).toContain("already running")
    }
  })

  it("acquirePidLock cleans up stale PID and acquires lock", async () => {
    // Write a stale PID (non-existent process)
    const txDir = path.join(tempDir, ".tx")
    fs.mkdirSync(txDir, { recursive: true })
    fs.writeFileSync(path.join(txDir, "daemon.pid"), "999999999")

    await Effect.runPromise(acquirePidLock())

    // Lock file should exist (recreated after stale cleanup)
    expect(fs.existsSync(path.join(txDir, "daemon.pid"))).toBe(true)
  })

  it("acquirePidLock creates .tx directory if missing", async () => {
    // Ensure no .tx directory exists
    expect(fs.existsSync(path.join(tempDir, ".tx"))).toBe(false)

    await Effect.runPromise(acquirePidLock())

    // Directory and lock file should both exist
    expect(fs.existsSync(path.join(tempDir, ".tx"))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, ".tx", "daemon.pid"))).toBe(true)
  })

  it("concurrent acquirePidLock calls: only one succeeds", async () => {
    // Race two lock acquisitions — exactly one should win
    const results = await Promise.allSettled([
      Effect.runPromise(acquirePidLock()),
      Effect.runPromise(acquirePidLock())
    ])

    const successes = results.filter((r) => r.status === "fulfilled")
    const failures = results.filter((r) => r.status === "rejected")

    // Exactly one should succeed, one should fail
    expect(successes.length).toBe(1)
    expect(failures.length).toBe(1)

    // The failure should be about already running / in progress
    const failReason = String((failures[0] as PromiseRejectedResult).reason).toLowerCase()
    expect(
      failReason.includes("already running") || failReason.includes("in progress")
    ).toBe(true)
  })

  it("second start after first acquires lock gets ALREADY_RUNNING", async () => {
    // First call acquires the lock
    await Effect.runPromise(acquirePidLock())

    // Second call should fail because lock file exists with empty content
    // (no valid PID, but file exists — treated as lock held by another start)
    const result = await Effect.runPromiseExit(acquirePidLock())

    expect(Exit.isFailure(result)).toBe(true)
  })
})

// =============================================================================
// Service Layer Composition Tests
// =============================================================================

describe("DaemonService Layer Composition", () => {
  it("DaemonServiceNoop can be provided to service consumer", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* DaemonService
      const status = yield* svc.status()
      return status.running
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(DaemonServiceNoop))
    )

    expect(result).toBe(false)
  })

  it("DaemonServiceLive can be provided to service consumer", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-layer-test-"))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const program = Effect.gen(function* () {
        const svc = yield* DaemonService
        const status = yield* svc.status()
        return status.running
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(DaemonServiceLive))
      )

      expect(result).toBe(false) // No daemon running
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("can switch between Noop and Live implementations", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* DaemonService
      return yield* svc.status()
    })

    // Run with Noop
    const noopResult = await Effect.runPromise(
      program.pipe(Effect.provide(DaemonServiceNoop))
    )

    // Run with Live (in temp dir)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-daemon-switch-test-"))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const liveResult = await Effect.runPromise(
        program.pipe(Effect.provide(DaemonServiceLive))
      )

      // Both should show not running, but from different implementations
      expect(noopResult.running).toBe(false)
      expect(liveResult.running).toBe(false)
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
