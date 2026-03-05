import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process"
import { createServer } from "node:net"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Readable } from "node:stream"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/api-server/src/server.ts")
const SPEC_BATCH_MAX_BYTES = 5 * 1024 * 1024
const SPEC_BATCH_MAX_RECORDS = 50_000

interface ExecResult {
  status: number
  stdout: string
  stderr: string
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
      // Keep polling until deadline.
    }
    await sleep(200)
  }
  throw new Error("Timed out waiting for API server health endpoint")
}

describe("API spec batch HTTP integration", () => {
  let tmpProjectDir: string
  let dbPath: string
  let apiProc: ApiProcess
  let apiPort: number
  let baseUrl: string
  let serverLogs = ""

  beforeAll(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-spec-trace-http-"))
    dbPath = join(tmpProjectDir, "tasks.db")

    const init = runTx(["init"], dbPath, tmpProjectDir)
    if (init.status !== 0) {
      throw new Error(`Failed to init test database: ${init.stderr || init.stdout}`)
    }

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

  it("defaults to generic parser when from is omitted for /api/spec/batch", async () => {
    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: JSON.stringify([{ testId: "missing::api-default-from", passed: true }]),
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { received: number; recorded: number; unmatched: string[] }
    expect(body.received).toBe(1)
    expect(body.recorded).toBe(0)
    expect(body.unmatched).toEqual(["missing::api-default-from"])
  })

  it("normalizes from values with whitespace/case for /api/spec/batch", async () => {
    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "  JUNIT  ",
        raw: "<testsuite><testcase name=\"api-normalized-from\"/></testsuite>",
      }),
    })

    const rawBody = await res.text()
    if (res.status !== 200) {
      throw new Error(`Expected 200 but received ${res.status}: ${rawBody}`)
    }
    const body = JSON.parse(rawBody) as { received: number; recorded: number; unmatched: string[] }
    expect(body.received).toBe(1)
    expect(body.recorded).toBe(0)
    expect(body.unmatched).toEqual(["junit::api-normalized-from"])
  })

  it("returns BadRequest for invalid 'from' when results are provided", async () => {
    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "definitely-invalid",
        results: [
          {
            testId: "missing::api-invalid-from-results",
            passed: true,
          },
        ],
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("from")
  })

  it("returns BadRequest for invalid 'from' when raw is supplied", async () => {
    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "definitely-invalid",
        raw: "[]",
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("Invalid 'from' value")
    expect(body).toContain("definitely-invalid")
  })

  it("rejects mixed raw+results payloads for /api/spec/batch", async () => {
    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "generic",
        raw: JSON.stringify([{ testId: "missing::from-raw", passed: true }]),
        results: [
          {
            testId: "missing::from-results",
            passed: true,
          },
        ],
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("Provide either 'raw' + optional 'from', or 'results' (not both).")
  })

  it("returns BadRequest for malformed junit XML in /api/spec/batch", async () => {
    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "junit",
        raw: "<testsuite><testcase name=\"broken\"></testsuite>",
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("Invalid JUnit XML input")
  })

  it("rejects oversized normalized result sets for /api/spec/batch", async () => {
    const oversizedResults = Array.from({ length: SPEC_BATCH_MAX_RECORDS + 1 }, (_, i) => ({
      testId: `missing::${i}`,
      passed: true,
    }))

    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        results: oversizedResults,
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain(String(SPEC_BATCH_MAX_RECORDS))
  })

  it("enforces API body-size limit for /api/spec/batch", async () => {
    const oversizedRaw = "x".repeat(SPEC_BATCH_MAX_BYTES + 64)

    const res = await fetch(`${baseUrl}/api/spec/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "junit",
        raw: oversizedRaw,
      }),
    })

    expect(res.status).toBe(413)
    const body = await res.json() as { error?: { code?: string; message?: string } }
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE")
  })
})
