import { makeMinimalLayerFromInfra } from "@jamesaphoenix/tx"
const normaliseTaskCommand = (args: string[]): string[] => /^(add|list|ready|show|update|done|reset|delete|bulk|label|dep|block|unblock|children|tree)$/.test(args[0] ?? "") ? ["task", ...(/^(block|unblock|children|tree)$/.test(args[0]) ? ["dep"] : []), ...args] : args
/**
 * API Contract Validator Tests
 *
 * Validates that CLI, MCP, and SDK return IDENTICAL results for the same operations.
 * Uses the shared SerializedTask type from @tx/types as the contract.
 *
 * Per CLAUDE.md Rule 1: Every API response MUST include full dependency information.
 * Per PRD-007: Multi-interface integration requires consistent response shapes.
 *
 * These tests ensure:
 * 1. All interfaces serialize tasks identically (same JSON output)
 * 2. All TaskWithDeps fields are populated correctly
 * 3. No interface returns bare Task without dependency info
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect, ManagedRuntime, Layer } from "effect"
import { Database } from "bun:sqlite"

import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx/testing"
import { seedFixtures, FIXTURES } from "../fixtures.js"
import {
  SqliteClient,
  TaskService,
  DependencyService,
  ReadyService,
} from "@jamesaphoenix/tx"
import type { TaskId, TaskWithDeps } from "@jamesaphoenix/tx/types"
import { serializeTask } from "@jamesaphoenix/tx/types"
import { TxClient } from "@jamesaphoenix/tx-agent-sdk"

// =============================================================================
// Constants
// =============================================================================

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 60000 : 30000))
const FIXTURE_TIMESTAMP = "2026-01-01T00:00:00.000Z"

// =============================================================================
// Common Serialized Type (for cross-interface comparison)
// =============================================================================

/**
 * Common serialized task interface that both @tx/types and @jamesaphoenix/tx-agent-sdk satisfy.
 * Uses plain strings instead of branded types for runtime comparison.
 * This is the actual JSON shape returned by all interfaces.
 */
interface SerializedTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: string
  readonly parentId: string | null
  readonly score: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly completedAt: string | null
  readonly assigneeType: "human" | "agent" | null
  readonly assigneeId: string | null
  readonly assignedAt: string | null
  readonly assignedBy: string | null
  readonly metadata: Record<string, unknown>
  readonly blockedBy: readonly string[]
  readonly blocks: readonly string[]
  readonly children: readonly string[]
  readonly isReady: boolean
  readonly linkedDocs: ReadonlyArray<{
    readonly docId: string
    readonly name: string
    readonly title: string
    readonly kind: string
    readonly version: number
    readonly status: string
    readonly filePath: string
    readonly linkType: string
  }>
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to validate a value conforms to SerializedTask contract.
 * Returns specific validation errors if not conforming.
 */
