import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"

const TX_BIN = resolve(__dirname, "../../apps/cli/dist/cli.js")
const CLI_TIMEOUT = 10000

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

/**
 * Run tx CLI with array of arguments (for precise control over argument parsing)
 */
function runTxArgs(args: string[], dbPath: string): ExecResult {
  try {
    const result = spawnSync("bun", [TX_BIN, ...args, "--db", dbPath], {
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

/**
 * Run tx CLI with simple space-separated string (for simple commands)
 */
function runTx(args: string, dbPath: string): ExecResult {
  return runTxArgs(args.split(" "), dbPath)
}

describe("CLI try command", () => {
  let tmpDir: string
  let dbPath: string
  let taskId: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-try-"))
    dbPath = join(tmpDir, "test.db")
    // Initialize the database
    runTx("init", dbPath)
    // Create a task to record attempts on
    const addResult = runTxArgs(["add", "Test task for attempts", "--json"], dbPath)
    const taskJson = JSON.parse(addResult.stdout)
    taskId = taskJson.id
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("records a failed attempt with reason as flag value", () => {
      const result = runTxArgs(["try", taskId, "Used Redux", "--failed", "Too complex for this use case"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Recorded attempt:")
      expect(result.stdout).toContain("Approach: Used Redux")
      expect(result.stdout).toContain("Outcome:")
      expect(result.stdout).toContain("failed")
      expect(result.stdout).toContain("Reason: Too complex for this use case")
    })

    it("records a succeeded attempt without reason", () => {
      const result = runTxArgs(["try", taskId, "Used Zustand", "--succeeded"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Recorded attempt:")
      expect(result.stdout).toContain("Approach: Used Zustand")
      expect(result.stdout).toContain("succeeded")
      // Should not show "Reason:" line when no reason provided
      expect(result.stdout).not.toContain("Reason:")
    })

    it("records a failed attempt without reason", () => {
      const result = runTxArgs(["try", taskId, "Direct state", "--failed"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Approach: Direct state")
      expect(result.stdout).toContain("failed")
      expect(result.stdout).not.toContain("Reason:")
    })

    it("records a succeeded attempt with reason", () => {
      const result = runTxArgs(["try", taskId, "Context API", "--succeeded", "Simple and effective"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Approach: Context API")
      expect(result.stdout).toContain("succeeded")
      expect(result.stdout).toContain("Reason: Simple and effective")
    })
  })

  describe("mutually exclusive flags", () => {
    it("fails when both --failed and --succeeded are provided", () => {
      const result = runTxArgs(["try", taskId, "Some approach", "--failed", "--succeeded"], dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("--failed and --succeeded are mutually exclusive")
    })

    it("fails when neither --failed nor --succeeded is provided", () => {
      const result = runTxArgs(["try", taskId, "Some approach"], dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Must specify either --failed or --succeeded")
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag for failed attempt", () => {
      const result = runTxArgs(["try", taskId, "JSON test approach", "--failed", "Test reason", "--json"], dbPath)
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.id).toBeGreaterThan(0)
      expect(json.taskId).toBe(taskId)
      expect(json.approach).toBe("JSON test approach")
      expect(json.outcome).toBe("failed")
      expect(json.reason).toBe("Test reason")
      expect(json.createdAt).toBeDefined()
    })

    it("outputs JSON with --json flag for succeeded attempt", () => {
      const result = runTxArgs(["try", taskId, "Success approach", "--succeeded", "--json"], dbPath)
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.outcome).toBe("succeeded")
      expect(json.reason).toBeNull()
    })

    it("JSON output includes null reason when not provided", () => {
      const result = runTxArgs(["try", taskId, "No reason", "--failed", "--json"], dbPath)
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.reason).toBeNull()
    })
  })

  describe("error cases", () => {
    it("shows error when task-id is missing", () => {
      const result = runTx("try", dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Usage:")
    })

    it("shows error when approach is missing", () => {
      const result = runTxArgs(["try", taskId], dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Usage:")
    })

    it("shows TaskNotFoundError for non-existent task", () => {
      const result = runTxArgs(["try", "tx-nonexistent", "Some approach", "--failed"], dbPath)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("Task not found")
    })

    it("shows usage error for empty approach", () => {
      // Empty string approach is treated as missing argument by CLI arg parsing
      const result = runTxArgs(["try", taskId, "", "--failed"], dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Usage:")
    })
  })

  describe("help", () => {
    it("try --help shows help", () => {
      const result = runTx("try --help", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx try")
      expect(result.stdout).toContain("--failed")
      expect(result.stdout).toContain("--succeeded")
      expect(result.stdout).toContain("mutually exclusive")
    })

    it("help try shows help", () => {
      const result = runTx("help try", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx try")
      expect(result.stdout).toContain("Record an attempt on a task")
    })
  })

  describe("multiple attempts on same task", () => {
    it("allows recording multiple attempts on the same task", () => {
      // Record first attempt
      const result1 = runTxArgs(["try", taskId, "First approach", "--failed", "Did not work"], dbPath)
      expect(result1.status).toBe(0)

      // Record second attempt
      const result2 = runTxArgs(["try", taskId, "Second approach", "--failed", "Also failed"], dbPath)
      expect(result2.status).toBe(0)

      // Record successful attempt
      const result3 = runTxArgs(["try", taskId, "Third approach", "--succeeded"], dbPath)
      expect(result3.status).toBe(0)

      // All should have different attempt IDs
      const json1 = JSON.parse(runTxArgs(["try", taskId, "Check 1", "--failed", "--json"], dbPath).stdout)
      const json2 = JSON.parse(runTxArgs(["try", taskId, "Check 2", "--succeeded", "--json"], dbPath).stdout)
      expect(json1.id).not.toBe(json2.id)
    })
  })

  describe("special characters in approach and reason", () => {
    it("handles approach with special characters", () => {
      const result = runTxArgs(["try", taskId, "Use config.json & env vars", "--failed", "--json"], dbPath)
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.approach).toContain("config.json")
    })

    it("handles reason with special characters", () => {
      const result = runTxArgs(["try", taskId, "Test approach", "--failed", "Error: 'undefined' is not a function", "--json"], dbPath)
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.reason).toContain("Error:")
    })
  })
})
