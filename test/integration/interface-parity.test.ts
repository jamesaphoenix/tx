/**
 * Interface Parity Integration Tests
 *
 * Tests that CLI, MCP, and API return equivalent TaskWithDeps data
 * when called with identical inputs.
 *
 * Per CLAUDE.md Rule 1: Every API response MUST include full dependency information.
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * These tests ensure all three interfaces return consistent data structures
 * and values, preventing divergence between interface implementations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { Effect, ManagedRuntime, Layer } from "effect"
import { Database } from "bun:sqlite"
import { Hono } from "hono"

import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  LearningRepositoryLive,
  FileLearningRepositoryLive,
  TaskServiceLive,
  TaskService,
  DependencyServiceLive,
  DependencyService,
  ReadyServiceLive,
  ReadyService,
  HierarchyServiceLive,
  LearningServiceLive,
  FileLearningServiceLive,
  EmbeddingServiceNoop,
  AutoSyncServiceNoop,
  QueryExpansionServiceNoop,
  RerankerServiceNoop,
  RetrieverServiceLive
} from "@jamesaphoenix/tx-core"
import type { TaskId, TaskWithDeps } from "@jamesaphoenix/tx-types"

// =============================================================================
// Constants
// =============================================================================

const TX_BIN = resolve(__dirname, "../../apps/cli/dist/cli.js")
const CLI_TIMEOUT = 10000
const DEPENDENCY_SNAPSHOT_SQL = "select blocker_id, blocked_id from task_dependencies"

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase()
}

function countPrepareCallsByQueryShape(
  calls: ReadonlyArray<ReadonlyArray<unknown>>,
  predicate: (normalizedSql: string) => boolean
): number {
  return calls.reduce((count, call) => {
    const sql = call[0]
    if (typeof sql !== "string") {
      return count
    }
    return predicate(normalizeSql(sql)) ? count + 1 : count
  }, 0)
}

// =============================================================================
// Types
// =============================================================================

/** Normalized task structure for comparison across interfaces */
interface NormalizedTask {
  id: string
  title: string
  description: string
  status: string
  parentId: string | null
  score: number
  createdAt: string  // ISO string
  updatedAt: string  // ISO string
  completedAt: string | null  // ISO string or null
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
}

interface CliExecResult {
  stdout: string
  stderr: string
  status: number
}

// =============================================================================
// CLI Helper
// =============================================================================

function runTxArgs(args: string[], dbPath: string): CliExecResult {
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

// =============================================================================
// MCP Test Runtime Factory
// =============================================================================

type McpTestServices = TaskService | ReadyService | DependencyService

function makeTestRuntime(db: Database): ManagedRuntime.ManagedRuntime<McpTestServices, any> {
  const infra = Layer.succeed(SqliteClient, db.db as Database)

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )

  const retrieverLayer = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop))
  )

  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive,
    FileLearningServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, retrieverLayer, AutoSyncServiceNoop))
  )

  return ManagedRuntime.make(services)
}

// =============================================================================
// MCP Tool Implementation (mirrors src/mcp/server.ts)
// =============================================================================

const serializeTask = (task: TaskWithDeps): Record<string, unknown> => ({
  id: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  parentId: task.parentId,
  score: task.score,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  completedAt: task.completedAt?.toISOString() ?? null,
  metadata: task.metadata,
  blockedBy: task.blockedBy,
  blocks: task.blocks,
  children: task.children,
  isReady: task.isReady
})

interface McpToolResponse {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

async function callMcpShow(
  runtime: ManagedRuntime.ManagedRuntime<McpTestServices, any>,
  id: string
): Promise<McpToolResponse> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      const task = yield* taskService.getWithDeps(id as TaskId)
      const serialized = serializeTask(task)
      return {
        content: [
          { type: "text" as const, text: `Task: ${task.title}` },
          { type: "text" as const, text: JSON.stringify(serialized) }
        ]
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        })
      )
    )
  )
}

