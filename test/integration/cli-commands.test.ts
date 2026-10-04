const normaliseTaskCommand = (args: string[]): string[] => /^(add|list|ready|show|update|done|reset|delete|bulk|label|dep|block|unblock|children|tree)$/.test(args[0] ?? "") ? ["task", ...(/^(block|unblock|children|tree)$/.test(args[0]) ? ["dep"] : []), ...args] : args
/**
 * CLI E2E Tests for untested commands
 *
 * Tests the following CLI commands:
 * - tx task dep tree <id> - hierarchy visualization, JSON output
 * - tx sync stream compatibility + status behavior
 * - tx migrate status - schema version, applied/pending
 *
 * Per DD-007: Uses real in-memory SQLite and deterministic test setup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync, mkdirSync, } from "node:fs"
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

/**
 * Run tx CLI with simple space-separated string (for simple commands)
 */
function runTx(args: string, dbPath: string): ExecResult {
  return runTxArgs(args.split(" "), dbPath)
}

// =============================================================================
// tx task dep tree Command Tests
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
    const rootResult = runTxArgs(["task", "add", "Root task", "--json"], dbPath)
    rootId = JSON.parse(rootResult.stdout).id

    const parentResult = runTxArgs(["task", "add", "Parent task", "--parent", rootId, "--json"], dbPath)
    parentId = JSON.parse(parentResult.stdout).id

    const child1Result = runTxArgs(["task", "add", "Child 1", "--parent", parentId, "--json"], dbPath)
    child1Id = JSON.parse(child1Result.stdout).id

    const child2Result = runTxArgs(["task", "add", "Child 2", "--parent", parentId, "--json"], dbPath)
    child2Id = JSON.parse(child2Result.stdout).id

    const grandchildResult = runTxArgs(["task", "add", "Grandchild", "--parent", child1Id, "--json"], dbPath)
    grandchildId = JSON.parse(grandchildResult.stdout).id
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("shows tree structure with proper indentation", () => {
      const result = runTxArgs(["task", "dep", "tree", parentId], dbPath)
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
      const result = runTxArgs(["task", "dep", "tree", parentId], dbPath)
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
      const result = runTxArgs(["task", "dep", "tree", parentId], dbPath)
      expect(result.status).toBe(0)
      // All tasks should be ready (no blockers) and marked with +
      expect(result.stdout).toMatch(/\+/)
    })

    it("shows single node for leaf task", () => {
      const result = runTxArgs(["task", "dep", "tree", grandchildId], dbPath)
      expect(result.status).toBe(0)

      const lines = result.stdout.split("\n").filter(Boolean)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(grandchildId)
      expect(lines[0]).toContain("Grandchild")
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const result = runTxArgs(["task", "dep", "tree", parentId, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.id).toBe(parentId)
      expect(json.title).toBe("Parent task")
      expect(json.childTasks).toBeDefined()
      expect(Array.isArray(json.childTasks)).toBe(true)
    })

    it("JSON output includes TaskWithDeps fields", () => {
      const result = runTxArgs(["task", "dep", "tree", parentId, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("blockedBy")
      expect(json).toHaveProperty("blocks")
      expect(json).toHaveProperty("children")
      expect(json).toHaveProperty("isReady")
    })

    it("JSON output includes nested children recursively", () => {
      const result = runTxArgs(["task", "dep", "tree", parentId, "--json"], dbPath)
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
      const result = runTxArgs(["task", "dep", "tree", "tx-nonexistent"], dbPath)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("Task not found")
    })
  })

  describe("help", () => {
    it("task dep tree --help shows help", () => {
      const result = runTx("task dep tree --help", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx task dep tree")
      expect(result.stdout).toContain("--json")
    })

    it("help tree shows help", () => {
      const result = runTx("help task dep tree", dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx task dep tree")
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
    const add = runInTmp(["task", "add", "Status task", "--json"])
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

    const listed = JSON.parse(runInTmp(["task", "list", "--json"]).stdout) as Array<{ id: string }>
    const deleted = runInTmp(["task", "delete", listed[0]!.id])
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
      const result = runTxArgs(["sync", "migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Migration Status:")
      expect(result.stdout).toContain("Current version:")
      expect(result.stdout).toContain("Latest version:")
    })

    it("shows schema version is current", () => {
      const result = runTxArgs(["sync", "migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Pending migrations: 0")
    })

    it("shows applied migrations", () => {
      const result = runTxArgs(["sync", "migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Applied migrations:")
      expect(result.stdout).toMatch(/v\d+ - applied/)
    })

    it("shows no pending migrations for fully migrated db", () => {
      const result = runTxArgs(["sync", "migrate", "status"], dbPath)
      expect(result.status).toBe(0)
      // Should not show "Pending migrations:" section with items
      expect(result.stdout).not.toMatch(/Pending migrations:\n\s+v\d+/)
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const result = runTxArgs(["sync", "migrate", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("currentVersion")
      expect(json).toHaveProperty("latestVersion")
      expect(json).toHaveProperty("pendingCount")
      expect(json).toHaveProperty("appliedMigrations")
      expect(json).toHaveProperty("pendingMigrations")
    })

    it("JSON shows correct version numbers", () => {
      const result = runTxArgs(["sync", "migrate", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.currentVersion).toBe(json.latestVersion)
      expect(json.pendingCount).toBe(0)
      expect(json.pendingMigrations).toEqual([])
    })

    it("JSON appliedMigrations has correct structure", () => {
      const result = runTxArgs(["sync", "migrate", "status", "--json"], dbPath)
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
    it("sync migrate status --help shows help", () => {
      const result = runTxArgs(["sync", "migrate", "status", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx sync migrate status")
    })

    it("help migrate shows help", () => {
      const result = runTxArgs(["help", "sync", "migrate"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("sync migrate")
    })
  })

  describe("unknown subcommand", () => {
    it("shows error for unknown migrate subcommand", () => {
      const result = runTxArgs(["sync", "migrate", "unknown"], dbPath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Unknown sync migrate subcommand")
    })
  })
})
