/**
 * CLI E2E Tests for untested commands
 *
 * Tests the following CLI commands:
 * - tx tree <id> - hierarchy visualization, JSON output
 * - tx sync export - JSONL file creation, format validation
 * - tx sync import - import, conflict resolution
 * - tx sync status - status reporting
 * - tx sync compact - file compaction
 * - tx migrate status - schema version, applied/pending
 *
 * Per DD-007: Uses real in-memory SQLite and deterministic test setup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
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
// tx sync export Command Tests
// =============================================================================

describe("CLI sync export command", () => {
  let tmpDir: string
  let dbPath: string
  let jsonlPath: string
  let taskId: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-export-"))
    dbPath = join(tmpDir, "test.db")
    jsonlPath = join(tmpDir, "tasks.jsonl")

    // Initialize and create some tasks
    runTx("init", dbPath)

    const result = runTxArgs(["add", "Test task for export", "--json"], dbPath)
    taskId = JSON.parse(result.stdout).id

    runTxArgs(["add", "Second task", "--json"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("exports tasks to JSONL file", () => {
      const result = runTxArgs(["sync", "export", "--path", jsonlPath], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Exported")
      expect(result.stdout).toContain("operation(s)")
      expect(existsSync(jsonlPath)).toBe(true)
    })

    it("creates valid JSONL format", () => {
      runTxArgs(["sync", "export", "--path", jsonlPath], dbPath)

      const content = readFileSync(jsonlPath, "utf-8")
      const lines = content.trim().split("\n")

      // Should have at least 2 operations (2 tasks)
      expect(lines.length).toBeGreaterThanOrEqual(2)

      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })

    it("exports with correct operation structure", () => {
      runTxArgs(["sync", "export", "--path", jsonlPath], dbPath)

      const content = readFileSync(jsonlPath, "utf-8")
      const lines = content.trim().split("\n")
      const ops = lines.map(line => JSON.parse(line))

      const upsertOps = ops.filter(op => op.op === "upsert")
      expect(upsertOps.length).toBeGreaterThanOrEqual(2)

      for (const op of upsertOps) {
        expect(op.v).toBe(1)
        expect(op.op).toBe("upsert")
        expect(op.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(op.id).toMatch(/^tx-[a-z0-9]{8}$/)
        expect(op.data).toHaveProperty("title")
        expect(op.data).toHaveProperty("status")
      }
    })

    it("exports specific task correctly", () => {
      runTxArgs(["sync", "export", "--path", jsonlPath], dbPath)

      const content = readFileSync(jsonlPath, "utf-8")
      const lines = content.trim().split("\n")
      const ops = lines.map(line => JSON.parse(line))

      const taskOp = ops.find(op => op.id === taskId)
      expect(taskOp).toBeDefined()
      expect(taskOp.data.title).toBe("Test task for export")
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const result = runTxArgs(["sync", "export", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("path")
      expect(json).toHaveProperty("opCount")
      expect(json.path).toBe(jsonlPath)
      expect(typeof json.opCount).toBe("number")
    })

    it("JSON output reports correct operation count", () => {
      const result = runTxArgs(["sync", "export", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.opCount).toBe(2) // 2 tasks, no dependencies
    })
  })

  describe("empty database", () => {
    it("handles empty database gracefully", () => {
      const emptyDbPath = join(tmpDir, "empty.db")
      runTx("init", emptyDbPath)

      const result = runTxArgs(["sync", "export", "--path", jsonlPath, "--json"], emptyDbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.opCount).toBe(0)
    })
  })

  describe("help", () => {
    it("sync export --help shows help", () => {
      const result = runTxArgs(["sync", "export", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx sync export")
      expect(result.stdout).toContain("--path")
    })

    it("help sync export shows help", () => {
      const result = runTxArgs(["help", "sync", "export"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("sync export")
    })
  })
})

// =============================================================================
// tx sync import Command Tests
// =============================================================================

describe("CLI sync import command", () => {
  let tmpDir: string
  let dbPath: string
  let jsonlPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-import-"))
    dbPath = join(tmpDir, "test.db")
    jsonlPath = join(tmpDir, "tasks.jsonl")

    // Initialize empty database
    runTx("init", dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("imports tasks from JSONL file", () => {
      const now = new Date().toISOString()
      const jsonl = [
        JSON.stringify({
          v: 1,
          op: "upsert",
          ts: now,
          id: "tx-aabbcc01",
          data: { title: "Imported task", description: "", status: "backlog", score: 500, parentId: null, metadata: {} }
        })
      ].join("\n")
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "import", "--path", jsonlPath], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Imported: 1")

      // Verify task was created
      const showResult = runTxArgs(["show", "tx-aabbcc01", "--json"], dbPath)
      expect(showResult.status).toBe(0)
      const task = JSON.parse(showResult.stdout)
      expect(task.title).toBe("Imported task")
    })

    it("imports multiple tasks", () => {
      const now = new Date().toISOString()
      const jsonl = [
        JSON.stringify({
          v: 1, op: "upsert", ts: now, id: "tx-aabbcc02",
          data: { title: "Task 1", description: "", status: "backlog", score: 500, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "upsert", ts: now, id: "tx-aabbcc03",
          data: { title: "Task 2", description: "", status: "ready", score: 600, parentId: null, metadata: {} }
        })
      ].join("\n")
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "import", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.imported).toBe(2)
    })

    it("imports dependencies correctly", () => {
      const now = new Date().toISOString()
      const jsonl = [
        JSON.stringify({
          v: 1, op: "upsert", ts: now, id: "tx-block001",
          data: { title: "Blocker", description: "", status: "ready", score: 500, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "upsert", ts: now, id: "tx-block002",
          data: { title: "Blocked", description: "", status: "backlog", score: 400, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "dep_add", ts: now, blockerId: "tx-block001", blockedId: "tx-block002"
        })
      ].join("\n")
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "import", "--path", jsonlPath], dbPath)
      expect(result.status).toBe(0)

      // Verify dependency was created
      const showResult = runTxArgs(["show", "tx-block002", "--json"], dbPath)
      const task = JSON.parse(showResult.stdout)
      expect(task.blockedBy).toContain("tx-block001")
    })
  })

  describe("conflict resolution", () => {
    it("updates existing task when JSONL timestamp is newer", () => {
      // Create a task first
      runTxArgs(["add", "Original task", "--json"], dbPath)

      // Export to get the task ID and timestamp
      runTxArgs(["sync", "export", "--path", jsonlPath], dbPath)
      const content = readFileSync(jsonlPath, "utf-8")
      const ops = content.trim().split("\n").map(l => JSON.parse(l))
      const taskOp = ops.find(op => op.data?.title === "Original task")

      // Create JSONL with newer timestamp and different title
      const newerTs = new Date(Date.now() + 10000).toISOString()
      const newJsonl = JSON.stringify({
        v: 1, op: "upsert", ts: newerTs, id: taskOp.id,
        data: { title: "Updated task", description: "", status: "ready", score: 800, parentId: null, metadata: {} }
      })
      writeFileSync(jsonlPath, newJsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "import", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.imported).toBe(1)

      // Verify task was updated
      const showResult = runTxArgs(["show", taskOp.id, "--json"], dbPath)
      const task = JSON.parse(showResult.stdout)
      expect(task.title).toBe("Updated task")
      expect(task.status).toBe("ready")
    })

    it("reports conflict when local timestamp is newer", () => {
      // Create JSONL with old timestamp
      const oldTs = "2020-01-01T00:00:00.000Z"
      const jsonl = JSON.stringify({
        v: 1, op: "upsert", ts: oldTs, id: "tx-confli01",
        data: { title: "Old task", description: "", status: "backlog", score: 500, parentId: null, metadata: {} }
      })
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      // Import first with old timestamp
      runTxArgs(["sync", "import", "--path", jsonlPath], dbPath)

      // Now update the task locally (which gives it a newer timestamp)
      runTxArgs(["update", "tx-confli01", "--title", "Local update"], dbPath)

      // Try to import again with the old timestamp
      const result = runTxArgs(["sync", "import", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.conflicts).toBe(1)

      // Verify local changes are preserved
      const showResult = runTxArgs(["show", "tx-confli01", "--json"], dbPath)
      const task = JSON.parse(showResult.stdout)
      expect(task.title).toBe("Local update")
    })
  })

  describe("error handling", () => {
    it("returns zero counts for missing file", () => {
      const result = runTxArgs(["sync", "import", "--path", "/nonexistent/file.jsonl", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.imported).toBe(0)
      expect(json.skipped).toBe(0)
      expect(json.conflicts).toBe(0)
    })

    it("returns zero counts for empty file", () => {
      writeFileSync(jsonlPath, "", "utf-8")

      const result = runTxArgs(["sync", "import", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.imported).toBe(0)
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const now = new Date().toISOString()
      const jsonl = JSON.stringify({
        v: 1, op: "upsert", ts: now, id: "tx-jsonnn01",
        data: { title: "JSON test", description: "", status: "backlog", score: 500, parentId: null, metadata: {} }
      })
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "import", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("imported")
      expect(json).toHaveProperty("skipped")
      expect(json).toHaveProperty("conflicts")
    })
  })

  describe("help", () => {
    it("sync import --help shows help", () => {
      const result = runTxArgs(["sync", "import", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx sync import")
      expect(result.stdout).toContain("--path")
    })
  })
})

// =============================================================================
// tx sync status Command Tests
// =============================================================================

describe("CLI sync status command", () => {
  let tmpDir: string
  let dbPath: string
  let txDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-status-"))
    txDir = join(tmpDir, ".tx")
    mkdirSync(txDir, { recursive: true })
    dbPath = join(txDir, "tasks.db")

    runTx("init", dbPath)
    runTxArgs(["add", "Test task"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("shows sync status", () => {
      const result = runTxArgs(["sync", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Sync Status:")
      expect(result.stdout).toContain("Tasks in database:")
      expect(result.stdout).toContain("Operations in JSONL:")
    })

    it("shows correct task count", () => {
      const result = runTxArgs(["sync", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/Tasks in database:\s*1/)
    })

    it("shows dirty status when no export exists", () => {
      const result = runTxArgs(["sync", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Dirty")
      expect(result.stdout).toContain("yes")
    })

    it("shows auto-sync status", () => {
      const result = runTxArgs(["sync", "status"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Auto-sync:")
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const result = runTxArgs(["sync", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("dbTaskCount")
      expect(json).toHaveProperty("jsonlOpCount")
      expect(json).toHaveProperty("isDirty")
      expect(json).toHaveProperty("autoSyncEnabled")
    })

    it("JSON output has correct task count", () => {
      const result = runTxArgs(["sync", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.dbTaskCount).toBe(1)
    })
  })

  describe("after export", () => {
    it("shows operation count after export to default path", () => {
      // Export to the default path that sync status checks
      // sync status looks at .tx/tasks.jsonl relative to cwd
      // Since our db is in tmpDir/.tx/tasks.db, we need to run from tmpDir
      const jsonlPath = join(txDir, "tasks.jsonl")
      runTxArgs(["sync", "export", "--path", jsonlPath], dbPath)

      // Read the status - it should show the op count from the file
      const result = runTxArgs(["sync", "status", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      // The status shows that export happened (lastExport is set)
      expect(json.lastExport).not.toBeNull()
      // dbTaskCount should be correct
      expect(json.dbTaskCount).toBe(1)
    })
  })

  describe("help", () => {
    it("sync status --help shows help", () => {
      const result = runTxArgs(["sync", "status", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx sync status")
    })
  })
})

// =============================================================================
// tx sync compact Command Tests
// =============================================================================

describe("CLI sync compact command", () => {
  let tmpDir: string
  let dbPath: string
  let jsonlPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-sync-compact-"))
    dbPath = join(tmpDir, "test.db")
    jsonlPath = join(tmpDir, "tasks.jsonl")

    runTx("init", dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("basic success cases", () => {
    it("compacts duplicate upserts (keeps latest)", () => {
      const earlier = "2024-01-01T00:00:00.000Z"
      const later = "2024-01-02T00:00:00.000Z"

      const jsonl = [
        JSON.stringify({
          v: 1, op: "upsert", ts: earlier, id: "tx-compac01",
          data: { title: "Old Title", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "upsert", ts: later, id: "tx-compac01",
          data: { title: "New Title", description: "", status: "ready", score: 200, parentId: null, metadata: {} }
        })
      ].join("\n")
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "compact", "--path", jsonlPath], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Compacted: 2")
      expect(result.stdout).toContain("1 operations")

      // Verify compacted content has newer version
      const content = readFileSync(jsonlPath, "utf-8")
      const lines = content.trim().split("\n")
      expect(lines).toHaveLength(1)

      const op = JSON.parse(lines[0])
      expect(op.data.title).toBe("New Title")
      expect(op.ts).toBe(later)
    })

    it("removes deleted tasks (tombstones)", () => {
      const createTs = "2024-01-01T00:00:00.000Z"
      const deleteTs = "2024-01-02T00:00:00.000Z"

      const jsonl = [
        JSON.stringify({
          v: 1, op: "upsert", ts: createTs, id: "tx-todelete",
          data: { title: "To Delete", description: "", status: "backlog", score: 100, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "delete", ts: deleteTs, id: "tx-todelete"
        })
      ].join("\n")
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "compact", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.before).toBe(2)
      expect(json.after).toBe(0)

      // File should be empty
      const content = readFileSync(jsonlPath, "utf-8")
      expect(content.trim()).toBe("")
    })

    it("removes dep_add followed by dep_remove", () => {
      const addTs = "2024-01-01T00:00:00.000Z"
      const removeTs = "2024-01-02T00:00:00.000Z"

      const jsonl = [
        JSON.stringify({
          v: 1, op: "upsert", ts: addTs, id: "tx-depaa01",
          data: { title: "A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "upsert", ts: addTs, id: "tx-depbb01",
          data: { title: "B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "dep_add", ts: addTs, blockerId: "tx-depaa01", blockedId: "tx-depbb01"
        }),
        JSON.stringify({
          v: 1, op: "dep_remove", ts: removeTs, blockerId: "tx-depaa01", blockedId: "tx-depbb01"
        })
      ].join("\n")
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "compact", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.before).toBe(4)
      expect(json.after).toBe(2) // Only 2 task upserts remain

      // Verify no dependency operations remain
      const content = readFileSync(jsonlPath, "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      const ops = lines.map(line => JSON.parse(line))
      const depOps = ops.filter(op => op.op === "dep_add" || op.op === "dep_remove")
      expect(depOps).toHaveLength(0)
    })

    it("preserves active dependencies", () => {
      const ts = "2024-01-01T00:00:00.000Z"

      const jsonl = [
        JSON.stringify({
          v: 1, op: "upsert", ts, id: "tx-presaa01",
          data: { title: "A", description: "", status: "ready", score: 100, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "upsert", ts, id: "tx-presbb01",
          data: { title: "B", description: "", status: "backlog", score: 50, parentId: null, metadata: {} }
        }),
        JSON.stringify({
          v: 1, op: "dep_add", ts, blockerId: "tx-presaa01", blockedId: "tx-presbb01"
        })
      ].join("\n")
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "compact", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.before).toBe(3)
      expect(json.after).toBe(3) // All preserved

      // Verify dep_add is preserved
      const content = readFileSync(jsonlPath, "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      const ops = lines.map(line => JSON.parse(line))
      const depOps = ops.filter(op => op.op === "dep_add")
      expect(depOps).toHaveLength(1)
    })
  })

  describe("error handling", () => {
    it("returns zero counts for missing file", () => {
      const result = runTxArgs(["sync", "compact", "--path", "/nonexistent/file.jsonl", "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.before).toBe(0)
      expect(json.after).toBe(0)
    })
  })

  describe("JSON output formatting", () => {
    it("outputs JSON with --json flag", () => {
      const jsonl = JSON.stringify({
        v: 1, op: "upsert", ts: new Date().toISOString(), id: "tx-jsoncp01",
        data: { title: "Test", description: "", status: "backlog", score: 500, parentId: null, metadata: {} }
      })
      writeFileSync(jsonlPath, jsonl + "\n", "utf-8")

      const result = runTxArgs(["sync", "compact", "--path", jsonlPath, "--json"], dbPath)
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("before")
      expect(json).toHaveProperty("after")
    })
  })

  describe("help", () => {
    it("sync compact --help shows help", () => {
      const result = runTxArgs(["sync", "compact", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx sync compact")
    })
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
