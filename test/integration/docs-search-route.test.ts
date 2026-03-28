import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Readable } from "node:stream"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DOCS_APP_DIR = resolve(ROOT, "apps/docs")

type DocsProcess = ChildProcessByStdio<null, Readable, Readable>

interface SearchResult {
  id: string
  url: string
  type: "page" | "heading" | "text"
  content: string
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

async function waitForDocsServer(baseUrl: string, proc: DocsProcess): Promise<void> {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Docs server exited early with code ${proc.exitCode}`)
    }

    try {
      const res = await fetchWithTimeout(`${baseUrl}/api/search?query=decompose`, 1_000)
      if (res.ok) return
    } catch {
      // keep polling until the server is ready
    }

    await sleep(200)
  }

  throw new Error("Timed out waiting for docs search endpoint")
}

describe("docs search route", { timeout: 180_000 }, () => {
  let docsProc: DocsProcess | undefined
  let baseUrl = ""
  let serverLogs = ""

  beforeAll(async () => {
    const build = spawnSync("bun", ["run", "build"], {
      cwd: DOCS_APP_DIR,
      encoding: "utf-8",
      timeout: 180_000,
    })

    if (build.status !== 0) {
      throw new Error(`Docs build failed:\n${build.stdout}\n${build.stderr}`)
    }

    const port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`

    docsProc = spawn("bun", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: DOCS_APP_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    docsProc.stdout.on("data", (chunk: Buffer) => {
      serverLogs += chunk.toString()
    })
    docsProc.stderr.on("data", (chunk: Buffer) => {
      serverLogs += chunk.toString()
    })

    try {
      await waitForDocsServer(baseUrl, docsProc)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nLogs:\n${serverLogs}`)
    }
  })

  afterAll(async () => {
    if (docsProc && docsProc.exitCode === null) {
      docsProc.kill("SIGTERM")
      await Promise.race([
        new Promise<void>((resolveExit) => {
          docsProc?.once("exit", () => resolveExit())
        }),
        sleep(3_000),
      ])

      if (docsProc.exitCode === null) {
        docsProc.kill("SIGKILL")
      }
    }
  })

  it("serves /api/search with JSON results instead of 404", async () => {
    const response = await fetch(`${baseUrl}/api/search?query=decompose`)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")

    const payload = await response.json() as SearchResult[]

    expect(Array.isArray(payload)).toBe(true)
    expect(payload.length).toBeGreaterThan(0)
    expect(payload.some((result) => result.url === "/docs/primitives/decompose")).toBe(true)
  })

  it("returns an empty array for an empty query", async () => {
    const response = await fetch(`${baseUrl}/api/search?query=`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })
})
