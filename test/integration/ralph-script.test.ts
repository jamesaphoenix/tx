import { Database } from "bun:sqlite"
import { describe, it, expect, afterEach } from "vitest"
import { spawn, spawnSync, type SpawnSyncReturns } from "child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { Effect, Layer } from "effect"
import type { ReviewTriggerCause } from "@jamesaphoenix/tx-types"
import {
  SqliteClientLive,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  SqliteClient,
} from "@jamesaphoenix/tx-core"
import {
  DocRepositoryLive,
  DomainEventRepositoryLive,
  DocReviewRepositoryLive,
} from "@jamesaphoenix/tx-core/repo"
import {
  SupervisionRepository,
  SupervisionRepositoryLive,
  DomainEventService,
  DomainEventServiceLive,
  DocReviewService,
  DocReviewServiceLive,
} from "@jamesaphoenix/tx-core"
import { fixtureId } from "../fixtures.js"

interface Harness {
  tmpDir: string
  stateDir: string
  scriptPath: string
  run: (args: string[], extraEnv?: Record<string, string>) => SpawnSyncReturns<string>
  runAsync: (args: string[], extraEnv?: Record<string, string>) => ReturnType<typeof spawn>
  readStateFile: (name: string) => string
}

const hasJq = spawnSync("jq", ["--version"], { stdio: "pipe" }).status === 0
const hasSqlite3 = spawnSync("sqlite3", ["--version"], { stdio: "pipe" }).status === 0
const describeIf = hasJq ? describe : describe.skip
const itIfSqlite3 = hasSqlite3 ? it : it.skip

const SOURCE_RALPH = resolve(__dirname, "../../scripts/ralph.sh")
const FAST_TASK_TIMEOUT_ARGS = ["--task-timeout", "1", "--verify-timeout", "1", "--learnings-timeout", "1"] as const

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

  // Minimal agent profiles needed by ralph.sh dispatch and auto-selection.
  const agentProfiles = ["tx-implementer", "tx-tester", "tx-reviewer", "tx-decomposer"]
  for (const profile of agentProfiles) {
    writeFileSync(join(codexAgentsDir, `${profile}.md`), `# codex ${profile} profile\n`)
    writeFileSync(join(claudeAgentsDir, `${profile}.md`), `# claude ${profile} profile\n`)
  }

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
    elif [ "\${MOCK_SCOPE_FIXTURE:-0}" = "1" ]; then
      touch "$STATE_DIR/ready_once_consumed"
      echo '[{"id":"tx-other-1","title":"Other design task","score":900,"children":[],"linkedDocs":[{"docId":"doc-other-design","name":"other-design","title":"Other Design","kind":"design","version":1,"status":"changing","filePath":"design/other-design.md","linkType":"references"}]},{"id":"tx-test-1","title":"Scoped design task","score":500,"children":[],"linkedDocs":[{"docId":"doc-test-design","name":"test-design","title":"Test Design","kind":"design","version":1,"status":"changing","filePath":"design/test-design.md","linkType":"references"}]}]'
    else
      touch "$STATE_DIR/ready_once_consumed"
      echo '[{"id":"tx-test-1","title":"Test task","score":500,"children":[]}]'
    fi
    ;;
  list)
    if printf '%s\\n' "$*" | grep -q -- "--status active"; then
      echo "[]"
    elif [ "\${MOCK_SCOPE_FIXTURE:-0}" = "1" ]; then
      echo '[{"id":"tx-test-1","title":"Scoped design task","status":"active","score":500,"linkedDocs":[{"docId":"doc-test-design","name":"test-design","title":"Test Design","kind":"design","version":1,"status":"changing","filePath":"design/test-design.md","linkType":"references"}]},{"id":"tx-test-3","title":"Scoped sibling task","status":"blocked","score":350,"linkedDocs":[{"docId":"doc-test-design","name":"test-design","title":"Test Design","kind":"design","version":1,"status":"changing","filePath":"design/test-design.md","linkType":"references"}]},{"id":"tx-other-1","title":"Other design task","status":"ready","score":900,"linkedDocs":[{"docId":"doc-other-design","name":"other-design","title":"Other Design","kind":"design","version":1,"status":"changing","filePath":"design/other-design.md","linkType":"references"}]}]'
    else
      echo '[{"id":"tx-test-1","title":"Test task","status":"active","score":500},{"id":"tx-test-2","title":"Sibling task","status":"backlog","score":350}]'
    fi
    ;;
  claim)
    SUBCMD="\${1:-}"
    if [ "$SUBCMD" = "release" ]; then
      shift || true
      echo "$*" >> "$STATE_DIR/releases.log"
    else
      echo "$*" >> "$STATE_DIR/claims.log"
      if [ "\${MOCK_CLAIM_FAIL:-0}" = "1" ]; then
        exit 1
      fi
    fi
    ;;
  show)
    STATUS="\${MOCK_SHOW_STATUS:-done}"
    TASK_ID="\${1:-tx-test-1}"
    if [ "\${MOCK_SCOPE_FIXTURE:-0}" = "1" ]; then
      case "$TASK_ID" in
        tx-test-3)
          echo "{\\"id\\":\\"tx-test-3\\",\\"title\\":\\"Scoped sibling task\\",\\"status\\":\\"blocked\\",\\"score\\":350,\\"linkedDocs\\":[{\\"docId\\":\\"doc-test-design\\",\\"name\\":\\"test-design\\",\\"title\\":\\"Test Design\\",\\"kind\\":\\"design\\",\\"version\\":1,\\"status\\":\\"changing\\",\\"filePath\\":\\"design/test-design.md\\",\\"linkType\\":\\"references\\"}]}"
          ;;
        tx-other-1)
          echo "{\\"id\\":\\"tx-other-1\\",\\"title\\":\\"Other design task\\",\\"status\\":\\"$STATUS\\",\\"score\\":900,\\"linkedDocs\\":[{\\"docId\\":\\"doc-other-design\\",\\"name\\":\\"other-design\\",\\"title\\":\\"Other Design\\",\\"kind\\":\\"design\\",\\"version\\":1,\\"status\\":\\"changing\\",\\"filePath\\":\\"design/other-design.md\\",\\"linkType\\":\\"references\\"}]}"
          ;;
        *)
          echo "{\\"id\\":\\"tx-test-1\\",\\"title\\":\\"Scoped design task\\",\\"status\\":\\"$STATUS\\",\\"score\\":500,\\"linkedDocs\\":[{\\"docId\\":\\"doc-test-design\\",\\"name\\":\\"test-design\\",\\"title\\":\\"Test Design\\",\\"kind\\":\\"design\\",\\"version\\":1,\\"status\\":\\"changing\\",\\"filePath\\":\\"design/test-design.md\\",\\"linkType\\":\\"references\\"}]}"
          ;;
      esac
    else
      echo "{\\"id\\":\\"tx-test-1\\",\\"title\\":\\"Test task\\",\\"status\\":\\"$STATUS\\",\\"score\\":500,\\"linkedDocs\\":[{\\"docId\\":\\"doc-test-design\\",\\"name\\":\\"test-design\\",\\"title\\":\\"Test Design\\",\\"kind\\":\\"design\\",\\"version\\":1,\\"status\\":\\"changing\\",\\"filePath\\":\\"design/test-design.md\\",\\"linkType\\":\\"references\\"}]}"
    fi
    ;;
  doc)
    SUBCMD="\${1:-}"
    shift || true
    case "$SUBCMD" in
      show)
        DOC_NAME="\${1:-}"
        if [ "$DOC_NAME" = "test-design" ]; then
          cat <<'EOF'
