import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { spawnSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:net"
import { Database } from "bun:sqlite"
import { fixtureId } from "../fixtures.js"
import { TxClient } from "@jamesaphoenix/tx-agent-sdk"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const API_SERVER_SRC = resolve(__dirname, "../../apps/api-server/src/server.ts")

const runFixtureId = (name: string): string => `run-${fixtureId(`api-runs-heartbeat:${name}`).slice(3)}`
const taskFixtureId = (name: string): string => fixtureId(`api-runs-heartbeat:${name}`)

interface ExecResult {
  status: number
  stdout: string
  stderr: string
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
    timeout: 20000,
  })
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

async function waitForHealth(baseUrl: string, proc: ChildProcessWithoutNullStreams): Promise<void> {
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

function insertTask(db: Database, taskId: string, status: string = "active"): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, NULL, 500, ?, ?, NULL, '{}')`
  ).run(taskId, `Task ${taskId}`, "API heartbeat integration task", status, now, now)
}

function insertRun(
  db: Database,
  runId: string,
  taskId: string | null = null,
  startedAt: string = new Date().toISOString()
): void {
  db.prepare(
    `INSERT INTO runs (id, task_id, agent, started_at, status, pid, metadata)
     VALUES (?, ?, 'tx-implementer', ?, 'running', NULL, '{}')`
  ).run(runId, taskId, startedAt)
}

describe("API + SDK run heartbeat integration", () => {
  let tmpProjectDir: string
  let dbPath: string
  let db: Database
  let apiProc: ChildProcessWithoutNullStreams
  let apiPort: number
  let baseUrl: string
  let serverLogs = ""

  beforeAll(async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-api-runs-heartbeat-"))
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
    db.exec("DELETE FROM run_heartbeat_state")
    db.exec("DELETE FROM runs")
    db.exec("DELETE FROM task_dependencies")
    db.exec("DELETE FROM tasks")
    db.exec("DELETE FROM events")
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

  it("POST /api/runs/:id/heartbeat persists heartbeat state", async () => {
    const runId = runFixtureId("api-heartbeat")
    const checkAt = "2026-02-20T20:00:00.000Z"
    const activityAt = "2026-02-20T19:58:00.000Z"
    insertRun(db, runId)

    const res = await fetch(`${baseUrl}/api/runs/${runId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stdoutBytes: 120,
        stderrBytes: 7,
        transcriptBytes: 2048,
        deltaBytes: 256,
        checkAt,
        activityAt,
      }),
    })

    expect(res.status).toBe(200)
    const payload = await res.json() as {
      runId: string
      stdoutBytes: number
      stderrBytes: number
      transcriptBytes: number
      deltaBytes: number
      checkAt: string
      activityAt: string | null
    }

    expect(payload.runId).toBe(runId)
    expect(payload.stdoutBytes).toBe(120)
    expect(payload.stderrBytes).toBe(7)
    expect(payload.transcriptBytes).toBe(2048)
    expect(payload.deltaBytes).toBe(256)
    expect(payload.checkAt).toBe(checkAt)
    expect(payload.activityAt).toBe(activityAt)

    const row = db.prepare(
      `SELECT last_check_at, last_activity_at, stdout_bytes, stderr_bytes, transcript_bytes, last_delta_bytes
       FROM run_heartbeat_state
       WHERE run_id = ?`
    ).get(runId) as {
      last_check_at: string
      last_activity_at: string
      stdout_bytes: number
      stderr_bytes: number
      transcript_bytes: number
      last_delta_bytes: number
    } | null

    expect(row).not.toBeNull()
    expect(row?.last_check_at).toBe(checkAt)
    expect(row?.last_activity_at).toBe(activityAt)
    expect(row?.stdout_bytes).toBe(120)
    expect(row?.stderr_bytes).toBe(7)
    expect(row?.transcript_bytes).toBe(2048)
    expect(row?.last_delta_bytes).toBe(256)
  })

  it("GET /api/runs/:id returns messages, logs payload, and source-path metadata", async () => {
    const runId = runFixtureId("api-run-detail-logs")
    const now = new Date().toISOString()
    const runLogsDir = join(tmpProjectDir, ".tx", "runs")
    mkdirSync(runLogsDir, { recursive: true })

    const transcriptPath = join(runLogsDir, `${runId}.jsonl`)
    const stdoutPath = join(runLogsDir, `${runId}.stdout`)
    const stderrPath = join(runLogsDir, `${runId}.stderr`)
    const contextPath = join(runLogsDir, `${runId}.context.md`)

    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "show status" },
          timestamp: now,
          uuid: "tx-run-detail-user",
        }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "status ready" }] },
          timestamp: now,
          uuid: "tx-run-detail-assistant",
        }),
      ].join("\n")
    )
    writeFileSync(stdoutPath, "stdout line 1\nstdout line 2\n")
    writeFileSync(stderrPath, "stderr line 1\n")
    writeFileSync(contextPath, "context payload")

    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, pid, transcript_path, stdout_path, stderr_path, context_injected, metadata)
       VALUES (?, NULL, 'tx-implementer', ?, 'running', NULL, ?, ?, ?, ?, '{}')`
    ).run(runId, now, transcriptPath, stdoutPath, stderrPath, contextPath)

    const res = await fetch(`${baseUrl}/api/runs/${runId}`)
    expect(res.status).toBe(200)

    const payload = await res.json() as {
      run: {
        id: string
        transcriptPath: string | null
        stdoutPath: string | null
        stderrPath: string | null
        contextInjected: string | null
      }
      messages: Array<{ role: string; content: unknown }>
      logs: {
        stdout: string | null
        stderr: string | null
        stdoutTruncated: boolean
        stderrTruncated: boolean
      }
    }

    expect(payload.run.id).toBe(runId)
    expect(payload.run.transcriptPath).toBe(transcriptPath)
    expect(payload.run.stdoutPath).toBe(stdoutPath)
    expect(payload.run.stderrPath).toBe(stderrPath)
    expect(payload.run.contextInjected).toBe(contextPath)
    expect(payload.messages.length).toBe(2)
    expect(payload.logs.stdout).toContain("stdout line 1")
    expect(payload.logs.stderr).toContain("stderr line 1")
    expect(payload.logs.stdoutTruncated).toBe(false)
    expect(payload.logs.stderrTruncated).toBe(false)
  })

  it("GET /api/runs/:id truncates oversized logs and ignores invalid log paths safely", async () => {
    const runId = runFixtureId("api-run-detail-truncation")
    const now = new Date().toISOString()
    const runLogsDir = join(tmpProjectDir, ".tx", "runs")
    mkdirSync(runLogsDir, { recursive: true })

    const stdoutPath = join(runLogsDir, `${runId}.stdout`)
    const outsideStderrPath = join(tmpProjectDir, "..", `${runId}.stderr`)
    const stdoutPrefix = "trim-from-start\n"
    const stdoutTail = "keep-tail-marker\n"

    writeFileSync(stdoutPath, `${stdoutPrefix}${"x".repeat(250_000)}${stdoutTail}`)

    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, pid, transcript_path, stdout_path, stderr_path, context_injected, metadata)
       VALUES (?, NULL, 'tx-implementer', ?, 'failed', NULL, NULL, ?, ?, NULL, '{}')`
    ).run(runId, now, stdoutPath, outsideStderrPath)

    const res = await fetch(`${baseUrl}/api/runs/${runId}`)
    expect(res.status).toBe(200)

    const payload = await res.json() as {
      run: {
        status: string
        stdoutPath: string | null
        stderrPath: string | null
      }
      logs: {
        stdout: string | null
        stderr: string | null
        stdoutTruncated: boolean
        stderrTruncated: boolean
      }
    }

    expect(payload.run.status).toBe("failed")
    expect(payload.run.stdoutPath).toBe(stdoutPath)
    expect(payload.run.stderrPath).toBe(outsideStderrPath)
    expect(payload.logs.stdout).not.toBeNull()
    expect(payload.logs.stdout?.length).toBe(200_000)
    expect(payload.logs.stdout).not.toContain(stdoutPrefix)
    expect(payload.logs.stdout?.endsWith(stdoutTail)).toBe(true)
    expect(payload.logs.stdoutTruncated).toBe(true)
    expect(payload.logs.stderr).toBeNull()
    expect(payload.logs.stderrTruncated).toBe(false)
  })

  it("GET /api/runs/:id returns safe empty messages/logs when transcript and log files are missing", async () => {
    const runId = runFixtureId("api-run-detail-missing-log")
    const now = new Date().toISOString()
    const runLogsDir = join(tmpProjectDir, ".tx", "runs")
    mkdirSync(runLogsDir, { recursive: true })

    const missingTranscriptPath = join(runLogsDir, `${runId}.jsonl`)
    const missingStdoutPath = join(runLogsDir, `${runId}.stdout`)
    const missingStderrPath = join(runLogsDir, `${runId}.stderr`)

    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, pid, transcript_path, stdout_path, stderr_path, context_injected, metadata)
       VALUES (?, NULL, 'tx-implementer', ?, 'failed', NULL, ?, ?, ?, NULL, '{}')`
    ).run(runId, now, missingTranscriptPath, missingStdoutPath, missingStderrPath)

    const res = await fetch(`${baseUrl}/api/runs/${runId}`)
    expect(res.status).toBe(200)

    const payload = await res.json() as {
      run: {
        transcriptPath: string | null
        stdoutPath: string | null
        stderrPath: string | null
      }
      messages: Array<{ role: string; content: unknown }>
      logs: {
        stdout: string | null
        stderr: string | null
        stdoutTruncated: boolean
        stderrTruncated: boolean
      }
    }

    expect(payload.run.transcriptPath).toBe(missingTranscriptPath)
    expect(payload.run.stdoutPath).toBe(missingStdoutPath)
    expect(payload.run.stderrPath).toBe(missingStderrPath)
    expect(payload.messages).toEqual([])
    expect(payload.logs.stdout).toBeNull()
    expect(payload.logs.stderr).toBeNull()
    expect(payload.logs.stdoutTruncated).toBe(false)
    expect(payload.logs.stderrTruncated).toBe(false)
  })

  it("GET /api/runs/:id treats unreadable transcript/stdout/stderr paths as empty without crashing", async () => {
    const runId = runFixtureId("api-run-detail-unreadable-paths")
    const now = new Date().toISOString()
    const runLogsDir = join(tmpProjectDir, ".tx", "runs")
    mkdirSync(runLogsDir, { recursive: true })

    const transcriptPath = join(runLogsDir, `${runId}.jsonl`)
    const stdoutPath = join(runLogsDir, `${runId}.stdout`)
    const stderrPath = join(runLogsDir, `${runId}.stderr`)

    // Directories are readable but not valid file payloads, forcing EISDIR read failures.
    mkdirSync(transcriptPath)
    mkdirSync(stdoutPath)
    mkdirSync(stderrPath)

    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, pid, transcript_path, stdout_path, stderr_path, context_injected, metadata)
       VALUES (?, NULL, 'tx-implementer', ?, 'failed', NULL, ?, ?, ?, NULL, '{}')`
    ).run(runId, now, transcriptPath, stdoutPath, stderrPath)

    const res = await fetch(`${baseUrl}/api/runs/${runId}`)
    expect(res.status).toBe(200)

    const payload = await res.json() as {
      run: {
        status: string
        transcriptPath: string | null
        stdoutPath: string | null
        stderrPath: string | null
      }
      messages: Array<{ role: string; content: unknown }>
      logs: {
        stdout: string | null
        stderr: string | null
        stdoutTruncated: boolean
        stderrTruncated: boolean
      }
    }

    expect(payload.run.status).toBe("failed")
    expect(payload.run.transcriptPath).toBe(transcriptPath)
    expect(payload.run.stdoutPath).toBe(stdoutPath)
    expect(payload.run.stderrPath).toBe(stderrPath)
    expect(payload.messages).toEqual([])
    expect(payload.logs.stdout).toBeNull()
    expect(payload.logs.stderr).toBeNull()
    expect(payload.logs.stdoutTruncated).toBe(false)
    expect(payload.logs.stderrTruncated).toBe(false)
  })

  it("GET /api/runs/:id preserves logs payload and transcript-only logCapture metadata for failed scan/cycle runs", async () => {
    const scanRunId = runFixtureId("api-run-detail-failed-scan")
    const cycleRunId = runFixtureId("api-run-detail-failed-cycle")
    const now = new Date().toISOString()
    const runLogsDir = join(tmpProjectDir, ".tx", "logs")
    mkdirSync(runLogsDir, { recursive: true })

    const scanTranscriptPath = join(runLogsDir, `${scanRunId}.jsonl`)
    const cycleTranscriptPath = join(runLogsDir, `${cycleRunId}.jsonl`)

    writeFileSync(
      scanTranscriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "scan failed without stdio capture" }] },
        timestamp: now,
      })}\n`
    )
    writeFileSync(
      cycleTranscriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "cycle failed without stdio capture" }] },
        timestamp: now,
      })}\n`
    )

    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, pid, transcript_path, stdout_path, stderr_path, context_injected, metadata)
       VALUES (?, NULL, 'scan-agent-1', ?, 'failed', NULL, ?, NULL, NULL, NULL, ?)`
    ).run(
      scanRunId,
      now,
      scanTranscriptPath,
      JSON.stringify({
        type: "scan",
        cycle: 9,
        round: 1,
        cycleRunId,
        logCapture: {
          mode: "transcript_only",
          reason: "failed_without_stdio_capture",
          stdout: { path: null, state: "not_reported", reason: "path_not_reported" },
          stderr: { path: null, state: "not_reported", reason: "path_not_reported" },
          failureReason: "authentication_failed",
          updatedAt: now,
        },
      })
    )

    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, pid, transcript_path, stdout_path, stderr_path, context_injected, metadata)
       VALUES (?, NULL, 'cycle-scanner', ?, 'failed', NULL, ?, NULL, NULL, NULL, ?)`
    ).run(
      cycleRunId,
      now,
      cycleTranscriptPath,
      JSON.stringify({
        type: "cycle",
        cycle: 9,
        name: "failed cycle",
        description: "cycle failure example",
        logCapture: {
          mode: "transcript_only",
          reason: "failed_without_stdio_capture",
          stdout: { path: null, state: "not_reported", reason: "path_not_reported" },
          stderr: { path: null, state: "not_reported", reason: "path_not_reported" },
          failureReason: "authentication_failed",
          updatedAt: now,
        },
      })
    )

    const scanResponse = await fetch(`${baseUrl}/api/runs/${scanRunId}`)
    expect(scanResponse.status).toBe(200)
    const scanPayload = await scanResponse.json() as {
      run: {
        agent: string
        transcriptPath: string | null
        stdoutPath: string | null
        stderrPath: string | null
        metadata: {
          logCapture?: { mode?: string; reason?: string; failureReason?: string | null }
        }
      }
      logs: {
        stdout: string | null
        stderr: string | null
        stdoutTruncated: boolean
        stderrTruncated: boolean
      }
    }

    expect(scanPayload.run.agent).toBe("scan-agent-1")
    expect(scanPayload.run.transcriptPath).toBe(scanTranscriptPath)
    expect(scanPayload.run.stdoutPath).toBeNull()
    expect(scanPayload.run.stderrPath).toBeNull()
    expect(scanPayload.run.metadata.logCapture?.mode).toBe("transcript_only")
    expect(scanPayload.run.metadata.logCapture?.reason).toBe("failed_without_stdio_capture")
    expect(scanPayload.logs.stdout).toBeNull()
    expect(scanPayload.logs.stderr).toBeNull()
    expect(scanPayload.logs.stdoutTruncated).toBe(false)
    expect(scanPayload.logs.stderrTruncated).toBe(false)

    const cycleResponse = await fetch(`${baseUrl}/api/runs/${cycleRunId}`)
    expect(cycleResponse.status).toBe(200)
    const cyclePayload = await cycleResponse.json() as {
      run: {
        agent: string
        transcriptPath: string | null
        metadata: {
          logCapture?: { mode?: string; reason?: string; failureReason?: string | null }
        }
      }
      logs: {
        stdout: string | null
        stderr: string | null
        stdoutTruncated: boolean
        stderrTruncated: boolean
      }
    }

    expect(cyclePayload.run.agent).toBe("cycle-scanner")
    expect(cyclePayload.run.transcriptPath).toBe(cycleTranscriptPath)
    expect(cyclePayload.run.metadata.logCapture?.mode).toBe("transcript_only")
    expect(cyclePayload.run.metadata.logCapture?.reason).toBe("failed_without_stdio_capture")
    expect(cyclePayload.logs.stdout).toBeNull()
    expect(cyclePayload.logs.stderr).toBeNull()
    expect(cyclePayload.logs.stdoutTruncated).toBe(false)
    expect(cyclePayload.logs.stderrTruncated).toBe(false)
  })

  it("GET /api/runs/stalled lists stalled runs", async () => {
    const runId = runFixtureId("api-stalled-list")
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    insertRun(db, runId)

    const heartbeat = await fetch(`${baseUrl}/api/runs/${runId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stdoutBytes: 0,
        stderrBytes: 0,
        transcriptBytes: 42,
        deltaBytes: 0,
        checkAt: old,
        activityAt: old,
      }),
    })
    expect(heartbeat.status).toBe(200)

    const res = await fetch(`${baseUrl}/api/runs/stalled?transcriptIdleSeconds=300`)
    expect(res.status).toBe(200)

    const payload = await res.json() as {
      runs: Array<{
        run: { id: string }
        reason: string
        transcriptBytes: number
      }>
    }
    expect(payload.runs.length).toBeGreaterThanOrEqual(1)

    const stalled = payload.runs.find((item) => item.run.id === runId)
    expect(stalled).toBeDefined()
    expect(stalled?.reason).toBe("transcript_idle")
    expect(stalled?.transcriptBytes).toBe(42)
  })

  it("POST /api/runs/stalled/reap cancels run and resets task by default", async () => {
    const runId = runFixtureId("api-reap-default")
    const taskId = taskFixtureId("api-reap-default-task")
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    insertTask(db, taskId, "active")
    insertRun(db, runId, taskId)

    const heartbeat = await fetch(`${baseUrl}/api/runs/${runId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stdoutBytes: 0,
        stderrBytes: 0,
        transcriptBytes: 0,
        deltaBytes: 0,
        checkAt: old,
        activityAt: old,
      }),
    })
    expect(heartbeat.status).toBe(200)

    const res = await fetch(`${baseUrl}/api/runs/stalled/reap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcriptIdleSeconds: 300,
      }),
    })
    expect(res.status).toBe(200)

    const payload = await res.json() as {
      runs: Array<{
        id: string
        taskId: string | null
        taskReset: boolean
        processTerminated: boolean
      }>
    }
    const reaped = payload.runs.find((item) => item.id === runId)
    expect(reaped).toBeDefined()
    expect(reaped?.taskId).toBe(taskId)
    expect(reaped?.taskReset).toBe(true)
    expect(reaped?.processTerminated).toBe(false)

    const runRow = db.prepare("SELECT status, exit_code FROM runs WHERE id = ?").get(runId) as
      | { status: string; exit_code: number | null }
      | null
    const taskRow = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
      | { status: string }
      | null

    expect(runRow?.status).toBe("cancelled")
    expect(runRow?.exit_code).toBe(137)
    expect(taskRow?.status).toBe("ready")
  })

  it("SDK HTTP client can heartbeat/list/reap stalled runs", async () => {
    const runId = runFixtureId("sdk-http")
    const taskId = taskFixtureId("sdk-http-task")
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    insertTask(db, taskId, "active")
    insertRun(db, runId, taskId)

    const tx = new TxClient({ apiUrl: baseUrl })

    const heartbeat = await tx.runs.heartbeat(runId, {
      stdoutBytes: 12,
      stderrBytes: 1,
      transcriptBytes: 100,
      deltaBytes: 0,
      checkAt: old,
      activityAt: old,
    })
    expect(heartbeat.runId).toBe(runId)
    expect(heartbeat.transcriptBytes).toBe(100)

    const stalled = await tx.runs.stalled({ transcriptIdleSeconds: 300 })
    expect(stalled.some((row) => row.run.id === runId)).toBe(true)

    const reaped = await tx.runs.reap({
      transcriptIdleSeconds: 300,
      resetTask: false,
    })
    const row = reaped.find((item) => item.id === runId)
    expect(row).toBeDefined()
    expect(row?.taskReset).toBe(false)

    const runRow = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as
      | { status: string }
      | null
    const taskRow = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
      | { status: string }
      | null

    expect(runRow?.status).toBe("cancelled")
    expect(taskRow?.status).toBe("active")
  })

  it("POST /api/runs/:id/heartbeat validates ISO timestamps", async () => {
    const runId = runFixtureId("api-invalid-check-at")
    insertRun(db, runId)

    const res = await fetch(`${baseUrl}/api/runs/${runId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkAt: "not-an-iso-date",
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("checkAt")
  })
})
