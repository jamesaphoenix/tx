import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnSyncReturns } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fixtureId } from "../fixtures"

interface Harness {
  tmpDir: string
  stateDir: string
  runLauncher: (args: string[], extraEnv?: Record<string, string>) => SpawnSyncReturns<string>
  runWatchdog: (args: string[], extraEnv?: Record<string, string>) => SpawnSyncReturns<string>
  runWatchdogAsync: (args: string[], extraEnv?: Record<string, string>) => ChildProcessWithoutNullStreams
}

const LAUNCHER_TEMPLATE = resolve(__dirname, "../../apps/cli/src/templates/watchdog/scripts/watchdog-launcher.sh")
const WATCHDOG_TEMPLATE = resolve(__dirname, "../../apps/cli/src/templates/watchdog/scripts/ralph-watchdog.sh")
const hasSqlite3 = spawnSync("sqlite3", ["--version"], { stdio: "pipe" }).status === 0
const describeIfSqlite3 = hasSqlite3 ? describe : describe.skip
const harnesses: Harness[] = []

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function writeWatchdogEnv(tmpDir: string): void {
  const envPath = join(tmpDir, ".tx", "watchdog.env")
  writeFileSync(
    envPath,
    [
      "WATCHDOG_ENABLED=1",
      "WATCHDOG_RUNTIME_MODE=codex",
      "WATCHDOG_CODEX_ENABLED=1",
      "WATCHDOG_CLAUDE_ENABLED=0",
      "WATCHDOG_POLL_SECONDS=1",
      "WATCHDOG_TRANSCRIPT_IDLE_SECONDS=60",
      "WATCHDOG_CLAUDE_STALL_GRACE_SECONDS=90",
      "WATCHDOG_HEARTBEAT_LAG_SECONDS=1",
      "WATCHDOG_RUN_STALE_SECONDS=60",
      "WATCHDOG_IDLE_ROUNDS=1",
      "WATCHDOG_ERROR_BURST_WINDOW_MINUTES=20",
      "WATCHDOG_ERROR_BURST_THRESHOLD=4",
      "WATCHDOG_ERROR_BURST_GRACE_SECONDS=2",
      "WATCHDOG_RESTART_COOLDOWN_SECONDS=1",
      "WATCHDOG_DETACHED=1",
      "",
    ].join("\n")
  )
}