function validateTaskContract(task: unknown, label: string): string[] {
  const errors: string[] = []

  if (!task || typeof task !== "object") {
    errors.push(`${label}: not an object`)
    return errors
  }

  const t = task as Record<string, unknown>

  // Required string fields
  for (const field of ["id", "title", "description", "status"] as const) {
    if (typeof t[field] !== "string") {
      errors.push(`${label}: ${field} is not a string (got ${typeof t[field]})`)
    }
  }

  // Required number fields
  if (typeof t.score !== "number") {
    errors.push(`${label}: score is not a number (got ${typeof t.score})`)
  }

  // Required date string fields
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (typeof t[field] !== "string") {
      errors.push(`${label}: ${field} is not a string (got ${typeof t[field]})`)
    } else if (isNaN(Date.parse(t[field] as string))) {
      errors.push(`${label}: ${field} is not a valid ISO date string`)
    }
  }

  // Nullable string fields
  if (t.parentId !== null && typeof t.parentId !== "string") {
    errors.push(`${label}: parentId must be string or null (got ${typeof t.parentId})`)
  }
  if (t.completedAt !== null && typeof t.completedAt !== "string") {
    errors.push(`${label}: completedAt must be string or null (got ${typeof t.completedAt})`)
  }
  if (t.assigneeType !== null && t.assigneeType !== "human" && t.assigneeType !== "agent") {
    errors.push(`${label}: assigneeType must be "human", "agent", or null`)
  }
  if (t.assigneeId !== null && typeof t.assigneeId !== "string") {
    errors.push(`${label}: assigneeId must be string or null (got ${typeof t.assigneeId})`)
  }
  if (t.assignedBy !== null && typeof t.assignedBy !== "string") {
    errors.push(`${label}: assignedBy must be string or null (got ${typeof t.assignedBy})`)
  }
  if (t.assignedAt !== null && typeof t.assignedAt !== "string") {
    errors.push(`${label}: assignedAt must be string or null (got ${typeof t.assignedAt})`)
  } else if (typeof t.assignedAt === "string" && isNaN(Date.parse(t.assignedAt))) {
    errors.push(`${label}: assignedAt is not a valid ISO date string`)
  }

  // DOCTRINE RULE 1: blockedBy, blocks, children MUST be arrays
  for (const field of ["blockedBy", "blocks", "children"] as const) {
    if (!Array.isArray(t[field])) {
      errors.push(`${label}: ${field} MUST be an array (got ${typeof t[field]}) - DOCTRINE VIOLATION`)
    } else if (!(t[field] as unknown[]).every(x => typeof x === "string")) {
      errors.push(`${label}: ${field} must contain only strings`)
    }
  }

  // DOCTRINE RULE 1: isReady MUST be a boolean
  if (typeof t.isReady !== "boolean") {
    errors.push(`${label}: isReady MUST be a boolean (got ${typeof t.isReady}) - DOCTRINE VIOLATION`)
  }

  // metadata should be an object
  if (typeof t.metadata !== "object" || t.metadata === null || Array.isArray(t.metadata)) {
    errors.push(`${label}: metadata must be an object (got ${typeof t.metadata})`)
  }
  if (!Array.isArray(t.linkedDocs)) {
    errors.push(`${label}: linkedDocs must be an array (got ${typeof t.linkedDocs})`)
  } else {
    for (const [index, doc] of t.linkedDocs.entries()) {
      if (!doc || typeof doc !== "object") {
        errors.push(`${label}: linkedDocs[${index}] must be an object`)
        continue
      }
      const linkedDoc = doc as Record<string, unknown>
      for (const field of ["docId", "name", "title", "kind", "status", "filePath", "linkType"] as const) {
        if (typeof linkedDoc[field] !== "string") {
          errors.push(`${label}: linkedDocs[${index}].${field} must be a string`)
        }
      }
      if (typeof linkedDoc.version !== "number" || !Number.isInteger(linkedDoc.version)) {
        errors.push(`${label}: linkedDocs[${index}].version must be an integer`)
      }
    }
  }
  // Ensure legacy redundant field is NOT present
  if ("failedAttemptCount" in t) {
    errors.push(`${label}: failedAttemptCount should not exist (use failedAttempts instead)`)
  }

  return errors
}

// =============================================================================
// CLI Helper
// =============================================================================

interface CliResult {
  stdout: string
  stderr: string
  status: number
}

type LinkedDocFixture = SerializedTask["linkedDocs"][number]

function insertLinkedDoc(
  db: Database,
  taskId: string,
  overrides: Partial<LinkedDocFixture> = {}
): LinkedDocFixture {
  const now = FIXTURE_TIMESTAMP
  const fixture: LinkedDocFixture = {
    docId: overrides.docId ?? "doc-666666666666",
    name: overrides.name ?? "contract-linked-spec",
    title: overrides.title ?? "Contract Linked Spec",
    kind: overrides.kind ?? "prd",
    version: overrides.version ?? 1,
    status: overrides.status ?? "changing",
    filePath: overrides.filePath ?? "specs/prd/contract-linked-spec.md",
    linkType: overrides.linkType ?? "implements",
  }

  const docResult = db.prepare(
    `INSERT INTO docs (doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '{}')`
  ).run(
    fixture.docId,
    `hash-${fixture.docId}-${fixture.version}`,
    fixture.kind,
    fixture.name,
    fixture.title,
    fixture.version,
    fixture.status,
    fixture.filePath,
    now
  )

  db.prepare(
    "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
  ).run(taskId, docResult.lastInsertRowid, fixture.linkType, now)

  return fixture
}

