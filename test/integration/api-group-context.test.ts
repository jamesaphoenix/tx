import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { spawnSync, spawn, type ChildProcessByStdio } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"
import type { Readable } from "node:stream"
import { Database } from "bun:sqlite"
import { fixtureId } from "../fixtures.js"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/api-server/src/server.ts")

const FIXTURE_TIMESTAMP = "2026-02-24T12:00:00.000Z"

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

interface SerializedTask {
  id: string
  groupContext: string | null
  effectiveGroupContext: string | null
  effectiveGroupContextSourceTaskId: string | null
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
}

type ApiProcess = ChildProcessByStdio<null, Readable, Readable>

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, ms)
})

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Failed to acquire free port")))
        return
      }
      const { port } = address
      server.close((err) => {
        if (err) rejectPort(err)
        else resolvePort(port)
      })
    })
    server.on("error", rejectPort)
  })
}

function runTx(args: string[], dbPath: string, cwd: string): ExecResult {
  const res = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
  })
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

async function waitForHealth(baseUrl: string, proc: ApiProcess): Promise<void> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`API server exited early with code ${proc.exitCode}`)
    }
    try {
      const res = await fetchWithTimeout(`${baseUrl}/health`, 1000)
      if (res.ok) return
    } catch {
      // keep polling until deadline
    }
    await sleep(200)
  }
  throw new Error("Timed out waiting for API server health endpoint")
}

const taskFixtureId = (name: string): string => fixtureId(`api-group-context:${name}`)