async function callMcpReady(
  runtime: ManagedRuntime.ManagedRuntime<McpTestServices, any>,
  limit?: number
): Promise<McpToolResponse> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const readyService = yield* ReadyService
      const tasks = yield* readyService.getReady(limit ?? 100)
      const serialized = tasks.map(serializeTask)
      return {
        content: [
          { type: "text" as const, text: `Found ${tasks.length} ready task(s)` },
          { type: "text" as const, text: JSON.stringify(serialized) }
        ]
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        })
      )
    )
  )
}

async function callMcpList(
  runtime: ManagedRuntime.ManagedRuntime<McpTestServices, any>,
  options?: { status?: string; limit?: number }
): Promise<McpToolResponse> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const taskService = yield* TaskService
      const tasks = yield* taskService.listWithDeps({
        status: options?.status as any,
        limit: options?.limit
      })
      const serialized = tasks.map(serializeTask)
      return {
        content: [
          { type: "text" as const, text: `Found ${tasks.length} task(s)` },
          { type: "text" as const, text: JSON.stringify(serialized) }
        ]
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        })
      )
    )
  )
}

// =============================================================================
// API App Factory (mirrors apps/dashboard/api)
// =============================================================================

interface TaskRow {
  id: string
  title: string
  description: string
  status: string
  parent_id: string | null
  score: number
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: string
}

interface ApiTaskWithDeps {
  id: string
  title: string
  description: string
  status: string
  parentId: string | null
  score: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  metadata: Record<string, unknown>
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
}

