import { Database } from "bun:sqlite"
import { describe, it, expect, afterEach } from "vitest"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnSyncReturns } from "child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { fixtureId } from "../fixtures"

interface Harness {
  tmpDir: string
  stateDir: string
  scriptPath: string
  run: (args: string[], extraEnv?: Record<string, string>) => SpawnSyncReturns<string>
  runAsync: (args: string[], extraEnv?: Record<string, string>) => ChildProcessWithoutNullStreams
  readStateFile: (name: string) => string
}

const hasJq = spawnSync("jq", ["--version"], { stdio: "pipe" }).status === 0
const hasSqlite3 = spawnSync("sqlite3", ["--version"], { stdio: "pipe" }).status === 0
const describeIf = hasJq ? describe : describe.skip
const itIfSqlite3 = hasSqlite3 ? it : it.skip

const SOURCE_RALPH = resolve(__dirname, "../../scripts/ralph.sh")

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function setupHarness(options?: { withCodex?: boolean; withClaude?: boolean }): Harness {
  const withCodex = options?.withCodex ?? true
  const withClaude = options?.withClaude ?? true

  const tmpDir = mkdtempSync(join(tmpdir(), "tx-ralph-script-"))
  const scriptsDir = join(tmpDir, "scripts")
  const appCliDir = join(tmpDir, "apps", "cli", "src")
  const binDir = join(tmpDir, "bin")
  const stateDir = join(tmpDir, "state")
  const codexAgentsDir = join(tmpDir, ".codex", "agents")
  const claudeAgentsDir = join(tmpDir, ".claude", "agents")

  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(appCliDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  mkdirSync(codexAgentsDir, { recursive: true })
  mkdirSync(claudeAgentsDir, { recursive: true })

  // Minimal agent profiles needed by ralph.sh dispatch.
  writeFileSync(join(codexAgentsDir, "tx-implementer.md"), "# codex implementer profile\n")
  writeFileSync(join(claudeAgentsDir, "tx-implementer.md"), "# claude implementer profile\n")

  // Script under test
  const scriptPath = join(scriptsDir, "ralph.sh")
  writeFileSync(scriptPath, readFileSync(SOURCE_RALPH, "utf-8"))
  chmodSync(scriptPath, 0o755)

  // Placeholder CLI source path expected by ralph.sh tx() helper
  writeFileSync(join(appCliDir, "cli.ts"), "// mock placeholder for ralph integration tests\n")

  // Mock bun command: emulates `tx` subcommands used by ralph.sh
  writeExecutable(
    join(binDir, "bun"),
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${RALPH_TEST_STATE_DIR:?}"
mkdir -p "$STATE_DIR"

# arg1 is cli.ts path
shift || true
CMD="\${1:-}"
shift || true

case "$CMD" in
  ready)
    if [ -f "$STATE_DIR/ready_once_consumed" ]; then
      echo "[]"
    else
      touch "$STATE_DIR/ready_once_consumed"
      echo '[{"id":"tx-test-1","title":"Test task","score":500,"children":[]}]'
    fi
    ;;
  list)
    echo "[]"
    ;;
  claim)
    echo "$*" >> "$STATE_DIR/claims.log"
    if [ "\${MOCK_CLAIM_FAIL:-0}" = "1" ]; then
      exit 1
    fi
    ;;
  "claim:release")
    echo "$*" >> "$STATE_DIR/releases.log"
    ;;
  show)
    STATUS="\${MOCK_SHOW_STATUS:-done}"
    echo "{\\"id\\":\\"tx-test-1\\",\\"status\\":\\"$STATUS\\",\\"score\\":500}"
    ;;
  update)
    echo "$*" >> "$STATE_DIR/updates.log"
    ;;
  reset)
    echo "$*" >> "$STATE_DIR/resets.log"
    ;;
  context)
    echo ""
    ;;
  *)
    echo ""
    ;;
