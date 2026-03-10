/**
 * Integration tests for CLI memory subcommands: context, learn, recall.
 *
 * These test the 3 new subcommands added to `tx memory` as part of the
 * primitive pruning consolidation (replacing standalone tx context, tx learn,
 * tx recall commands).
 *
 * Uses real subprocess execution (spawnSync) against a real SQLite DB.
 * No mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 60000 : 30000))

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

/**
 * Run a tx CLI command in the given temp directory.
 * Uses --db to point at the test DB within the temp dir.
 */
function runTx(args: string[], cwd: string, dbPath: string): ExecResult {
  try {
    const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd,
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

// =============================================================================
// tx memory learn
// =============================================================================

describe("CLI memory learn", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-mem-learn-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx(["init"], tmpDir, dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("creates a file learning with path and note", () => {
    const result = runTx(["memory", "learn", "src/db.ts", "Always run migrations in a transaction"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Created file learning:")
    expect(result.stdout).toContain("Pattern: src/db.ts")
    expect(result.stdout).toContain("Note: Always run migrations in a transaction")
  })

  it("creates a file learning with glob pattern", () => {
    const result = runTx(["memory", "learn", "src/services/*.ts", "Services must use Effect-TS"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Pattern: src/services/*.ts")
  })

  it("creates a file learning with --task association", () => {
    // Create a task first
    const addResult = runTx(["add", "Auth system", "--json"], tmpDir, dbPath)
    const taskJson = JSON.parse(addResult.stdout)
    const taskId = taskJson.id

    const result = runTx(["memory", "learn", "src/auth.ts", "Auth needs sessions", "--task", taskId], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Task: ${taskId}`)
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["memory", "learn", "src/db.ts", "JSON test note", "--json"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.filePattern).toBe("src/db.ts")
    expect(json.note).toBe("JSON test note")
    expect(json.id).toBeDefined()
    expect(json.filePath).toBeDefined()
  })

  it("writes a .md file to docs/learnings/ in the project dir", () => {
    runTx(["memory", "learn", "src/db.ts", "Transactions are important"], tmpDir, dbPath)
    const learningsDir = join(tmpDir, "docs", "learnings")
    expect(existsSync(learningsDir)).toBe(true)

    // Should have at least one .md file
    const { readdirSync } = require("node:fs")
    const files = readdirSync(learningsDir).filter((f: string) => f.endsWith(".md"))
    expect(files.length).toBeGreaterThanOrEqual(1)

    // The file should contain the note text
    const content = readFileSync(join(learningsDir, files[0]), "utf-8")
    expect(content).toContain("Transactions are important")
  })

  it("shows error when path is missing", () => {
    const result = runTx(["memory", "learn"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
  })

  it("shows error when note is missing", () => {
    const result = runTx(["memory", "learn", "src/db.ts"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
  })
})

// =============================================================================
// tx memory recall
// =============================================================================

describe("CLI memory recall", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-mem-recall-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx(["init"], tmpDir, dbPath)

    // Seed some file learnings via `tx memory learn`
    runTx(["memory", "learn", "src/db.ts", "Database specific note"], tmpDir, dbPath)
    runTx(["memory", "learn", "src/services/*.ts", "Service patterns"], tmpDir, dbPath)
    runTx(["memory", "learn", "test/*.ts", "Test conventions"], tmpDir, dbPath)
    runTx(["memory", "learn", "src/**/*.ts", "Deep nested source files"], tmpDir, dbPath)

    // Index so the memory system can find them
    runTx(["memory", "index"], tmpDir, dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("recalls all file learnings without path argument", () => {
    const result = runTx(["memory", "recall"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("file learning(s)")
    expect(result.stdout).toContain("src/db.ts")
    expect(result.stdout).toContain("src/services/*.ts")
  })

  it("recalls learnings matching exact path", () => {
    const result = runTx(["memory", "recall", "src/db.ts"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Database specific note")
  })

  it("recalls learnings matching single-star glob pattern", () => {
    const result = runTx(["memory", "recall", "src/services/task-service.ts"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Service patterns")
  })

  it("recalls learnings matching double-star glob pattern", () => {
    const result = runTx(["memory", "recall", "src/lib/utils/helper.ts"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Deep nested source files")
  })

  it("outputs JSON with --json flag for all learnings", () => {
    const result = runTx(["memory", "recall", "--json"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(Array.isArray(json)).toBe(true)
    expect(json.length).toBe(4)
    expect(json[0]).toHaveProperty("id")
    expect(json[0]).toHaveProperty("filePattern")
    expect(json[0]).toHaveProperty("note")
  })

  it("outputs JSON with --json flag for path query", () => {
    const result = runTx(["memory", "recall", "src/db.ts", "--json"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(Array.isArray(json)).toBe(true)
    expect(json.length).toBe(1)
    expect(json[0].filePattern).toBe("src/db.ts")
  })

  it("shows message when no learnings match path", () => {
    const result = runTx(["memory", "recall", "nonexistent/path.ts"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No learnings found for")
  })

  it("returns empty array in JSON when no learnings match path", () => {
    const result = runTx(["memory", "recall", "nonexistent/path.ts", "--json"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json).toEqual([])
  })

  it("matches ? glob wildcard for single character", () => {
    // Create a learning with ? wildcard (matches exactly one character)
    runTx(["memory", "learn", "src/db?.ts", "Single char wildcard note"], tmpDir, dbPath)
    runTx(["memory", "index"], tmpDir, dbPath)

    // src/db1.ts should match (? matches "1")
    const matchResult = runTx(["memory", "recall", "src/db1.ts", "--json"], tmpDir, dbPath)
    expect(matchResult.status).toBe(0)
    const matchJson = JSON.parse(matchResult.stdout)
    const hasWildcardNote = matchJson.some((l: { note: string }) => l.note === "Single char wildcard note")
    expect(hasWildcardNote).toBe(true)

    // src/db12.ts should NOT match (? matches only one char, not two)
    const noMatchResult = runTx(["memory", "recall", "src/db12.ts", "--json"], tmpDir, dbPath)
    expect(noMatchResult.status).toBe(0)
    const noMatchJson = JSON.parse(noMatchResult.stdout)
    const hasWildcardNoteInNoMatch = noMatchJson.some((l: { note: string }) => l.note === "Single char wildcard note")
    expect(hasWildcardNoteInNoMatch).toBe(false)
  })

  it("matches literal brackets in file patterns (regex metacharacters)", () => {
    // Create a learning with literal brackets in the path
    runTx(["memory", "learn", "src/[utils]/helper.ts", "Bracket path note"], tmpDir, dbPath)
    runTx(["memory", "index"], tmpDir, dbPath)

    // Exact match with brackets should find it
    const result = runTx(["memory", "recall", "src/[utils]/helper.ts", "--json"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    const hasBracketNote = json.some((l: { note: string }) => l.note === "Bracket path note")
    expect(hasBracketNote).toBe(true)
  })

  it("treats dot in file extension as literal (not regex wildcard)", () => {
    // Create a learning for config.json
    runTx(["memory", "learn", "config.json", "Config file note"], tmpDir, dbPath)
    runTx(["memory", "index"], tmpDir, dbPath)

    // config.json should match
    const matchResult = runTx(["memory", "recall", "config.json", "--json"], tmpDir, dbPath)
    expect(matchResult.status).toBe(0)
    const matchJson = JSON.parse(matchResult.stdout)
    const hasConfigNote = matchJson.some((l: { note: string }) => l.note === "Config file note")
    expect(hasConfigNote).toBe(true)

    // configXjson should NOT match (dot is literal, not regex wildcard)
    const noMatchResult = runTx(["memory", "recall", "configXjson", "--json"], tmpDir, dbPath)
    expect(noMatchResult.status).toBe(0)
    const noMatchJson = JSON.parse(noMatchResult.stdout)
    const hasConfigNoteInNoMatch = noMatchJson.some((l: { note: string }) => l.note === "Config file note")
    expect(hasConfigNoteInNoMatch).toBe(false)
  })
})

// =============================================================================
// tx memory context
// =============================================================================

describe("CLI memory context", () => {
  let tmpDir: string
  let dbPath: string
  let taskId: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-mem-ctx-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx(["init"], tmpDir, dbPath)

    // Create a task
    const addResult = runTx(["add", "Implement JWT validation", "--json"], tmpDir, dbPath)
    const taskJson = JSON.parse(addResult.stdout)
    taskId = taskJson.id

    // Create learnings related to JWT via memory learn
    runTx(["memory", "learn", "src/auth.ts", "JWT tokens should be validated on every request"], tmpDir, dbPath)
    runTx(["memory", "learn", "src/middleware.ts", "Always check token expiration before processing"], tmpDir, dbPath)

    // Index so the retriever can find them
    runTx(["memory", "index"], tmpDir, dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("gets contextual memory for a task", () => {
    const result = runTx(["memory", "context", taskId], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Context for:")
    expect(result.stdout).toContain("relevant result(s)")
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["memory", "context", taskId, "--json"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.taskId).toBe(taskId)
    expect(json.taskTitle).toContain("JWT")
    expect(Array.isArray(json.results)).toBe(true)
    expect(json).toHaveProperty("searchQuery")
    expect(json).toHaveProperty("searchDuration")
  })

  it("writes context file with --inject flag", () => {
    const result = runTx(["memory", "context", taskId, "--inject"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Wrote")
    expect(result.stdout).toContain("result(s) to")

    // Verify the context file was written in the cwd
    const contextPath = join(tmpDir, ".tx", "context.md")
    expect(existsSync(contextPath)).toBe(true)

    const content = readFileSync(contextPath, "utf-8")
    expect(content).toContain("Context for")
    expect(content).toContain(taskId)
  })

  it("respects --limit flag", () => {
    const result = runTx(["memory", "context", taskId, "--limit", "1", "--json"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.results.length).toBeLessThanOrEqual(1)
  })

  it("shows error when task-id is missing", () => {
    const result = runTx(["memory", "context"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
  })

  it("shows error for non-existent task", () => {
    const result = runTx(["memory", "context", "tx-nonexistent"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
  })
})

// =============================================================================
// Help text for new subcommands
// =============================================================================

describe("CLI memory subcommand help", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-mem-help-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("help memory context shows usage", () => {
    const result = runTx(["help", "memory", "context"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx memory context")
    expect(result.stdout).toContain("--inject")
  })

  it("help memory learn shows usage", () => {
    const result = runTx(["help", "memory", "learn"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx memory learn")
    expect(result.stdout).toContain("--task")
  })

  it("help memory recall shows usage", () => {
    const result = runTx(["help", "memory", "recall"], tmpDir, dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx memory recall")
  })
})

// =============================================================================
// Old commands are removed
// =============================================================================

describe("Removed CLI commands are no longer recognized", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-removed-"))
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    dbPath = join(tmpDir, ".tx", "tasks.db")
    runTx(["init"], tmpDir, dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("tx context is no longer recognized", () => {
    const result = runTx(["context", "tx-abc123"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Unknown command")
  })

  it("tx learn is no longer recognized", () => {
    const result = runTx(["learn", "src/db.ts", "note"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Unknown command")
  })

  it("tx recall is no longer recognized", () => {
    const result = runTx(["recall"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Unknown command")
  })

  it("tx learning is no longer recognized", () => {
    const result = runTx(["learning", "add", "test"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Unknown command")
  })

  it("tx try is no longer recognized", () => {
    const result = runTx(["try", "tx-abc123", "approach"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Unknown command")
  })

  it("tx attempts is no longer recognized", () => {
    const result = runTx(["attempts", "tx-abc123"], tmpDir, dbPath)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Unknown command")
  })
})
