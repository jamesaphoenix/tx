import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/api-server/src/server.ts")
const SYNC_MAX_BYTES = 10 * 1024 * 1024

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

interface SyncExportResponse {
  eventCount: number
  streamId: string
  path: string
}

interface SyncImportResponse {
  importedEvents: number
  appliedEvents: number
  streamCount: number
}

interface SyncHydrateResponse extends SyncImportResponse {
  rebuilt: boolean
}

interface SyncStreamResponse {
  streamId: string
  nextSeq: number
  lastSeq: number
  eventsDir: string
  configPath: string
  knownStreams: Array<{ streamId: string; lastSeq: number; lastEventAt: string | null }>
}

interface SyncStatusResponse {
  dbTaskCount: number
  eventOpCount: number
  lastExport: string | null
  lastImport: string | null
  isDirty: boolean
  autoSyncEnabled: boolean
}

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
    timeout: 30000,
  })

  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

async function waitForHealth(baseUrl: string, proc: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`API server exited early with code ${proc.exitCode}`)
    }
    try {
      const res = await fetchWithTimeout(`${baseUrl}/health`, 1000)
      if (res.ok) return
    } catch {
      // Keep polling until deadline.
    }
    await sleep(200)
  }

  throw new Error("Timed out waiting for API server health endpoint")
}

function writeTaskUpsertEvent(params: {
  cwd: string
  streamId: string
  eventId: string
  seq: number
  ts: string
  taskId: string
  title: string
  description: string
}) {
  const eventsDir = resolve(params.cwd, ".tx", "streams", params.streamId)
  mkdirSync(eventsDir, { recursive: true })
  writeFileSync(
    resolve(eventsDir, "events-2026-03-05.jsonl"),
    `${JSON.stringify({
      event_id: params.eventId,
      stream_id: params.streamId,
      seq: params.seq,
      ts: params.ts,
      type: "task.upsert",
      entity_id: params.taskId,
      v: 2,
      payload: {
        v: 1,
        op: "upsert",
        ts: params.ts,
        eventId: params.eventId,
        id: params.taskId,
        data: {
          title: params.title,
          description: params.description,
          status: "backlog",
          score: 100,
          parentId: null,
          metadata: {},
        },
      },
    })}\n`,
    "utf-8"
  )
}

function writeDocTraversalEvent(params: { cwd: string; streamId: string; eventId: string }) {
  const eventsDir = resolve(params.cwd, ".tx", "streams", params.streamId)
  mkdirSync(eventsDir, { recursive: true })
  writeFileSync(
    resolve(eventsDir, "events-2026-03-05.jsonl"),
    `${JSON.stringify({
      event_id: params.eventId,
      stream_id: params.streamId,
      seq: 1,
      ts: "2026-03-05T12:00:00Z",
      type: "doc.upsert",
      entity_id: "unsafe-doc:1",
      v: 2,
      payload: {
        v: 1,
        op: "doc_upsert",
        ts: "2026-03-05T12:00:00Z",
        id: 1,
        contentHash: "unsafe-doc-content-hash",
        data: {
          kind: "prd",
          name: "unsafe-doc",
          title: "Unsafe Doc",
          version: 1,
          status: "changing",
          filePath: "../../../../../etc/passwd",
          hash: "unsafe-doc-version-hash",
          parentDocKey: null,
          lockedAt: null,
          metadata: {},
        },
      },
    })}\n`,
    "utf-8"
  )
}

