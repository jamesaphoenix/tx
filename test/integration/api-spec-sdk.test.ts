import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { spawnSync, spawn, type ChildProcessByStdio } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"
import type { Readable } from "node:stream"
import { Database } from "bun:sqlite"
import { TxClient } from "@jamesaphoenix/tx-agent-sdk"
import { fixtureId } from "../fixtures.js"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/api-server/src/server.ts")

type ApiProcess = ChildProcessByStdio<null, Readable, Readable>

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, ms)
})

const runTx = (args: string[], cwd: string) =>
  spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
  })

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

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

describe("API + SDK spec traceability integration", () => {
  let tmpProjectDir: string
  let dbPath: string
  let db: Database
  let apiProc: ApiProcess
  let apiPort: number
  let baseUrl: string
  let serverLogs = ""

  beforeAll(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-spec-sdk-"))
    mkdirSync(join(tmpProjectDir, ".tx"), { recursive: true })
    dbPath = join(tmpProjectDir, ".tx", "tasks.db")

    const init = runTx(["init", "--db", dbPath], tmpProjectDir)
    if ((init.status ?? 1) !== 0) {
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

  beforeEach(() => {
    db.exec("DELETE FROM spec_signoffs")
    db.exec("DELETE FROM spec_test_runs")
    db.exec("DELETE FROM spec_tests")
    db.exec("DELETE FROM invariant_checks")
    db.exec("DELETE FROM invariants")
    db.exec("DELETE FROM doc_links")
    db.exec("DELETE FROM docs")
    rmSync(join(tmpProjectDir, ".tx", "docs"), { recursive: true, force: true })
    mkdirSync(join(tmpProjectDir, ".tx", "docs", "prd"), { recursive: true })
    mkdirSync(join(tmpProjectDir, ".tx", "docs", "design"), { recursive: true })
    writeFileSync(
      join(tmpProjectDir, ".tx", "config.toml"),
      ['[docs]', 'path = ".tx/docs"', "require_ears = false"].join("\n"),
      "utf8"
    )
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

  it("SDK HTTP client exposes spec discovery, mapping, scoring, batch ingestion, and completion", async () => {
    const tx = new TxClient({ apiUrl: baseUrl })
    const docName = `PRD-${fixtureId("api-spec-sdk:doc").slice(3)}`
    const invariantA = `INV-${fixtureId("api-spec-sdk:inv-a").slice(3).toUpperCase()}`
    const invariantB = `INV-${fixtureId("api-spec-sdk:inv-b").slice(3).toUpperCase()}`

    await tx.docs.create({
      kind: "prd",
      name: docName,
      title: "HTTP SDK Spec",
      yamlContent: [
        "kind: prd",
        `name: ${docName}`,
        "title: HTTP SDK Spec",
        "status: changing",
        "",
        "invariants:",
        `  - id: ${invariantA}`,
        "    rule: http sdk invariant a",
        "    enforcement: integration_test",
        `  - id: ${invariantB}`,
        "    rule: http sdk invariant b",
        "    enforcement: integration_test",
      ].join("\n"),
    })

    const discover = await tx.spec.discover({ doc: docName, patterns: ["test/**/*.ts"] })
    expect(discover.discoveredLinks).toBe(0)

    const linked = await tx.spec.link(invariantA, "test/integration/http-sdk.test.ts", "http sdk case", "vitest")
    await tx.spec.link(invariantB, "test/integration/http-sdk-junit.test.ts", "junit http sdk case", "junit")

    const tests = await tx.spec.tests(invariantA)
    expect(tests).toHaveLength(1)

    const reverse = await tx.spec.invariantsForTest(linked.testId)
    expect(reverse).toContain(invariantA)

    const run = await tx.spec.run(linked.testId, true, { durationMs: 11 })
    expect(run.recorded).toBe(1)

    const batch = await tx.spec.batch({
      from: "junit",
      raw: [
        "<testsuites>",
        '<testsuite file="test/integration/http-sdk-junit.test.ts">',
        '<testcase name="junit http sdk case" time="0.012"/>',
        "</testsuite>",
        "</testsuites>",
      ].join(""),
    })
    expect(batch.recorded).toBe(1)

    const fci = await tx.spec.fci({ doc: docName })
    expect(fci.fci).toBe(100)
    expect(fci.phase).toBe("HARDEN")

    const status = await tx.spec.status({ doc: docName })
    expect(status.phase).toBe("HARDEN")

    const matrix = await tx.spec.matrix({ doc: docName })
    expect(matrix).toHaveLength(2)

    const signoff = await tx.spec.complete({
      doc: docName,
      signedOffBy: "http-reviewer",
      notes: "ready to ship",
    })
    expect(signoff.scopeType).toBe("doc")
    expect(signoff.scopeValue).toBe(docName)
    expect(signoff.signedOffBy).toBe("http-reviewer")
  })
})
