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

function runTx(args: string[], dbPath: string): ExecResult {
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

describe("CLI learning:add", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    // Initialize the database
    runTx(["init"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("creates a learning with content", () => {
    const result = runTx(["learning:add", "Always use transactions"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Created learning: #1")
    expect(result.stdout).toContain("Content: Always use transactions")
  })

  it("creates a learning with category flag", () => {
    const result = runTx(["learning:add", "DB tip", "-c", "database"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Category: database")
  })

  it("creates a learning with --category flag", () => {
    const result = runTx(["learning:add", "API tip", "--category", "api"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Category: api")
  })

  it("creates a learning with source-ref flag", () => {
    const result = runTx(["learning:add", "From task", "--source-ref", "tx-abc123"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Source: tx-abc123")
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["learning:add", "JSON test", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.id).toBe(1)
    expect(json.content).toBe("JSON test")
    expect(json.sourceType).toBe("manual")
  })

  it("handles source-type flag", () => {
    const result = runTx(["learning:add", "Compaction note", "--source-type", "compaction", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.sourceType).toBe("compaction")
  })

  it("shows error when content is missing", () => {
    const result = runTx(["learning:add"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })
})

describe("CLI learning:search", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)
    // Seed some learnings
    runTx(["learning:add", "Database transactions are essential for consistency"], dbPath)
    runTx(["learning:add", "API rate limiting prevents abuse"], dbPath)
    runTx(["learning:add", "PostgreSQL supports ACID transactions"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("searches learnings by query", () => {
    const result = runTx(["learning:search", "database"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("learning(s) found")
  })

  it("respects --limit flag", () => {
    const result = runTx(["learning:search", "transactions", "--limit", "1", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.length).toBeLessThanOrEqual(1)
  })

  it("respects -n short flag for limit", () => {
    const result = runTx(["learning:search", "transactions", "-n", "1", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.length).toBeLessThanOrEqual(1)
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["learning:search", "database", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(Array.isArray(json)).toBe(true)
    if (json.length > 0) {
      expect(json[0]).toHaveProperty("id")
      expect(json[0]).toHaveProperty("content")
      expect(json[0]).toHaveProperty("relevanceScore")
    }
  })

  it("returns empty results for non-matching query", () => {
    const result = runTx(["learning:search", "xyz123nonexistent"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No learnings found")
  })

  it("shows error when query is missing", () => {
    const result = runTx(["learning:search"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("respects --min-score flag", () => {
    const result = runTx(["learning:search", "database", "--min-score", "0.9", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    // Results should be filtered by min-score
    for (const r of json) {
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0.9)
    }
  })
})

describe("CLI learning:recent", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)
    // Seed some learnings
    runTx(["learning:add", "First learning"], dbPath)
    runTx(["learning:add", "Second learning"], dbPath)
    runTx(["learning:add", "Third learning"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("lists recent learnings", () => {
    const result = runTx(["learning:recent"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("recent learning(s)")
  })

  it("respects --limit flag", () => {
    const result = runTx(["learning:recent", "--limit", "2", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.length).toBeLessThanOrEqual(2)
  })

  it("respects -n short flag for limit", () => {
    const result = runTx(["learning:recent", "-n", "1", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.length).toBe(1)
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["learning:recent", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(Array.isArray(json)).toBe(true)
    expect(json.length).toBe(3)
    expect(json[0]).toHaveProperty("id")
    expect(json[0]).toHaveProperty("content")
    expect(json[0]).toHaveProperty("createdAt")
  })

  it("shows message when no learnings exist", () => {
    // Create fresh db with no learnings
    const emptyTmpDir = mkdtempSync(join(tmpdir(), "tx-test-empty-"))
    const emptyDbPath = join(emptyTmpDir, "test.db")
    runTx(["init"], emptyDbPath)

    const result = runTx(["learning:recent"], emptyDbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No learnings found")

    rmSync(emptyTmpDir, { recursive: true, force: true })
  })
})

describe("CLI learning:helpful", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)
    // Create a learning to mark as helpful
    runTx(["learning:add", "Test learning for helpfulness"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("records helpfulness with default score", () => {
    const result = runTx(["learning:helpful", "1"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Recorded helpfulness for learning #1")
    expect(result.stdout).toContain("Score: 100%")
  })

  it("records helpfulness with custom score", () => {
    const result = runTx(["learning:helpful", "1", "--score", "0.8"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Score: 80%")
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["learning:helpful", "1", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.success).toBe(true)
    expect(json.learning).toBeDefined()
    expect(json.learning.id).toBe(1)
  })

  it("shows error when ID is missing", () => {
    const result = runTx(["learning:helpful"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("shows error for non-numeric ID", () => {
    const result = runTx(["learning:helpful", "abc"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Learning ID must be a number")
  })

  it("shows error for non-existent learning", () => {
    const result = runTx(["learning:helpful", "999"], dbPath)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("Learning not found")
  })
})

describe("CLI context", () => {
  let tmpDir: string
  let dbPath: string
  let taskId: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)

    // Create a task
    const addResult = runTx(["add", "Implement JWT validation", "--json"], dbPath)
    const taskJson = JSON.parse(addResult.stdout)
    taskId = taskJson.id

    // Create learnings related to JWT
    runTx(["learning:add", "JWT tokens should be validated on every request"], dbPath)
    runTx(["learning:add", "Always check token expiration"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("gets contextual learnings for a task", () => {
    const result = runTx(["context", taskId], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Context for:")
    expect(result.stdout).toContain("relevant learning(s)")
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["context", taskId, "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.taskId).toBe(taskId)
    expect(json.taskTitle).toContain("JWT")
    expect(Array.isArray(json.learnings)).toBe(true)
    expect(json).toHaveProperty("searchQuery")
    expect(json).toHaveProperty("searchDuration")
  })

  it("writes context file with --inject flag", () => {
    // First create the .tx directory if it doesn't exist
    const result = runTx(["context", taskId, "--inject"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Wrote")
    expect(result.stdout).toContain("learning(s) to")

    // The context file is written to cwd/.tx/context.md (not the test db dir)
    // So we can't easily verify its contents without changing cwd
  })

  it("shows error when task-id is missing", () => {
    const result = runTx(["context"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("shows error for non-existent task", () => {
    const result = runTx(["context", "tx-nonexistent"], dbPath)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("Task not found")
  })
})

describe("CLI learn", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("attaches learning to a file path", () => {
    const result = runTx(["learn", "src/db.ts", "Always run migrations in a transaction"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Created file learning: #1")
    expect(result.stdout).toContain("Pattern: src/db.ts")
  })

  it("attaches learning to a glob pattern", () => {
    const result = runTx(["learn", "src/services/*.ts", "Services must use Effect-TS patterns"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Pattern: src/services/*.ts")
  })

  it("attaches learning with task association", () => {
    // Create a task first
    const addResult = runTx(["add", "Auth system", "--json"], dbPath)
    const taskJson = JSON.parse(addResult.stdout)
    const taskId = taskJson.id

    const result = runTx(["learn", "src/auth.ts", "Auth needs session handling", "--task", taskId], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Task: ${taskId}`)
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["learn", "src/db.ts", "JSON test", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.id).toBe(1)
    expect(json.filePattern).toBe("src/db.ts")
    expect(json.note).toBe("JSON test")
  })

  it("shows error when path is missing", () => {
    const result = runTx(["learn"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("shows error when note is missing", () => {
    const result = runTx(["learn", "src/db.ts"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })
})

describe("CLI recall", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)
    // Seed file learnings
    runTx(["learn", "src/db.ts", "Database specific note"], dbPath)
    runTx(["learn", "src/services/*.ts", "Service patterns"], dbPath)
    runTx(["learn", "test/*.ts", "Test conventions"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("recalls all file learnings without path", () => {
    const result = runTx(["recall"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("file learning(s)")
    expect(result.stdout).toContain("src/db.ts")
    expect(result.stdout).toContain("src/services/*.ts")
  })

  it("recalls learnings matching exact path", () => {
    const result = runTx(["recall", "src/db.ts"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Database specific note")
  })

  it("recalls learnings matching glob pattern", () => {
    const result = runTx(["recall", "src/services/task-service.ts"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Service patterns")
  })

  it("outputs JSON with --json flag for all learnings", () => {
    const result = runTx(["recall", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(Array.isArray(json)).toBe(true)
    expect(json.length).toBe(3)
    expect(json[0]).toHaveProperty("id")
    expect(json[0]).toHaveProperty("filePattern")
    expect(json[0]).toHaveProperty("note")
  })

  it("outputs JSON with --json flag for path query", () => {
    const result = runTx(["recall", "src/db.ts", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(Array.isArray(json)).toBe(true)
    expect(json.length).toBe(1)
    expect(json[0].filePattern).toBe("src/db.ts")
  })

  it("shows message when no learnings match path", () => {
    const result = runTx(["recall", "nonexistent/path.ts"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No learnings found for")
  })

  it("returns empty array in JSON when no learnings match path", () => {
    const result = runTx(["recall", "nonexistent/path.ts", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json).toEqual([])
  })
})

describe("CLI learning command help", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("learning:add --help shows help", () => {
    const result = runTx(["learning:add", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx learning:add")
    expect(result.stdout).toContain("Usage:")
  })

  it("learning:search --help shows help", () => {
    const result = runTx(["learning:search", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx learning:search")
  })

  it("learning:recent --help shows help", () => {
    const result = runTx(["learning:recent", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx learning:recent")
  })

  it("learning:helpful --help shows help", () => {
    const result = runTx(["learning:helpful", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx learning:helpful")
  })

  it("context --help shows help", () => {
    const result = runTx(["context", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx context")
    expect(result.stdout).toContain("--inject")
  })

  it("learn --help shows help", () => {
    const result = runTx(["learn", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx learn")
    expect(result.stdout).toContain("--task")
  })

  it("recall --help shows help", () => {
    const result = runTx(["recall", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx recall")
  })

  it("help learning:add shows help", () => {
    const result = runTx(["help", "learning:add"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx learning:add")
  })

  it("help context shows help", () => {
    const result = runTx(["help", "context"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx context")
  })
})