---
kind: spec
spec_type: design
name: test-design
title: Test Design
status: draft
version: 1
owners:
  - core
summary: Test design summary
domain: test
tags:
  - design
  - test
depends_on: []
supersedes: []
implements: test-prd
last_reviewed_at: 2026-03-27
---

# Summary
Test design guidance from linked spec.

# Architecture
The worker should read this before coding.
EOF
        elif [ "$DOC_NAME" = "other-design" ]; then
          cat <<'EOF'
# Other Design
This design doc should be excluded from the scoped prompt bundle.
EOF
        else
          echo "# $DOC_NAME"
        fi
        ;;
      *)
        echo ""
        ;;
    esac
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

async function waitForExit(proc: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
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

async function terminateChild(proc: ReturnType<typeof spawn>): Promise<void> {
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
  // eslint-disable-next-line tx/no-inline-sql -- test-only in-memory schema fixture
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

    const result = h.run(["--runtime", "codex", "--all-tasks", "--max", "1", "--max-hours", "1", "--idle-rounds", "1", ...FAST_TASK_TIMEOUT_ARGS])
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

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--idle-rounds", "1", ...FAST_TASK_TIMEOUT_ARGS])
    expect(result.status).toBe(0)

    // Retry briefly in case log file is not yet flushed to disk
    const logPath = join(h.tmpDir, ".tx", "ralph.log")
    let log = ""
    for (let i = 0; i < 10; i++) {
      if (existsSync(logPath)) {
        log = readFileSync(logPath, "utf-8")
        if (log.includes("Runtime: codex (Codex)")) break
      }
      spawnSync("sleep", ["0.05"])
    }
    expect(log).toContain("Runtime: codex (Codex)")
  })

  it("routes execution to claude runtime when requested", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "claude", "--max", "1", "--max-hours", "1", "--idle-rounds", "1", ...FAST_TASK_TIMEOUT_ARGS])
    expect(result.status).toBe(0)

    const logPath = join(h.tmpDir, ".tx", "ralph.log")
    let log = ""
    for (let i = 0; i < 10; i++) {
      if (existsSync(logPath)) {
        log = readFileSync(logPath, "utf-8")
        if (log.includes("Runtime: claude (Claude)")) break
      }
      spawnSync("sleep", ["0.05"])
    }
    expect(log).toContain("Runtime: claude (Claude)")
  })

  it("includes task-spec loop guidance in the agent prompt", () => {
    const h = setupHarness()
    harnesses.push(h)

    const script = readFileSync(h.scriptPath, "utf-8")
    expect(script).toContain("tx show $task_id")
    expect(script).toContain("tx add ... --parent $task_id")
    expect(script).toContain("tx dep block")
    expect(script).toContain("tx dep unblock")
    expect(script).toContain("paired PRD/design doc")
    expect(script).toContain("tx doc attach $task_id <prd-doc> --type implements")
    expect(script).toContain("tx doc attach $task_id <design-doc> --type references")
    expect(script).toContain("create follow-up docs work or block the task")
    expect(script).toContain("tx update $task_id --status blocked")
  })

  it("injects current task payload, linked design docs, and all tasks into prompt artifacts", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--all-tasks", "--max", "1", "--max-hours", "1", "--idle-rounds", "1", ...FAST_TASK_TIMEOUT_ARGS])
    expect(result.status).toBe(0)

    const codexPrompt = h.readStateFile("codex.log")
    expect(codexPrompt).toContain("===== BEGIN CURRENT TASK PAYLOAD (JSON) =====")
    expect(codexPrompt).toContain('"id":"tx-test-1"')
    expect(codexPrompt).toContain("===== BEGIN LINKED DESIGN DOCS (MARKDOWN) =====")
    expect(codexPrompt).toContain("Test design guidance from linked spec.")
    expect(codexPrompt).toContain("===== BEGIN ALL TASKS (JSON) =====")
    expect(codexPrompt).toContain('"id":"tx-test-2"')
    expect(codexPrompt).toContain("tx update <id> --score <n>")

    const runsDir = join(h.tmpDir, ".tx", "runs")
    expect(existsSync(runsDir)).toBe(true)
    const runIds = readdirSync(runsDir)
    expect(runIds.length).toBe(1)

    const runDir = join(runsDir, runIds[0]!)
    const currentTask = readFileSync(join(runDir, "current-task.json"), "utf-8")
    const designDocs = readFileSync(join(runDir, "linked-design-docs.md"), "utf-8")
    const allTasks = readFileSync(join(runDir, "all-tasks.json"), "utf-8")
    const promptContext = readFileSync(join(runDir, "prompt-context.txt"), "utf-8")
    const context = readFileSync(join(runDir, "context.md"), "utf-8")

    expect(currentTask).toContain('"name":"test-design"')
    expect(designDocs).toContain("Test design guidance from linked spec.")
    expect(allTasks).toContain('"id":"tx-test-2"')
    expect(promptContext).toContain("===== BEGIN CURRENT TASK PAYLOAD (JSON) =====")
    expect(promptContext).toContain("===== BEGIN ALL TASKS (JSON) =====")
    expect(context).toContain("===== BEGIN CURRENT TASK PAYLOAD (JSON) =====")
    expect(context).toContain("===== BEGIN ALL TASKS (JSON) =====")
  })

  it("filters ready selection and injected queue state to the requested design doc", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(
      ["--runtime", "codex", "--design-doc", "test-design", "--max", "1", "--max-hours", "1", "--idle-rounds", "1", ...FAST_TASK_TIMEOUT_ARGS],
      { MOCK_SCOPE_FIXTURE: "1" },
    )
    expect(result.status).toBe(0)

    const runsDir = join(h.tmpDir, ".tx", "runs")
    expect(existsSync(runsDir)).toBe(true)
    const runIds = readdirSync(runsDir)
    expect(runIds.length).toBe(1)

    const runDir = join(runsDir, runIds[0]!)
    const currentTask = readFileSync(join(runDir, "current-task.json"), "utf-8")
    const designDocs = readFileSync(join(runDir, "linked-design-docs.md"), "utf-8")
    const allTasks = readFileSync(join(runDir, "all-tasks.json"), "utf-8")
    const promptContext = readFileSync(join(runDir, "prompt-context.txt"), "utf-8")
    const context = readFileSync(join(runDir, "context.md"), "utf-8")

    expect(currentTask).toContain('"id":"tx-test-1"')
    expect(currentTask).not.toContain("tx-other-1")
    expect(designDocs).toContain("Test design guidance from linked spec.")
    expect(allTasks).toContain("tx-test-1")
    expect(allTasks).toContain("tx-test-3")
    expect(allTasks).not.toContain("tx-other-1")
    expect(promptContext).toContain("design-doc:test-design")
    expect(context).toContain("Task scope: design-doc:test-design")
  })

  it("passes --claim-lease value through to tx claim", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--claim-lease", "45", "--idle-rounds", "1", ...FAST_TASK_TIMEOUT_ARGS])
    expect(result.status).toBe(0)

    const claims = h.readStateFile("claims.log")
    expect(claims).toContain("--lease 45")
  })

  it("spawns multiple workers with --workers and creates per-worker state files", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--workers", "2", "--max", "1", "--max-hours", "1", "--idle-rounds", "1", ...FAST_TASK_TIMEOUT_ARGS])
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
    proc1.stdout?.on("data", (chunk) => { proc1Out += chunk.toString() })
    proc1.stderr?.on("data", (chunk) => { proc1Out += chunk.toString() })
    proc2.stdout?.on("data", (chunk) => { proc2Out += chunk.toString() })
    proc2.stderr?.on("data", (chunk) => { proc2Out += chunk.toString() })

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

// =============================================================================
// Supervision Bridge Integration Tests
//
// Tests the core service calls that ralph-supervision-bridge.ts makes, exercised
// against real in-memory SQLite. Verifies INV-SUP-001 (clean shutdown when no
// eligible tasks remain in scope).
//
// @see DD-039 for specification
// @see DD-007 for testing strategy
// @spec INV-SUP-001
// =============================================================================

const BRIDGE_NAMESPACE = "ralph-bridge-test"

const bridgeFixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${BRIDGE_NAMESPACE}:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const bridgeFixtureSessionId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${BRIDGE_NAMESPACE}:session:${name}`)
    .digest("hex")
    .substring(0, 12)
  return `ws-${hash}`
}

const bridgeFixtureDocId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${BRIDGE_NAMESPACE}:doc:${name}`)
    .digest("hex")
    .substring(0, 12)
  return `doc-${hash}`
}

