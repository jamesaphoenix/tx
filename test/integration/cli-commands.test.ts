/**
 * CLI E2E Tests for untested commands
 *
 * Tests the following CLI commands:
 * - tx tree <id> - hierarchy visualization, JSON output
 * - tx sync stream compatibility + status behavior
 * - tx migrate status - schema version, applied/pending
 *
 * Per DD-007: Uses real in-memory SQLite and deterministic test setup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 60000 : 30000))

/**
 * Force a WAL checkpoint on the database to ensure all writes from prior
 * subprocesses are visible to subsequent subprocess readers.
 */
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

/**
 * Run tx CLI with array of arguments (for precise control over argument parsing)
 */
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

/**
 * Run tx CLI with simple space-separated string (for simple commands)
 */
function runTx(args: string, dbPath: string): ExecResult {
  return runTxArgs(args.split(" "), dbPath)
}

// =============================================================================
// tx tree Command Tests
// =============================================================================

describe("CLI tree command", () => {
  let tmpDir: string
  let dbPath: string
  let rootId: string
  let parentId: string
  let child1Id: string
  let child2Id: string
  let grandchildId: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-tree-"))
    dbPath = join(tmpDir, "test.db")
    // Initialize the database
    runTx("init", dbPath)

    // Create a hierarchy: root -> parent -> child1, child2; child1 -> grandchild
    const rootResult = runTxArgs(["add", "Root task", "--json"], dbPath)
    rootId = JSON.parse(rootResult.stdout).id

    const parentResult = runTxArgs(["add", "Parent task", "--parent", rootId, "--json"], dbPath)
    parentId = JSON.parse(parentResult.stdout).id

    const child1Result = runTxArgs(["add", "Child 1", "--parent", parentId, "--json"], dbPath)
    child1Id = JSON.parse(child1Result.stdout).id

    const child2Result = runTxArgs(["add", "Child 2", "--parent", parentId, "--json"], dbPath)
    child2Id = JSON.parse(child2Result.stdout).id

    const grandchildResult = runTxArgs(["add", "Grandchild", "--parent", child1Id, "--json"], dbPath)
    grandchildId = JSON.parse(grandchildResult.stdout).id
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("shows tree structure with proper indentation", () => {
      const result = runTxArgs(["tree", parentId], dbPath)
      expect(result.status).toBe(0)

      // Check that parent, children, and grandchild are shown
      expect(result.stdout).toContain(parentId)
      expect(result.stdout).toContain("Parent task")
      expect(result.stdout).toContain(child1Id)
      expect(result.stdout).toContain("Child 1")
      expect(result.stdout).toContain(child2Id)
      expect(result.stdout).toContain("Child 2")
      expect(result.stdout).toContain(grandchildId)
      expect(result.stdout).toContain("Grandchild")
    })

    it("shows tree structure with indentation levels", () => {
      const result = runTxArgs(["tree", parentId], dbPath)
      expect(result.status).toBe(0)

      const lines = result.stdout.split("\n").filter(Boolean)
      // First line is the parent (no indentation)
      expect(lines[0]).toMatch(new RegExp(`^\\s*[+\\s]\\s*${parentId}`))

      // Children have 2-space indentation
      const childLines = lines.filter(l => l.includes(child1Id) || l.includes(child2Id))
      for (const childLine of childLines) {
        expect(childLine).toMatch(/^ {2}/)
      }

      // Grandchild has 4-space indentation
      const grandchildLine = lines.find(l => l.includes(grandchildId))
      expect(grandchildLine).toMatch(/^ {4}/)
    })

    it("shows ready indicator (+) for ready tasks", () => {
      const result = runTxArgs(["tree", parentId], dbPath)
      expect(result.status).toBe(0)
      // All tasks should be ready (no blockers) and marked with +
      expect(result.stdout).toMatch(/\+/)
    })

    it("shows single node for leaf task", () => {
      const result = runTxArgs(["tree", grandchildId], dbPath)
      expect(result.status).toBe(0)

      const lines = result.stdout.split("\n").filter(Boolean)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(grandchildId)
      expect(lines[0]).toContain("Grandchild")
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const result = runTxArgs(["tree", parentId, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.id).toBe(parentId)
      expect(json.title).toBe("Parent task")
      expect(json.childTasks).toBeDefined()
      expect(Array.isArray(json.childTasks)).toBe(true)
    })

    it("JSON output includes TaskWithDeps fields", () => {
      const result = runTxArgs(["tree", parentId, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("blockedBy")
      expect(json).toHaveProperty("blocks")
      expect(json).toHaveProperty("children")
      expect(json).toHaveProperty("isReady")
    })

    it("JSON output includes nested children recursively", () => {
      const result = runTxArgs(["tree", parentId, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.childTasks.length).toBe(2) // child1 and child2

      // Find child1 which has grandchild
      const child1 = json.childTasks.find((c: { id: string }) => c.id === child1Id)
      expect(child1).toBeDefined()
      expect(child1.childTasks).toHaveLength(1)
      expect(child1.childTasks[0].id).toBe(grandchildId)
    })
  })

  describe("error cases", () => {
    it("shows error when task-id is missing", () => {
      const result = runTx("tree", dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Usage:")
    })

    it("shows TaskNotFoundError for non-existent task", () => {
      const result = runTxArgs(["tree", "tx-nonexistent"], dbPath)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("Task not found")
    })
  })

  describe("help", () => {
    it("tree --help shows help", () => {
      const result = runTx("tree --help", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx tree")
      expect(result.stdout).toContain("--json")
    })

    it("help tree shows help", () => {
      const result = runTx("help tree", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx tree")
      expect(result.stdout).toContain("subtree")
    })
  })
})


// =============================================================================
// tx sync Command Tests (stream model + strict legacy rejection)
// =============================================================================

describe("CLI sync command strict mode", () => {
  let tmpDir: string
  let dbPath: string

  const runInTmp = (args: string[]): ExecResult => {
    const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: tmpDir,
    })
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      status: result.status ?? 1,
    }
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-compat-"))
    dbPath = join(tmpDir, ".tx", "tasks.db")
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    const init = runInTmp(["init"])
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("rejects legacy file flags for sync export/import", () => {
    const exportLegacy = runInTmp(["sync", "export", "--path", "tasks.jsonl"])
    expect(exportLegacy.status).toBe(1)
    expect(exportLegacy.stderr).toContain("no longer supported")

    const exportTasksOnly = runInTmp(["sync", "export", "--tasks-only"])
    expect(exportTasksOnly.status).toBe(1)
    expect(exportTasksOnly.stderr).toContain("no longer supported")

    const importLegacy = runInTmp(["sync", "import", "--path", "tasks.jsonl"])
    expect(importLegacy.status).toBe(1)
    expect(importLegacy.stderr).toContain("no longer supported")

    const importTasksOnly = runInTmp(["sync", "import", "--tasks-only"])
    expect(importTasksOnly.status).toBe(1)
    expect(importTasksOnly.stderr).toContain("no longer supported")
  })

  it("does not expose removed sync compact subcommand", () => {
    const result = runInTmp(["sync", "compact"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unknown sync subcommand: compact")
  })

  it("sync subcommand help excludes legacy file options", () => {
    const exportHelp = runInTmp(["sync", "export", "--help"])
    expect(exportHelp.status).toBe(0)
    expect(exportHelp.stdout).toContain("tx sync export")
    expect(exportHelp.stdout).not.toContain("--path")
    expect(exportHelp.stdout).not.toContain("--tasks-only")

    const importHelp = runInTmp(["sync", "import", "--help"])
    expect(importHelp.status).toBe(0)
    expect(importHelp.stdout).toContain("tx sync import")
    expect(importHelp.stdout).not.toContain("--path")
    expect(importHelp.stdout).not.toContain("--tasks-only")
  })
})

// =============================================================================
// tx sync status Command Tests (stream)
// =============================================================================

describe("CLI sync status command", () => {
  let tmpDir: string
  let dbPath: string

  const runInTmp = (args: string[]): ExecResult => {
    const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: tmpDir,
    })
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      status: result.status ?? 1,
    }
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-status-stream-"))
    dbPath = join(tmpDir, ".tx", "tasks.db")
    mkdirSync(join(tmpDir, ".tx"), { recursive: true })
    const init = runInTmp(["init"])
    expect(init.status).toBe(0)
    const add = runInTmp(["add", "Status task", "--json"])
    expect(add.status).toBe(0)
    walCheckpoint(dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("prints stream-based status fields", () => {
    const result = runInTmp(["sync", "status"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Sync Status:")
    expect(result.stdout).toContain("Tasks in database:")
    expect(result.stdout).toContain("Events in stream logs:")
    expect(result.stdout).toContain("Auto-sync:")
  })

  it("returns stream JSON status shape", () => {
    const result = runInTmp(["sync", "status", "--json"])
    expect(result.status).toBe(0)

    const json = JSON.parse(result.stdout)
    expect(json).toHaveProperty("dbTaskCount")
    expect(json).toHaveProperty("eventOpCount")
    expect(json).toHaveProperty("isDirty")
    expect(json).toHaveProperty("autoSyncEnabled")
    expect(json.dbTaskCount).toBe(1)
  })

  it("marks clean after export and dirty again after local deletion", () => {
    const exported = runInTmp(["sync", "export", "--json"])
    expect(exported.status).toBe(0)

    const clean = JSON.parse(runInTmp(["sync", "status", "--json"]).stdout)
    expect(clean.lastExport).not.toBeNull()
    expect(clean.isDirty).toBe(false)

    const listed = JSON.parse(runInTmp(["list", "--json"]).stdout) as Array<{ id: string }>
    const deleted = runInTmp(["delete", listed[0]!.id])
    expect(deleted.status).toBe(0)

    const dirty = JSON.parse(runInTmp(["sync", "status", "--json"]).stdout)
    expect(dirty.dbTaskCount).toBe(0)
    expect(dirty.isDirty).toBe(true)
  })

  it("sync status --help shows help", () => {
    const result = runInTmp(["sync", "status", "--help"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx sync status")
  })
})
// =============================================================================
// tx migrate status Command Tests
// =============================================================================

describe("CLI migrate status command", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-migrate-"))
    dbPath = join(tmpDir, "test.db")

    // Initialize database (applies all migrations)
    runTx("init", dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("shows migration status", () => {
      const result = runTxArgs(["migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Migration Status:")
      expect(result.stdout).toContain("Current version:")
      expect(result.stdout).toContain("Latest version:")
    })

    it("shows schema version is current", () => {
      const result = runTxArgs(["migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Pending migrations: 0")
    })

    it("shows applied migrations", () => {
      const result = runTxArgs(["migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Applied migrations:")
      expect(result.stdout).toMatch(/v\d+ - applied/)
    })

    it("shows no pending migrations for fully migrated db", () => {
      const result = runTxArgs(["migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      // Should not show "Pending migrations:" section with items
      expect(result.stdout).not.toMatch(/Pending migrations:\n\s+v\d+/)
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const result = runTxArgs(["migrate", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("currentVersion")
      expect(json).toHaveProperty("latestVersion")
      expect(json).toHaveProperty("pendingCount")
      expect(json).toHaveProperty("appliedMigrations")
      expect(json).toHaveProperty("pendingMigrations")
    })

    it("JSON shows correct version numbers", () => {
      const result = runTxArgs(["migrate", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.currentVersion).toBe(json.latestVersion)
      expect(json.pendingCount).toBe(0)
      expect(json.pendingMigrations).toEqual([])
    })

    it("JSON appliedMigrations has correct structure", () => {
      const result = runTxArgs(["migrate", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(Array.isArray(json.appliedMigrations)).toBe(true)
      expect(json.appliedMigrations.length).toBeGreaterThan(0)

      for (const m of json.appliedMigrations) {
        expect(m).toHaveProperty("version")
        expect(m).toHaveProperty("appliedAt")
        expect(typeof m.version).toBe("number")
      }
    })
  })

  describe("help", () => {
    it("migrate status --help shows help", () => {
      const result = runTxArgs(["migrate", "status", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx migrate status")
    })

    it("help migrate shows help", () => {
      const result = runTxArgs(["help", "migrate"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("migrate")
    })
  })

  describe("unknown subcommand", () => {
    it("shows error for unknown migrate subcommand", () => {
      const result = runTxArgs(["migrate", "unknown"], dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Unknown migrate subcommand")
    })
  })
})

// =============================================================================
// tx sync claude CLI E2E Tests
// =============================================================================

describe("CLI sync claude command", () => {
  let tmpDir: string
  let dbPath: string
  let targetDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-claude-"))
    dbPath = join(tmpDir, "test.db")
    targetDir = join(tmpDir, "claude-tasks")
    mkdirSync(targetDir)
    runTx("init", dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("writes task files to --dir", () => {
    runTxArgs(["add", "Build widget", "--score", "900", "--json"], dbPath)
    runTxArgs(["add", "Write tests", "--score", "800", "--json"], dbPath)

    const result = runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Wrote 2 task(s)")

    // Verify task files exist
    expect(existsSync(join(targetDir, "1.json"))).toBe(true)
    expect(existsSync(join(targetDir, "2.json"))).toBe(true)

    // Verify file contents
    const task1 = JSON.parse(readFileSync(join(targetDir, "1.json"), "utf-8"))
    expect(task1.id).toBe("1")
    expect(task1.subject).toBe("Build widget")
    expect(task1.status).toBe("pending")
    expect(task1.blocks).toEqual([])
    expect(task1.blockedBy).toEqual([])

    // Verify .highwatermark
    expect(readFileSync(join(targetDir, ".highwatermark"), "utf-8")).toBe("3")

    // Verify .lock exists
    expect(existsSync(join(targetDir, ".lock"))).toBe(true)
  })

  it("excludes done tasks from output", () => {
    runTxArgs(["add", "Active task", "--json"], dbPath)
    const t2 = JSON.parse(runTxArgs(["add", "Done task", "--json"], dbPath).stdout)
    runTxArgs(["done", t2.id], dbPath)

    const result = runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Wrote 1 task(s)")

    // Only 1.json should exist
    const files = readdirSync(targetDir).filter((f: string) => /^\d+\.json$/.test(f))
    expect(files).toHaveLength(1)

    const task = JSON.parse(readFileSync(join(targetDir, "1.json"), "utf-8"))
    expect(task.subject).toBe("Active task")
  })

  it("maps dependencies to numeric IDs", () => {
    const blocker = JSON.parse(runTxArgs(["add", "Blocker task", "--score", "900", "--json"], dbPath).stdout)
    const blocked = JSON.parse(runTxArgs(["add", "Blocked task", "--score", "800", "--json"], dbPath).stdout)
    runTxArgs(["block", blocked.id, blocker.id], dbPath)

    runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)

    const file1 = JSON.parse(readFileSync(join(targetDir, "1.json"), "utf-8"))
    const file2 = JSON.parse(readFileSync(join(targetDir, "2.json"), "utf-8"))

    // Blocker (ready, higher score) gets ID 1, blocked gets ID 2
    expect(file1.subject).toBe("Blocker task")
    expect(file2.subject).toBe("Blocked task")
    expect(file1.blocks).toContain("2")
    expect(file2.blockedBy).toContain("1")
  })

  it("includes tx context and done hints in description", () => {
    const task = JSON.parse(runTxArgs(["add", "Implement feature", "--description", "Build the thing", "--json"], dbPath).stdout)

    runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)

    const file = JSON.parse(readFileSync(join(targetDir, "1.json"), "utf-8"))
    expect(file.description).toContain("Build the thing")
    expect(file.description).toContain(`tx context ${task.id}`)
    expect(file.description).toContain(`tx done ${task.id}`)
    expect(file.activeForm).toContain(task.id)
  })

  it("outputs JSON with --json flag", () => {
    runTxArgs(["add", "Task A", "--json"], dbPath)

    const result = runTxArgs(["sync", "claude", "--dir", targetDir, "--json"], dbPath)
    expect(result.status).toBe(0)

    const output = JSON.parse(result.stdout)
    expect(output.tasksWritten).toBe(1)
    expect(output.dir).toBe(targetDir)
    expect(output.highwatermark).toBe(2)
  })

  it("cleans up stale files on re-sync", { timeout: 30000 }, () => {
    // First sync: 3 tasks
    const t1 = JSON.parse(runTxArgs(["add", "Task A", "--score", "900", "--json"], dbPath).stdout)
    const t2 = JSON.parse(runTxArgs(["add", "Task B", "--score", "800", "--json"], dbPath).stdout)
    runTxArgs(["add", "Task C", "--score", "700", "--json"], dbPath)

    runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)
    expect(existsSync(join(targetDir, "3.json"))).toBe(true)

    // Mark two as done
    runTxArgs(["done", t1.id], dbPath)
    runTxArgs(["done", t2.id], dbPath)

    // Re-sync: only 1 task remains
    const result = runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Wrote 1 task(s)")

    // Old files 2.json and 3.json should be cleaned up
    expect(existsSync(join(targetDir, "1.json"))).toBe(true)
    expect(existsSync(join(targetDir, "2.json"))).toBe(false)
    expect(existsSync(join(targetDir, "3.json"))).toBe(false)

    // Highwatermark updated
    expect(readFileSync(join(targetDir, ".highwatermark"), "utf-8")).toBe("2")
  })

  it("creates target directory if --dir does not exist", () => {
    const newDir = join(tmpDir, "new-team-dir")
    expect(existsSync(newDir)).toBe(false)

    runTxArgs(["add", "Task A", "--json"], dbPath)
    const result = runTxArgs(["sync", "claude", "--dir", newDir], dbPath)
    expect(result.status).toBe(0)

    expect(existsSync(join(newDir, "1.json"))).toBe(true)
  })

  it("handles empty task list gracefully", () => {
    const result = runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Wrote 0 task(s)")

    // Highwatermark should be 1 (next ID)
    expect(readFileSync(join(targetDir, ".highwatermark"), "utf-8")).toBe("1")

    // No task files
    const files = readdirSync(targetDir).filter((f: string) => /^\d+\.json$/.test(f))
    expect(files).toHaveLength(0)
  })

  it("errors without --team or --dir", () => {
    const result = runTxArgs(["sync", "claude"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("--team")
  })

  it("maps status correctly for active and review tasks", () => {
    runTxArgs(["add", "Backlog task", "--json"], dbPath)
    const t2 = JSON.parse(runTxArgs(["add", "Active task", "--json"], dbPath).stdout)
    runTxArgs(["update", t2.id, "--status", "active"], dbPath)
    walCheckpoint(dbPath)

    runTxArgs(["sync", "claude", "--dir", targetDir], dbPath)

    // Read all task files and find by subject
    const files = readdirSync(targetDir)
      .filter((f: string) => /^\d+\.json$/.test(f))
      .map((f: string) => JSON.parse(readFileSync(join(targetDir, f), "utf-8")))

    const backlog = files.find((f: { subject: string }) => f.subject === "Backlog task")
    const active = files.find((f: { subject: string }) => f.subject === "Active task")

    expect(backlog.status).toBe("pending")
    expect(active.status).toBe("in_progress")
  })
})

// =============================================================================
// tx group-context:* Command Tests
// =============================================================================

describe("CLI group-context commands", { timeout: CLI_TIMEOUT }, () => {
  let tmpDir: string
  let dbPath: string
  let parentId: string
  let childId: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-group-context-"))
    dbPath = join(tmpDir, "test.db")
    runTx("init", dbPath)

    parentId = JSON.parse(runTxArgs(["add", "Parent task", "--json"], dbPath).stdout).id
    childId = JSON.parse(runTxArgs(["add", "Child task", "--parent", parentId, "--json"], dbPath).stdout).id
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("set stores direct context and show/ready expose inherited effective context", () => {
    const context = "Shared auth rollout context"

    const setResult = runTxArgs(["group-context:set", parentId, context, "--json"], dbPath)
    expect(setResult.status).toBe(0)
    const setTask = JSON.parse(setResult.stdout)
    expect(setTask.groupContext).toBe(context)
    expect(setTask.effectiveGroupContext).toBe(context)
    expect(setTask.effectiveGroupContextSourceTaskId).toBe(parentId)

    const showChild = runTxArgs(["show", childId, "--json"], dbPath)
    expect(showChild.status).toBe(0)
    const child = JSON.parse(showChild.stdout)
    expect(child.groupContext).toBeNull()
    expect(child.effectiveGroupContext).toBe(context)
    expect(child.effectiveGroupContextSourceTaskId).toBe(parentId)

    const ready = runTxArgs(["ready", "--json"], dbPath)
    expect(ready.status).toBe(0)
    const readyTasks = JSON.parse(ready.stdout) as Array<{
      id: string
      effectiveGroupContext: string | null
      effectiveGroupContextSourceTaskId: string | null
    }>
    const readyChild = readyTasks.find(t => t.id === childId)
    expect(readyChild).toBeDefined()
    expect(readyChild?.effectiveGroupContext).toBe(context)
    expect(readyChild?.effectiveGroupContextSourceTaskId).toBe(parentId)
  })

  it("clear removes direct and inherited effective context", () => {
    const context = "Temporary group context"
    const setResult = runTxArgs(["group-context:set", parentId, context], dbPath)
    expect(setResult.status).toBe(0)

    const clearResult = runTxArgs(["group-context:clear", parentId, "--json"], dbPath)
    expect(clearResult.status).toBe(0)
    const cleared = JSON.parse(clearResult.stdout)
    expect(cleared.groupContext).toBeNull()
    expect(cleared.effectiveGroupContext).toBeNull()
    expect(cleared.effectiveGroupContextSourceTaskId).toBeNull()

    const showChild = runTxArgs(["show", childId, "--json"], dbPath)
    expect(showChild.status).toBe(0)
    const child = JSON.parse(showChild.stdout)
    expect(child.effectiveGroupContext).toBeNull()
    expect(child.effectiveGroupContextSourceTaskId).toBeNull()
  })

  it("does not leak context across siblings while preserving ancestor/descendant inheritance", () => {
    const siblingId = JSON.parse(runTxArgs(["add", "Sibling task", "--parent", parentId, "--json"], dbPath).stdout).id
    const grandChildId = JSON.parse(runTxArgs(["add", "Grandchild task", "--parent", childId, "--json"], dbPath).stdout).id
    const context = "Child-specific rollout context"

    const setResult = runTxArgs(["group-context:set", childId, context, "--json"], dbPath)
    expect(setResult.status).toBe(0)

    const showParent = JSON.parse(runTxArgs(["show", parentId, "--json"], dbPath).stdout)
    expect(showParent.effectiveGroupContext).toBe(context)
    expect(showParent.effectiveGroupContextSourceTaskId).toBe(childId)

    const showGrandChild = JSON.parse(runTxArgs(["show", grandChildId, "--json"], dbPath).stdout)
    expect(showGrandChild.effectiveGroupContext).toBe(context)
    expect(showGrandChild.effectiveGroupContextSourceTaskId).toBe(childId)

    const showSibling = JSON.parse(runTxArgs(["show", siblingId, "--json"], dbPath).stdout)
    expect(showSibling.groupContext).toBeNull()
    expect(showSibling.effectiveGroupContext).toBeNull()
    expect(showSibling.effectiveGroupContextSourceTaskId).toBeNull()
  })

  it("set shows usage error when arguments are missing", () => {
    const result = runTxArgs(["group-context:set", parentId], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage: tx group-context:set")
  })

  it("clear shows usage error when task id is missing", () => {
    const result = runTxArgs(["group-context:clear"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage: tx group-context:clear")
  })

  it("rejects oversized group context payloads", () => {
    const oversized = "x".repeat(20001)
    const result = runTxArgs(["group-context:set", parentId, oversized], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("at most 20000 characters")
  })
})
