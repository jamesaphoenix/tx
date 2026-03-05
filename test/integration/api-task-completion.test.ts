import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { spawnSync, spawn, type ChildProcessByStdio } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"
import type { Readable } from "node:stream"
import { Database } from "bun:sqlite"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/api-server/src/server.ts")

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

type ApiProcess = ChildProcessByStdio<null, Readable, Readable>

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, ms)
})

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
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
  const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

async function waitForHealth(baseUrl: string, proc: ApiProcess): Promise<void> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`API server exited early with code ${proc.exitCode}`)
    }
    try {
      const response = await fetchWithTimeout(`${baseUrl}/health`, 1000)
      if (response.ok) return
    } catch {
      // keep polling
    }
    await sleep(200)
  }

  throw new Error("Timed out waiting for API server health endpoint")
}

describe("API task completion with gate-linked task pins", () => {
  let tmpProjectDir: string
  let dbPath: string
  let apiProc: ApiProcess
  let apiPort: number
  let baseUrl: string
  let serverLogs = ""
  let db: Database

  beforeAll(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-task-completion-"))
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
    db.exec("DELETE FROM context_pins")
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

  it("POST /api/tasks/:id/done rejects gate-linked tasks by default for agent callers", async () => {
    const addTask = runTx(["add", "API done gate task", "--json"], dbPath, tmpProjectDir)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    expect(runTx(["update", taskId, "--status", "ready"], dbPath, tmpProjectDir).status).toBe(0)
    expect(runTx(["gate", "create", "docs-to-build", "--task-id", taskId], dbPath, tmpProjectDir).status).toBe(0)

    const response = await fetchWithTimeout(`${baseUrl}/api/tasks/${taskId}/done`, 5000, { method: "POST" })
    expect(response.status).toBe(400)

    const payload = await response.json() as { message: string }
    expect(payload.message).toContain("linked by gate pin")
  })

  it("POST /api/tasks/:id/done completes gate-linked tasks when x-tx-actor=human", async () => {
    const addTask = runTx(["add", "API human done gate task", "--json"], dbPath, tmpProjectDir)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    expect(runTx(["update", taskId, "--status", "ready"], dbPath, tmpProjectDir).status).toBe(0)
    expect(runTx(["gate", "create", "docs-to-build", "--task-id", taskId], dbPath, tmpProjectDir).status).toBe(0)

    const response = await fetchWithTimeout(`${baseUrl}/api/tasks/${taskId}/done`, 5000, {
      method: "POST",
      headers: { "x-tx-actor": "human" },
    })
    expect(response.status).toBe(200)

    const payload = await response.json() as {
      task: { id: string; status: string; completedAt: string | null }
      nowReady: unknown[]
    }
    expect(payload.task.id).toBe(taskId)
    expect(payload.task.status).toBe("done")
    expect(payload.task.completedAt).not.toBeNull()
    expect(Array.isArray(payload.nowReady)).toBe(true)
  })

  it("PATCH /api/tasks/:id accepts status=done for gate-linked tasks when x-tx-actor=human", async () => {
    const addTask = runTx(["add", "API patch gate task", "--json"], dbPath, tmpProjectDir)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    expect(runTx(["update", taskId, "--status", "ready"], dbPath, tmpProjectDir).status).toBe(0)
    expect(runTx(["gate", "create", "review-to-ship", "--task-id", taskId], dbPath, tmpProjectDir).status).toBe(0)

    const response = await fetchWithTimeout(`${baseUrl}/api/tasks/${taskId}`, 5000, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-tx-actor": "human",
      },
      body: JSON.stringify({ status: "done" }),
    })
    expect(response.status).toBe(200)

    const payload = await response.json() as { id: string; status: string; completedAt: string | null }
    expect(payload.id).toBe(taskId)
    expect(payload.status).toBe("done")
    expect(payload.completedAt).not.toBeNull()
  })
})
