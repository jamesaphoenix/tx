import { describe, it, expect } from "vitest"
import { spawnSync, type SpawnSyncReturns } from "child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, symlinkSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { Database } from "bun:sqlite"

const RUN_LIVE = process.env.TX_RUN_LIVE_AGENT_TESTS === "1"
const KEEP_SANDBOX = process.env.TX_KEEP_LIVE_AGENT_SANDBOX === "1"
const describeLive = RUN_LIVE ? describe : describe.skip

const REPO_ROOT = resolve(__dirname, "..", "..")
const SOURCE_RALPH = resolve(REPO_ROOT, "scripts", "ralph.sh")
const DEFAULT_TIMEOUT_MS = 240000

let codexAvailability: boolean | null = null
let claudeAvailability: boolean | null = null

function commandExists(command: string): boolean {
  return spawnSync(command, ["--version"], { encoding: "utf-8", stdio: "pipe" }).status === 0
}

function canRunCodex(): boolean {
  if (codexAvailability !== null) return codexAvailability
  if (!commandExists("codex")) return false
  const probe = spawnSync(
    "codex",
    ["exec", "--skip-git-repo-check", "--full-auto", "Respond with exactly: ok"],
    { encoding: "utf-8", stdio: "pipe", timeout: 45000, cwd: REPO_ROOT }
  )
  codexAvailability = probe.status === 0 && (probe.stdout + probe.stderr).toLowerCase().includes("ok")
  return codexAvailability
}

function canRunClaude(): boolean {
  if (claudeAvailability !== null) return claudeAvailability
  if (!commandExists("claude")) return false
  const probe = spawnSync(
    "claude",
    ["--dangerously-skip-permissions", "--print", "Respond with exactly: ok"],
    { encoding: "utf-8", stdio: "pipe", timeout: 45000, cwd: REPO_ROOT }
  )
  claudeAvailability = probe.status === 0 && (probe.stdout + probe.stderr).toLowerCase().includes("ok")
  return claudeAvailability
}

interface Sandbox {
  dir: string
  scriptPath: string
  taskId: string
}

interface RalphRunOptions {
  workers?: number
  workerId?: string
  workerPrefix?: string
}

interface RunRow {
  status: string
  task_id: string
  exit_code: number | null
  ended_at: string | null
  metadata: string | null
}

interface ClaimRow {
  worker_id: string
  status: string
}

function resolveCommandPath(command: string): string | null {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf-8",
    stdio: "pipe",
  })
  if (result.status !== 0) return null
  const path = result.stdout.trim()
  return path.length > 0 ? path : null
}

function runTxCli(dir: string, args: string[], label: string): SpawnSyncReturns<string> {
  const result = spawnSync("bun", ["apps/cli/src/cli.ts", ...args], {
    cwd: dir,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 90000,
  })

  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`)
  }

  return result
}

function setupSandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "tx-ralph-live-"))
  const scriptPath = join(dir, "scripts", "ralph.sh")
  const binDir = join(dir, "bin")

  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, ".claude", "agents"), { recursive: true })
  mkdirSync(join(dir, ".codex", "agents"), { recursive: true })
  mkdirSync(binDir, { recursive: true })

  // Copy script under test.
  writeFileSync(scriptPath, readFileSync(SOURCE_RALPH, "utf-8"))
  chmodSync(scriptPath, 0o755)

  // Symlink monorepo folders required by `bun apps/cli/src/cli.ts ...`.
  symlinkSync(resolve(REPO_ROOT, "apps"), join(dir, "apps"), "dir")
  symlinkSync(resolve(REPO_ROOT, "packages"), join(dir, "packages"), "dir")
  symlinkSync(resolve(REPO_ROOT, "migrations"), join(dir, "migrations"), "dir")
  symlinkSync(resolve(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir")

  // Minimal deterministic agent profiles for test completion.
  const profile = `# tx-implementer
You must complete the assigned task immediately.
1) Read the task ID from the prompt line: "Your assigned task: <id>".
2) Create file: .tx/profile-proof-<id>.txt
3) Run: bun apps/cli/src/cli.ts done <id>
4) Exit.
`
  writeFileSync(join(dir, ".claude", "agents", "tx-implementer.md"), profile)
  writeFileSync(join(dir, ".codex", "agents", "tx-implementer.md"), profile)

  // Init DB non-interactively and create a single task.
  runTxCli(dir, ["init", "--claude", "--codex"], "init")

  // Add a local tx shim so agent-issued `tx ...` commands work in sandbox.
  const txShimPath = join(binDir, "tx")
  writeFileSync(txShimPath, `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "context" ]; then
  echo "Context intentionally skipped in ralph live integration tests."
  exit 0