function createHarness(options?: { stubWatchdog?: boolean }): Harness {
  const tmpDir = mkdtempSync(join(tmpdir(), "tx-watchdog-script-"))
  const scriptsDir = join(tmpDir, "scripts")
  const txDir = join(tmpDir, ".tx")
  const stateDir = join(tmpDir, ".state")
  const binDir = join(tmpDir, "bin")
  const appCliDir = join(tmpDir, "apps", "cli", "src")

  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(txDir, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  mkdirSync(appCliDir, { recursive: true })

  copyFileSync(LAUNCHER_TEMPLATE, join(scriptsDir, "watchdog-launcher.sh"))
  chmodSync(join(scriptsDir, "watchdog-launcher.sh"), 0o755)

  if (options?.stubWatchdog) {
    writeExecutable(
      join(scriptsDir, "ralph-watchdog.sh"),
      `#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJECT_DIR/.tx/ralph-watchdog.pid"
EVENT_FILE="$PROJECT_DIR/.tx/watchdog-events.log"
echo "$$" > "$PID_FILE"
echo "start $$ $*" >> "$EVENT_FILE"
trap 'echo "stop $$" >> "$EVENT_FILE"; rm -f "$PID_FILE"; exit 0' TERM INT
while true; do
  /bin/sleep 1
done
`
    )
  } else {
    copyFileSync(WATCHDOG_TEMPLATE, join(scriptsDir, "ralph-watchdog.sh"))
    chmodSync(join(scriptsDir, "ralph-watchdog.sh"), 0o755)
  }

  writeWatchdogEnv(tmpDir)
  writeFileSync(join(appCliDir, "cli.ts"), "// mocked by PATH bun shim in watchdog script integration tests\n")

  writeExecutable(join(binDir, "codex"), "#!/bin/bash\nexit 0\n")

  writeExecutable(
    join(binDir, "ps"),
    `#!/bin/bash
set -euo pipefail
default_cmd="\${WATCHDOG_TEST_PS_DEFAULT_COMMAND:-ralph-watchdog.sh}"
if [ "\${1:-}" = "-p" ] && [ "\${3:-}" = "-o" ]; then
  pid="\${2:-}"
  if kill -0 "$pid" 2>/dev/null; then
    echo "$default_cmd"
  fi
  exit 0
fi
echo "$default_cmd"
`
  )

  writeExecutable(
    join(binDir, "bun"),
    `#!/bin/bash
set -euo pipefail
STATE_DIR="\${WATCHDOG_TEST_STATE_DIR:?}"
mkdir -p "$STATE_DIR"
shift || true
cmd="\${1:-}"
shift || true
case "$cmd" in
  reset)
    echo "$*" >> "$STATE_DIR/resets.log"
    ;;
  trace)
    echo "[]"
    ;;
  *)
    echo ""
    ;;
esac
`
  )

  writeExecutable(
    join(binDir, "jq"),
    `#!/bin/bash
set -euo pipefail
cat >/dev/null || true
echo "0"
`
  )

  const runScript = (
    scriptPath: string,
    args: string[],
    extraEnv?: Record<string, string>,
  ): SpawnSyncReturns<string> =>
    spawnSync("/bin/bash", [scriptPath, ...args], {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        WATCHDOG_TEST_STATE_DIR: stateDir,
        ...extraEnv,
      },
    })

  const runScriptAsync = (
    scriptPath: string,
    args: string[],
    extraEnv?: Record<string, string>,
  ): ChildProcessWithoutNullStreams =>
    spawn("/bin/bash", [scriptPath, ...args], {
      cwd: tmpDir,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        WATCHDOG_TEST_STATE_DIR: stateDir,
        ...extraEnv,
      },
    })

  return {
    tmpDir,
    stateDir,
    runLauncher: (args, extraEnv) => runScript(join(tmpDir, "scripts", "watchdog-launcher.sh"), args, extraEnv),
    runWatchdog: (args, extraEnv) => runScript(join(tmpDir, "scripts", "ralph-watchdog.sh"), args, extraEnv),
    runWatchdogAsync: (args, extraEnv) => runScriptAsync(join(tmpDir, "scripts", "ralph-watchdog.sh"), args, extraEnv),
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, ms)
})

async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  intervalMs: number = 25,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (condition()) {
      return
    }
    await sleep(intervalMs)
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

async function waitForExit(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number | null> {
  if (proc.exitCode !== null) {
    return proc.exitCode
  }

  return await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.removeListener("exit", onExit)
      reject(new Error(`Timed out waiting for process ${proc.pid} to exit`))
    }, timeoutMs)

    const onExit = (code: number | null) => {
      clearTimeout(timer)
      resolve(code)
    }

    proc.once("exit", onExit)
  })
}

function isPidLive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function terminatePid(pid: number): void {
  if (!isPidLive(pid)) {
    return
  }
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return
  }
  spawnSync("/bin/sleep", ["0.2"])
  if (isPidLive(pid)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Ignore cleanup races.
    }
  }
}

async function terminateChild(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null) {
    return
  }

  proc.kill("SIGTERM")
  try {
    await waitForExit(proc, 2000)
    return
  } catch {
    proc.kill("SIGKILL")
    await waitForExit(proc, 2000)
  }
}

