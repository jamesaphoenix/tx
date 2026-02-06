/**
 * CLI integration tests for tx doctor command
 *
 * Tests the following:
 * - All 7 diagnostic checks (database, WAL, schema, services, claims, tasks, API key)
 * - Verbose output mode
 * - JSON output mode
 * - Help text
 * - Exit codes (0 for healthy, 1 for failures)
 *
 * Per DD-007: Uses real SQLite database and deterministic SHA256 fixtures.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { Database } from "bun:sqlite"
import { fixtureId } from "@jamesaphoenix/tx-test-utils"

const TX_BIN = resolve(__dirname, "../../apps/cli/dist/cli.js")

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const FX = {
  TASK_1:    fixtureId("cli-doctor:task-1"),
  TASK_2:    fixtureId("cli-doctor:task-2"),
  READY:     fixtureId("cli-doctor:ready-task"),
  VERBOSE:   fixtureId("cli-doctor:verbose-task"),
} as const

// Helper to insert a task row with deterministic ID directly into the DB
function insertTask(
  dbPath: string,
  id: string,
  title: string,
  opts: { score?: number; status?: string; description?: string } = {},
): void {
  const db = new Database(dbPath)
  try {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      title,
      opts.description ?? "",
      opts.status ?? "backlog",
      null,
      opts.score ?? 500,
      now,
      now,
      opts.status === "done" ? now : null,
      "{}",
    )
  } finally {
    db.close()
  }
}

// Helper to insert a learning row directly into the DB
function insertLearning(dbPath: string, content: string): void {
  const db = new Database(dbPath)
  try {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO learnings (content, source_type, source_ref, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(content, "manual", null, now)
  } finally {
    db.close()
  }
}
const CLI_TIMEOUT = 10000

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

function runTxArgs(args: string[], dbPath: string, env?: Record<string, string>): ExecResult {
  try {
    const result = spawnSync("bun", [TX_BIN, ...args, "--db", dbPath], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    })
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      status: result.status ?? 1,
    }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      status: err.status ?? 1,
    }
  }
}

function runTx(args: string, dbPath: string, env?: Record<string, string>): ExecResult {
  return runTxArgs(args.split(" "), dbPath, env)
}

// =============================================================================
// tx doctor Command Tests
// =============================================================================

describe("CLI doctor command", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-doctor-"))
    dbPath = join(tmpDir, "test.db")
    runTx("init", dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("runs all checks and reports healthy", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("All checks passed.")
    })

    it("shows check for database connection", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Database:")
    })

    it("shows WAL mode check", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("WAL mode:")
    })

    it("shows schema version check", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/Schema: v\d+/)
    })

    it("shows Effect services check", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Effect services: wired correctly")
    })

    it("shows claims/workers check with no stale entries", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Claims/workers: no stale entries")
    })

    it("shows task counts", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Tasks:")
      expect(result.stdout).toContain("total")
    })

    it("shows learning count", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Learnings:")
    })

    it("shows ANTHROPIC_API_KEY status", () => {
      // Run without ANTHROPIC_API_KEY
      const result = runTxArgs(["doctor"], dbPath, { ANTHROPIC_API_KEY: "" })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("ANTHROPIC_API_KEY:")
    })

    it("uses pass icon for passing checks", () => {
      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      // \u2713 = check mark
      expect(result.stdout).toContain("\u2713")
    })
  })

  describe("with tasks and learnings", () => {
    it("shows correct task counts after adding tasks", () => {
      insertTask(dbPath, FX.TASK_1, "Task one")
      insertTask(dbPath, FX.TASK_2, "Task two")

      const result = runTx("doctor", dbPath)
      expect(result.status).toBe(0)
      // Should show 2 total tasks
      expect(result.stdout).toMatch(/Tasks: 2 total/)
    })

    it("shows ready count for ready tasks", () => {
      insertTask(dbPath, FX.READY, "Ready task")

      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      const taskCheck = json.checks.find((c: { name: string }) => c.name === "tasks")
      expect(taskCheck).toBeDefined()
      expect(taskCheck.message).toContain("ready")
    })

    it("shows learning count after adding learnings", () => {
      insertLearning(dbPath, "Test learning for doctor")

      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      const learningCheck = json.checks.find((c: { name: string }) => c.name === "learnings")
      expect(learningCheck).toBeDefined()
      expect(learningCheck.message).toContain("1 total")
    })
  })

  describe("verbose mode", () => {
    it("shows additional details with --verbose", () => {
      // API key warning should have details in verbose mode
      const result = runTxArgs(["doctor", "--verbose"], dbPath, { ANTHROPIC_API_KEY: "" })
      expect(result.status).toBe(0)
      // Verbose details for missing API key
      expect(result.stdout).toContain("Required for:")
    })

    it("shows verbose task breakdown", () => {
      insertTask(dbPath, FX.VERBOSE, "Verbose task")

      const result = runTx("doctor --verbose", dbPath)
      expect(result.status).toBe(0)
      // Verbose details show per-status breakdown
      expect(result.stdout).toMatch(/backlog: \d+/)
    })

    it("does not show details without --verbose", () => {
      const result = runTxArgs(["doctor"], dbPath, { ANTHROPIC_API_KEY: "" })
      expect(result.status).toBe(0)
      // Without verbose, details should not appear
      expect(result.stdout).not.toContain("Required for:")
    })
  })

  describe("JSON output", () => {
    it("outputs valid JSON with --json flag", () => {
      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("healthy")
      expect(json).toHaveProperty("checks")
    })

    it("JSON healthy field is true when all checks pass", () => {
      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.healthy).toBe(true)
    })

    it("JSON checks array contains all 7 checks", () => {
      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(Array.isArray(json.checks)).toBe(true)

      const checkNames = json.checks.map((c: { name: string }) => c.name)
      expect(checkNames).toContain("database")
      expect(checkNames).toContain("wal_mode")
      expect(checkNames).toContain("schema")
      expect(checkNames).toContain("services")
      expect(checkNames).toContain("stale_claims")
      expect(checkNames).toContain("tasks")
      expect(checkNames).toContain("learnings")
    })

    it("JSON checks have correct structure", () => {
      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      for (const check of json.checks) {
        expect(check).toHaveProperty("name")
        expect(check).toHaveProperty("status")
        expect(check).toHaveProperty("message")
        expect(["pass", "warn", "fail"]).toContain(check.status)
      }
    })

    it("JSON includes api_key check", () => {
      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      const apiKeyCheck = json.checks.find((c: { name: string }) => c.name === "api_key")
      expect(apiKeyCheck).toBeDefined()
      expect(["pass", "warn"]).toContain(apiKeyCheck.status)
    })
  })

  describe("ANTHROPIC_API_KEY detection", () => {
    it("warns when ANTHROPIC_API_KEY is not set", () => {
      const result = runTxArgs(["doctor", "--json"], dbPath, { ANTHROPIC_API_KEY: "" })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      const apiKeyCheck = json.checks.find((c: { name: string }) => c.name === "api_key")
      expect(apiKeyCheck.status).toBe("warn")
      expect(apiKeyCheck.message).toContain("not set")
    })

    it("passes when ANTHROPIC_API_KEY is set", () => {
      const result = runTxArgs(["doctor", "--json"], dbPath, { ANTHROPIC_API_KEY: "sk-test-key" })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      const apiKeyCheck = json.checks.find((c: { name: string }) => c.name === "api_key")
      expect(apiKeyCheck.status).toBe("pass")
      expect(apiKeyCheck.message).toContain("set")
    })
  })

  describe("schema check", () => {
    it("reports schema as current after init", () => {
      const result = runTx("doctor --json", dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      const schemaCheck = json.checks.find((c: { name: string }) => c.name === "schema")
      expect(schemaCheck.status).toBe("pass")
      expect(schemaCheck.message).toContain("current")
    })
  })

  describe("exit codes", () => {
    it("exits 0 when all checks pass or warn", () => {
      const result = runTx("doctor", dbPath)
      // Warns are fine, only fails cause exit 1
      expect(result.status).toBe(0)
    })
  })

  describe("help", () => {
    it("doctor --help shows help", () => {
      const result = runTx("doctor --help", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx doctor")
      expect(result.stdout).toContain("--verbose")
      expect(result.stdout).toContain("--json")
    })

    it("help doctor shows help", () => {
      const result = runTxArgs(["help", "doctor"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx doctor")
      expect(result.stdout).toContain("diagnostics")
    })
  })
})
