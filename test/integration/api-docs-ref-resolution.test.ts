import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawnSync, spawn, type ChildProcessByStdio } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"
import type { Readable } from "node:stream"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/cli/src/api/server.ts")

type ApiProcess = ChildProcessByStdio<null, Readable, Readable>

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

describe("API docs ref resolution", () => {
  let tmpProjectDir: string
  let dbPath: string
  let apiProc: ApiProcess
  let apiPort: number
  let baseUrl: string
  let serverLogs = ""
  let prdDocId = ""
  let designDocId = ""

  beforeAll(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-doc-refs-"))
    dbPath = join(tmpProjectDir, "tasks.db")

    const init = runTx(["init", "--codex"], dbPath, tmpProjectDir)
    if (init.status !== 0) {
      throw new Error(`Failed to init test database: ${init.stderr || init.stdout}`)
    }

    const addPrd = runTx(
      ["doc", "add", "prd", "shared-api-doc", "--title", "Shared API PRD"],
      dbPath,
      tmpProjectDir
    )
    expect(addPrd.status).toBe(0)

    const addDesign = runTx(
      ["doc", "add", "design", "shared-api-doc", "--title", "Shared API Design"],
      dbPath,
      tmpProjectDir
    )
    expect(addDesign.status).toBe(0)

    const prdShow = runTx(["doc", "show", "prd/shared-api-doc", "--json"], dbPath, tmpProjectDir)
    const designShow = runTx(["doc", "show", "design/shared-api-doc", "--json"], dbPath, tmpProjectDir)
    expect(prdShow.status).toBe(0)
    expect(designShow.status).toBe(0)

    prdDocId = (JSON.parse(prdShow.stdout) as { docId: string }).docId
    designDocId = (JSON.parse(designShow.stdout) as { docId: string }).docId

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

  afterAll(async () => {
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

  it("rejects ambiguous bare doc refs and resolves scoped refs and doc ids", async () => {
    const ambiguousRes = await fetchWithTimeout(`${baseUrl}/api/docs/shared-api-doc`, 5000)
    expect(ambiguousRes.status).toBe(400)
    const ambiguousPayload = await ambiguousRes.json() as { message: string }
    expect(ambiguousPayload.message).toContain("ambiguous across kinds")
    expect(ambiguousPayload.message).toContain("Use kind/name or doc_id instead")

    const scopedRes = await fetchWithTimeout(`${baseUrl}/api/docs/${encodeURIComponent("prd/shared-api-doc")}`, 5000)
    expect(scopedRes.status).toBe(200)
    const scopedPayload = await scopedRes.json() as { docId: string; name: string; kind: string }
    expect(scopedPayload).toMatchObject({
      docId: prdDocId,
      name: "shared-api-doc",
      kind: "prd",
    })

    const byIdRes = await fetchWithTimeout(`${baseUrl}/api/docs/${prdDocId}`, 5000)
    expect(byIdRes.status).toBe(200)
    const byIdPayload = await byIdRes.json() as { docId: string; name: string; kind: string }
    expect(byIdPayload).toMatchObject({
      docId: prdDocId,
      name: "shared-api-doc",
      kind: "prd",
    })

    const sourceRes = await fetchWithTimeout(
      `${baseUrl}/api/docs/${encodeURIComponent("design/shared-api-doc")}/source`,
      5000
    )
    expect(sourceRes.status).toBe(200)
    const sourcePayload = await sourceRes.json() as { docId: string; name: string; version: number; content: string | null }
    expect(sourcePayload).toMatchObject({
      docId: designDocId,
      name: "shared-api-doc",
      version: 1,
    })
    expect(typeof sourcePayload.content).toBe("string")
  })

  it("accepts scoped refs in render payloads", async () => {
    const renderRes = await fetchWithTimeout(`${baseUrl}/api/docs/render`, 5000, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "prd/shared-api-doc" }),
    })
    expect(renderRes.status).toBe(200)
    const renderPayload = await renderRes.json() as { rendered: string[] }
    expect(renderPayload.rendered.length).toBeGreaterThan(0)
    expect(renderPayload.rendered[0]).toContain("# Summary")
  })
})