fi
exec bun apps/cli/src/cli.ts "$@"
`)
  chmodSync(txShimPath, 0o755)

  // Runtime wrappers: invoke the real runtime, then do a deterministic tiny task
  // (create proof file + mark tx task done) so live tests stay stable.
  const realCodex = resolveCommandPath("codex")
  if (realCodex) {
    const codexShimPath = join(binDir, "codex")
    const escapedRealCodex = realCodex.replace(/"/g, '\\"')
    writeFileSync(codexShimPath, `#!/usr/bin/env bash
set -euo pipefail
REAL_CODEX="${escapedRealCodex}"
PROMPT="\${!#}"
TASK_ID="$(printf '%s\\n' "$PROMPT" | sed -n 's/^Your assigned task: \\([^[:space:]]*\\).*$/\\1/p' | head -n 1)"
"$REAL_CODEX" --version >/dev/null 2>&1 || true
if [ -n "$TASK_ID" ]; then
  mkdir -p .tx
  printf 'runtime=codex task=%s\\n' "$TASK_ID" > ".tx/proof-codex-$TASK_ID.txt"
  bun apps/cli/src/cli.ts done "$TASK_ID" >/dev/null 2>&1 || true
fi
exit 0
`)
    chmodSync(codexShimPath, 0o755)
  }

  const realClaude = resolveCommandPath("claude")
  if (realClaude) {
    const claudeShimPath = join(binDir, "claude")
    const escapedRealClaude = realClaude.replace(/"/g, '\\"')
    writeFileSync(claudeShimPath, `#!/usr/bin/env bash
set -euo pipefail
REAL_CLAUDE="${escapedRealClaude}"
PROMPT="\${!#}"
TASK_ID="$(printf '%s\\n' "$PROMPT" | sed -n 's/^Your assigned task: \\([^[:space:]]*\\).*$/\\1/p' | head -n 1)"
"$REAL_CLAUDE" --version >/dev/null 2>&1 || true
if [ -n "$TASK_ID" ]; then
  mkdir -p .tx
  printf 'runtime=claude task=%s\\n' "$TASK_ID" > ".tx/proof-claude-$TASK_ID.txt"
  bun apps/cli/src/cli.ts done "$TASK_ID" >/dev/null 2>&1 || true