function runCli(args: string[], dbPath: string): CliResult {
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

// =============================================================================
// MCP Runtime Factory
// =============================================================================

type McpServices = TaskService | ReadyService | DependencyService

function createMcpRuntime(db: TestDatabase): ManagedRuntime.ManagedRuntime<McpServices, unknown> { return ManagedRuntime.make(makeMinimalLayerFromInfra(Layer.succeed(SqliteClient, db.db as Database))) }

// =============================================================================
// MCP Operations (using shared serialization)
// =============================================================================

async function mcpGetTask(
  runtime: ManagedRuntime.ManagedRuntime<McpServices, unknown>,
  id: string
): Promise<SerializedTask> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      const task = yield* taskService.getWithDeps(id as TaskId)
      // Use the CANONICAL serialization from @tx/types
      return serializeTask(task)
    })
  )
}

async function mcpGetReady(
  runtime: ManagedRuntime.ManagedRuntime<McpServices, unknown>,
  limit?: number
): Promise<SerializedTask[]> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const readyService = yield* ReadyService
      const tasks = yield* readyService.getReady(limit ?? 100)
      return tasks.map(serializeTask)
    })
  )
}

async function mcpListTasks(
  runtime: ManagedRuntime.ManagedRuntime<McpServices, unknown>,
  options?: { status?: string; limit?: number }
): Promise<SerializedTask[]> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      const tasks = yield* taskService.listWithDeps({
        status: options?.status as TaskWithDeps["status"] | undefined,
        limit: options?.limit
      })
      return tasks.map(serializeTask)
    })
  )
}

// =============================================================================
// Normalization for Comparison
// =============================================================================

/**
 * Normalize a task for comparison.
 * Sorts array fields and truncates dates to second precision.
 */
function normalizeForComparison(task: SerializedTask): SerializedTask {
  return {
    ...task,
    // Sort arrays for stable comparison
    blockedBy: [...task.blockedBy].sort(),
    blocks: [...task.blocks].sort(),
    children: [...task.children].sort(),
    linkedDocs: [...task.linkedDocs].sort((a, b) =>
      a.docId.localeCompare(b.docId) ||
      a.linkType.localeCompare(b.linkType) ||
      a.version - b.version
    ),
    // Truncate dates to second precision to avoid millisecond differences
    createdAt: task.createdAt.slice(0, 19),
    updatedAt: task.updatedAt.slice(0, 19),
    completedAt: task.completedAt ? task.completedAt.slice(0, 19) : null,
    assignedAt: task.assignedAt ? task.assignedAt.slice(0, 19) : null,
  }
}

/** Fields that are part of the core SerializedTask contract */
const CONTRACT_FIELDS: (keyof SerializedTask)[] = [
  "id",
  "title",
  "description",
  "status",
  "parentId",
  "score",
  "createdAt",
  "updatedAt",
  "completedAt",
  "assigneeType",
  "assigneeId",
  "assignedAt",
  "assignedBy",
  "metadata",
  "blockedBy",
  "blocks",
  "children",
  "isReady",
  "linkedDocs",
]

/**
 * Deep equality check with detailed diff output.
 * Only compares fields that are part of the contract.
 */
