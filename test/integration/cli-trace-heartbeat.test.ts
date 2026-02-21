import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { fixtureId } from "../fixtures.js"

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

const runFixtureId = (name: string): string => `run-${fixtureId(`cli-trace-heartbeat:${name}`).slice(3)}`
const taskFixtureId = (name: string): string => fixtureId(`cli-trace-heartbeat:${name}`)

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

function insertTask(db: Database, taskId: string, status: string = "active"): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, NULL, 500, ?, ?, NULL, '{}')`
  ).run(taskId, `Task ${taskId}`, "Heartbeat CLI integration test task", status, now, now)
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

function insertWorker(
  db: Database,
  workerId: string,
  status: "starting" | "idle" | "busy" | "stopping" | "dead" = "busy",
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO workers (
       id, name, hostname, pid, status, registered_at, last_heartbeat_at, current_task_id, capabilities, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', '{}')`
  ).run(workerId, `Worker ${workerId}`, "localhost", 31337, status, now, now)
}

function insertActiveClaim(db: Database, taskId: string, workerId: string): void {
  const claimedAt = new Date()
  const leaseExpiresAt = new Date(claimedAt.getTime() + 30 * 60 * 1000)
  db.prepare(
    `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
     VALUES (?, ?, ?, ?, 0, 'active')`
  ).run(taskId, workerId, claimedAt.toISOString(), leaseExpiresAt.toISOString())
}

function insertSpanEvents(db: Database, runId: string, timestamp: string, count: number): void {
  const insertSpan = db.prepare(
    `INSERT INTO events (timestamp, event_type, run_id, task_id, agent, tool_name, content, metadata, duration_ms)
     VALUES (?, 'span', ?, NULL, 'tx-implementer', NULL, ?, '{"status":"ok"}', ?)`
  )

  for (let i = 0; i < count; i++) {
    insertSpan.run(timestamp, runId, `span-${i + 1}`, 5 + i)
  }
}