function writeDocNameTraversalEvent(params: { cwd: string; streamId: string; eventId: string }) {
  const eventsDir = resolve(params.cwd, ".tx", "streams", params.streamId)
  mkdirSync(eventsDir, { recursive: true })
  writeFileSync(
    resolve(eventsDir, "events-2026-03-05.jsonl"),
    `${JSON.stringify({
      event_id: params.eventId,
      stream_id: params.streamId,
      seq: 1,
      ts: "2026-03-05T12:01:00Z",
      type: "doc.upsert",
      entity_id: "unsafe-name-doc:1",
      v: 2,
      payload: {
        v: 1,
        op: "doc_upsert",
        ts: "2026-03-05T12:01:00Z",
        id: 1,
        contentHash: "unsafe-name-doc-content-hash",
        data: {
          kind: "prd",
          name: "../../unsafe-name-doc",
          title: "Unsafe name doc",
          version: 1,
          status: "changing",
          filePath: "prd/unsafe-name-doc.yml",
          hash: "unsafe-name-doc-version-hash",
          parentDocKey: null,
          lockedAt: null,
          metadata: {},
        },
      },
    })}\n`,
    "utf-8"
  )
}

describe("API sync HTTP integration", () => {
  let tmpProjectDir = ""
  let dbPath = ""
  let apiProc: ChildProcess | null = null
  let apiPort = 0
  let baseUrl = ""
  let serverLogs = ""

  const stopServer = async (): Promise<void> => {
    if (apiProc && apiProc.exitCode === null) {
      apiProc.kill("SIGTERM")
      await Promise.race([
        new Promise<void>((resolveExit) => {
          apiProc?.once("exit", () => resolveExit())
        }),
        sleep(3000),
      ])
      if (apiProc.exitCode === null) {
        apiProc.kill("SIGKILL")
      }
    }
    apiProc = null
  }

  const startServer = async (apiKey?: string): Promise<void> => {
    apiPort = await getFreePort()
    baseUrl = `http://127.0.0.1:${apiPort}`
    serverLogs = ""

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TX_API_HOST: "127.0.0.1",
      TX_API_PORT: String(apiPort),
      TX_DB_PATH: dbPath,
    }

    if (apiKey) {
      env.TX_API_KEY = apiKey
    } else {
      delete env.TX_API_KEY
    }

    apiProc = spawn("bun", [API_SERVER_SRC, "--host", "127.0.0.1", "--port", String(apiPort), "--db", dbPath], {
      cwd: tmpProjectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    apiProc.stdout?.on("data", (chunk: Buffer) => {
      serverLogs += chunk.toString()
    })
    apiProc.stderr?.on("data", (chunk: Buffer) => {
      serverLogs += chunk.toString()
    })

    try {
      if (!apiProc) {
        throw new Error("Failed to start API server")
      }
      await waitForHealth(baseUrl, apiProc)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nLogs:\n${serverLogs}`)
    }
  }

  beforeEach(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-sync-http-"))
    dbPath = join(tmpProjectDir, "tasks.db")

    const init = runTx(["init"], dbPath, tmpProjectDir)
    if (init.status !== 0) {
      throw new Error(`Failed to init test database: ${init.stderr || init.stdout}`)
    }

    await startServer()
  }, 90000)

  afterEach(async () => {
    await stopServer()

    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("GET /api/sync/stream and /api/sync/status return stream identity and status fields", async () => {
    const streamRes = await fetch(`${baseUrl}/api/sync/stream`)
    expect(streamRes.status).toBe(200)
    const stream = await streamRes.json() as SyncStreamResponse

    expect(stream.streamId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(stream.nextSeq).toBeGreaterThanOrEqual(1)
    expect(stream.lastSeq).toBeGreaterThanOrEqual(0)
    expect(existsSync(stream.eventsDir)).toBe(true)
    expect(existsSync(stream.configPath)).toBe(true)
    expect(Array.isArray(stream.knownStreams)).toBe(true)

    const statusRes = await fetch(`${baseUrl}/api/sync/status`)
    expect(statusRes.status).toBe(200)
    const status = await statusRes.json() as SyncStatusResponse

    expect(typeof status.dbTaskCount).toBe("number")
    expect(typeof status.eventOpCount).toBe("number")
    expect(status).not.toHaveProperty("jsonlOpCount")
    expect(typeof status.autoSyncEnabled).toBe("boolean")
  })

  it("POST /api/sync/export writes stream events", async () => {
    const add = runTx(["add", "API sync export task", "--json"], dbPath, tmpProjectDir)
    expect(add.status).toBe(0)

    const exportRes = await fetch(`${baseUrl}/api/sync/export`, { method: "POST" })
    expect(exportRes.status).toBe(200)
    const payload = await exportRes.json() as SyncExportResponse

    expect(payload.eventCount).toBeGreaterThan(0)
    expect(payload.streamId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(existsSync(payload.path)).toBe(true)

    const lines = readFileSync(payload.path, "utf-8").trim().split("\n").filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    const parsed = JSON.parse(lines[0]) as { v: number; stream_id: string; seq: number }
    expect(parsed.v).toBe(2)
    expect(parsed.stream_id).toBe(payload.streamId)
    expect(parsed.seq).toBeGreaterThan(0)
  })

  it("POST /api/sync/import applies stream events and creates tasks", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FC4"
    const taskId = "tx-syncapi"
    writeTaskUpsertEvent({
      cwd: tmpProjectDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FC5",
      seq: 1,
      ts: "2026-03-05T12:30:00Z",
      taskId,
      title: "Imported through API sync",
      description: "",
    })

    const importRes = await fetch(`${baseUrl}/api/sync/import`, { method: "POST" })
    expect(importRes.status).toBe(200)
    const payload = await importRes.json() as SyncImportResponse
    expect(payload.streamCount).toBeGreaterThanOrEqual(1)
    expect(payload.importedEvents).toBeGreaterThanOrEqual(1)
    expect(payload.appliedEvents).toBeGreaterThanOrEqual(1)

    const shown = runTx(["show", taskId, "--json"], dbPath, tmpProjectDir)
    expect(shown.status).toBe(0)
    const task = JSON.parse(shown.stdout) as { id: string; title: string }
    expect(task.id).toBe(taskId)
    expect(task.title).toBe("Imported through API sync")
  })

  it("POST /api/sync/import rejects traversal doc paths and keeps stream progress unchanged", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FC8"
    writeDocTraversalEvent({
      cwd: tmpProjectDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FC9",
    })

    const importRes = await fetch(`${baseUrl}/api/sync/import`, { method: "POST" })
    expect(importRes.status).toBe(400)
    const body = await importRes.text()
    expect(body.toLowerCase()).toContain("filepath")

    const streamRes = await fetch(`${baseUrl}/api/sync/stream`)
    expect(streamRes.status).toBe(200)
    const stream = await streamRes.json() as SyncStreamResponse
    expect(stream.knownStreams.some(item => item.streamId === streamId)).toBe(false)
  })

  it("POST /api/sync/import rejects traversal doc names and keeps stream progress unchanged", async () => {
    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FDC"
    writeDocNameTraversalEvent({
      cwd: tmpProjectDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FDD",
    })

    const importRes = await fetch(`${baseUrl}/api/sync/import`, { method: "POST" })
    expect(importRes.status).toBe(400)

    const streamRes = await fetch(`${baseUrl}/api/sync/stream`)
    expect(streamRes.status).toBe(200)
    const stream = await streamRes.json() as SyncStreamResponse
    expect(stream.knownStreams.some(item => item.streamId === streamId)).toBe(false)
  })

  it("sync POST endpoints reject oversized request bodies", async () => {
    const oversizedBody = JSON.stringify({ raw: "x".repeat(SYNC_MAX_BYTES + 128) })
    const syncPostRoutes = ["/api/sync/export", "/api/sync/import", "/api/sync/hydrate"]

    for (const route of syncPostRoutes) {
      const res = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversizedBody,
      })

      expect([413, 431]).toContain(res.status)

      if (res.status === 413) {
        const payload = await res.json() as { error?: { code?: string } }
        expect(payload.error?.code).toBe("PAYLOAD_TOO_LARGE")
      } else {
        // Node may reject extremely large payload headers before middleware.
        await res.text()
      }
    }
  })

  it("all sync endpoints enforce API key auth when TX_API_KEY is configured", async () => {
    await stopServer()
    await startServer("sync-test-secret")

    const syncRoutes: Array<{ method: "GET" | "POST"; path: string }> = [
      { method: "GET", path: "/api/sync/status" },
      { method: "GET", path: "/api/sync/stream" },
      { method: "POST", path: "/api/sync/export" },
      { method: "POST", path: "/api/sync/import" },
      { method: "POST", path: "/api/sync/hydrate" },
    ]

    for (const route of syncRoutes) {
      const missingRes = await fetch(`${baseUrl}${route.path}`, { method: route.method })
      expect(missingRes.status).toBe(401)
      const missingPayload = await missingRes.json() as { error?: { code?: string } }
      expect(missingPayload.error?.code).toBe("UNAUTHORIZED")

      const wrongRes = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { "x-api-key": "wrong-secret" },
      })
      expect(wrongRes.status).toBe(403)
      const wrongPayload = await wrongRes.json() as { error?: { code?: string } }
      expect(wrongPayload.error?.code).toBe("FORBIDDEN")

      const okRes = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { "x-api-key": "sync-test-secret" },
      })
      expect(okRes.status).toBe(200)
    }
  })

  it("POST /api/sync/hydrate rolls back on invalid events and preserves existing tasks", async () => {
    const created = runTx(["add", "Existing hydrate baseline", "--json"], dbPath, tmpProjectDir)
    expect(created.status).toBe(0)
    const existingTask = JSON.parse(created.stdout) as { id: string; title: string }

    const streamId = "01ARZ3NDEKTSV4RRFFQ69G5FDE"
    const taskId = "tx-synchd"
    writeTaskUpsertEvent({
      cwd: tmpProjectDir,
      streamId,
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FDF",
      seq: 1,
      ts: "2026-03-05T12:35:00Z",
      taskId,
      title: "Invalid hydrate import",
      description: "",
    })

    const streamFile = resolve(tmpProjectDir, ".tx", "streams", streamId, "events-2026-03-05.jsonl")
    const parsed = JSON.parse(readFileSync(streamFile, "utf-8").trim()) as {
      payload: { data: { description: string | null } }
    }
    parsed.payload.data.description = null
    writeFileSync(streamFile, `${JSON.stringify(parsed)}\n`, "utf-8")

    const hydrateRes = await fetch(`${baseUrl}/api/sync/hydrate`, { method: "POST" })
    expect(hydrateRes.status).toBe(400)

    const baseline = runTx(["show", existingTask.id, "--json"], dbPath, tmpProjectDir)
    expect(baseline.status).toBe(0)
    const baselineTask = JSON.parse(baseline.stdout) as { title: string }
    expect(baselineTask.title).toBe(existingTask.title)

    const imported = runTx(["show", taskId, "--json"], dbPath, tmpProjectDir)
    expect(imported.status).not.toBe(0)
  })

  it("POST /api/sync/hydrate rebuilds deleted tasks from stream event logs", async () => {
    const add = runTx(["add", "Hydrate me from API", "--json"], dbPath, tmpProjectDir)
    expect(add.status).toBe(0)
    const created = JSON.parse(add.stdout) as { id: string; title: string }

    const exported = await fetch(`${baseUrl}/api/sync/export`, { method: "POST" })
    expect(exported.status).toBe(200)

    const deleted = runTx(["delete", created.id], dbPath, tmpProjectDir)
    expect(deleted.status).toBe(0)

    const missing = runTx(["show", created.id, "--json"], dbPath, tmpProjectDir)
    expect(missing.status).not.toBe(0)

    const hydrateRes = await fetch(`${baseUrl}/api/sync/hydrate`, { method: "POST" })
    expect(hydrateRes.status).toBe(200)
    const payload = await hydrateRes.json() as SyncHydrateResponse
    expect(payload.rebuilt).toBe(true)
    expect(payload.appliedEvents).toBeGreaterThan(0)

    const restored = runTx(["show", created.id, "--json"], dbPath, tmpProjectDir)
    expect(restored.status).toBe(0)
    const task = JSON.parse(restored.stdout) as { title: string }
    expect(task.title).toBe(created.title)
  })
})