function insertTask(
  db: Database,
  taskId: string,
  title: string,
  parentId: string | null = null,
  status: string = "backlog"
): void {
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '{}')`
  ).run(taskId, title, `${title} description`, status, parentId, 500, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP)
}

describe("API task group-context integration", () => {
  let tmpProjectDir: string
  let dbPath: string
  let db: Database
  let apiProc: ApiProcess
  let apiPort: number
  let baseUrl: string
  let serverLogs = ""

  beforeAll(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-group-context-"))
    dbPath = join(tmpProjectDir, "tasks.db")

    const init = runTx(["init"], dbPath, tmpProjectDir)
    if (init.status !== 0) {
      throw new Error(`Failed to init test database: ${init.stderr || init.stdout}`)
    }

    db = new Database(dbPath)
    apiPort = await getFreePort()
    baseUrl = `http://127.0.0.1:${apiPort}`

    apiProc = spawn("bun", [API_SERVER_SRC, "--host", "127.0.0.1", "--port", String(apiPort), "--db", dbPath], {
      cwd: tmpProjectDir,
      env: {
        ...process.env,
        TX_API_HOST: "127.0.0.1",
        TX_API_PORT: String(apiPort),
        TX_DB_PATH: dbPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    apiProc.stdout.on("data", (chunk: Buffer) => {
      serverLogs += chunk.toString()
    })
    apiProc.stderr.on("data", (chunk: Buffer) => {
      serverLogs += chunk.toString()
    })

    try {
      await waitForHealth(baseUrl, apiProc)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nLogs:\n${serverLogs}`)
    }
  }, 90000)

  afterEach(() => {
    db.exec("DELETE FROM task_dependencies")
    db.exec("DELETE FROM task_claims")
    db.exec("DELETE FROM runs")
    db.exec("DELETE FROM events")
    db.exec("DELETE FROM tasks")
  })

  afterAll(async () => {
    db.close()

    if (apiProc && apiProc.exitCode === null) {
      apiProc.kill("SIGTERM")
      await Promise.race([
        new Promise<void>((resolveExit) => {
          apiProc.once("exit", () => resolveExit())
        }),
        sleep(3000),
      ])
      if (apiProc.exitCode === null) {
        apiProc.kill("SIGKILL")
      }
    }

    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("PUT/DELETE group-context propagates to show/ready/list and clears correctly", async () => {
    const parentId = taskFixtureId("parent")
    const childId = taskFixtureId("child")
    insertTask(db, parentId, "Parent task")
    insertTask(db, childId, "Child task", parentId)

    const context = "Shared rollout context"
    const setRes = await fetch(`${baseUrl}/api/tasks/${parentId}/group-context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context })
    })
    expect(setRes.status).toBe(200)
    const setPayload = await setRes.json() as SerializedTask
    expect(setPayload.id).toBe(parentId)
    expect(setPayload.groupContext).toBe(context)
    expect(setPayload.effectiveGroupContext).toBe(context)
    expect(setPayload.effectiveGroupContextSourceTaskId).toBe(parentId)
    expect(Array.isArray(setPayload.blockedBy)).toBe(true)
    expect(Array.isArray(setPayload.blocks)).toBe(true)
    expect(Array.isArray(setPayload.children)).toBe(true)
    expect(typeof setPayload.isReady).toBe("boolean")

    const showChildRes = await fetch(`${baseUrl}/api/tasks/${childId}`)
    expect(showChildRes.status).toBe(200)
    const showChildPayload = await showChildRes.json() as { task: SerializedTask }
    expect(showChildPayload.task.groupContext).toBeNull()
    expect(showChildPayload.task.effectiveGroupContext).toBe(context)
    expect(showChildPayload.task.effectiveGroupContextSourceTaskId).toBe(parentId)

    const readyRes = await fetch(`${baseUrl}/api/tasks/ready?limit=100`)
    expect(readyRes.status).toBe(200)
    const readyPayload = await readyRes.json() as { tasks: SerializedTask[] }
    const readyChild = readyPayload.tasks.find(task => task.id === childId)
    expect(readyChild).toBeDefined()
    expect(readyChild?.effectiveGroupContext).toBe(context)
    expect(readyChild?.effectiveGroupContextSourceTaskId).toBe(parentId)

    const listRes = await fetch(`${baseUrl}/api/tasks?limit=100`)
    expect(listRes.status).toBe(200)
    const listPayload = await listRes.json() as { tasks: SerializedTask[] }
    const listChild = listPayload.tasks.find(task => task.id === childId)
    expect(listChild).toBeDefined()
    expect(listChild?.effectiveGroupContext).toBe(context)
    expect(listChild?.effectiveGroupContextSourceTaskId).toBe(parentId)

    const clearRes = await fetch(`${baseUrl}/api/tasks/${parentId}/group-context`, {
      method: "DELETE"
    })
    expect(clearRes.status).toBe(200)
    const clearPayload = await clearRes.json() as SerializedTask
    expect(clearPayload.groupContext).toBeNull()
    expect(clearPayload.effectiveGroupContext).toBeNull()
    expect(clearPayload.effectiveGroupContextSourceTaskId).toBeNull()

    const showChildAfterClearRes = await fetch(`${baseUrl}/api/tasks/${childId}`)
    expect(showChildAfterClearRes.status).toBe(200)
    const showChildAfterClear = await showChildAfterClearRes.json() as { task: SerializedTask }
    expect(showChildAfterClear.task.groupContext).toBeNull()
    expect(showChildAfterClear.task.effectiveGroupContext).toBeNull()
    expect(showChildAfterClear.task.effectiveGroupContextSourceTaskId).toBeNull()
  })

  it("child-scoped context does not leak to siblings", async () => {
    const parentId = taskFixtureId("sibling-parent")
    const childAId = taskFixtureId("sibling-child-a")
    const childBId = taskFixtureId("sibling-child-b")
    insertTask(db, parentId, "Parent task")
    insertTask(db, childAId, "Child A", parentId)
    insertTask(db, childBId, "Child B", parentId)

    const context = "Child-A only context"
    const setRes = await fetch(`${baseUrl}/api/tasks/${childAId}/group-context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context })
    })
    expect(setRes.status).toBe(200)

    const parentRes = await fetch(`${baseUrl}/api/tasks/${parentId}`)
    expect(parentRes.status).toBe(200)
    const parentPayload = await parentRes.json() as { task: SerializedTask }
    expect(parentPayload.task.effectiveGroupContext).toBe(context)
    expect(parentPayload.task.effectiveGroupContextSourceTaskId).toBe(childAId)

    const siblingRes = await fetch(`${baseUrl}/api/tasks/${childBId}`)
    expect(siblingRes.status).toBe(200)
    const siblingPayload = await siblingRes.json() as { task: SerializedTask }
    expect(siblingPayload.task.groupContext).toBeNull()
    expect(siblingPayload.task.effectiveGroupContext).toBeNull()
    expect(siblingPayload.task.effectiveGroupContextSourceTaskId).toBeNull()
  })

  it("rejects oversized group-context payloads", async () => {
    const taskId = taskFixtureId("oversized")
    insertTask(db, taskId, "Oversized context task")

    const response = await fetch(`${baseUrl}/api/tasks/${taskId}/group-context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: "x".repeat(20001) })
    })

    expect(response.status).toBe(400)

    const showRes = await fetch(`${baseUrl}/api/tasks/${taskId}`)
    expect(showRes.status).toBe(200)
    const payload = await showRes.json() as { task: SerializedTask }
    expect(payload.task.groupContext).toBeNull()
    expect(payload.task.effectiveGroupContext).toBeNull()
    expect(payload.task.effectiveGroupContextSourceTaskId).toBeNull()
  })

  it("rejects invisible-only group-context payloads", async () => {
    const taskId = taskFixtureId("invisible-only")
    insertTask(db, taskId, "Invisible context task")

    const response = await fetch(`${baseUrl}/api/tasks/${taskId}/group-context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: "\u200B\u200C\u200D" })
    })

    expect(response.status).toBe(400)

    const showRes = await fetch(`${baseUrl}/api/tasks/${taskId}`)
    expect(showRes.status).toBe(200)
    const payload = await showRes.json() as { task: SerializedTask }
    expect(payload.task.groupContext).toBeNull()
    expect(payload.task.effectiveGroupContext).toBeNull()
    expect(payload.task.effectiveGroupContextSourceTaskId).toBeNull()
  })

  it("sanitizes null bytes from group-context payloads", async () => {
    const taskId = taskFixtureId("null-bytes")
    insertTask(db, taskId, "Null-byte context task")

    const response = await fetch(`${baseUrl}/api/tasks/${taskId}/group-context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: "alpha\u0000beta" })
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as SerializedTask
    expect(payload.groupContext).toBe("alphabeta")
    expect(payload.effectiveGroupContext).toBe("alphabeta")
    expect(payload.effectiveGroupContextSourceTaskId).toBe(taskId)
  })
})