function assertTasksIdentical(
  label: string,
  expected: SerializedTask,
  actual: SerializedTask
): void {
  const expNorm = normalizeForComparison(expected)
  const actNorm = normalizeForComparison(actual)

  // Compare only contract fields for better error messages
  for (const key of CONTRACT_FIELDS) {
    const expVal = expNorm[key]
    const actVal = actNorm[key]

    if (Array.isArray(expVal)) {
      expect(actVal, `${label}: ${key}`).toEqual(expVal)
    } else if (typeof expVal === "object" && expVal !== null) {
      expect(actVal, `${label}: ${key}`).toEqual(expVal)
    } else {
      expect(actVal, `${label}: ${key}`).toBe(expVal)
    }
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("API Contract Validator", () => {
  let tmpDir: string
  let dbPath: string
  let db: TestDatabase
  let mcpRuntime: ManagedRuntime.ManagedRuntime<McpServices, unknown>
  let sdkClient: TxClient

  beforeEach(async () => {
    // Create temp directory for CLI database
    tmpDir = mkdtempSync(join(tmpdir(), "tx-contract-test-"))
    dbPath = join(tmpDir, "test.db")

    // Initialize CLI database
    runCli(["init"], dbPath)

    // Create shared in-memory database for MCP
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db, FIXTURE_TIMESTAMP)

    // Seed CLI database with same fixtures
    const now = FIXTURE_TIMESTAMP
    const cliDb = new Database(dbPath)
    cliDb.exec("PRAGMA journal_mode = WAL")
    cliDb.exec("PRAGMA busy_timeout = 5000")
    cliDb.exec("BEGIN TRANSACTION")

    const insert = cliDb.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertDep = cliDb.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
    )

    insert.run(FIXTURES.TASK_ROOT, "Root project", "The root task", "backlog", null, 1000, now, now, null, "{}")
    insert.run(FIXTURES.TASK_AUTH, "Implement auth", "Authentication system", "backlog", FIXTURES.TASK_ROOT, 800, now, now, null, "{}")
    insert.run(FIXTURES.TASK_LOGIN, "Login page", "Build login UI", "ready", FIXTURES.TASK_AUTH, 600, now, now, null, "{}")
    insert.run(FIXTURES.TASK_JWT, "JWT validation", "Validate JWT tokens", "ready", FIXTURES.TASK_AUTH, 700, now, now, null, "{}")
    insert.run(FIXTURES.TASK_BLOCKED, "Integration tests", "Test everything", "backlog", FIXTURES.TASK_AUTH, 500, now, now, null, "{}")
    insert.run(FIXTURES.TASK_DONE, "Setup project", "Initial setup", "done", FIXTURES.TASK_AUTH, 900, now, now, now, "{}")

    insertDep.run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, now)
    insertDep.run(FIXTURES.TASK_LOGIN, FIXTURES.TASK_BLOCKED, now)

    const assignmentFixtureTime = "2026-02-21T12:00:00.000Z"
    db.db.prepare(
      `UPDATE tasks
       SET assignee_type = ?, assignee_id = ?, assigned_at = ?, assigned_by = ?
       WHERE id = ?`
    ).run("agent", "contract-worker", assignmentFixtureTime, "test:contract-seed", FIXTURES.TASK_JWT)
    cliDb.prepare(
      `UPDATE tasks
       SET assignee_type = ?, assignee_id = ?, assigned_at = ?, assigned_by = ?
       WHERE id = ?`
    ).run("agent", "contract-worker", assignmentFixtureTime, "test:contract-seed", FIXTURES.TASK_JWT)

    cliDb.exec("COMMIT")
    cliDb.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    cliDb.close()

    // Create MCP runtime
    mcpRuntime = createMcpRuntime(db)

    // Create SDK client in direct mode
    sdkClient = new TxClient({ dbPath })
  })

  afterEach(async () => {
    db.close()
    await mcpRuntime.dispose()
    await sdkClient.dispose()
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // ===========================================================================
  // Contract Validation (Doctrine Rule 1)
  // ===========================================================================

  describe("Contract Validation (Doctrine Rule 1)", () => {
    it("CLI show --json conforms to SerializedTask contract", () => {
      const result = runCli(["task", "show", FIXTURES.TASK_AUTH, "--json"], dbPath)
      expect(result.status, `CLI failed: ${result.stderr}`).toBe(0)

      const task = JSON.parse(result.stdout)
      const errors = validateTaskContract(task, "CLI show")

      expect(errors, errors.join("\n")).toHaveLength(0)
    })

    it("CLI ready --json conforms to SerializedTask contract", () => {
      const result = runCli(["task", "ready", "--json", "--limit", "10"], dbPath)
      expect(result.status, `CLI failed: ${result.stderr}`).toBe(0)

      const tasks = JSON.parse(result.stdout) as unknown[]
      for (let i = 0; i < tasks.length; i++) {
        const errors = validateTaskContract(tasks[i], `CLI ready[${i}]`)
        expect(errors, errors.join("\n")).toHaveLength(0)
      }
    })

    it("CLI list --json conforms to SerializedTask contract", () => {
      const result = runCli(["task", "list", "--json", "--limit", "10"], dbPath)
      expect(result.status, `CLI failed: ${result.stderr}`).toBe(0)

      const tasks = JSON.parse(result.stdout) as unknown[]
      for (let i = 0; i < tasks.length; i++) {
        const errors = validateTaskContract(tasks[i], `CLI list[${i}]`)
        expect(errors, errors.join("\n")).toHaveLength(0)
      }
    })

    it("MCP getTask conforms to SerializedTask contract", async () => {
      const task = await mcpGetTask(mcpRuntime, FIXTURES.TASK_AUTH)
      const errors = validateTaskContract(task, "MCP getTask")
      expect(errors, errors.join("\n")).toHaveLength(0)
    })

    it("MCP getReady conforms to SerializedTask contract", async () => {
      const tasks = await mcpGetReady(mcpRuntime, 10)
      for (let i = 0; i < tasks.length; i++) {
        const errors = validateTaskContract(tasks[i], `MCP getReady[${i}]`)
        expect(errors, errors.join("\n")).toHaveLength(0)
      }
    })

    it("SDK tasks.get conforms to SerializedTask contract", async () => {
      const task = await sdkClient.tasks.get(FIXTURES.TASK_AUTH)
      const errors = validateTaskContract(task, "SDK tasks.get")
      expect(errors, errors.join("\n")).toHaveLength(0)
    })

    it("SDK tasks.ready conforms to SerializedTask contract", async () => {
      const tasks = await sdkClient.tasks.ready({ limit: 10 })
      for (let i = 0; i < tasks.length; i++) {
        const errors = validateTaskContract(tasks[i], `SDK tasks.ready[${i}]`)
        expect(errors, errors.join("\n")).toHaveLength(0)
      }
    })
  })

  // ===========================================================================
  // Cross-Interface Parity: show / getTask / tasks.get
  // ===========================================================================

  describe("task show/ getTask / tasks.get parity", () => {
    it("all interfaces return identical results for task without dependencies", async () => {
      const taskId = FIXTURES.TASK_JWT

      // CLI
      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      expect(cliResult.status, `CLI failed: ${cliResult.stderr}`).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask

      // MCP
      const mcpTask = await mcpGetTask(mcpRuntime, taskId)

      // SDK
      const sdkTask = await sdkClient.tasks.get(taskId)

      expect(cliTask.assigneeType).toBe("agent")
      expect(mcpTask.assigneeType).toBe("agent")
      expect(sdkTask.assigneeType).toBe("agent")
      expect(cliTask.assigneeId).toBe("contract-worker")
      expect(mcpTask.assigneeId).toBe("contract-worker")
      expect(sdkTask.assigneeId).toBe("contract-worker")
      expect(cliTask.assignedBy).toBe("test:contract-seed")
      expect(mcpTask.assignedBy).toBe("test:contract-seed")
      expect(sdkTask.assignedBy).toBe("test:contract-seed")

      // Cross-validate
      assertTasksIdentical("CLI vs MCP", cliTask, mcpTask)
      assertTasksIdentical("MCP vs SDK", mcpTask, sdkTask)
      assertTasksIdentical("CLI vs SDK", cliTask, sdkTask)
    })

    it("all interfaces return identical results for blocked task", async () => {
      const taskId = FIXTURES.TASK_BLOCKED

      // CLI
      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      expect(cliResult.status, `CLI failed: ${cliResult.stderr}`).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask

      // MCP
      const mcpTask = await mcpGetTask(mcpRuntime, taskId)

      // SDK
      const sdkTask = await sdkClient.tasks.get(taskId)

      // Verify blockedBy is populated
      expect(cliTask.blockedBy.length, "CLI blockedBy").toBeGreaterThan(0)
      expect(mcpTask.blockedBy.length, "MCP blockedBy").toBeGreaterThan(0)
      expect(sdkTask.blockedBy.length, "SDK blockedBy").toBeGreaterThan(0)

      // Cross-validate
      assertTasksIdentical("CLI vs MCP", cliTask, mcpTask)
      assertTasksIdentical("MCP vs SDK", mcpTask, sdkTask)
    })

    it("all interfaces return identical results for task that blocks others", async () => {
      const taskId = FIXTURES.TASK_JWT // Blocks TASK_BLOCKED

      // CLI
      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask

      // MCP
      const mcpTask = await mcpGetTask(mcpRuntime, taskId)

      // SDK
      const sdkTask = await sdkClient.tasks.get(taskId)

      // Verify blocks is populated
      expect(cliTask.blocks.length, "CLI blocks").toBeGreaterThan(0)
      expect(mcpTask.blocks.length, "MCP blocks").toBeGreaterThan(0)
      expect(sdkTask.blocks.length, "SDK blocks").toBeGreaterThan(0)

      // Cross-validate
      assertTasksIdentical("CLI vs MCP", cliTask, mcpTask)
      assertTasksIdentical("MCP vs SDK", mcpTask, sdkTask)
    })

    it("all interfaces return identical results for parent task with children", async () => {
      const taskId = FIXTURES.TASK_AUTH

      // CLI
      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask

      // MCP
      const mcpTask = await mcpGetTask(mcpRuntime, taskId)

      // SDK
      const sdkTask = await sdkClient.tasks.get(taskId)

      // Verify children is populated
      expect(cliTask.children.length, "CLI children").toBeGreaterThan(0)
      expect(mcpTask.children.length, "MCP children").toBeGreaterThan(0)
      expect(sdkTask.children.length, "SDK children").toBeGreaterThan(0)

      // Cross-validate
      assertTasksIdentical("CLI vs MCP", cliTask, mcpTask)
      assertTasksIdentical("MCP vs SDK", mcpTask, sdkTask)
    })

    it("all interfaces return identical linkedDocs for an attached spec", async () => {
      const taskId = FIXTURES.TASK_JWT
      const expected = insertLinkedDoc(db.db, taskId, {
        docId: "doc-777777777777",
        name: "contract-jwt-prd",
        title: "Contract JWT PRD",
        filePath: "specs/prd/contract-jwt-prd.md",
      })

      const cliDb = new Database(dbPath)
      insertLinkedDoc(cliDb, taskId, expected)
      cliDb.exec("PRAGMA wal_checkpoint(TRUNCATE)")
      cliDb.close()

      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      expect(cliResult.status, `CLI failed: ${cliResult.stderr}`).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask

      const mcpTask = await mcpGetTask(mcpRuntime, taskId)
      const sdkTask = await sdkClient.tasks.get(taskId)

      expect(cliTask.linkedDocs).toEqual([expected])
      expect(mcpTask.linkedDocs).toEqual([expected])
      expect(sdkTask.linkedDocs).toEqual([expected])

      assertTasksIdentical("CLI vs MCP", cliTask, mcpTask)
      assertTasksIdentical("MCP vs SDK", mcpTask, sdkTask)
      assertTasksIdentical("CLI vs SDK", cliTask, sdkTask)
    })
  })

  // ===========================================================================
  // Cross-Interface Parity: ready / getReady / tasks.ready
  // ===========================================================================

  describe("task ready/ getReady / tasks.ready parity", () => {
    it("all interfaces return identical ready task list s", async () => {
      // CLI
      const cliResult = runCli(["task", "ready", "--json", "--limit", "100"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as SerializedTask[]

      // MCP
      const mcpTasks = await mcpGetReady(mcpRuntime, 100)

      // SDK
      const sdkTasks = await sdkClient.tasks.ready({ limit: 100 })

      // All should have same count
      expect(cliTasks.length).toBe(mcpTasks.length)
      expect(mcpTasks.length).toBe(sdkTasks.length)

      // All ready tasks should have isReady = true
      for (const task of cliTasks) {
        expect(task.isReady, `CLI task ${task.id} isReady`).toBe(true)
      }
      for (const task of mcpTasks) {
        expect(task.isReady, `MCP task ${task.id} isReady`).toBe(true)
      }
      for (const task of sdkTasks) {
        expect(task.isReady, `SDK task ${task.id} isReady`).toBe(true)
      }

      // Sort by ID and compare
      const cliSorted = [...cliTasks].sort((a, b) => a.id.localeCompare(b.id))
      const mcpSorted = [...mcpTasks].sort((a, b) => a.id.localeCompare(b.id))
      const sdkSorted = [...sdkTasks].sort((a, b) => a.id.localeCompare(b.id))

      for (let i = 0; i < cliSorted.length; i++) {
        assertTasksIdentical(`ready[${i}] CLI vs MCP`, cliSorted[i], mcpSorted[i])
        assertTasksIdentical(`ready[${i}] MCP vs SDK`, mcpSorted[i], sdkSorted[i])
      }
    })

    it("all interfaces respect limit parameter", async () => {
      const limit = 2

      // CLI
      const cliResult = runCli(["task", "ready", "--json", "--limit", String(limit)], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as SerializedTask[]

      // MCP
      const mcpTasks = await mcpGetReady(mcpRuntime, limit)

      // SDK
      const sdkTasks = await sdkClient.tasks.ready({ limit })

      // All should respect limit
      expect(cliTasks.length).toBeLessThanOrEqual(limit)
      expect(mcpTasks.length).toBeLessThanOrEqual(limit)
      expect(sdkTasks.length).toBeLessThanOrEqual(limit)
    })
  })

  // ===========================================================================
  // Cross-Interface Parity: list / listTasks / tasks.list
  // ===========================================================================

  describe("task list/ listTasks / tasks.list parity", () => {
    it("all interfaces return identical task list s", async () => {
      // CLI
      const cliResult = runCli(["task", "list", "--json", "--limit", "100"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as SerializedTask[]

      // MCP
      const mcpTasks = await mcpListTasks(mcpRuntime, { limit: 100 })

      // SDK
      const sdkListResult = await sdkClient.tasks.list({ limit: 100 })
      const sdkTasks = sdkListResult.items

      // All should have same count
      expect(cliTasks.length).toBe(mcpTasks.length)
      expect(mcpTasks.length).toBe(sdkTasks.length)

      // Sort by ID and compare
      const cliSorted = [...cliTasks].sort((a, b) => a.id.localeCompare(b.id))
      const mcpSorted = [...mcpTasks].sort((a, b) => a.id.localeCompare(b.id))
      const sdkSorted = [...sdkTasks].sort((a, b) => a.id.localeCompare(b.id))

      for (let i = 0; i < cliSorted.length; i++) {
        assertTasksIdentical(`list[${i}] CLI vs MCP`, cliSorted[i], mcpSorted[i])
        assertTasksIdentical(`list[${i}] MCP vs SDK`, mcpSorted[i], sdkSorted[i])
      }
    })

    it("all interfaces filter by status identically", async () => {
      const status = "ready"

      // CLI
      const cliResult = runCli(["task", "list", "--json", "--status", status], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as SerializedTask[]

      // MCP
      const mcpTasks = await mcpListTasks(mcpRuntime, { status })

      // SDK
      const sdkListResult = await sdkClient.tasks.list({ status })
      const sdkTasks = sdkListResult.items

      // All should filter to same status
      for (const task of cliTasks) {
        expect(task.status).toBe(status)
      }
      for (const task of mcpTasks) {
        expect(task.status).toBe(status)
      }
      for (const task of sdkTasks) {
        expect(task.status).toBe(status)
      }

      // Same count after filtering
      expect(cliTasks.length).toBe(mcpTasks.length)
      expect(mcpTasks.length).toBe(sdkTasks.length)
    })
  })

  // ===========================================================================
  // Dependency Field Verification
  // ===========================================================================

  describe("Dependency fields never hardcoded or empty incorrectly", () => {
    it("blockedBy is populated correctly for blocked tasks", async () => {
      const taskId = FIXTURES.TASK_BLOCKED

      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask
      const mcpTask = await mcpGetTask(mcpRuntime, taskId)
      const sdkTask = await sdkClient.tasks.get(taskId)

      // All should have exactly 2 blockers (JWT and LOGIN)
      expect(cliTask.blockedBy).toHaveLength(2)
      expect(mcpTask.blockedBy).toHaveLength(2)
      expect(sdkTask.blockedBy).toHaveLength(2)

      // Should contain the correct IDs
      expect(cliTask.blockedBy).toContain(FIXTURES.TASK_JWT)
      expect(cliTask.blockedBy).toContain(FIXTURES.TASK_LOGIN)
    })

    it("blocks is populated correctly for blocking tasks", async () => {
      const taskId = FIXTURES.TASK_JWT // Blocks TASK_BLOCKED

      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask
      const mcpTask = await mcpGetTask(mcpRuntime, taskId)
      const sdkTask = await sdkClient.tasks.get(taskId)

      // All should have exactly 1 task they block
      expect(cliTask.blocks).toHaveLength(1)
      expect(mcpTask.blocks).toHaveLength(1)
      expect(sdkTask.blocks).toHaveLength(1)

      // Should contain the correct ID
      expect(cliTask.blocks).toContain(FIXTURES.TASK_BLOCKED)
    })

    it("task dep children is populated correctly for parent tasks", async () => {
      const taskId = FIXTURES.TASK_AUTH // Parent of LOGIN, JWT, BLOCKED, DONE

      const cliResult = runCli(["task", "show", taskId, "--json"], dbPath)
      const cliTask = JSON.parse(cliResult.stdout) as SerializedTask
      const mcpTask = await mcpGetTask(mcpRuntime, taskId)
      const sdkTask = await sdkClient.tasks.get(taskId)

      // All should have 4 children
      expect(cliTask.children).toHaveLength(4)
      expect(mcpTask.children).toHaveLength(4)
      expect(sdkTask.children).toHaveLength(4)
    })

    it("isReady is calculated correctly based on blockers", async () => {
      // TASK_JWT has no blockers and is in "ready" status -> should be ready
      const jwtTask = await mcpGetTask(mcpRuntime, FIXTURES.TASK_JWT)
      expect(jwtTask.isReady, "JWT task should be ready").toBe(true)

      // TASK_BLOCKED has incomplete blockers -> should NOT be ready
      const blockedTask = await mcpGetTask(mcpRuntime, FIXTURES.TASK_BLOCKED)
      expect(blockedTask.isReady, "Blocked task should not be ready").toBe(false)

      // TASK_DONE is completed -> should NOT be ready
      const doneTask = await mcpGetTask(mcpRuntime, FIXTURES.TASK_DONE)
      expect(doneTask.isReady, "Done task should not be ready").toBe(false)
    })
  })
})