function cleanupHarness(h: Harness): void {
  const pidFile = join(h.tmpDir, ".tx", "ralph-watchdog.pid")
  if (existsSync(pidFile)) {
    const rawPid = readFileSync(pidFile, "utf-8").trim()
    const pid = Number(rawPid)
    terminatePid(pid)
  }
  if (existsSync(h.tmpDir)) {
    rmSync(h.tmpDir, { recursive: true, force: true })
  }
}

function createReconcileSchema(db: Database): void {
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      agent TEXT,
      pid INTEGER,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      exit_code INTEGER,
      error_message TEXT,
      metadata TEXT
    );
    CREATE TABLE task_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      renewed_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );
  `)
}

function runWatchdogSweep(harness: Harness, extraEnv?: Record<string, string>): SpawnSyncReturns<string> {
  return harness.runWatchdog([
    "--once",
    "--no-start",
    "--no-claude",
    "--interval",
    "1",
    "--transcript-idle-seconds",
    "60",
    "--heartbeat-lag-seconds",
    "1",
    "--run-stale-seconds",
    "60",
  ], extraEnv)
}

function insertActiveClaim(db: Database, taskId: string, workerId: string): void {
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + 5 * 60_000)
  db.prepare(
    `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
     VALUES (?, ?, ?, ?, 0, 'active')`
  ).run(taskId, workerId, now.toISOString(), leaseExpiresAt.toISOString())
}

function getClaimStatus(db: Database, taskId: string): string | null {
  const row = db
    .query("SELECT status FROM task_claims WHERE task_id = ? ORDER BY id DESC LIMIT 1")
    .get(taskId) as { status: string } | null
  return row?.status ?? null
}

function getActiveClaimCount(db: Database, taskId: string): number {
  const row = db
    .query("SELECT COUNT(*) AS count FROM task_claims WHERE task_id = ? AND status = 'active'")
    .get(taskId) as { count: number } | null
  return row?.count ?? 0
}

afterEach(() => {
  for (const harness of harnesses.splice(0, harnesses.length)) {
    cleanupHarness(harness)
  }
})

describe("watchdog launcher integration", () => {
  it("enforces single-instance lock and restarts cleanly", () => {
    const harness = createHarness({ stubWatchdog: true })
    harnesses.push(harness)

    const firstStart = harness.runLauncher(["start"])
    expect(firstStart.status, `${firstStart.stdout}\n${firstStart.stderr}`).toBe(0)
    expect(`${firstStart.stdout}\n${firstStart.stderr}`).toContain("Watchdog started")

    const pidFile = join(harness.tmpDir, ".tx", "ralph-watchdog.pid")
    expect(existsSync(pidFile)).toBe(true)
    const firstPid = readFileSync(pidFile, "utf-8").trim()
    expect(firstPid).toMatch(/^[0-9]+$/)

    const secondStart = harness.runLauncher(["start"])
    expect(secondStart.status).toBe(0)
    expect(`${secondStart.stdout}\n${secondStart.stderr}`).toContain("Watchdog already running")
    expect(readFileSync(pidFile, "utf-8").trim()).toBe(firstPid)

    const restart = harness.runLauncher(["restart"])
    expect(restart.status).toBe(0)
    expect(`${restart.stdout}\n${restart.stderr}`).toContain("Watchdog stopped")
    expect(`${restart.stdout}\n${restart.stderr}`).toContain("Watchdog started")

    const eventsLog = readFileSync(join(harness.tmpDir, ".tx", "watchdog-events.log"), "utf-8")
    expect(eventsLog.match(/^start /gm)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(eventsLog).toContain("--claude-stall-grace-seconds 90")
    expect(eventsLog).toContain("--error-burst-grace-seconds 2")

    const stop = harness.runLauncher(["stop"])
    expect(stop.status).toBe(0)
    expect(`${stop.stdout}\n${stop.stderr}`).toContain("Watchdog stopped")
    expect(existsSync(pidFile)).toBe(false)
  })
})

describe("ralph-watchdog singleton lock integration", () => {
  const watchdogArgs = [
    "--interval",
    "5",
    "--no-start",
    "--no-codex",
    "--transcript-idle-seconds",
    "60",
    "--heartbeat-lag-seconds",
    "1",
    "--run-stale-seconds",
    "60",
  ]

  async function expectSingleWinner(options?: { preseedStalePidFile?: boolean }): Promise<void> {
    const harness = createHarness()
    harnesses.push(harness)

    const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    db.close()

    const pidFile = join(harness.tmpDir, ".tx", "ralph-watchdog.pid")
    if (options?.preseedStalePidFile === true) {
      writeFileSync(pidFile, "999999\n")
    }

    const proc1 = harness.runWatchdogAsync(watchdogArgs)
    const proc2 = harness.runWatchdogAsync(watchdogArgs)

    let proc1Out = ""
    let proc2Out = ""
    proc1.stdout.on("data", (chunk) => { proc1Out += chunk.toString() })
    proc1.stderr.on("data", (chunk) => { proc1Out += chunk.toString() })
    proc2.stdout.on("data", (chunk) => { proc2Out += chunk.toString() })
    proc2.stderr.on("data", (chunk) => { proc2Out += chunk.toString() })

    try {
      await waitForCondition(() => proc1.exitCode !== null || proc2.exitCode !== null, 8000)
      await waitForCondition(() => {
        const logPath = join(harness.tmpDir, ".tx", "ralph-watchdog.log")
        if (!existsSync(logPath)) {
          return false
        }
        const logContents = readFileSync(logPath, "utf-8")
        return logContents.includes("Watchdog started interval=")
      }, 8000)
      await sleep(300)

      const liveCount = [proc1, proc2].filter((proc) => proc.exitCode === null).length
      expect(liveCount).toBe(1)

      const exited = proc1.exitCode !== null ? proc1 : proc2
      expect(exited.exitCode).toBe(0)

      const combinedOut = `${proc1Out}\n${proc2Out}`
      expect(combinedOut).toContain("Another watchdog is already running")
      expect(combinedOut).not.toContain("No such file or directory")

      const logContents = readFileSync(join(harness.tmpDir, ".tx", "ralph-watchdog.log"), "utf-8")
      expect(logContents.match(/Watchdog started interval=/g)?.length ?? 0).toBe(1)
    } finally {
      await terminateChild(proc1)
      await terminateChild(proc2)
    }
  }

  it("allows only one winner when concurrent starts race with an empty pid file", async () => {
    await expectSingleWinner()
  })

  it("allows only one winner when concurrent starts race with a stale pid file", async () => {
    await expectSingleWinner({ preseedStalePidFile: true })
  })
})

describe("ralph-watchdog signal trap integration", () => {
  const watchdogArgs = [
    "--interval",
    "5",
    "--no-start",
    "--no-codex",
    "--transcript-idle-seconds",
    "60",
    "--heartbeat-lag-seconds",
    "1",
    "--run-stale-seconds",
    "60",
  ]

  async function expectSignalStopsWatchdog(
    signal: "SIGTERM" | "SIGINT",
    expectedExitCode: number,
  ): Promise<void> {
    const harness = createHarness()
    harnesses.push(harness)

    const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    db.close()

    const pidFile = join(harness.tmpDir, ".tx", "ralph-watchdog.pid")
    const proc = harness.runWatchdogAsync(watchdogArgs)
    let procOut = ""
    proc.stdout.on("data", (chunk) => { procOut += chunk.toString() })
    proc.stderr.on("data", (chunk) => { procOut += chunk.toString() })

    try {
      expect(proc.pid ?? 0).toBeGreaterThan(0)
      await waitForCondition(() => {
        if (!existsSync(pidFile)) {
          return false
        }
        const lockOwner = readFileSync(pidFile, "utf-8").trim()
        return lockOwner === String(proc.pid)
      }, 8000)

      proc.kill(signal)

      const exitCode = await waitForExit(proc, 2000)
      expect(exitCode, procOut).toBe(expectedExitCode)
      await waitForCondition(() => !existsSync(pidFile), 2000)

      const watchdogLog = readFileSync(join(harness.tmpDir, ".tx", "ralph-watchdog.log"), "utf-8")
      expect(watchdogLog).toContain(`Received ${signal}`)
    } finally {
      await terminateChild(proc)
    }
  }

  it("exits cleanly on SIGTERM after releasing the watchdog lock", async () => {
    await expectSignalStopsWatchdog("SIGTERM", 143)
  })

  it("exits cleanly on SIGINT after releasing the watchdog lock", async () => {
    await expectSignalStopsWatchdog("SIGINT", 130)
  })
})

describeIfSqlite3("ralph-watchdog reconcile integration", () => {
  it("cancels worker-managed running rows with missing pid, resets task, and expires active claims", () => {
    const harness = createHarness()
    harnesses.push(harness)

    const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    createReconcileSchema(db)

    const taskId = fixtureId("watchdog-reconcile-task")
    const runId = `run-${fixtureId("watchdog-reconcile-run").slice(3)}`
    const workerId = fixtureId("watchdog-reconcile-worker")
    const now = new Date().toISOString()
    const metadata = JSON.stringify({
      runtime: "codex",
      worker: "ralph-codex-live-main",
    })

    db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "backlog")
    db.prepare(
      "INSERT INTO runs (id, task_id, agent, pid, status, started_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(runId, taskId, "tx-implementer", 0, "running", now, metadata)
    insertActiveClaim(db, taskId, workerId)
    db.close()

    const result = runWatchdogSweep(harness)
    expect(result.status).toBe(0)

    const checkDb = new Database(dbPath)
    const row = checkDb
      .query("SELECT status, error_message FROM runs WHERE id = ?")
      .get(runId) as { status: string; error_message: string | null } | null
    const claimStatus = getClaimStatus(checkDb, taskId)
    const activeClaimCount = getActiveClaimCount(checkDb, taskId)
    checkDb.close()

    expect(row).not.toBeNull()
    expect(row?.status).toBe("cancelled")
    expect(row?.error_message ?? "").toContain("missing PID")
    expect(claimStatus).toBe("expired")
    expect(activeClaimCount).toBe(0)

    const resetsLogPath = join(harness.stateDir, "resets.log")
    expect(existsSync(resetsLogPath)).toBe(true)
    expect(readFileSync(resetsLogPath, "utf-8")).toContain(taskId)

    const watchdogLog = readFileSync(join(harness.tmpDir, ".tx", "ralph-watchdog.log"), "utf-8")
    expect(watchdogLog).toContain(`Reconciled run=${runId} (missing pid)`)
    expect(existsSync(join(harness.tmpDir, ".tx", "ralph-watchdog.pid"))).toBe(false)
  })

  it("cancels running rows with dead pid, resets task, and expires active claims", () => {
    const harness = createHarness()
    harnesses.push(harness)

    const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    createReconcileSchema(db)

    const taskId = fixtureId("watchdog-dead-pid-task")
    const runId = `run-${fixtureId("watchdog-dead-pid-run").slice(3)}`
    const workerId = fixtureId("watchdog-dead-pid-worker")
    const now = new Date().toISOString()
    const metadata = JSON.stringify({
      runtime: "codex",
      worker: "ralph-codex-live-main",
    })

    db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "backlog")
    db.prepare(
      "INSERT INTO runs (id, task_id, agent, pid, status, started_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(runId, taskId, "tx-implementer", 999_999, "running", now, metadata)
    insertActiveClaim(db, taskId, workerId)
    db.close()

    const result = runWatchdogSweep(harness)
    expect(result.status).toBe(0)

    const checkDb = new Database(dbPath)
    const row = checkDb
      .query("SELECT status, error_message FROM runs WHERE id = ?")
      .get(runId) as { status: string; error_message: string | null } | null
    const claimStatus = getClaimStatus(checkDb, taskId)
    const activeClaimCount = getActiveClaimCount(checkDb, taskId)
    checkDb.close()

    expect(row).not.toBeNull()
    expect(row?.status).toBe("cancelled")
    expect(row?.error_message ?? "").toContain("process not alive")
    expect(claimStatus).toBe("expired")
    expect(activeClaimCount).toBe(0)

    const resetsLogPath = join(harness.stateDir, "resets.log")
    expect(existsSync(resetsLogPath)).toBe(true)
    expect(readFileSync(resetsLogPath, "utf-8")).toContain(taskId)
  })

  it("does not cancel non-worker running rows that do not report a pid", () => {
    const harness = createHarness()
    harnesses.push(harness)

    const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    createReconcileSchema(db)

    const runId = `run-${fixtureId("watchdog-scan-missing-pid").slice(3)}`
    const now = new Date().toISOString()
    const metadata = JSON.stringify({ type: "scan" })

    db.prepare(
      "INSERT INTO runs (id, task_id, agent, pid, status, started_at, metadata) VALUES (?, NULL, ?, ?, ?, ?, ?)"
    ).run(runId, "scan-agent-1", 0, "running", now, metadata)
    db.close()

    const result = runWatchdogSweep(harness)
    expect(result.status).toBe(0)

    const checkDb = new Database(dbPath)
    const row = checkDb
      .query("SELECT status, error_message FROM runs WHERE id = ?")
      .get(runId) as { status: string; error_message: string | null } | null
    checkDb.close()

    expect(row).not.toBeNull()
    expect(row?.status).toBe("running")
    expect(row?.error_message).toBeNull()

    const watchdogLog = readFileSync(join(harness.tmpDir, ".tx", "ralph-watchdog.log"), "utf-8")
    expect(watchdogLog).toContain(`Skipping run=${runId} pid reconciliation`)
  })

  it("cancels stale running rows, resets task, and expires active claims", () => {
    const harness = createHarness()
    harnesses.push(harness)

    const staleProc = spawn("/bin/sleep", ["30"], { stdio: "ignore" })
    const stalePid = staleProc.pid ?? -1

    try {
      expect(stalePid).toBeGreaterThan(0)

      const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
      const db = new Database(dbPath)
      createReconcileSchema(db)

      const taskId = fixtureId("watchdog-stale-run-task")
      const runId = `run-${fixtureId("watchdog-stale-run").slice(3)}`
      const workerId = fixtureId("watchdog-stale-run-worker")
      const oldStart = new Date(Date.now() - 120_000).toISOString()
      const metadata = JSON.stringify({
        runtime: "codex",
        worker: "ralph-codex-live-main",
      })

      db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "backlog")
      db.prepare(
        "INSERT INTO runs (id, task_id, pid, status, started_at, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(runId, taskId, stalePid, "running", oldStart, metadata)
      insertActiveClaim(db, taskId, workerId)
      db.close()

      const result = runWatchdogSweep(harness, {
        WATCHDOG_TEST_PS_DEFAULT_COMMAND: `${join(harness.tmpDir, "scripts", "ralph.sh")} --runtime codex --worker-prefix ralph-codex-live`,
      })
      expect(result.status).toBe(0)

      const checkDb = new Database(dbPath)
      const row = checkDb
        .query("SELECT status, error_message FROM runs WHERE id = ?")
        .get(runId) as { status: string; error_message: string | null } | null
      const claimStatus = getClaimStatus(checkDb, taskId)
      const activeClaimCount = getActiveClaimCount(checkDb, taskId)
      checkDb.close()

      expect(row).not.toBeNull()
      expect(row?.status).toBe("cancelled")
      expect(row?.error_message ?? "").toContain("stale running run killed")
      expect(claimStatus).toBe("expired")
      expect(activeClaimCount).toBe(0)

      const resetsLogPath = join(harness.stateDir, "resets.log")
      expect(existsSync(resetsLogPath)).toBe(true)
      expect(readFileSync(resetsLogPath, "utf-8")).toContain(taskId)
      expect(isPidLive(stalePid)).toBe(false)
    } finally {
      terminatePid(stalePid)
    }
  })

  it("cancels stale runs without killing unrelated live PIDs when ownership cannot be confirmed", () => {
    const harness = createHarness()
    harnesses.push(harness)

    const unrelatedProc = spawn("/bin/sleep", ["30"], { stdio: "ignore" })
    const unrelatedPid = unrelatedProc.pid ?? -1

    try {
      expect(unrelatedPid).toBeGreaterThan(0)

      const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
      const db = new Database(dbPath)
      createReconcileSchema(db)

      const taskId = fixtureId("watchdog-pid-reuse-task")
      const runId = `run-${fixtureId("watchdog-pid-reuse-run").slice(3)}`
      const workerId = fixtureId("watchdog-pid-reuse-worker")
      const oldStart = new Date(Date.now() - 120_000).toISOString()
      const metadata = JSON.stringify({
        runtime: "codex",
        worker: "ralph-codex-live-main",
      })

      db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "backlog")
      db.prepare(
        "INSERT INTO runs (id, task_id, pid, status, started_at, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(runId, taskId, unrelatedPid, "running", oldStart, metadata)
      insertActiveClaim(db, taskId, workerId)
      db.close()

      const result = runWatchdogSweep(harness)
      expect(result.status).toBe(0)

      const checkDb = new Database(dbPath)
      const row = checkDb
        .query("SELECT status, error_message FROM runs WHERE id = ?")
        .get(runId) as { status: string; error_message: string | null } | null
      const claimStatus = getClaimStatus(checkDb, taskId)
      const activeClaimCount = getActiveClaimCount(checkDb, taskId)
      checkDb.close()

      expect(row).not.toBeNull()
      expect(row?.status).toBe("cancelled")
      expect(row?.error_message ?? "").toContain("ownership not confirmed")
      expect(claimStatus).toBe("expired")
      expect(activeClaimCount).toBe(0)
      expect(isPidLive(unrelatedPid)).toBe(true)

      const resetsLogPath = join(harness.stateDir, "resets.log")
      expect(existsSync(resetsLogPath)).toBe(true)
      expect(readFileSync(resetsLogPath, "utf-8")).toContain(taskId)

      const watchdogLog = readFileSync(join(harness.tmpDir, ".tx", "ralph-watchdog.log"), "utf-8")
      expect(watchdogLog).toContain("ownership not confirmed")
    } finally {
      terminatePid(unrelatedPid)
    }
  })

  it("resets orphaned active tasks and expires active claims", () => {
    const harness = createHarness()
    harnesses.push(harness)

    const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    createReconcileSchema(db)

    const taskId = fixtureId("watchdog-orphan-task")
    const workerId = fixtureId("watchdog-orphan-worker")

    db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "active")
    insertActiveClaim(db, taskId, workerId)
    db.close()

    const result = runWatchdogSweep(harness)
    expect(result.status).toBe(0)

    const checkDb = new Database(dbPath)
    const claimStatus = getClaimStatus(checkDb, taskId)
    const activeClaimCount = getActiveClaimCount(checkDb, taskId)
    checkDb.close()

    expect(claimStatus).toBe("expired")
    expect(activeClaimCount).toBe(0)

    const resetsLogPath = join(harness.stateDir, "resets.log")
    expect(existsSync(resetsLogPath)).toBe(true)
    expect(readFileSync(resetsLogPath, "utf-8")).toContain(taskId)

    const watchdogLog = readFileSync(join(harness.tmpDir, ".tx", "ralph-watchdog.log"), "utf-8")
    expect(watchdogLog).toContain("Reset 1 orphaned active task(s)")
  })
})
