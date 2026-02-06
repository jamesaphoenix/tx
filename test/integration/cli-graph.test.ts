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

describe("CLI graph:link", () => {
  let tmpDir: string
  let dbPath: string
  let learningId: number

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    // Initialize the database
    runTx(["init"], dbPath)
    // Create a learning to link
    const result = runTx(["learning:add", "Always use transactions for database operations", "--json"], dbPath)
    const json = JSON.parse(result.stdout)
    learningId = json.id
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("creates an anchor linking a learning to a file path", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Created anchor #")
    expect(result.stdout).toContain(`Learning: #${learningId}`)
    expect(result.stdout).toContain("File: src/db.ts")
    expect(result.stdout).toContain("Type: glob")
  })

  it("creates an anchor with --type flag", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "glob"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Type: glob")
  })

  it("creates an anchor with hash type and --value", () => {
    // SHA256 hash must be 64 hex characters
    const validHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "hash", "--value", validHash], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Type: hash")
    expect(result.stdout).toContain(`Value: ${validHash}`)
  })

  it("creates an anchor with symbol type and --value", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "symbol", "--value", "DatabaseService"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Type: symbol")
    expect(result.stdout).toContain("Value: DatabaseService")
  })

  it("creates an anchor with line_range type and --value", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "line_range", "--value", "10-20"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Type: line_range")
    expect(result.stdout).toContain("Value: 10-20")
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.id).toBeDefined()
    expect(json.learningId).toBe(learningId)
    expect(json.filePath).toBe("src/db.ts")
    expect(json.anchorType).toBe("glob")
    expect(json.status).toBe("valid")
  })

  it("shows error when learning-id is missing", () => {
    const result = runTx(["graph:link"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("shows error when file-path is missing", () => {
    const result = runTx(["graph:link", String(learningId)], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("shows error for non-numeric learning ID", () => {
    const result = runTx(["graph:link", "abc", "src/db.ts"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Learning ID must be a number")
  })

  it("shows error for hash type without --value", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "hash"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("--value is required for hash anchors")
  })

  it("shows error for symbol type without --value", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "symbol"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("--value is required for symbol anchors")
  })

  it("shows error for invalid anchor type", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "invalid"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Invalid anchor type")
  })

  it("shows error for malformed line range with trailing dash", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "line_range", "--value", "10-"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Invalid line range")
  })

  it("shows error for malformed line range with leading dash", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "line_range", "--value", "-20"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Invalid line range")
  })

  it("shows error for malformed line range with just dash", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "line_range", "--value", "-"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Invalid line range")
  })

  it("shows error for line range with non-numeric values", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "line_range", "--value", "abc-def"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Invalid line range")
  })

  it("shows error for line range with end less than start", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "line_range", "--value", "20-10"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("End line must be >= start line")
  })

  it("shows error for line range with zero", () => {
    const result = runTx(["graph:link", String(learningId), "src/db.ts", "--type", "line_range", "--value", "0-10"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Line numbers must be positive")
  })
})

describe("CLI graph:show", () => {
  let tmpDir: string
  let dbPath: string
  let learningId: number

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)
    // Create a learning
    const result = runTx(["learning:add", "Test learning for graph operations", "--json"], dbPath)
    const json = JSON.parse(result.stdout)
    learningId = json.id
    // Create an anchor for the learning
    runTx(["graph:link", String(learningId), "src/test.ts"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("shows edges for a learning", () => {
    const result = runTx(["graph:show", String(learningId)], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Graph for learning #${learningId}`)
    expect(result.stdout).toContain("Anchors (1):")
    expect(result.stdout).toContain("glob")
    expect(result.stdout).toContain("src/test.ts")
  })

  it("shows no anchors message when learning has no anchors", () => {
    // Create a new learning without anchors
    const addResult = runTx(["learning:add", "Learning without anchors", "--json"], dbPath)
    const json = JSON.parse(addResult.stdout)
    const newLearningId = json.id

    const result = runTx(["graph:show", String(newLearningId)], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Graph for learning #${newLearningId}`)
    expect(result.stdout).toContain("No anchors")
  })

  it("shows no edges message when learning has no edges", () => {
    const result = runTx(["graph:show", String(learningId)], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No outgoing edges")
    expect(result.stdout).toContain("No incoming edges")
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["graph:show", String(learningId), "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.learningId).toBe(learningId)
    expect(Array.isArray(json.anchors)).toBe(true)
    expect(json.anchors.length).toBe(1)
    expect(json.anchors[0].filePath).toBe("src/test.ts")
    expect(Array.isArray(json.outgoingEdges)).toBe(true)
    expect(Array.isArray(json.incomingEdges)).toBe(true)
  })

  it("shows error when learning-id is missing", () => {
    const result = runTx(["graph:show"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("shows error for non-numeric learning ID", () => {
    const result = runTx(["graph:show", "abc"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Learning ID must be a number")
  })

  it("handles learning with multiple anchors", () => {
    // Add more anchors
    runTx(["graph:link", String(learningId), "src/other.ts"], dbPath)
    runTx(["graph:link", String(learningId), "src/utils.ts"], dbPath)

    const result = runTx(["graph:show", String(learningId)], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Anchors (3):")
    expect(result.stdout).toContain("src/test.ts")
    expect(result.stdout).toContain("src/other.ts")
    expect(result.stdout).toContain("src/utils.ts")
  })
})

describe("CLI graph:neighbors", () => {
  let tmpDir: string
  let dbPath: string
  let learningId: number

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-"))
    dbPath = join(tmpDir, "test.db")
    runTx(["init"], dbPath)
    // Create learnings with anchors to create a graph
    const result = runTx(["learning:add", "Database operations require transactions", "--json"], dbPath)
    const json = JSON.parse(result.stdout)
    learningId = json.id
    // Create anchors to establish relationships
    runTx(["graph:link", String(learningId), "src/db.ts"], dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("finds neighbors of a learning node", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Neighbors of learning:${learningId}`)
  })

  it("respects --depth flag", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--depth", "3"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("depth 3")
  })

  it("respects short form -d flag for depth", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "-d", "2"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("depth 2")
  })

  it("respects --direction flag for outgoing", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--direction", "outgoing"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("outgoing")
  })

  it("respects --direction flag for incoming", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--direction", "incoming"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("incoming")
  })

  it("respects --direction flag for both", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--direction", "both"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("both")
  })

  it("filters by edge type with --edge-type flag", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--edge-type", "ANCHORED_TO"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("ANCHORED_TO")
  })

  it("filters by multiple edge types", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--edge-type", "ANCHORED_TO,IMPORTS"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("ANCHORED_TO, IMPORTS")
  })

  it("outputs JSON with --json flag", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.nodeType).toBe("learning")
    expect(json.nodeId).toBe(String(learningId))
    expect(json.depth).toBe(2)
    expect(json.direction).toBe("both")
    expect(Array.isArray(json.neighbors)).toBe(true)
  })

  it("shows no neighbors message when none found", () => {
    // Create a learning without any graph connections
    const addResult = runTx(["learning:add", "Isolated learning", "--json"], dbPath)
    const json = JSON.parse(addResult.stdout)
    const isolatedId = json.id

    const result = runTx(["graph:neighbors", String(isolatedId), "--node-type", "learning"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No neighbors found")
  })

  it("shows error when node-id is missing", () => {
    const result = runTx(["graph:neighbors"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Usage:")
  })

  it("shows error for invalid node type", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "invalid"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Invalid node type")
  })

  it("shows error for invalid direction", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--direction", "invalid"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Invalid direction")
  })

  it("shows error for invalid depth (non-numeric)", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--depth", "abc"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("is not a valid finite number")
  })

  it("shows error for invalid depth (zero)", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--node-type", "learning", "--depth", "0"], dbPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Depth must be a positive integer")
  })

  it("uses default node-type of learning when not specified", () => {
    const result = runTx(["graph:neighbors", String(learningId), "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.nodeType).toBe("learning")
  })

  it("supports file as node-type", () => {
    const result = runTx(["graph:neighbors", "src/db.ts", "--node-type", "file", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.nodeType).toBe("file")
    expect(json.nodeId).toBe("src/db.ts")
  })

  it("supports task as node-type", () => {
    // Create a task first
    const addResult = runTx(["add", "Test task", "--json"], dbPath)
    const taskJson = JSON.parse(addResult.stdout)
    const taskId = taskJson.id

    const result = runTx(["graph:neighbors", taskId, "--node-type", "task", "--json"], dbPath)
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.nodeType).toBe("task")
    expect(json.nodeId).toBe(taskId)
  })
})

describe("CLI graph command help", () => {
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

  it("graph:verify --help shows help", () => {
    const result = runTx(["graph:verify", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:verify")
  })

  it("graph:invalidate --help shows help", () => {
    const result = runTx(["graph:invalidate", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:invalidate")
  })

  it("graph:restore --help shows help", () => {
    const result = runTx(["graph:restore", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:restore")
  })

  it("graph:prune --help shows help", () => {
    const result = runTx(["graph:prune", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:prune")
  })

  it("graph:status --help shows help", () => {
    const result = runTx(["graph:status", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:status")
  })

  it("graph:pin --help shows help", () => {
    const result = runTx(["graph:pin", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:pin")
  })

  it("graph:unpin --help shows help", () => {
    const result = runTx(["graph:unpin", "--help"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:unpin")
  })

  it("help graph:verify shows help", () => {
    const result = runTx(["help", "graph:verify"], dbPath)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx graph:verify")
  })
})
