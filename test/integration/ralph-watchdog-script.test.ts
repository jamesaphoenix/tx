import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
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
      "WATCHDOG_HEARTBEAT_LAG_SECONDS=1",
      "WATCHDOG_RUN_STALE_SECONDS=60",
      "WATCHDOG_IDLE_ROUNDS=1",
      "WATCHDOG_ERROR_BURST_WINDOW_MINUTES=20",
      "WATCHDOG_ERROR_BURST_THRESHOLD=4",
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
if [ "\${1:-}" = "-p" ] && [ "\${3:-}" = "-o" ]; then
  pid="\${2:-}"
  if kill -0 "$pid" 2>/dev/null; then
    echo "ralph-watchdog.sh"
  fi
  exit 0
fi
echo "ralph-watchdog.sh"
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

  return {
    tmpDir,
    stateDir,
    runLauncher: (args, extraEnv) => runScript(join(tmpDir, "scripts", "watchdog-launcher.sh"), args, extraEnv),
    runWatchdog: (args, extraEnv) => runScript(join(tmpDir, "scripts", "ralph-watchdog.sh"), args, extraEnv),
  }
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

    const stop = harness.runLauncher(["stop"])
    expect(stop.status).toBe(0)
    expect(`${stop.stdout}\n${stop.stderr}`).toContain("Watchdog stopped")
    expect(existsSync(pidFile)).toBe(false)
  })
})

describeIfSqlite3("ralph-watchdog reconcile integration", () => {
  it("cancels running rows with missing pid and resets the linked task", () => {
    const harness = createHarness()
    harnesses.push(harness)

    const dbPath = join(harness.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        pid INTEGER,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        exit_code INTEGER,
        error_message TEXT,
        metadata TEXT
      );
    `)

    const taskId = fixtureId("watchdog-reconcile-task")
    const runId = `run-${fixtureId("watchdog-reconcile-run").slice(3)}`
    const now = new Date().toISOString()

    db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "backlog")
    db.prepare(
      "INSERT INTO runs (id, task_id, pid, status, started_at, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(runId, taskId, 0, "running", now, "{}")
    db.close()

    const result = harness.runWatchdog([
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
    ])
    expect(result.status).toBe(0)

    const checkDb = new Database(dbPath)
    const row = checkDb
      .query("SELECT status, error_message FROM runs WHERE id = ?")
      .get(runId) as { status: string; error_message: string | null } | null
    checkDb.close()

    expect(row).not.toBeNull()
    expect(row?.status).toBe("cancelled")
    expect(row?.error_message ?? "").toContain("missing PID")

    const resetsLogPath = join(harness.stateDir, "resets.log")
    expect(existsSync(resetsLogPath)).toBe(true)
    expect(readFileSync(resetsLogPath, "utf-8")).toContain(taskId)

    const watchdogLog = readFileSync(join(harness.tmpDir, ".tx", "ralph-watchdog.log"), "utf-8")
    expect(watchdogLog).toContain(`Reconciled run=${runId} (missing pid)`)
    expect(existsSync(join(harness.tmpDir, ".tx", "ralph-watchdog.pid"))).toBe(false)
  })
})