esac
`
  )

  // Mock git command
  writeExecutable(
    join(binDir, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  rev-parse)
    echo "deadbeef"
    ;;
  status|add|commit)
    ;;
  *)
    ;;
esac
`
  )

  // Mock uuidgen for deterministic claude mode tests
  writeExecutable(
    join(binDir, "uuidgen"),
    `#!/usr/bin/env bash
set -euo pipefail
echo "11111111-2222-3333-4444-555555555555"
`
  )

  if (withCodex) {
    writeExecutable(
      join(binDir, "codex"),
      `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${RALPH_TEST_STATE_DIR:?}"
echo "$*" >> "$STATE_DIR/codex.log"
if [ -n "\${MOCK_AGENT_SLEEP_SECONDS:-}" ]; then
  sleep "\${MOCK_AGENT_SLEEP_SECONDS}"
fi
`
    )
  }

  if (withClaude) {
    writeExecutable(
      join(binDir, "claude"),
      `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${RALPH_TEST_STATE_DIR:?}"
echo "$*" >> "$STATE_DIR/claude.log"
if [ -n "\${MOCK_AGENT_SLEEP_SECONDS:-}" ]; then
  sleep "\${MOCK_AGENT_SLEEP_SECONDS}"
fi
`
    )
  }

  const baseEnv = (extraEnv?: Record<string, string>) => ({
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    RALPH_TEST_STATE_DIR: stateDir,
    RALPH_LOOP_PID: "",
    ...extraEnv,
  })

  const run = (args: string[], extraEnv?: Record<string, string>) =>
    spawnSync(scriptPath, args, {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 30000,
      env: baseEnv(extraEnv),
    })

  const runAsync = (args: string[], extraEnv?: Record<string, string>) =>
    spawn(scriptPath, args, {
      cwd: tmpDir,
      stdio: "pipe",
      env: baseEnv(extraEnv),
    })

  return {
    tmpDir,
    stateDir,
    scriptPath,
    run,
    runAsync,
    readStateFile: (name: string) => readFileSync(join(stateDir, name), "utf-8"),
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

function createReconcileSchema(db: Database): void {
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
    CREATE TABLE task_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      renewed_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );
    CREATE TABLE orchestrator_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      pid INTEGER,
      started_at TEXT,
      updated_at TEXT
    );
  `)

  db.prepare(
    `INSERT INTO orchestrator_state (id, status, pid, started_at, updated_at)
     VALUES (1, 'stopped', NULL, NULL, datetime('now'))`
  ).run()
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

describeIf("ralph.sh integration", () => {
  const harnesses: Harness[] = []

  afterEach(() => {
    for (const h of harnesses.splice(0, harnesses.length)) {
      if (existsSync(h.tmpDir)) {
        rmSync(h.tmpDir, { recursive: true, force: true })
      }
    }
  })

  it("defaults workers to 1 and uses ralph-main as worker id", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Worker mode: workers=1 worker_id=ralph-main")

    const claims = h.readStateFile("claims.log")
    expect(claims).toContain("tx-test-1 ralph-main --lease 30")
  })

  it("rejects invalid --workers values", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--workers", "0"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid --workers value")
  })

  it("rejects invalid --claim-lease values", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--claim-lease", "0"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid --claim-lease value")
  })

  it("routes execution to codex runtime when requested", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Runtime: codex (Codex)")
  })

  it("routes execution to claude runtime when requested", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "claude", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Runtime: claude (Claude)")
  })

  it("passes --claim-lease value through to tx claim", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--claim-lease", "45", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const claims = h.readStateFile("claims.log")
    expect(claims).toContain("--lease 45")
  })

  it("spawns multiple workers with --workers and creates per-worker state files", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--workers", "2", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Spawned worker ralph-1")
    expect(log).toContain("Spawned worker ralph-2")

    expect(existsSync(join(h.tmpDir, ".tx", "ralph-state-ralph-1"))).toBe(true)
    expect(existsSync(join(h.tmpDir, ".tx", "ralph-state-ralph-2"))).toBe(true)
  })

  it("owner-safe-cleanup: does not remove lock/pid files when a non-owner invocation exits", async () => {
    const h = setupHarness()
    harnesses.push(h)

    const lockKey = "owner-safe-cleanup"
    const lockFile = join(h.tmpDir, ".tx", `ralph-${lockKey}.lock`)
    const pidFile = join(h.tmpDir, ".tx", `ralph-${lockKey}.pid`)
    const ownerProc = h.runAsync(
      ["--runtime", "codex", "--lock-key", lockKey, "--max", "1", "--max-hours", "1", "--idle-rounds", "50"],
      { MOCK_AGENT_SLEEP_SECONDS: "60" },
    )

    try {
      await waitForCondition(() => existsSync(lockFile) && existsSync(pidFile), 5000)
      const ownerPid = Number(readFileSync(lockFile, "utf-8").trim())
      expect(isPidLive(ownerPid)).toBe(true)
      expect(readFileSync(pidFile, "utf-8").trim()).toBe(String(ownerPid))

      const contender = h.run(["--runtime", "codex", "--lock-key", lockKey, "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
      expect(contender.status).not.toBe(0)
      expect(contender.stdout + contender.stderr).toContain("RALPH already running")

      expect(existsSync(lockFile)).toBe(true)
      expect(existsSync(pidFile)).toBe(true)
      expect(readFileSync(lockFile, "utf-8").trim()).toBe(String(ownerPid))
      expect(readFileSync(pidFile, "utf-8").trim()).toBe(String(ownerPid))
      expect(isPidLive(ownerPid)).toBe(true)
    } finally {
      await terminateChild(ownerProc)
    }
  })

  it("stale-race: allows only one winner when concurrent starters race against a stale lock", async () => {
    const h = setupHarness()
    harnesses.push(h)

    const lockKey = "stale-race"
    const txDir = join(h.tmpDir, ".tx")
    const lockFile = join(txDir, `ralph-${lockKey}.lock`)
    const pidFile = join(txDir, `ralph-${lockKey}.pid`)
    mkdirSync(txDir, { recursive: true })
    writeFileSync(lockFile, "999999\n")

    const proc1 = h.runAsync(
      ["--runtime", "codex", "--lock-key", lockKey, "--max", "1", "--max-hours", "1", "--idle-rounds", "50"],
      { MOCK_AGENT_SLEEP_SECONDS: "60" },
    )
    const proc2 = h.runAsync(
      ["--runtime", "codex", "--lock-key", lockKey, "--max", "1", "--max-hours", "1", "--idle-rounds", "50"],
      { MOCK_AGENT_SLEEP_SECONDS: "60" },
    )

    let proc1Out = ""
    let proc2Out = ""
    proc1.stdout.on("data", (chunk) => { proc1Out += chunk.toString() })
    proc1.stderr.on("data", (chunk) => { proc1Out += chunk.toString() })
    proc2.stdout.on("data", (chunk) => { proc2Out += chunk.toString() })
    proc2.stderr.on("data", (chunk) => { proc2Out += chunk.toString() })

    try {
      await waitForCondition(() => proc1.exitCode !== null || proc2.exitCode !== null, 8000)
      await sleep(300)

      const liveCount = [proc1, proc2].filter((proc) => proc.exitCode === null).length
      expect(liveCount).toBe(1)

      const exited = proc1.exitCode !== null ? proc1 : proc2
      const winner = exited === proc1 ? proc2 : proc1
      expect(exited.exitCode).not.toBe(0)
      expect(winner.exitCode).toBeNull()
      expect(existsSync(lockFile)).toBe(true)
      expect(existsSync(pidFile)).toBe(true)
      const lockPid = Number(readFileSync(lockFile, "utf-8").trim())
      const pidFilePid = Number(readFileSync(pidFile, "utf-8").trim())
      expect(Number.isFinite(lockPid)).toBe(true)
      expect(pidFilePid).toBe(lockPid)
      expect(lockPid).toBe(winner.pid ?? -1)
      expect(isPidLive(lockPid)).toBe(true)
      expect((proc1Out + proc2Out).includes("No such file or directory")).toBe(false)
    } finally {
      await terminateChild(proc1)
      await terminateChild(proc2)
    }
  })

  itIfSqlite3("cancels orphaned runs and expires active claims for linked tasks", () => {
    const h = setupHarness()
    harnesses.push(h)

    mkdirSync(join(h.tmpDir, ".tx"), { recursive: true })
    const dbPath = join(h.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    createReconcileSchema(db)

    const taskId = fixtureId("ralph-orphan-run-task")
    const runId = `run-${fixtureId("ralph-orphan-run").slice(3)}`
    const workerId = fixtureId("ralph-orphan-run-worker")
    const now = new Date().toISOString()

    db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "backlog")
    db.prepare(
      "INSERT INTO runs (id, task_id, pid, status, started_at, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(runId, taskId, 999999, "running", now, "{}")
    insertActiveClaim(db, taskId, workerId)
    db.close()

    const result = h.run(["--runtime", "codex", "--max", "0", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const checkDb = new Database(dbPath)
    const runRow = checkDb
      .query("SELECT status, error_message FROM runs WHERE id = ?")
      .get(runId) as { status: string; error_message: string | null } | null
    const claimStatus = getClaimStatus(checkDb, taskId)
    const activeClaimCount = getActiveClaimCount(checkDb, taskId)
    checkDb.close()

    expect(runRow).not.toBeNull()
    expect(runRow?.status).toBe("cancelled")
    expect(runRow?.error_message ?? "").toContain("orphaned")
    expect(claimStatus).toBe("expired")
    expect(activeClaimCount).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Cancelled 1 orphaned run(s)")
  })

  itIfSqlite3("resets orphaned active tasks and expires active claims during startup reconciliation", () => {
    const h = setupHarness()
    harnesses.push(h)

    mkdirSync(join(h.tmpDir, ".tx"), { recursive: true })
    const dbPath = join(h.tmpDir, ".tx", "tasks.db")
    const db = new Database(dbPath)
    createReconcileSchema(db)

    const taskId = fixtureId("ralph-orphan-active-task")
    const workerId = fixtureId("ralph-orphan-active-worker")

    db.prepare("INSERT INTO tasks (id, status) VALUES (?, ?)").run(taskId, "active")
    insertActiveClaim(db, taskId, workerId)
    db.close()

    const result = h.run(["--runtime", "codex", "--max", "0", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const checkDb = new Database(dbPath)
    const claimStatus = getClaimStatus(checkDb, taskId)
    const activeClaimCount = getActiveClaimCount(checkDb, taskId)
    checkDb.close()

    expect(claimStatus).toBe("expired")
    expect(activeClaimCount).toBe(0)

    const resetsLogPath = join(h.stateDir, "resets.log")
    expect(existsSync(resetsLogPath)).toBe(true)
    expect(readFileSync(resetsLogPath, "utf-8")).toContain(taskId)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Reset 1 orphaned active task(s)")
  })
})
