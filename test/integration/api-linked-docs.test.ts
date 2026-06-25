import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { spawnSync, spawn, type ChildProcessByStdio } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"
import type { Readable } from "node:stream"
import { Database } from "bun:sqlite"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/cli/src/api/server.ts")

type ApiProcess = ChildProcessByStdio<null, Readable, Readable>

type LinkedDocFixture = {
  docId: string
  name: string
  title: string
  kind: "prd" | "design"
  version: number
  status: "changing" | "locked"
  filePath: string
  linkType: "implements" | "references"
}

type ExecResult = {
  status: number
  stdout: string
  stderr: string
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

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
      server.close((error) => {
        if (error) rejectPort(error)
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

function insertLinkedDoc(
  db: Database,
  taskId: string,
  overrides: Partial<LinkedDocFixture> = {}
): LinkedDocFixture {
  const now = "2026-03-27T12:00:00.000Z"
  const fixture: LinkedDocFixture = {
    docId: overrides.docId ?? "doc-888888888888",
    name: overrides.name ?? "api-linked-spec",
    title: overrides.title ?? "API Linked Spec",
    kind: overrides.kind ?? "prd",
    version: overrides.version ?? 1,
    status: overrides.status ?? "changing",
    filePath: overrides.filePath ?? "specs/prd/api-linked-spec.md",
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

describe("API linked-doc responses", () => {
  let tmpProjectDir: string
  let dbPath: string
  let apiProc: ApiProcess
  let apiPort: number
  let baseUrl: string
  let serverLogs = ""
  let db: Database

  beforeAll(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-linked-docs-"))
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
    db.exec("DELETE FROM task_doc_links")
    db.exec("DELETE FROM doc_links")
    db.exec("DELETE FROM docs")
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

  it("GET /api/tasks/:id returns linkedDocs", async () => {
    const addTask = runTx(["add", "API linked docs show", "--json"], dbPath, tmpProjectDir)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    expect(runTx(["update", taskId, "--status", "ready"], dbPath, tmpProjectDir).status).toBe(0)
    const expected = insertLinkedDoc(db, taskId, {
      docId: "doc-999999999999",
      name: "api-show-prd",
      title: "API Show PRD",
      filePath: "specs/prd/api-show-prd.md",
    })

    const response = await fetchWithTimeout(`${baseUrl}/api/tasks/${taskId}`, 5000)
    expect(response.status).toBe(200)

    const payload = await response.json() as {
      task: {
        id: string
        linkedDocs: LinkedDocFixture[]
      }
    }
    expect(payload.task.id).toBe(taskId)
    expect(payload.task.linkedDocs).toEqual([expected])
  })

  it("GET /api/tasks/ready returns linkedDocs", async () => {
    const addTask = runTx(["add", "API linked docs ready", "--json"], dbPath, tmpProjectDir)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    expect(runTx(["update", taskId, "--status", "ready"], dbPath, tmpProjectDir).status).toBe(0)
    const expected = insertLinkedDoc(db, taskId, {
      docId: "doc-aaaaaaaaaaaa",
      name: "api-ready-design",
      title: "API Ready Design",
      kind: "design",
      filePath: "specs/design/api-ready-design.md",
      linkType: "references",
    })

    const response = await fetchWithTimeout(`${baseUrl}/api/tasks/ready?limit=50`, 5000)
    expect(response.status).toBe(200)

    const payload = await response.json() as {
      tasks: Array<{
        id: string
        linkedDocs: LinkedDocFixture[]
      }>
    }

    const task = payload.tasks.find((entry) => entry.id === taskId)
    expect(task).toBeDefined()
    expect(task?.linkedDocs).toEqual([expected])
  })
})