describe("CLI trace heartbeat integration", () => {
  let tmpProjectDir: string
  let dbPath: string

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-cli-trace-heartbeat-"))
    dbPath = join(tmpProjectDir, "tasks.db")
    const init = runTx(["init"], dbPath, tmpProjectDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("records heartbeat state with tx trace heartbeat", () => {
    const runId = runFixtureId("records-heartbeat")
    const checkAt = "2026-02-20T20:00:00.000Z"
    const activityAt = "2026-02-20T19:58:00.000Z"

    const db = new Database(dbPath)
    try {
      insertRun(db, runId)
    } finally {
      db.close()
    }

    const result = runTx([
      "trace",
      "heartbeat",
      runId,
      "--stdout-bytes",
      "120",
      "--stderr-bytes",
      "5",
      "--transcript-bytes",
      "2048",
      "--delta-bytes",
      "128",
      "--check-at",
      checkAt,
      "--activity-at",
      activityAt,
      "--json",
    ], dbPath, tmpProjectDir)

    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout) as {
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
    expect(payload.stderrBytes).toBe(5)
    expect(payload.transcriptBytes).toBe(2048)
    expect(payload.deltaBytes).toBe(128)
    expect(payload.checkAt).toBe(checkAt)
    expect(payload.activityAt).toBe(activityAt)

    const verifyDb = new Database(dbPath)
    try {
      const row = verifyDb.prepare(
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
      expect(row?.stderr_bytes).toBe(5)
      expect(row?.transcript_bytes).toBe(2048)
      expect(row?.last_delta_bytes).toBe(128)
    } finally {
      verifyDb.close()
    }
  })

  it("applies SQL cutoff semantics for trace list across hours and limits with stable ordering", () => {
    const runNewest = runFixtureId("trace-list-newest")
    const runRecent = runFixtureId("trace-list-recent")
    const runNearOneHour = runFixtureId("trace-list-near-one-hour")
    const runOld = runFixtureId("trace-list-old")
    const runVeryOld = runFixtureId("trace-list-very-old")
    const now = Date.now()

    const fixtureRows = [
      { id: runNewest, startedAt: new Date(now - 5 * 60 * 1000).toISOString(), spanCount: 2 },
      { id: runRecent, startedAt: new Date(now - 20 * 60 * 1000).toISOString(), spanCount: 1 },
      { id: runNearOneHour, startedAt: new Date(now - 55 * 60 * 1000).toISOString(), spanCount: 3 },
      { id: runOld, startedAt: new Date(now - 130 * 60 * 1000).toISOString(), spanCount: 4 },
      { id: runVeryOld, startedAt: new Date(now - 260 * 60 * 1000).toISOString(), spanCount: 5 },
    ]

    const db = new Database(dbPath)
    try {
      for (const row of fixtureRows) {
        insertRun(db, row.id, null, row.startedAt)
        insertSpanEvents(db, row.id, row.startedAt, row.spanCount)
      }
    } finally {
      db.close()
    }

    const cases = [
      { hours: 1, limit: 10, expectedIds: [runNewest, runRecent, runNearOneHour] },
      { hours: 1, limit: 2, expectedIds: [runNewest, runRecent] },
      { hours: 3, limit: 10, expectedIds: [runNewest, runRecent, runNearOneHour, runOld] },
      { hours: 6, limit: 3, expectedIds: [runNewest, runRecent, runNearOneHour] },
      { hours: 6, limit: 10, expectedIds: [runNewest, runRecent, runNearOneHour, runOld, runVeryOld] },
    ]

    for (const traceCase of cases) {
      const result = runTx([
        "trace",
        "list",
        "--hours",
        String(traceCase.hours),
        "--limit",
        String(traceCase.limit),
        "--json",
      ], dbPath, tmpProjectDir)

      expect(result.status).toBe(0)
      const rows = JSON.parse(result.stdout) as Array<{ id: string; spanCount: number }>
      expect(rows.map((row) => row.id)).toEqual(traceCase.expectedIds)

      const expectedSpanCounts = traceCase.expectedIds.map((expectedId) =>
        fixtureRows.find((row) => row.id === expectedId)?.spanCount ?? -1
      )
      expect(rows.map((row) => row.spanCount)).toEqual(expectedSpanCounts)
    }
  })

  it("lists stalled runs via tx trace stalled", () => {
    const runId = runFixtureId("lists-stalled")
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const db = new Database(dbPath)
    try {
      insertRun(db, runId)
    } finally {
      db.close()
    }

    const heartbeat = runTx([
      "trace",
      "heartbeat",
      runId,
      "--stdout-bytes",
      "10",
      "--stderr-bytes",
      "1",
      "--transcript-bytes",
      "100",
      "--delta-bytes",
      "0",
      "--check-at",
      old,
      "--activity-at",
      old,
    ], dbPath, tmpProjectDir)
    expect(heartbeat.status).toBe(0)

    const stalled = runTx([
      "trace",
      "stalled",
      "--transcript-idle-seconds",
      "300",
      "--json",
    ], dbPath, tmpProjectDir)
    expect(stalled.status).toBe(0)

    const rows = JSON.parse(stalled.stdout) as Array<{
      run: { id: string }
      reason: string
      transcriptBytes: number
    }>
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const row = rows.find((item) => item.run.id === runId)
    expect(row).toBeDefined()
    expect(row?.reason).toBe("transcript_idle")
    expect(row?.transcriptBytes).toBe(100)
  })

  it("dry-run reap returns candidates without mutating run/task/claim state", () => {
    const runId = runFixtureId("reap-dry-run")
    const taskId = taskFixtureId("reap-dry-run-task")
    const workerId = fixtureId("cli-trace-heartbeat:reap-dry-run-worker")
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const db = new Database(dbPath)
    try {
      insertTask(db, taskId, "active")
      insertRun(db, runId, taskId)
      insertWorker(db, workerId)
      insertActiveClaim(db, taskId, workerId)
    } finally {
      db.close()
    }

    const heartbeat = runTx([
      "trace",
      "heartbeat",
      runId,
      "--stdout-bytes",
      "0",
      "--stderr-bytes",
      "0",
      "--transcript-bytes",
      "0",
      "--delta-bytes",
      "0",
      "--check-at",
      old,
      "--activity-at",
      old,
    ], dbPath, tmpProjectDir)
    expect(heartbeat.status).toBe(0)

    const reap = runTx([
      "trace",
      "stalled",
      "--reap",
      "--dry-run",
      "--transcript-idle-seconds",
      "300",
      "--json",
    ], dbPath, tmpProjectDir)
    expect(reap.status).toBe(0)

    const rows = JSON.parse(reap.stdout) as Array<{
      id: string
      taskReset: boolean
      processTerminated: boolean
    }>
    const row = rows.find((item) => item.id === runId)
    expect(row).toBeDefined()
    expect(row?.taskReset).toBe(false)
    expect(row?.processTerminated).toBe(false)

    const verifyDb = new Database(dbPath)
    try {
      const runRow = verifyDb.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as
        | { status: string }
        | null
      const taskRow = verifyDb.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
        | { status: string }
        | null
      const claimRow = verifyDb.prepare(
        "SELECT status FROM task_claims WHERE task_id = ? ORDER BY id DESC LIMIT 1"
      ).get(taskId) as { status: string } | null
      const activeClaims = verifyDb.prepare(
        "SELECT COUNT(*) as count FROM task_claims WHERE task_id = ? AND status = 'active'"
      ).get(taskId) as { count: number } | null

      expect(runRow?.status).toBe("running")
      expect(taskRow?.status).toBe("active")
      expect(claimRow?.status).toBe("active")
      expect(activeClaims?.count ?? 0).toBe(1)
    } finally {
      verifyDb.close()
    }
  })

  it("reaps stalled runs and resets task by default", () => {
    const runId = runFixtureId("reap-default")
    const taskId = taskFixtureId("reap-default-task")
    const workerId = fixtureId("cli-trace-heartbeat:reap-default-worker")
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const db = new Database(dbPath)
    try {
      insertTask(db, taskId, "active")
      insertRun(db, runId, taskId)
      insertWorker(db, workerId)
      insertActiveClaim(db, taskId, workerId)
    } finally {
      db.close()
    }

    const heartbeat = runTx([
      "trace",
      "heartbeat",
      runId,
      "--stdout-bytes",
      "0",
      "--stderr-bytes",
      "0",
      "--transcript-bytes",
      "0",
      "--delta-bytes",
      "0",
      "--check-at",
      old,
      "--activity-at",
      old,
    ], dbPath, tmpProjectDir)
    expect(heartbeat.status).toBe(0)

    const reap = runTx([
      "trace",
      "stalled",
      "--reap",
      "--transcript-idle-seconds",
      "300",
      "--json",
    ], dbPath, tmpProjectDir)
    expect(reap.status).toBe(0)

    const rows = JSON.parse(reap.stdout) as Array<{
      id: string
      taskId: string | null
      processTerminated: boolean
      taskReset: boolean
    }>
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const row = rows.find((item) => item.id === runId)
    expect(row).toBeDefined()
    expect(row?.taskId).toBe(taskId)
    expect(row?.taskReset).toBe(true)
    expect(row?.processTerminated).toBe(false)

    const verifyDb = new Database(dbPath)
    try {
      const runRow = verifyDb.prepare(
        "SELECT status, exit_code, error_message FROM runs WHERE id = ?"
      ).get(runId) as { status: string; exit_code: number | null; error_message: string | null } | null
      const taskRow = verifyDb.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
        | { status: string }
        | null
      const claimRow = verifyDb.prepare(
        "SELECT status FROM task_claims WHERE task_id = ? ORDER BY id DESC LIMIT 1"
      ).get(taskId) as { status: string } | null
      const activeClaims = verifyDb.prepare(
        "SELECT COUNT(*) as count FROM task_claims WHERE task_id = ? AND status = 'active'"
      ).get(taskId) as { count: number } | null

      expect(runRow).not.toBeNull()
      expect(runRow?.status).toBe("cancelled")
      expect(runRow?.exit_code).toBe(137)
      expect(runRow?.error_message).toContain("Run reaped by heartbeat primitive")
      expect(taskRow?.status).toBe("ready")
      expect(claimRow?.status).toBe("expired")
      expect(activeClaims?.count ?? 0).toBe(0)
    } finally {
      verifyDb.close()
    }

    const ready = runTx(["ready", "--json"], dbPath, tmpProjectDir)
    expect(ready.status).toBe(0)
    const readyRows = JSON.parse(ready.stdout) as Array<{ id: string }>
    expect(readyRows.map((item) => item.id)).toContain(taskId)
  })

  it("reaps stalled runs without resetting task when --no-reset-task is set", () => {
    const runId = runFixtureId("reap-no-reset")
    const taskId = taskFixtureId("reap-no-reset-task")
    const workerId = fixtureId("cli-trace-heartbeat:reap-no-reset-worker")
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const db = new Database(dbPath)
    try {
      insertTask(db, taskId, "active")
      insertRun(db, runId, taskId)
      insertWorker(db, workerId)
      insertActiveClaim(db, taskId, workerId)
    } finally {
      db.close()
    }

    const heartbeat = runTx([
      "trace",
      "heartbeat",
      runId,
      "--stdout-bytes",
      "0",
      "--stderr-bytes",
      "0",
      "--transcript-bytes",
      "0",
      "--delta-bytes",
      "0",
      "--check-at",
      old,
      "--activity-at",
      old,
    ], dbPath, tmpProjectDir)
    expect(heartbeat.status).toBe(0)

    const reap = runTx([
      "trace",
      "stalled",
      "--reap",
      "--no-reset-task",
      "--transcript-idle-seconds",
      "300",
      "--json",
    ], dbPath, tmpProjectDir)
    expect(reap.status).toBe(0)

    const rows = JSON.parse(reap.stdout) as Array<{
      id: string
      taskReset: boolean
    }>
    const row = rows.find((item) => item.id === runId)
    expect(row).toBeDefined()
    expect(row?.taskReset).toBe(false)

    const verifyDb = new Database(dbPath)
    try {
      const runRow = verifyDb.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as
        | { status: string }
        | null
      const taskRow = verifyDb.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
        | { status: string }
        | null
      const claimRow = verifyDb.prepare(
        "SELECT status FROM task_claims WHERE task_id = ? ORDER BY id DESC LIMIT 1"
      ).get(taskId) as { status: string } | null
      const activeClaims = verifyDb.prepare(
        "SELECT COUNT(*) as count FROM task_claims WHERE task_id = ? AND status = 'active'"
      ).get(taskId) as { count: number } | null

      expect(runRow?.status).toBe("cancelled")
      expect(taskRow?.status).toBe("active")
      expect(claimRow?.status).toBe("expired")
      expect(activeClaims?.count ?? 0).toBe(0)
    } finally {
      verifyDb.close()
    }
  })

  it("fails heartbeat when run does not exist", () => {
    const missingRunId = runFixtureId("missing-run")

    const result = runTx([
      "trace",
      "heartbeat",
      missingRunId,
      "--stdout-bytes",
      "1",
      "--stderr-bytes",
      "0",
      "--transcript-bytes",
      "10",
    ], dbPath, tmpProjectDir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`Run not found: ${missingRunId}`)
  })
})