function createTestApiApp(db: Database) {
  const app = new Hono()

  function enrichTasksWithDeps(tasks: TaskRow[]): ApiTaskWithDeps[] {
    const deps = db.db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as Array<{
      blocker_id: string
      blocked_id: string
    }>

    const blockedByMap = new Map<string, string[]>()
    const blocksMap = new Map<string, string[]>()

    for (const dep of deps) {
      const existing = blockedByMap.get(dep.blocked_id) ?? []
      blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id])

      const existingBlocks = blocksMap.get(dep.blocker_id) ?? []
      blocksMap.set(dep.blocker_id, [...existingBlocks, dep.blocked_id])
    }

    const allTasks = db.db.prepare("SELECT id, parent_id, status FROM tasks").all() as Array<{
      id: string
      parent_id: string | null
      status: string
    }>

    const childrenMap = new Map<string, string[]>()
    for (const task of allTasks) {
      if (task.parent_id) {
        const existing = childrenMap.get(task.parent_id) ?? []
        childrenMap.set(task.parent_id, [...existing, task.id])
      }
    }

    const statusMap = new Map(allTasks.map(t => [t.id, t.status]))
    const workableStatuses = ["backlog", "ready", "planning"]

    return tasks.map(task => {
      const blockedBy = blockedByMap.get(task.id) ?? []
      const blocks = blocksMap.get(task.id) ?? []
      const children = childrenMap.get(task.id) ?? []
      const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done")
      const isReady = workableStatuses.includes(task.status) && allBlockersDone

      return {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        parentId: task.parent_id,
        score: task.score,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at,
        metadata: JSON.parse(task.metadata || "{}"),
        blockedBy,
        blocks,
        children,
        isReady
      }
    })
  }

  // GET /api/tasks/ready (MUST be defined before /api/tasks/:id due to Hono route matching)
  app.get("/api/tasks/ready", (c) => {
    try {
      const limitParam = c.req.query("limit")
      const limit = limitParam ? parseInt(limitParam, 10) : 100

      const tasks = db.db.prepare("SELECT * FROM tasks ORDER BY score DESC").all() as TaskRow[]
      const enriched = enrichTasksWithDeps(tasks)
      const ready = enriched.filter(t => t.isReady).slice(0, limit)

      return c.json({ tasks: ready })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/tasks/:id (MUST be defined after /api/tasks/ready)
  app.get("/api/tasks/:id", (c) => {
    try {
      const id = c.req.param("id")
      const task = db.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
      if (!task) {
        return c.json({ error: "Task not found" }, 404)
      }
      const [enrichedTask] = enrichTasksWithDeps([task])
      return c.json({ task: enrichedTask })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/tasks
  app.get("/api/tasks", (c) => {
    try {
      const statusFilter = c.req.query("status")
      const limitParam = c.req.query("limit")
      const limit = limitParam ? parseInt(limitParam, 10) : 100

      let sql = "SELECT * FROM tasks"
      const params: string[] = []

      if (statusFilter) {
        const statuses = statusFilter.split(",")
        sql += ` WHERE status IN (${statuses.map(() => "?").join(",")})`
        params.push(...statuses)
      }

      sql += " ORDER BY score DESC LIMIT ?"
      params.push(String(limit))

      const tasks = db.db.prepare(sql).all(...params) as TaskRow[]
      const enriched = enrichTasksWithDeps(tasks)

      return c.json({ tasks: enriched })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  return app
}

// =============================================================================
// Normalization Helper
// =============================================================================

function normalizeTask(task: any): NormalizedTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    parentId: task.parentId ?? task.parent_id ?? null,
    score: task.score,
    createdAt: typeof task.createdAt === "string" ? task.createdAt : task.created_at,
    updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : task.updated_at,
    completedAt: task.completedAt ?? task.completed_at ?? null,
    blockedBy: [...(task.blockedBy ?? [])].sort(),
    blocks: [...(task.blocks ?? [])].sort(),
    children: [...(task.children ?? [])].sort(),
    isReady: task.isReady
  }
}

function assertTasksEqual(label: string, t1: NormalizedTask, t2: NormalizedTask): void {
  expect(t1.id, `${label}: id`).toBe(t2.id)
  expect(t1.title, `${label}: title`).toBe(t2.title)
  expect(t1.description, `${label}: description`).toBe(t2.description)
  expect(t1.status, `${label}: status`).toBe(t2.status)
  expect(t1.parentId, `${label}: parentId`).toBe(t2.parentId)
  expect(t1.score, `${label}: score`).toBe(t2.score)
  // Dates may have slight formatting differences, compare without ms precision
  expect(t1.createdAt.slice(0, 19), `${label}: createdAt`).toBe(t2.createdAt.slice(0, 19))
  expect(t1.updatedAt.slice(0, 19), `${label}: updatedAt`).toBe(t2.updatedAt.slice(0, 19))
  if (t1.completedAt && t2.completedAt) {
    expect(t1.completedAt.slice(0, 19), `${label}: completedAt`).toBe(t2.completedAt.slice(0, 19))
  } else {
    expect(t1.completedAt, `${label}: completedAt`).toBe(t2.completedAt)
  }
  expect(t1.blockedBy, `${label}: blockedBy`).toEqual(t2.blockedBy)
  expect(t1.blocks, `${label}: blocks`).toEqual(t2.blocks)
  expect(t1.children, `${label}: children`).toEqual(t2.children)
  expect(t1.isReady, `${label}: isReady`).toBe(t2.isReady)
}

function assertTaskListsEqual(label: string, list1: NormalizedTask[], list2: NormalizedTask[]): void {
  expect(list1.length, `${label}: list length`).toBe(list2.length)

  // Sort both lists by ID for stable comparison
  const sorted1 = [...list1].sort((a, b) => a.id.localeCompare(b.id))
  const sorted2 = [...list2].sort((a, b) => a.id.localeCompare(b.id))

  for (let i = 0; i < sorted1.length; i++) {
    assertTasksEqual(`${label}[${i}]`, sorted1[i], sorted2[i])
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("Interface Parity", () => {
  let tmpDir: string
  let dbPath: string
  let db: TestDatabase
  let runtime: ManagedRuntime.ManagedRuntime<McpTestServices, any>
  let apiApp: ReturnType<typeof createTestApiApp>

  beforeEach(async () => {
    // Create temp directory for CLI database
    tmpDir = mkdtempSync(join(tmpdir(), "tx-parity-test-"))
    dbPath = join(tmpDir, "test.db")

    // Initialize CLI database
    runTxArgs(["init"], dbPath)

    // Create shared in-memory database for MCP/API
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)

    // Seed CLI database with same fixtures
    const now = new Date().toISOString()
    const cliDb = new Database(dbPath)

    // Enable WAL mode for better concurrency
    cliDb.exec("PRAGMA journal_mode = WAL")
    cliDb.exec("PRAGMA busy_timeout = 5000")

    // Use a transaction to batch all inserts
    cliDb.exec("BEGIN TRANSACTION")

    const insert = cliDb.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertDep = cliDb.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
    )

    // Root task (no parent)
    insert.run(FIXTURES.TASK_ROOT, "Root project", "The root task", "backlog", null, 1000, now, now, null, "{}")
    // Auth task (parent: root)
    insert.run(FIXTURES.TASK_AUTH, "Implement auth", "Authentication system", "backlog", FIXTURES.TASK_ROOT, 800, now, now, null, "{}")
    // Login task (parent: auth, ready status)
    insert.run(FIXTURES.TASK_LOGIN, "Login page", "Build login UI", "ready", FIXTURES.TASK_AUTH, 600, now, now, null, "{}")
    // JWT task (parent: auth, ready status, no blockers)
    insert.run(FIXTURES.TASK_JWT, "JWT validation", "Validate JWT tokens", "ready", FIXTURES.TASK_AUTH, 700, now, now, null, "{}")
    // Blocked task (parent: auth, blocked by JWT and LOGIN)
    insert.run(FIXTURES.TASK_BLOCKED, "Integration tests", "Test everything", "backlog", FIXTURES.TASK_AUTH, 500, now, now, null, "{}")
    // Done task (parent: auth)
    insert.run(FIXTURES.TASK_DONE, "Setup project", "Initial setup", "done", FIXTURES.TASK_AUTH, 900, now, now, now, "{}")

    // Dependencies: TASK_BLOCKED is blocked by TASK_JWT and TASK_LOGIN
    insertDep.run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, now)
    insertDep.run(FIXTURES.TASK_LOGIN, FIXTURES.TASK_BLOCKED, now)

    cliDb.exec("COMMIT")

    // Checkpoint WAL to ensure all writes are flushed to main database file
    cliDb.exec("PRAGMA wal_checkpoint(TRUNCATE)")

    cliDb.close()

    // Create MCP runtime and API app
    runtime = makeTestRuntime(db)
    apiApp = createTestApiApp(db)
  })

  afterEach(async () => {
    await runtime.dispose()
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // ===========================================================================
  // show / tx_show / GET /api/tasks/:id
  // ===========================================================================

  describe("show / tx_show / GET /api/tasks/:id", () => {
    it("returns equivalent TaskWithDeps for a task without dependencies", async () => {
      const taskId = FIXTURES.TASK_JWT

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      expect(mcpResult.isError).toBeFalsy()
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Normalize and compare
      const cliNorm = normalizeTask(cliTask)
      const mcpNorm = normalizeTask(mcpTask)
      const apiNorm = normalizeTask(apiTask)

      assertTasksEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTasksEqual("MCP vs API", mcpNorm, apiNorm)
      assertTasksEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("returns equivalent TaskWithDeps for a task with blockedBy dependencies", async () => {
      const taskId = FIXTURES.TASK_BLOCKED

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      expect(mcpResult.isError).toBeFalsy()
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Normalize and compare
      const cliNorm = normalizeTask(cliTask)
      const mcpNorm = normalizeTask(mcpTask)
      const apiNorm = normalizeTask(apiTask)

      // Verify blockedBy is populated
      expect(cliNorm.blockedBy.length).toBeGreaterThan(0)
      expect(mcpNorm.blockedBy.length).toBeGreaterThan(0)
      expect(apiNorm.blockedBy.length).toBeGreaterThan(0)

      assertTasksEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTasksEqual("MCP vs API", mcpNorm, apiNorm)
      assertTasksEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("returns equivalent TaskWithDeps for a task that blocks others", async () => {
      const taskId = FIXTURES.TASK_JWT  // Blocks TASK_BLOCKED

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      expect(mcpResult.isError).toBeFalsy()
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Normalize and compare
      const cliNorm = normalizeTask(cliTask)
      const mcpNorm = normalizeTask(mcpTask)
      const apiNorm = normalizeTask(apiTask)

      // Verify blocks is populated
      expect(cliNorm.blocks.length).toBeGreaterThan(0)
      expect(mcpNorm.blocks.length).toBeGreaterThan(0)
      expect(apiNorm.blocks.length).toBeGreaterThan(0)

      assertTasksEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTasksEqual("MCP vs API", mcpNorm, apiNorm)
      assertTasksEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("returns equivalent TaskWithDeps for a parent task with children", async () => {
      const taskId = FIXTURES.TASK_AUTH  // Has multiple children

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      expect(mcpResult.isError).toBeFalsy()
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Normalize and compare
      const cliNorm = normalizeTask(cliTask)
      const mcpNorm = normalizeTask(mcpTask)
      const apiNorm = normalizeTask(apiTask)

      // Verify children is populated
      expect(cliNorm.children.length).toBeGreaterThan(0)
      expect(mcpNorm.children.length).toBeGreaterThan(0)
      expect(apiNorm.children.length).toBeGreaterThan(0)

      assertTasksEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTasksEqual("MCP vs API", mcpNorm, apiNorm)
      assertTasksEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("API /api/tasks/:id uses one dependency snapshot query shape", async () => {
      const prepareSpy = vi.spyOn(db.db, "prepare")

      try {
        const apiResponse = await apiApp.request(`/api/tasks/${FIXTURES.TASK_BLOCKED}`)
        expect(apiResponse.status).toBe(200)
        const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }

        expect(apiData.task.blockedBy).toEqual(expect.arrayContaining([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN]))
        expect(apiData.task.blocks).toEqual([])
        expect(Array.isArray(apiData.task.children)).toBe(true)
        expect(apiData.task.isReady).toBe(false)

        const snapshotScanCount = countPrepareCallsByQueryShape(
          prepareSpy.mock.calls,
          (sql) => sql === DEPENDENCY_SNAPSHOT_SQL
        )
        const dependencyTableQueryCount = countPrepareCallsByQueryShape(
          prepareSpy.mock.calls,
          (sql) => sql.includes("from task_dependencies")
        )

        expect(snapshotScanCount, "perf-sensitive path should build one dependency snapshot for /api/tasks/:id").toBe(1)
        expect(dependencyTableQueryCount, "query shape should avoid repeated task_dependencies scans for /api/tasks/:id").toBe(1)
      } finally {
        prepareSpy.mockRestore()
      }
    })
  })

  // ===========================================================================
  // ready / tx_ready / GET /api/tasks/ready
  // ===========================================================================

  describe("ready / tx_ready / GET /api/tasks/ready", () => {
    it("returns equivalent ready task lists", async () => {
      // CLI
      const cliResult = runTxArgs(["ready", "--json", "--limit", "100"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as unknown[]

      // MCP
      const mcpResult = await callMcpReady(runtime, 100)
      expect(mcpResult.isError).toBeFalsy()
      const mcpTasks = JSON.parse(mcpResult.content[1].text) as unknown[]

      // API
      const apiResponse = await apiApp.request("/api/tasks/ready?limit=100")
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { tasks: ApiTaskWithDeps[] }
      const apiTasks = apiData.tasks

      // Normalize
      const cliNorm = cliTasks.map(normalizeTask)
      const mcpNorm = mcpTasks.map(normalizeTask)
      const apiNorm = apiTasks.map(normalizeTask)

      // All ready tasks should have isReady = true
      for (const task of cliNorm) {
        expect(task.isReady, `CLI task ${task.id} isReady`).toBe(true)
      }
      for (const task of mcpNorm) {
        expect(task.isReady, `MCP task ${task.id} isReady`).toBe(true)
      }
      for (const task of apiNorm) {
        expect(task.isReady, `API task ${task.id} isReady`).toBe(true)
      }

      assertTaskListsEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTaskListsEqual("MCP vs API", mcpNorm, apiNorm)
      assertTaskListsEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("returns equivalent results with limit parameter", async () => {
      const limit = 2

      // CLI
      const cliResult = runTxArgs(["ready", "--json", "--limit", String(limit)], dbPath)
      expect(cliResult.status, `CLI failed: stdout=${cliResult.stdout}, stderr=${cliResult.stderr}`).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as unknown[]

      // MCP
      const mcpResult = await callMcpReady(runtime, limit)
      expect(mcpResult.isError).toBeFalsy()
      const mcpTasks = JSON.parse(mcpResult.content[1].text) as unknown[]

      // API
      const apiResponse = await apiApp.request(`/api/tasks/ready?limit=${limit}`)
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { tasks: ApiTaskWithDeps[] }
      const apiTasks = apiData.tasks

      // Should respect limit
      expect(cliTasks.length).toBeLessThanOrEqual(limit)
      expect(mcpTasks.length).toBeLessThanOrEqual(limit)
      expect(apiTasks.length).toBeLessThanOrEqual(limit)

      // Normalize
      const cliNorm = cliTasks.map(normalizeTask)
      const mcpNorm = mcpTasks.map(normalizeTask)
      const apiNorm = apiTasks.map(normalizeTask)

      assertTaskListsEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTaskListsEqual("MCP vs API", mcpNorm, apiNorm)
      assertTaskListsEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("API /api/tasks/ready uses one dependency snapshot query shape", async () => {
      const prepareSpy = vi.spyOn(db.db, "prepare")

      try {
        const apiResponse = await apiApp.request("/api/tasks/ready?limit=100")
        expect(apiResponse.status).toBe(200)
        const apiData = await apiResponse.json() as { tasks: ApiTaskWithDeps[] }

        for (const task of apiData.tasks) {
          expect(Array.isArray(task.blockedBy)).toBe(true)
          expect(Array.isArray(task.blocks)).toBe(true)
          expect(Array.isArray(task.children)).toBe(true)
          expect(typeof task.isReady).toBe("boolean")
          expect(task.isReady).toBe(true)
        }

        const snapshotScanCount = countPrepareCallsByQueryShape(
          prepareSpy.mock.calls,
          (sql) => sql === DEPENDENCY_SNAPSHOT_SQL
        )
        const dependencyTableQueryCount = countPrepareCallsByQueryShape(
          prepareSpy.mock.calls,
          (sql) => sql.includes("from task_dependencies")
        )

        expect(snapshotScanCount, "perf-sensitive path should build one dependency snapshot for /api/tasks/ready").toBe(1)
        expect(dependencyTableQueryCount, "query shape should avoid repeated task_dependencies scans for /api/tasks/ready").toBe(1)
      } finally {
        prepareSpy.mockRestore()
      }
    })
  })

  // ===========================================================================
  // list / tx_list / GET /api/tasks
  // ===========================================================================

  describe("list / tx_list / GET /api/tasks", () => {
    it("returns equivalent task lists", async () => {
      // CLI
      const cliResult = runTxArgs(["list", "--json", "--limit", "100"], dbPath)
      expect(cliResult.status).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as unknown[]

      // MCP
      const mcpResult = await callMcpList(runtime, { limit: 100 })
      expect(mcpResult.isError).toBeFalsy()
      const mcpTasks = JSON.parse(mcpResult.content[1].text) as unknown[]

      // API
      const apiResponse = await apiApp.request("/api/tasks?limit=100")
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { tasks: ApiTaskWithDeps[] }
      const apiTasks = apiData.tasks

      // Normalize
      const cliNorm = cliTasks.map(normalizeTask)
      const mcpNorm = mcpTasks.map(normalizeTask)
      const apiNorm = apiTasks.map(normalizeTask)

      assertTaskListsEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTaskListsEqual("MCP vs API", mcpNorm, apiNorm)
      assertTaskListsEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("returns equivalent results with status filter", async () => {
      const status = "ready"

      // CLI
      const cliResult = runTxArgs(["list", "--json", "--status", status], dbPath)
      expect(cliResult.status, `CLI failed: stdout=${cliResult.stdout}, stderr=${cliResult.stderr}`).toBe(0)
      const cliTasks = JSON.parse(cliResult.stdout) as unknown[]

      // MCP
      const mcpResult = await callMcpList(runtime, { status })
      expect(mcpResult.isError).toBeFalsy()
      const mcpTasks = JSON.parse(mcpResult.content[1].text) as unknown[]

      // API
      const apiResponse = await apiApp.request(`/api/tasks?status=${status}`)
      expect(apiResponse.status).toBe(200)
      const apiData = await apiResponse.json() as { tasks: ApiTaskWithDeps[] }
      const apiTasks = apiData.tasks

      // All tasks should have the specified status
      for (const task of cliTasks as Array<{ status: string }>) {
        expect(task.status).toBe(status)
      }
      for (const task of mcpTasks as Array<{ status: string }>) {
        expect(task.status).toBe(status)
      }
      for (const task of apiTasks) {
        expect(task.status).toBe(status)
      }

      // Normalize
      const cliNorm = (cliTasks as unknown[]).map(normalizeTask)
      const mcpNorm = (mcpTasks as unknown[]).map(normalizeTask)
      const apiNorm = apiTasks.map(normalizeTask)

      assertTaskListsEqual("CLI vs MCP", cliNorm, mcpNorm)
      assertTaskListsEqual("MCP vs API", mcpNorm, apiNorm)
      assertTaskListsEqual("CLI vs API", cliNorm, apiNorm)
    })

    it("API /api/tasks uses one dependency snapshot query shape", async () => {
      const prepareSpy = vi.spyOn(db.db, "prepare")

      try {
        const apiResponse = await apiApp.request("/api/tasks?limit=100")
        expect(apiResponse.status).toBe(200)
        const apiData = await apiResponse.json() as { tasks: ApiTaskWithDeps[] }

        const blockedTask = apiData.tasks.find(task => task.id === FIXTURES.TASK_BLOCKED)
        expect(blockedTask).toBeDefined()
        expect(blockedTask?.blockedBy).toEqual(expect.arrayContaining([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN]))
        expect(blockedTask?.blocks).toEqual([])
        expect(Array.isArray(blockedTask?.children)).toBe(true)
        expect(blockedTask?.isReady).toBe(false)

        const snapshotScanCount = countPrepareCallsByQueryShape(
          prepareSpy.mock.calls,
          (sql) => sql === DEPENDENCY_SNAPSHOT_SQL
        )
        const dependencyTableQueryCount = countPrepareCallsByQueryShape(
          prepareSpy.mock.calls,
          (sql) => sql.includes("from task_dependencies")
        )

        expect(snapshotScanCount, "perf-sensitive path should build one dependency snapshot for /api/tasks").toBe(1)
        expect(dependencyTableQueryCount, "query shape should avoid repeated task_dependencies scans for /api/tasks").toBe(1)
      } finally {
        prepareSpy.mockRestore()
      }
    })
  })

  // ===========================================================================
  // TaskWithDeps Field Verification
  // ===========================================================================

  describe("TaskWithDeps field verification (Rule 1 compliance)", () => {
    it("all interfaces include blockedBy, blocks, children, and isReady fields", async () => {
      const taskId = FIXTURES.TASK_AUTH

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status, `CLI failed: stdout=${cliResult.stdout}, stderr=${cliResult.stderr}`).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Verify all TaskWithDeps fields exist
      for (const [name, task] of [["CLI", cliTask], ["MCP", mcpTask], ["API", apiTask]] as const) {
        expect(task, `${name}: task exists`).toBeDefined()
        expect(task.blockedBy, `${name}: blockedBy exists`).toBeDefined()
        expect(Array.isArray(task.blockedBy), `${name}: blockedBy is array`).toBe(true)
        expect(task.blocks, `${name}: blocks exists`).toBeDefined()
        expect(Array.isArray(task.blocks), `${name}: blocks is array`).toBe(true)
        expect(task.children, `${name}: children exists`).toBeDefined()
        expect(Array.isArray(task.children), `${name}: children is array`).toBe(true)
        expect(typeof task.isReady, `${name}: isReady is boolean`).toBe("boolean")
      }
    })

    it("all interfaces return non-empty blockedBy for blocked tasks", async () => {
      const taskId = FIXTURES.TASK_BLOCKED

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status, `CLI failed: stdout=${cliResult.stdout}, stderr=${cliResult.stderr}`).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Verify blockedBy is populated (not empty)
      expect(cliTask.blockedBy.length, "CLI: blockedBy should not be empty").toBeGreaterThan(0)
      expect(mcpTask.blockedBy.length, "MCP: blockedBy should not be empty").toBeGreaterThan(0)
      expect(apiTask.blockedBy.length, "API: blockedBy should not be empty").toBeGreaterThan(0)

      // isReady should be false for blocked tasks
      expect(cliTask.isReady, "CLI: blocked task should not be ready").toBe(false)
      expect(mcpTask.isReady, "MCP: blocked task should not be ready").toBe(false)
      expect(apiTask.isReady, "API: blocked task should not be ready").toBe(false)
    })

    it("all interfaces return non-empty blocks for blocking tasks", async () => {
      const taskId = FIXTURES.TASK_JWT  // Blocks TASK_BLOCKED

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status, `CLI failed: stdout=${cliResult.stdout}, stderr=${cliResult.stderr}`).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Verify blocks is populated (not empty)
      expect(cliTask.blocks.length, "CLI: blocks should not be empty").toBeGreaterThan(0)
      expect(mcpTask.blocks.length, "MCP: blocks should not be empty").toBeGreaterThan(0)
      expect(apiTask.blocks.length, "API: blocks should not be empty").toBeGreaterThan(0)
    })

    it("all interfaces return non-empty children for parent tasks", async () => {
      const taskId = FIXTURES.TASK_AUTH  // Parent of multiple tasks

      // CLI
      const cliResult = runTxArgs(["show", taskId, "--json"], dbPath)
      expect(cliResult.status, `CLI failed: stdout=${cliResult.stdout}, stderr=${cliResult.stderr}`).toBe(0)
      const cliTask = JSON.parse(cliResult.stdout)

      // MCP
      const mcpResult = await callMcpShow(runtime, taskId)
      const mcpTask = JSON.parse(mcpResult.content[1].text)

      // API
      const apiResponse = await apiApp.request(`/api/tasks/${taskId}`)
      const apiData = await apiResponse.json() as { task: ApiTaskWithDeps }
      const apiTask = apiData.task

      // Verify children is populated (not empty)
      expect(cliTask.children.length, "CLI: children should not be empty").toBeGreaterThan(0)
      expect(mcpTask.children.length, "MCP: children should not be empty").toBeGreaterThan(0)
      expect(apiTask.children.length, "API: children should not be empty").toBeGreaterThan(0)
    })
  })
})