const BF = {
  WORKER_1: bridgeFixtureId("worker-1"),
  WORKER_2: bridgeFixtureId("worker-2"),
  SESSION_1: bridgeFixtureSessionId("session-1"),
  SESSION_2: bridgeFixtureSessionId("session-2"),
  TASK_1: bridgeFixtureId("task-1"),
  TASK_2: bridgeFixtureId("task-2"),
  TASK_3: bridgeFixtureId("task-3"),
  DOC_STABLE_1: bridgeFixtureDocId("design-doc-1"),
  DOC_NAME_1: "test-ralph-bridge-doc",
} as const

function makeBridgeTestLayer() {
  const infra = SqliteClientLive(":memory:")

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    DocRepositoryLive,
    DomainEventRepositoryLive,
    SupervisionRepositoryLive,
    DocReviewRepositoryLive,
  ).pipe(Layer.provide(infra))

  const domainEventService = DomainEventServiceLive.pipe(Layer.provide(repos))

  const docReviewService = DocReviewServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, domainEventService, infra))
  )

  return Layer.mergeAll(repos, domainEventService, docReviewService, infra)
}

const runBridge = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(makeBridgeTestLayer())) as Effect.Effect<A, never, never>
  )

const BRIDGE_NOW = new Date().toISOString()

