/**
 * CLI Integration Tests for Compound Command Consolidation
 *
 * Tests the new compound command structure:
 * - tx dep <block|unblock|children|tree>
 * - tx msg <send|inbox|ack|pending|gc>
 * - tx diag <stats|doctor|dashboard>
 * - tx auto <guard|gate|verify|label|reflect>
 * - tx sync <compact|history|migrate>
 * - Deprecated aliases emit warnings + still function
 *
 * Per DD-007: Uses real in-memory SQLite and deterministic test setup.
 * No mocks — all tests run against real CLI subprocess with real database.
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

describe("CLI compound commands — help output", () => {
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

  it("tx dep shows help with subcommands", () => {
    const result = runTx("dep", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("block")
    expect(result.stdout).toContain("unblock")
    expect(result.stdout).toContain("children")
    expect(result.stdout).toContain("tree")
  })

  it("tx msg shows help with subcommands", () => {
    const result = runTx("msg", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("send")
    expect(result.stdout).toContain("inbox")
    expect(result.stdout).toContain("ack")
    expect(result.stdout).toContain("pending")
    expect(result.stdout).toContain("gc")
  })

  it("tx diag shows help with subcommands", () => {
    const result = runTx("diag", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("stats")
    expect(result.stdout).toContain("doctor")
    expect(result.stdout).toContain("dashboard")
  })

  it("tx auto shows help with subcommands", () => {
    const result = runTx("auto", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("guard")
    expect(result.stdout).toContain("gate")
    expect(result.stdout).toContain("verify")
    expect(result.stdout).toContain("label")
    expect(result.stdout).toContain("reflect")
  })

  it("tx sync shows compact/history/migrate subcommands", () => {
    const result = runTx("sync", dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("compact")
    expect(result.stdout).toContain("history")
    expect(result.stdout).toContain("migrate")
  })

  it("tx help is compact (under 50 lines)", () => {
    const result = runTx("help", dbPath)
    const lineCount = result.stdout.split("\n").length
    expect(lineCount).toBeLessThan(50)
  })
})

// =============================================================================
// tx dep — Dependencies & Hierarchy
// =============================================================================

describe("CLI tx dep — dependencies", () => {
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
    const resultA = runTxArgs(["add", "Task A", "--json"], dbPath)
    taskA = JSON.parse(resultA.stdout).id
    walCheckpoint(dbPath)

    const resultB = runTxArgs(["add", "Task B", "--json"], dbPath)
    taskB = JSON.parse(resultB.stdout).id
    walCheckpoint(dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx dep block creates a dependency", () => {
    const result = runTxArgs(["dep", "block", taskA, taskB], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("now blocks")
  })

  it("tx dep block --json returns structured output", () => {
    const result = runTxArgs(["dep", "block", taskA, taskB, "--json"], dbPath)
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data.success).toBe(true)
    expect(data.task.blockedBy).toContain(taskB)
  })

  it("tx dep unblock removes a dependency", () => {
    runTxArgs(["dep", "block", taskA, taskB], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["dep", "unblock", taskA, taskB], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("no longer blocks")
  })

  it("tx dep children lists children", () => {
    const childResult = runTxArgs(["add", "Child", "--parent", taskA, "--json"], dbPath)
    walCheckpoint(dbPath)
    const childId = JSON.parse(childResult.stdout).id

    const result = runTxArgs(["dep", "children", taskA], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(childId)
    expect(result.stdout).toContain("Child")
  })

  it("tx dep tree shows hierarchy", () => {
    runTxArgs(["add", "Child 1", "--parent", taskA], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["dep", "tree", taskA], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Task A")
    expect(result.stdout).toContain("Child 1")
  })
})

// =============================================================================
// tx msg — Messaging
// =============================================================================

describe("CLI tx msg — messaging", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-msg-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx("init", dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx msg send creates a message", () => {
    const result = runTxArgs(["msg", "send", "test-channel", "Hello world"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("sent to channel")
    expect(result.stdout).toContain("test-channel")
  })

  it("tx msg send --json returns structured output", () => {
    const result = runTxArgs(["msg", "send", "ch1", "Hi", "--json"], dbPath)
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data.channel).toBe("ch1")
    expect(data.content).toBe("Hi")
  })

  it("tx msg inbox reads messages", () => {
    runTxArgs(["msg", "send", "ch1", "Message 1"], dbPath)
    walCheckpoint(dbPath)
    runTxArgs(["msg", "send", "ch1", "Message 2"], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["msg", "inbox", "ch1"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Message 1")
    expect(result.stdout).toContain("Message 2")
    expect(result.stdout).toContain("2 message(s)")
  })

  it("tx msg ack acknowledges a message", () => {
    const sendResult = runTxArgs(["msg", "send", "ch1", "Ack me", "--json"], dbPath)
    walCheckpoint(dbPath)
    const msgId = JSON.parse(sendResult.stdout).id

    const result = runTxArgs(["msg", "ack", String(msgId)], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("acknowledged")
  })

  it("tx msg pending counts pending messages", () => {
    runTxArgs(["msg", "send", "ch1", "Msg 1"], dbPath)
    walCheckpoint(dbPath)
    runTxArgs(["msg", "send", "ch1", "Msg 2"], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["msg", "pending", "ch1"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("2 pending")
  })

  it("tx msg gc garbage collects", () => {
    const result = runTxArgs(["msg", "gc"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("GC complete")
  })
})

// =============================================================================
// tx diag — Diagnostics
// =============================================================================

describe("CLI tx diag — diagnostics", () => {
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
    runTxArgs(["add", "Task 1"], dbPath)
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
    expect(data).toHaveProperty("claims")
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
// tx auto — Bounded Autonomy
// =============================================================================

describe("CLI tx auto — bounded autonomy", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-auto-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx("init", dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx auto guard set configures a guard", () => {
    const result = runTxArgs(["auto", "guard", "set", "--max-pending", "5"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Guard updated")
    expect(result.stdout).toContain("max_pending: 5")
  })

  it("tx auto guard show lists guards", () => {
    runTxArgs(["auto", "guard", "set", "--max-pending", "10"], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["auto", "guard", "show"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("max_pending")
  })

  it("tx auto guard clear removes guards", () => {
    runTxArgs(["auto", "guard", "set", "--max-pending", "10"], dbPath)
    walCheckpoint(dbPath)

    const result = runTxArgs(["auto", "guard", "clear"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("cleared")
  })

  it("tx auto gate create/check/approve flow", () => {
    // Create a gate
    const createResult = runTxArgs(["auto", "gate", "create", "deploy", "--json"], dbPath)
    expect(createResult.status).toBe(0)
    const gate = JSON.parse(createResult.stdout)
    expect(gate.approved).toBe(false)
    walCheckpoint(dbPath)

    // Check should fail (not approved)
    const checkResult = runTxArgs(["auto", "gate", "check", "deploy"], dbPath)
    expect(checkResult.status).toBe(1)
    walCheckpoint(dbPath)

    // Approve
    const approveResult = runTxArgs(["auto", "gate", "approve", "deploy", "--by", "human"], dbPath)
    expect(approveResult.status).toBe(0)
    expect(approveResult.stdout).toContain("approved")
    walCheckpoint(dbPath)

    // Check should pass now
    const checkResult2 = runTxArgs(["auto", "gate", "check", "deploy"], dbPath)
    expect(checkResult2.status).toBe(0)
  })

  it("tx auto label add/assign/list flow", () => {
    // Create a task first
    const taskResult = runTxArgs(["add", "Labeled task", "--json"], dbPath)
    const taskId = JSON.parse(taskResult.stdout).id
    walCheckpoint(dbPath)

    // Create label
    const addResult = runTxArgs(["auto", "label", "add", "phase:test"], dbPath)
    expect(addResult.status).toBe(0)
    expect(addResult.stdout).toContain("Label created")
    walCheckpoint(dbPath)

    // Assign label to task
    const assignResult = runTxArgs(["auto", "label", "assign", taskId, "phase:test"], dbPath)
    expect(assignResult.status).toBe(0)
    expect(assignResult.stdout).toContain("assigned")
    walCheckpoint(dbPath)

    // List labels
    const listResult = runTxArgs(["auto", "label", "list"], dbPath)
    expect(listResult.status).toBe(0)
    expect(listResult.stdout).toContain("phase:test")
  })

  it("tx auto verify set/show/clear flow", () => {
    const taskResult = runTxArgs(["add", "Verify task", "--json"], dbPath)
    const taskId = JSON.parse(taskResult.stdout).id
    walCheckpoint(dbPath)

    // Set verify command
    const setResult = runTxArgs(["auto", "verify", "set", taskId, "echo", "ok"], dbPath)
    expect(setResult.status).toBe(0)
    expect(setResult.stdout).toContain("Verify command set")
    walCheckpoint(dbPath)

    // Show verify command
    const showResult = runTxArgs(["auto", "verify", "show", taskId], dbPath)
    expect(showResult.status).toBe(0)
    expect(showResult.stdout).toContain("echo ok")
    walCheckpoint(dbPath)

    // Clear verify command
    const clearResult = runTxArgs(["auto", "verify", "clear", taskId], dbPath)
    expect(clearResult.status).toBe(0)
    expect(clearResult.stdout).toContain("cleared")
  })
})

// =============================================================================
// tx sync — Absorbed Commands
// =============================================================================

describe("CLI tx sync — absorbed commands", () => {
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

  it("tx sync history shows compaction history", () => {
    const result = runTxArgs(["sync", "history"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No compaction history")
  })

  it("tx sync history --json returns empty array", () => {
    const result = runTxArgs(["sync", "history", "--json"], dbPath)
    expect(result.status).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
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

  it("tx sync compact --dry-run previews compaction", () => {
    const result = runTxArgs(["sync", "compact", "--dry-run"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No tasks eligible for compaction")
  })
})

// =============================================================================
// Deprecated Aliases
// =============================================================================

describe("CLI deprecated aliases", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-deprecated-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx("init", dbPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("tx block emits deprecation warning", () => {
    const result = runTx("block", dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx dep block")
  })

  it("tx unblock emits deprecation warning", () => {
    const result = runTx("unblock", dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx dep unblock")
  })

  it("tx send emits deprecation warning", () => {
    const result = runTx("send", dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx msg send")
  })

  it("tx inbox emits deprecation warning", () => {
    const result = runTx("inbox", dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx msg inbox")
  })

  it("tx stats emits deprecation warning and still works", () => {
    const result = runTx("stats", dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx diag stats")
    expect(result.stdout).toContain("Queue Status:")
  })

  it("tx doctor emits deprecation warning and still works", () => {
    const result = runTx("doctor", dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx diag doctor")
    expect(result.stdout).toContain("System Health")
  })

  it("tx compact emits deprecation warning", () => {
    const result = runTxArgs(["compact", "--dry-run"], dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx sync compact")
  })

  it("tx history emits deprecation warning and still works", () => {
    const result = runTx("history", dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx sync history")
    expect(result.stdout).toContain("No compaction history")
  })

  it("tx guard emits deprecation warning", () => {
    const result = runTxArgs(["guard", "show"], dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx auto guard")
  })

  it("tx label emits deprecation warning", () => {
    const result = runTxArgs(["label", "list"], dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx auto label")
  })

  it("tx migrate emits deprecation warning and still works", () => {
    const result = runTxArgs(["migrate", "status"], dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx sync migrate")
    expect(result.stdout).toContain("Migration Status:")
  })

  it("tx block --help emits deprecation warning with help text", () => {
    const result = runTxArgs(["block", "--help"], dbPath)
    expect(result.stderr).toContain("[deprecated]")
    expect(result.stderr).toContain("tx dep block")
    expect(result.stdout).toContain("block")
  })

  it("deprecated alias still executes the actual command", () => {
    // Create tasks
    const resultA = runTxArgs(["add", "Task A", "--json"], dbPath)
    const taskA = JSON.parse(resultA.stdout).id
    walCheckpoint(dbPath)
    const resultB = runTxArgs(["add", "Task B", "--json"], dbPath)
    const taskB = JSON.parse(resultB.stdout).id
    walCheckpoint(dbPath)

    // Use deprecated "block" command
    const blockResult = runTxArgs(["block", taskA, taskB], dbPath)
    expect(blockResult.status).toBe(0)
    expect(blockResult.stderr).toContain("[deprecated]")
    expect(blockResult.stdout).toContain("now blocks")
  })
})