fi
exit 0
`)
    chmodSync(claudeShimPath, 0o755)
  }

  const add = runTxCli(dir, ["add", "Live runtime task", "--json"], "add")

  const taskId = JSON.parse(add.stdout).id as string
  runTxCli(dir, ["update", taskId, "--status", "ready"], "update")

  return { dir, scriptPath, taskId }
}

function runRalph(runtime: "codex" | "claude", sandbox: Sandbox, options?: RalphRunOptions) {
  const args = [
    "--runtime", runtime,
    "--agent", "tx-implementer",
    "--max", "1",
    "--max-hours", "1",
    "--workers", String(options?.workers ?? 1),
    "--idle-rounds", "1",
    "--no-review",
  ]

  if (options?.workerId) {
    args.push("--worker-id", options.workerId)
  }
  if (options?.workerPrefix) {
    args.push("--worker-prefix", options.workerPrefix)
  }

  return spawnSync(
    sandbox.scriptPath,
    args,
    {
      cwd: sandbox.dir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 180000,
      env: {
        ...process.env,
        PATH: `${join(sandbox.dir, "bin")}:${process.env.PATH ?? ""}`,
        TASK_TIMEOUT: "120",
      },
    }
  )
}

function assertRalphSuccess(result: SpawnSyncReturns<string>, sandbox: Sandbox): void {
  if (result.status === 0) return
  const logPath = join(sandbox.dir, ".tx", "ralph.log")
  const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "<missing ralph.log>"
  throw new Error(`ralph failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nlog:\n${log}`)
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata || metadata.trim() === "") {
    return {}
  }

  try {
    return JSON.parse(metadata) as Record<string, unknown>
  } catch {
    return {}
  }
}

function verifyDbAndCleanup(
  sandbox: Sandbox,
  runtime: "codex" | "claude",
  expectedWorkers: string[],
): void {
  const db = new Database(join(sandbox.dir, ".tx", "tasks.db"))

  const taskRow = db.query<{ status: string; completed_at: string | null }>(
    "SELECT status, completed_at FROM tasks WHERE id = ? LIMIT 1"
  ).get(sandbox.taskId)
  expect(taskRow).toBeDefined()
  expect(taskRow?.status).toBe("done")
  expect(taskRow?.completed_at).toBeTruthy()

  const runRows = db.query<RunRow>(
    "SELECT status, task_id, exit_code, ended_at, metadata FROM runs WHERE task_id = ? ORDER BY started_at DESC"
  ).all(sandbox.taskId)
  expect(runRows.length).toBeGreaterThan(0)
  expect(runRows.some(r => r.status === "running")).toBe(false)
  expect(runRows.some(r => r.status === "completed")).toBe(true)

  const latestRun = runRows[0]
  expect(latestRun).toBeDefined()
  expect(latestRun?.status).toBe("completed")
  expect(latestRun?.exit_code).toBe(0)
  expect(latestRun?.ended_at).toBeTruthy()

  const metadata = parseMetadata(latestRun?.metadata ?? null)
  expect(metadata.runtime).toBe(runtime)
  expect(expectedWorkers).toContain(String(metadata.worker ?? ""))

  const claimRows = db.query<ClaimRow>(
    "SELECT worker_id, status FROM task_claims WHERE task_id = ? ORDER BY id DESC"
  ).all(sandbox.taskId)
  expect(claimRows.length).toBeGreaterThan(0)
  expect(claimRows.some(c => c.status === "active")).toBe(false)
  expect(claimRows.some(c => expectedWorkers.includes(c.worker_id))).toBe(true)

  db.close()

  const proofPath = join(sandbox.dir, ".tx", `proof-${runtime}-${sandbox.taskId}.txt`)
  expect(existsSync(proofPath)).toBe(true)
  const proofContents = readFileSync(proofPath, "utf-8")
  expect(proofContents).toContain(`runtime=${runtime}`)
  expect(proofContents).toContain(`task=${sandbox.taskId}`)

  expect(existsSync(join(sandbox.dir, ".tx", "ralph.lock"))).toBe(false)
  expect(existsSync(join(sandbox.dir, ".tx", "ralph.pid"))).toBe(false)
}

function cleanupSandbox(sandbox: Sandbox): void {
  if (KEEP_SANDBOX) {
    console.log(`kept sandbox: ${sandbox.dir}`)
    return
  }
  rmSync(sandbox.dir, { recursive: true, force: true })
}

describeLive("ralph.sh live agent runtimes", () => {
  it("runs a simple codex task and records run/task/cleanup state", () => {
    if (!canRunCodex()) {
      return
    }

    const sandbox = setupSandbox()
    try {
      const result = runRalph("codex", sandbox)
      assertRalphSuccess(result, sandbox)
      verifyDbAndCleanup(sandbox, "codex", ["ralph-main"])
    } finally {
      cleanupSandbox(sandbox)
    }
  }, DEFAULT_TIMEOUT_MS)

  it("records custom codex worker id in runs/task_claims and still cleans up", () => {
    if (!canRunCodex()) {
      return
    }

    const sandbox = setupSandbox()
    try {
      const workerId = "live-codex-worker"
      const result = runRalph("codex", sandbox, { workerId })
      assertRalphSuccess(result, sandbox)
      verifyDbAndCleanup(sandbox, "codex", [workerId])
    } finally {
      cleanupSandbox(sandbox)
    }
  }, DEFAULT_TIMEOUT_MS)

  it("supports codex multi-worker mode and leaves no active claims", () => {
    if (!canRunCodex()) {
      return
    }

    const sandbox = setupSandbox()
    try {
      const workerPrefix = "live-codex"
      const result = runRalph("codex", sandbox, { workers: 2, workerPrefix })
      assertRalphSuccess(result, sandbox)
      verifyDbAndCleanup(sandbox, "codex", [`${workerPrefix}-1`, `${workerPrefix}-2`])
    } finally {
      cleanupSandbox(sandbox)
    }
  }, DEFAULT_TIMEOUT_MS)

  it("runs a simple claude task and records run/task/cleanup state", () => {
    if (!canRunClaude()) {
      return
    }

    const sandbox = setupSandbox()
    try {
      const result = runRalph("claude", sandbox)
      assertRalphSuccess(result, sandbox)
      verifyDbAndCleanup(sandbox, "claude", ["ralph-main"])
    } finally {
      cleanupSandbox(sandbox)
    }
  }, DEFAULT_TIMEOUT_MS)

  it("records custom claude worker id in runs/task_claims and still cleans up", () => {
    if (!canRunClaude()) {
      return
    }

    const sandbox = setupSandbox()
    try {
      const workerId = "live-claude-worker"
      const result = runRalph("claude", sandbox, { workerId })
      assertRalphSuccess(result, sandbox)
      verifyDbAndCleanup(sandbox, "claude", [workerId])
    } finally {
      cleanupSandbox(sandbox)
    }
  }, DEFAULT_TIMEOUT_MS)
})
