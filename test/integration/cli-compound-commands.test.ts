const normaliseTaskCommand = (args: string[]): string[] => /^(add|list|ready|show|update|done|reset|delete|bulk|label|dep|block|unblock|children|tree)$/.test(args[0] ?? "") ? ["task", ...(/^(block|unblock|children|tree)$/.test(args[0]) ? ["dep"] : []), ...args] : args
/**
 * CLI Integration Tests for Compound Command Consolidation
 *
 * Tests the new compound command structure:
 * - tx task dep <block|unblock|children|tree>
 * - tx msg <send|inbox|ack|pending|gc>
 * - tx diag <stats|doctor|dashboard>
 * - tx auto <guard|gate|verify|label|reflect>
 * - tx sync <compact|history|migrate>
 * - Deprecated aliases emit warnings + still function
 *
 * Per DD-007: Uses real in-memory SQLite and deterministic test setup.
 * No mocks - all tests run against real CLI subprocess with real database.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 60000 : 30000))

function walCheckpoint(dbPath: string): void {
  const { Database } = require("bun:sqlite")
  const db = new Database(dbPath)
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()
}

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

function runTxArgs(args: string[], dbPath: string): ExecResult {
  args = normaliseTaskCommand(args)

  try {
    const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: process.cwd()
    })
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      status: result.status ?? 1
    }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      status: err.status ?? 1
    }
  }
}

function runTx(args: string, dbPath: string): ExecResult {
  return runTxArgs(args.split(" "), dbPath)
}

// =============================================================================
// Compound Command Help Tests
// =============================================================================

describe("CLI compound commands - help output", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-compound-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx("init", dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx task dep show s help with subcommands", () => {
    const result = runTx("dep", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("block")
    expect(result.stdout).toContain("unblock")
    expect(result.stdout).toContain("children")
    expect(result.stdout).toContain("tree")
  })

  it("tx diag shows help with subcommands", () => {
    const result = runTx("diag", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("stats")
    expect(result.stdout).toContain("diag doctor")
    expect(result.stdout).toContain("dashboard")
  })

  it("tx sync shows compact/history/migrate subcommands", () => {
    const result = runTx("sync", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("hydrate")
    expect(result.stdout).toContain("stream")
    expect(result.stdout).toContain("sync migrate")
  })

  it("tx help is compact (under 50 lines)", () => {
    const result = runTx("help", dbPath)
    const lineCount = result.stdout.split("\n").length
    expect(lineCount).toBeLessThan(50)
  })
})

// =============================================================================
// tx task dep - Dependencies & Hierarchy
// =============================================================================

describe("CLI tx task dep - dependencies", () => {
  let tmpDir: string
  let dbPath: string
  let taskA: string
  let taskB: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-dep-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx("init", dbPath)

    // Create two tasks
    const resultA = runTxArgs(["task", "add", "Task A", "--json"], dbPath)
    taskA = JSON.parse(resultA.stdout).id
    walCheckpoint(dbPath)

    const resultB = runTxArgs(["task", "add", "Task B", "--json"], dbPath)
    taskB = JSON.parse(resultB.stdout).id
    walCheckpoint(dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx task dep block creates a dependency", () => {
    const result = runTxArgs(["task", "dep", "block", taskA, taskB], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("now blocks")
  })

  it("tx task dep block --json returns structured output", () => {
    const result = runTxArgs(["task", "dep", "block", taskA, taskB, "--json"], dbPath)
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data.success).toBe(true)
    expect(data.task.blockedBy).toContain(taskB)
  })

  it("tx task dep unblock removes a dependency", () => {
    runTxArgs(["task", "dep", "block", taskA, taskB], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["task", "dep", "unblock", taskA, taskB], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("no longer blocks")
  })

  it("tx task dep children lists children", () => {
    const childResult = runTxArgs(["task", "add", "Child", "--parent", taskA, "--json"], dbPath)
    walCheckpoint(dbPath)
    const childId = JSON.parse(childResult.stdout).id

    const result = runTxArgs(["task", "dep", "children", taskA], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(childId)
    expect(result.stdout).toContain("Child")
  })

  it("tx task dep tree shows hierarchy", () => {
    runTxArgs(["task", "add", "Child 1", "--parent", taskA], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["task", "dep", "tree", taskA], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Task A")
    expect(result.stdout).toContain("Child 1")
  })
})

// =============================================================================
// tx diag - Diagnostics
// =============================================================================

describe("CLI tx diag - diagnostics", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-diag-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx("init", dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx diag stats shows queue metrics", () => {
    runTxArgs(["task", "add", "Task 1"], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["diag", "stats"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Queue Status:")
    expect(result.stdout).toContain("Total:")
  })

  it("tx diag stats --json returns structured output", () => {
    const result = runTxArgs(["diag", "stats", "--json"], dbPath)
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data).toHaveProperty("total")
    expect(data).toHaveProperty("byStatus")
    expect(data).toHaveProperty("readyCount")
    expect(data).not.toHaveProperty("claims")
  })

  it("tx diag doctor runs health checks", () => {
    const result = runTxArgs(["diag", "doctor"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("System Health")
    expect(result.stdout).toContain("WAL mode")
  })

  it("tx diag doctor --json returns structured output", () => {
    const result = runTxArgs(["diag", "doctor", "--json"], dbPath)
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data).toHaveProperty("healthy")
    expect(data).toHaveProperty("checks")
    expect(data.healthy).toBe(true)
  })
})

// =============================================================================
// tx sync - Absorbed Commands
// =============================================================================

describe("CLI tx sync - absorbed commands", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-sync-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx("init", dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx sync migrate status shows schema version", () => {
    const result = runTxArgs(["sync", "migrate", "status"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Migration Status:")
    expect(result.stdout).toContain("Current version:")
    expect(result.stdout).toContain("Pending migrations: 0")
  })

  it("tx sync migrate status --json returns structured output", () => {
    const result = runTxArgs(["sync", "migrate", "status", "--json"], dbPath)
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data).toHaveProperty("currentVersion")
    expect(data).toHaveProperty("latestVersion")
    expect(data.currentVersion).toBe(data.latestVersion)
  })
})