const seedBridgeWorker = (workerId: string, name: string, status = "idle") =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    db.prepare(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, metadata)
       VALUES (?, ?, 'test-host', 12345, ?, ?, ?, '{}')`
    ).run(workerId, name, status, BRIDGE_NOW, BRIDGE_NOW)
  })

const seedBridgeTask = (taskId: string, title: string, status = "active") =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const completedAt = status === "done" ? BRIDGE_NOW : null
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, 'Test task', ?, NULL, 500, ?, ?, ?, '{}')`
    ).run(taskId, title, status, BRIDGE_NOW, BRIDGE_NOW, completedAt)
  })

const seedBridgeDoc = (docStableId: string, name: string, version = 1) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const hash = createHash("sha256").update(`${name}:${version}`).digest("hex").substring(0, 16)
    db.prepare(
      `INSERT INTO docs (doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
       VALUES (?, ?, 'design', ?, ?, ?, 'changing', ?, NULL, ?, '{}')`
    ).run(docStableId, hash, name, `Test: ${name}`, version, `design/${name}.md`, BRIDGE_NOW)
  })

const seedBridgeRun = (runId: string, taskId: string, status = "running") =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
       VALUES (?, ?, 'tx-tester', ?, ?, '{}')`
    ).run(runId, taskId, BRIDGE_NOW, status)
  })

const bridgeLinkTaskToDoc = (taskId: string, docName: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const docRow = db.prepare(
      "SELECT id FROM docs WHERE name = ? ORDER BY version DESC LIMIT 1"
    ).get(docName) as { id: number } | null
    if (!docRow) throw new Error(`Doc not found: ${docName}`)
    db.prepare(
      "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, 'references', ?)"
    ).run(taskId, docRow.id, BRIDGE_NOW)
  })

/** Mirror of ralph-supervision-bridge.ts sessionCreate() */
const bridgeSessionCreate = (opts: {
  sessionId: string
  workerId: string
  scopeMode?: string
  scopeRef?: string | null
  runtime?: string
  tmuxSessionName?: string | null
}) =>
  Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    const events = yield* DomainEventService

    const session = yield* repo.createSession({
      id: opts.sessionId,
      workerId: opts.workerId,
      scopeMode: opts.scopeMode ?? "all",
      scopeRef: opts.scopeRef ?? null,
      orchestrator: "ralph",
      runtime: opts.runtime ?? "claude",
      terminalBackend: "tmux",
      tmuxSessionName: opts.tmuxSessionName ?? null,
      tmuxWindowName: "main",
      tmuxPaneId: "%0",
      controlMode: "agent",
      currentTaskId: null,
      currentRunId: null,
      activeTerminalController: null,
      startedAt: BRIDGE_NOW,
      lastHeartbeatAt: BRIDGE_NOW,
      metadata: { pid: 12345, source: "ralph.sh" },
    })

    yield* events.publish({
      eventType: "worker.session_created",
      streamType: "worker_session",
      streamId: session.id,
      aggregateType: "worker",
      aggregateId: opts.workerId,
      actorType: "system",
      actorId: "ralph",
      schemaVersion: 1,
      payload: {
        sessionId: session.id,
        workerId: opts.workerId,
        scopeMode: opts.scopeMode ?? "all",
        scopeRef: opts.scopeRef ?? null,
        runtime: opts.runtime ?? "claude",
        tmuxSessionName: opts.tmuxSessionName ?? null,
      },
      metadata: {},
    })

    return session
  })

/** Mirror of ralph-supervision-bridge.ts sessionUpdate() */
const bridgeSessionUpdate = (sessionId: string, fields: {
  currentTaskId?: string | null
  currentRunId?: string | null
}) =>
  Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    yield* repo.updateSession(sessionId, {
      currentTaskId: fields.currentTaskId,
      currentRunId: fields.currentRunId,
      lastHeartbeatAt: new Date().toISOString(),
    })
  })

/** Mirror of ralph-supervision-bridge.ts sessionEnd() */
const bridgeSessionEnd = (sessionId: string) =>
  Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    const events = yield* DomainEventService
    const now = new Date().toISOString()

    const session = yield* repo.getSessionById(sessionId)
    if (!session || session.endedAt) return

    yield* repo.endSession(sessionId, now)

    yield* events.publish({
      eventType: "worker.session_ended",
      streamType: "worker_session",
      streamId: sessionId,
      aggregateType: "worker",
      aggregateId: session.workerId,
      actorType: "system",
      actorId: "ralph",
      schemaVersion: 1,
      payload: { sessionId, workerId: session.workerId, endedAt: now },
      metadata: {},
    })
  })

/** Mirror of ralph.sh handle_scope_drain() */
const bridgeHandleScopeDrain = (opts: {
  workerId: string
  sessionId: string
  scopeMode: string
  scopeRef?: string | null
}) =>
  Effect.gen(function* () {
    const events = yield* DomainEventService
    const drainPayload = {
      sessionId: opts.sessionId,
      workerId: opts.workerId,
      scopeMode: opts.scopeMode,
      scopeRef: opts.scopeRef ?? null,
    }

    yield* events.publish({
      eventType: "worker.scope_drained",
      streamType: "worker_session",
      streamId: opts.sessionId,
      aggregateType: "worker",
      aggregateId: opts.workerId,
      actorType: "system",
      actorId: "ralph",
      schemaVersion: 1,
      payload: drainPayload,
      metadata: {},
    })

    yield* events.publish({
      eventType: "worker.shutdown_requested",
      streamType: "worker_session",
      streamId: opts.sessionId,
      aggregateType: "worker",
      aggregateId: opts.workerId,
      actorType: "system",
      actorId: "ralph",
      schemaVersion: 1,
      payload: drainPayload,
      metadata: {},
    })

    let triggerResult = null
    if (opts.scopeMode === "design-doc" && opts.scopeRef) {
      const docReview = yield* DocReviewService
      triggerResult = yield* docReview.maybeTrigger(
        opts.scopeRef,
        "scope_drained" as ReviewTriggerCause
      )
    }

    yield* events.publish({
      eventType: "worker.shutdown_completed",
      streamType: "worker_session",
      streamId: opts.sessionId,
      aggregateType: "worker",
      aggregateId: opts.workerId,
      actorType: "system",
      actorId: "ralph",
      schemaVersion: 1,
      payload: drainPayload,
      metadata: {},
    })

    return triggerResult
  })

describe("Ralph Supervision Bridge Integration [INV-SUP-001]", () => {

  // ---------------------------------------------------------------------------
  // 1. tmux session creation hook
  // ---------------------------------------------------------------------------
  describe("tmux session creation hook", () => {

    it("creates a worker_sessions row with correct tmux metadata", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        const session = yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "all",
          runtime: "claude",
          tmuxSessionName: "ralph-worker-1",
        })

        expect(session.id).toBe(BF.SESSION_1)
        expect(session.workerId).toBe(BF.WORKER_1)
        expect(session.scopeMode).toBe("all")
        expect(session.orchestrator).toBe("ralph")
        expect(session.runtime).toBe("claude")
        expect(session.terminalBackend).toBe("tmux")
        expect(session.tmuxSessionName).toBe("ralph-worker-1")
        expect(session.controlMode).toBe("agent")
        expect(session.currentTaskId).toBeNull()
        expect(session.endedAt).toBeNull()
      })))

    it("emits worker.session_created domain event with tmux session name", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: "my-design-doc",
          runtime: "codex",
          tmuxSessionName: "ralph-worker-1",
        })

        const eventSvc = yield* DomainEventService
        const sessionEvents = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)

        expect(sessionEvents.length).toBe(1)
        expect(sessionEvents[0].eventType).toBe("worker.session_created")
        expect(sessionEvents[0].aggregateId).toBe(BF.WORKER_1)
        expect(sessionEvents[0].actorId).toBe("ralph")

        const payload = sessionEvents[0].payload as Record<string, unknown>
        expect(payload.tmuxSessionName).toBe("ralph-worker-1")
        expect(payload.scopeMode).toBe("design-doc")
        expect(payload.scopeRef).toBe("my-design-doc")
      })))

    it("handles null tmux fields when tmux is unavailable", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        const session = yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          tmuxSessionName: null,
        })

        expect(session.tmuxSessionName).toBeNull()
      })))
  })

  // ---------------------------------------------------------------------------
  // 2. Session creation/update/end calls to core
  // ---------------------------------------------------------------------------
  describe("session creation/update/end lifecycle", () => {

    it("update sets currentTaskId and currentRunId on the session row", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeTask(BF.TASK_1, "task-1", "active")
        yield* seedBridgeRun("run-abc", BF.TASK_1)

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
        })

        yield* bridgeSessionUpdate(BF.SESSION_1, {
          currentTaskId: BF.TASK_1,
          currentRunId: null,
        })

        const repo = yield* SupervisionRepository
        const s1 = yield* repo.getSessionById(BF.SESSION_1)
        expect(s1!.currentTaskId).toBe(BF.TASK_1)
        expect(s1!.currentRunId).toBeNull()

        yield* bridgeSessionUpdate(BF.SESSION_1, {
          currentTaskId: BF.TASK_1,
          currentRunId: "run-abc",
        })

        const s2 = yield* repo.getSessionById(BF.SESSION_1)
        expect(s2!.currentRunId).toBe("run-abc")
      })))

    it("update clears task/run fields after task completion", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeTask(BF.TASK_1, "task-1", "active")
        yield* seedBridgeRun("run-1", BF.TASK_1)

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
        })

        yield* bridgeSessionUpdate(BF.SESSION_1, {
          currentTaskId: BF.TASK_1,
          currentRunId: "run-1",
        })

        yield* bridgeSessionUpdate(BF.SESSION_1, {
          currentTaskId: null,
          currentRunId: null,
        })

        const repo = yield* SupervisionRepository
        const session = yield* repo.getSessionById(BF.SESSION_1)
        expect(session!.currentTaskId).toBeNull()
        expect(session!.currentRunId).toBeNull()
      })))

    it("heartbeat updates lastHeartbeatAt timestamp", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
        })

        const repo = yield* SupervisionRepository
        const before = yield* repo.getSessionById(BF.SESSION_1)

        yield* Effect.sleep("10 millis")
        yield* repo.updateHeartbeat(BF.SESSION_1, new Date().toISOString())

        const after = yield* repo.getSessionById(BF.SESSION_1)
        expect(after!.lastHeartbeatAt).not.toBe(before!.lastHeartbeatAt)
      })))

    it("end sets endedAt and emits worker.session_ended event", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
        })

        yield* bridgeSessionEnd(BF.SESSION_1)

        const repo = yield* SupervisionRepository
        const ended = yield* repo.getSessionById(BF.SESSION_1)
        expect(ended!.endedAt).toBeTruthy()

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)
        const endedEvent = events.find(e => e.eventType === "worker.session_ended")
        expect(endedEvent).toBeDefined()
        expect((endedEvent!.payload as Record<string, unknown>).sessionId).toBe(BF.SESSION_1)
      })))

    it("ending an already-ended session is idempotent", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
        })

        yield* bridgeSessionEnd(BF.SESSION_1)
        yield* bridgeSessionEnd(BF.SESSION_1)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)
        const endedEvents = events.filter(e => e.eventType === "worker.session_ended")
        expect(endedEvents.length).toBe(1)
      })))

    it("full lifecycle: create → update → end produces expected events", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeTask(BF.TASK_1, "task-1", "active")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          tmuxSessionName: "ralph-worker-1",
        })

        yield* bridgeSessionUpdate(BF.SESSION_1, { currentTaskId: BF.TASK_1 })
        yield* bridgeSessionUpdate(BF.SESSION_1, { currentTaskId: null, currentRunId: null })
        yield* bridgeSessionEnd(BF.SESSION_1)

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)
        const types = events.map(e => e.eventType)

        expect(types).toContain("worker.session_created")
        expect(types).toContain("worker.session_ended")
        expect(events.length).toBe(2)
      })))
  })

  // ---------------------------------------------------------------------------
  // 3. Scope-drain shutdown (INV-SUP-001)
  // ---------------------------------------------------------------------------
  describe("scope-drain shutdown [INV-SUP-001]", () => {

    it("emits scope_drained, shutdown_requested, and shutdown_completed events", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "all",
        })

        yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "all",
        })

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)

        const drainTypes = events
          .filter(e => ["worker.scope_drained", "worker.shutdown_requested", "worker.shutdown_completed"].includes(e.eventType))
          .map(e => e.eventType)

        expect(drainTypes).toContain("worker.scope_drained")
        expect(drainTypes).toContain("worker.shutdown_requested")
        expect(drainTypes).toContain("worker.shutdown_completed")
        expect(drainTypes.length).toBe(3)
      })))

    it("scope_drained payload includes session, worker, and scope details", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)
        const drained = events.find(e => e.eventType === "worker.scope_drained")!

        const payload = drained.payload as Record<string, unknown>
        expect(payload.sessionId).toBe(BF.SESSION_1)
        expect(payload.workerId).toBe(BF.WORKER_1)
        expect(payload.scopeMode).toBe("design-doc")
        expect(payload.scopeRef).toBe(BF.DOC_NAME_1)
      })))

    it("all drain events are queryable by worker aggregate", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
        })

        yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "all",
        })

        const eventSvc = yield* DomainEventService
        const workerEvents = yield* eventSvc.listByAggregate("worker", BF.WORKER_1)
        const drainTypes = workerEvents
          .filter(e => e.eventType.startsWith("worker.shutdown") || e.eventType === "worker.scope_drained")
          .map(e => e.eventType)

        expect(drainTypes).toContain("worker.scope_drained")
        expect(drainTypes).toContain("worker.shutdown_requested")
        expect(drainTypes).toContain("worker.shutdown_completed")
      })))

    it("all-scope drain does not invoke maybeTrigger or emit design_doc events", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "all",
        })

        const result = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "all",
        })

        expect(result).toBeNull()

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)
        expect(events.filter(e => e.eventType.startsWith("design_doc.")).length).toBe(0)
      })))
  })

  // ---------------------------------------------------------------------------
  // 4. Design-doc maybe-trigger hook on drain
  // ---------------------------------------------------------------------------
  describe("design-doc maybe-trigger on drain", () => {

    it("triggers review when all linked tasks are done", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeDoc(BF.DOC_STABLE_1, BF.DOC_NAME_1)
        yield* seedBridgeTask(BF.TASK_1, "task-1", "done")
        yield* seedBridgeTask(BF.TASK_2, "task-2", "done")
        yield* bridgeLinkTaskToDoc(BF.TASK_1, BF.DOC_NAME_1)
        yield* bridgeLinkTaskToDoc(BF.TASK_2, BF.DOC_NAME_1)

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        const triggerResult = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        expect(triggerResult!.outcome).toBe("triggered")
        expect(triggerResult!.reviewRunId).toBeTruthy()

        const eventSvc = yield* DomainEventService
        const docEvents = yield* eventSvc.listByStream("design_doc", BF.DOC_STABLE_1)
        const docTypes = docEvents.map(e => e.eventType)
        expect(docTypes).toContain("design_doc.review_eligible")
        expect(docTypes).toContain("design_doc.review_triggered")
      })))

    it("returns not_all_done when linked tasks are incomplete", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeDoc(BF.DOC_STABLE_1, BF.DOC_NAME_1)
        yield* seedBridgeTask(BF.TASK_1, "task-1", "done")
        yield* seedBridgeTask(BF.TASK_2, "task-2", "active")
        yield* bridgeLinkTaskToDoc(BF.TASK_1, BF.DOC_NAME_1)
        yield* bridgeLinkTaskToDoc(BF.TASK_2, BF.DOC_NAME_1)

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        const triggerResult = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        expect(triggerResult!.outcome).toBe("not_all_done")
        expect(triggerResult!.reviewRunId).toBeNull()
      })))

    it("returns no_linked_tasks when design doc has no linked tasks", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeDoc(BF.DOC_STABLE_1, BF.DOC_NAME_1)

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        const triggerResult = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        expect(triggerResult!.outcome).toBe("no_linked_tasks")
      })))

    it("second drain with same task snapshot is idempotent (already_active)", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeDoc(BF.DOC_STABLE_1, BF.DOC_NAME_1)
        yield* seedBridgeTask(BF.TASK_1, "task-1", "done")
        yield* bridgeLinkTaskToDoc(BF.TASK_1, BF.DOC_NAME_1)

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })

        const first = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })
        expect(first!.outcome).toBe("triggered")

        const second = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })
        expect(second!.outcome).toBe("already_active")
      })))
  })

  // ---------------------------------------------------------------------------
  // 5. Full worker lifecycle (INV-SUP-001)
  // ---------------------------------------------------------------------------
  describe("full worker lifecycle [INV-SUP-001]", () => {

    it("create → work → drain → trigger → end produces correct event sequence", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")
        yield* seedBridgeDoc(BF.DOC_STABLE_1, BF.DOC_NAME_1)
        yield* seedBridgeTask(BF.TASK_1, "implement-auth", "done")
        yield* seedBridgeTask(BF.TASK_2, "implement-api", "done")
        yield* bridgeLinkTaskToDoc(BF.TASK_1, BF.DOC_NAME_1)
        yield* bridgeLinkTaskToDoc(BF.TASK_2, BF.DOC_NAME_1)

        // 1. Start
        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
          tmuxSessionName: "ralph-worker-1",
        })

        // 2. Work on tasks
        yield* bridgeSessionUpdate(BF.SESSION_1, { currentTaskId: BF.TASK_1 })
        yield* bridgeSessionUpdate(BF.SESSION_1, { currentTaskId: BF.TASK_2 })
        yield* bridgeSessionUpdate(BF.SESSION_1, { currentTaskId: null, currentRunId: null })

        // 3. Drain + trigger
        const trigger = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "design-doc",
          scopeRef: BF.DOC_NAME_1,
        })
        expect(trigger!.outcome).toBe("triggered")

        // 4. End
        yield* bridgeSessionEnd(BF.SESSION_1)

        // Verify session state
        const repo = yield* SupervisionRepository
        const session = yield* repo.getSessionById(BF.SESSION_1)
        expect(session!.endedAt).toBeTruthy()
        expect(session!.currentTaskId).toBeNull()

        // Verify worker_session event stream
        const eventSvc = yield* DomainEventService
        const wsEvents = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)
        const wsTypes = wsEvents.map(e => e.eventType)

        expect(wsTypes).toContain("worker.session_created")
        expect(wsTypes).toContain("worker.scope_drained")
        expect(wsTypes).toContain("worker.shutdown_requested")
        expect(wsTypes).toContain("worker.shutdown_completed")
        expect(wsTypes).toContain("worker.session_ended")

        // Verify design_doc event stream
        const docEvents = yield* eventSvc.listByStream("design_doc", BF.DOC_STABLE_1)
        const docTypes = docEvents.map(e => e.eventType)
        expect(docTypes).toContain("design_doc.review_eligible")
        expect(docTypes).toContain("design_doc.review_triggered")
      })))

    it("all-scope worker lifecycle drains cleanly without review", () =>
      runBridge(Effect.gen(function* () {
        yield* seedBridgeWorker(BF.WORKER_1, "ralph-worker-1")

        yield* bridgeSessionCreate({
          sessionId: BF.SESSION_1,
          workerId: BF.WORKER_1,
          scopeMode: "all",
        })

        const trigger = yield* bridgeHandleScopeDrain({
          workerId: BF.WORKER_1,
          sessionId: BF.SESSION_1,
          scopeMode: "all",
        })
        expect(trigger).toBeNull()

        yield* bridgeSessionEnd(BF.SESSION_1)

        const repo = yield* SupervisionRepository
        const session = yield* repo.getSessionById(BF.SESSION_1)
        expect(session!.endedAt).toBeTruthy()

        const eventSvc = yield* DomainEventService
        const events = yield* eventSvc.listByStream("worker_session", BF.SESSION_1)
        expect(events.filter(e => e.eventType.startsWith("design_doc.")).length).toBe(0)
        expect(events.some(e => e.eventType === "worker.session_created")).toBe(true)
        expect(events.some(e => e.eventType === "worker.shutdown_completed")).toBe(true)
        expect(events.some(e => e.eventType === "worker.session_ended")).toBe(true)
      })))
  })
})
