import { Database } from "bun:sqlite"
import { describe, it, expect, afterEach } from "vitest"
import { spawnSync, type SpawnSyncReturns } from "child_process"
import { appendFileSync, chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..")
const SOURCE_RALPH = resolve(REPO_ROOT, "scripts", "ralph.sh")

interface Sandbox {
  dir: string
  scriptPath: string
  stateDir: string
  taskId: string
  scopedSiblingId: string
  unrelatedTaskId: string
  designDocName: string
}

const sandboxes: string[] = []

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function runTxCli(dir: string, args: string[], label: string): SpawnSyncReturns<string> {
  const result = spawnSync("bun", ["apps/cli/src/cli.ts", ...args], {
    cwd: dir,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 90000,
  })

  if (result.status !== 0) {
    throw new Error(`${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }

  return result
}

function setupSandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "tx-ralph-context-e2e-"))
  const scriptPath = join(dir, "scripts", "ralph.sh")
  const stateDir = join(dir, "state")
  const binDir = join(dir, "bin")
  const designDocName = "ralph-context-design"
  const prdDocName = "ralph-context-prd"

  sandboxes.push(dir)

  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, ".codex", "agents"), { recursive: true })
  mkdirSync(binDir, { recursive: true })
  mkdirSync(stateDir, { recursive: true })

  writeFileSync(scriptPath, readFileSync(SOURCE_RALPH, "utf-8"))
  chmodSync(scriptPath, 0o755)

  symlinkSync(resolve(REPO_ROOT, "apps"), join(dir, "apps"), "dir")
  symlinkSync(resolve(REPO_ROOT, "packages"), join(dir, "packages"), "dir")
  symlinkSync(resolve(REPO_ROOT, "migrations"), join(dir, "migrations"), "dir")
  symlinkSync(resolve(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir")

  writeFileSync(
    join(dir, ".codex", "agents", "tx-implementer.md"),
    "# tx-implementer\nFollow the task instructions in the injected prompt.\n",
  )

  writeExecutable(
    join(binDir, "codex"),
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${RALPH_E2E_STATE_DIR:?}"
PROMPT="\${!#}"
mkdir -p "$STATE_DIR"
printf '%s\\n' "$*" > "$STATE_DIR/codex-argv.log"
printf '%s' "$PROMPT" > "$STATE_DIR/prompt-last.txt"
if [ ! -f "$STATE_DIR/prompt-initial.txt" ]; then
  printf '%s' "$PROMPT" > "$STATE_DIR/prompt-initial.txt"
fi
TASK_ID="$(printf '%s\\n' "$PROMPT" | sed -n 's/^Your assigned task: \\([^[:space:]]*\\).*$/\\1/p' | head -n 1)"
if [ -n "$TASK_ID" ]; then
  bun apps/cli/src/cli.ts done "$TASK_ID" >/dev/null 2>&1 || true
fi
exit 0
`,
  )

  runTxCli(dir, ["init", "--codex"], "tx init")
  runTxCli(dir, ["doc", "add", "prd", prdDocName, "--title", "Ralph Context PRD"], "tx doc add prd")
  runTxCli(dir, ["doc", "add", "design", designDocName, "--title", "Ralph Context Design"], "tx doc add design")
  runTxCli(dir, ["doc", "link", prdDocName, designDocName], "tx doc link")

  appendFileSync(
    join(dir, "specs", "design", `${designDocName}.md`),
    "\n## Sandbox Marker\nDesign doc sentinel for Ralph bundle e2e.\n",
  )
  runTxCli(dir, ["doc", "sync", designDocName], "tx doc sync design")

  const targetTask = JSON.parse(runTxCli(
    dir,
    ["add", "Implement Ralph bundle", "--description", "Primary task for Ralph context bundle coverage", "--json"],
    "tx add target task",
  ).stdout) as { id: string }
  const siblingTask = JSON.parse(runTxCli(
    dir,
    ["add", "Document follow-up task", "--description", "Sibling task that should appear in the injected queue snapshot", "--json"],
    "tx add sibling task",
  ).stdout) as { id: string }
  const unrelatedTask = JSON.parse(runTxCli(
    dir,
    ["add", "Unrelated queue task", "--description", "Task outside the design-doc scope that should only appear in global queue mode", "--json"],
    "tx add unrelated task",
  ).stdout) as { id: string }

  runTxCli(dir, ["update", targetTask.id, "--status", "ready"], "tx update target task")
  runTxCli(dir, ["update", siblingTask.id, "--status", "blocked"], "tx update sibling task")
  runTxCli(dir, ["update", unrelatedTask.id, "--status", "blocked"], "tx update unrelated task")
  runTxCli(dir, ["doc", "attach", targetTask.id, prdDocName, "--type", "implements"], "tx doc attach prd")
  runTxCli(dir, ["doc", "attach", targetTask.id, designDocName, "--type", "references"], "tx doc attach design")
  runTxCli(dir, ["doc", "attach", siblingTask.id, designDocName, "--type", "references"], "tx doc attach sibling design")

  return {
    dir,
    scriptPath,
    stateDir,
    taskId: targetTask.id,
    scopedSiblingId: siblingTask.id,
    unrelatedTaskId: unrelatedTask.id,
    designDocName,
  }
}

function runRalph(sandbox: Sandbox, extraArgs: string[] = []): SpawnSyncReturns<string> {
  return spawnSync(
    sandbox.scriptPath,
    [
      "--runtime", "codex",
      "--agent", "tx-implementer",
      "--max", "1",
      "--max-hours", "1",
      "--idle-rounds", "1",
      "--no-review",
      "--task-timeout", "1",
      "--verify-timeout", "1",
      "--learnings-timeout", "1",
      ...extraArgs,
    ],
    {
      cwd: sandbox.dir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60000,
      env: {
        ...process.env,
        PATH: `${join(sandbox.dir, "bin")}:${process.env.PATH ?? ""}`,
        RALPH_E2E_STATE_DIR: sandbox.stateDir,
      },
    },
  )
}

function assertRalphSuccess(result: SpawnSyncReturns<string>, sandbox: Sandbox): void {
  if (result.status === 0) {
    return
  }

  const logPath = join(sandbox.dir, ".tx", "ralph.log")
  const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "<missing ralph.log>"
  throw new Error(`ralph failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nlog:\n${log}`)
}

afterEach(() => {
  for (const dir of sandboxes.splice(0, sandboxes.length)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe("RALPH context bundle e2e", () => {
  it("injects linked design docs, the current task, and the full queue with the real tx CLI", () => {
    const sandbox = setupSandbox()
    const result = runRalph(sandbox, ["--all-tasks"])

    assertRalphSuccess(result, sandbox)

    const prompt = readFileSync(join(sandbox.stateDir, "prompt-initial.txt"), "utf-8")
    expect(prompt).toContain("Task scope: all-tasks")
    expect(prompt).toContain("===== BEGIN CURRENT TASK PAYLOAD (JSON) =====")
    expect(prompt).toContain(sandbox.taskId)
    expect(prompt).toContain("===== BEGIN LINKED DESIGN DOCS (MARKDOWN) =====")
    expect(prompt).toContain("Design doc sentinel for Ralph bundle e2e.")
    expect(prompt).toContain("===== BEGIN ALL TASKS (JSON) =====")
    expect(prompt).toContain(sandbox.scopedSiblingId)
    expect(prompt).toContain(sandbox.unrelatedTaskId)
    expect(prompt).toContain("tx update <id> --score <n>")

    const runsDir = join(sandbox.dir, ".tx", "runs")
    expect(existsSync(runsDir)).toBe(true)
    const runIds = readdirSync(runsDir)
    expect(runIds.length).toBe(1)

    const runDir = join(runsDir, runIds[0]!)
    const currentTask = readFileSync(join(runDir, "current-task.json"), "utf-8")
    const designDocs = readFileSync(join(runDir, "linked-design-docs.md"), "utf-8")
    const allTasks = readFileSync(join(runDir, "all-tasks.json"), "utf-8")
    const promptContext = readFileSync(join(runDir, "prompt-context.txt"), "utf-8")
    const fullContext = readFileSync(join(runDir, "context.md"), "utf-8")

    expect(currentTask).toContain(sandbox.taskId)
    expect(currentTask).toContain(sandbox.designDocName)
    expect(designDocs).toContain("Design doc sentinel for Ralph bundle e2e.")
    expect(allTasks).toContain(sandbox.scopedSiblingId)
    expect(allTasks).toContain(sandbox.unrelatedTaskId)
    expect(promptContext).toContain("===== BEGIN CURRENT TASK PAYLOAD (JSON) =====")
    expect(promptContext).toContain("===== BEGIN ALL TASKS (JSON) =====")
    expect(promptContext).toContain("all-tasks")
    expect(fullContext).toContain("If the queue needs reordering")

    const db = new Database(join(sandbox.dir, ".tx", "tasks.db"))
    const task = db.query<{ status: string; completed_at: string | null }, [string]>(
      "SELECT status, completed_at FROM tasks WHERE id = ? LIMIT 1",
    ).get(sandbox.taskId)
    expect(task?.status).toBe("done")
    expect(task?.completed_at).toBeTruthy()
    db.close()
  }, 60000)

  it("filters the queue bundle to a single design doc when --design-doc is used", () => {
    const sandbox = setupSandbox()
    const result = runRalph(sandbox, ["--design-doc", sandbox.designDocName])

    assertRalphSuccess(result, sandbox)

    const prompt = readFileSync(join(sandbox.stateDir, "prompt-initial.txt"), "utf-8")
    expect(prompt).toContain(`Task scope: design-doc:${sandbox.designDocName}`)
    expect(prompt).toContain(sandbox.taskId)
    expect(prompt).toContain(sandbox.scopedSiblingId)
    expect(prompt).not.toContain(sandbox.unrelatedTaskId)

    const runsDir = join(sandbox.dir, ".tx", "runs")
    expect(existsSync(runsDir)).toBe(true)
    const runIds = readdirSync(runsDir)
    expect(runIds.length).toBe(1)

    const runDir = join(runsDir, runIds[0]!)
    const currentTask = readFileSync(join(runDir, "current-task.json"), "utf-8")
    const designDocs = readFileSync(join(runDir, "linked-design-docs.md"), "utf-8")
    const allTasks = readFileSync(join(runDir, "all-tasks.json"), "utf-8")
    const promptContext = readFileSync(join(runDir, "prompt-context.txt"), "utf-8")

    expect(currentTask).toContain(sandbox.taskId)
    expect(currentTask).not.toContain(sandbox.unrelatedTaskId)
    expect(designDocs).toContain("Design doc sentinel for Ralph bundle e2e.")
    expect(allTasks).toContain(sandbox.taskId)
    expect(allTasks).toContain(sandbox.scopedSiblingId)
    expect(allTasks).not.toContain(sandbox.unrelatedTaskId)
    expect(promptContext).toContain(`design-doc:${sandbox.designDocName}`)
  }, 60000)
})
