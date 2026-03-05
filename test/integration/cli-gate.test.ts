import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

function runTx(args: string[], dbPath: string, cwd: string = dirname(dbPath)): ExecResult {
  const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
    encoding: "utf-8",
    cwd,
    timeout: 30000,
  })

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  }
}

function writeConfig(cwd: string, content: string): void {
  const configPath = join(cwd, ".tx", "config.toml")
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, content)
}

describe("CLI gate integration", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-gate-"))
    dbPath = join(tmpDir, "test.db")
    const init = runTx(["init"], dbPath)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("supports full gate lifecycle with check exit semantics", () => {
    expect(runTx(["gate", "create", "docs-to-build", "--phase-from", "docs", "--phase-to", "build"], dbPath).status).toBe(0)

    const blocked = runTx(["gate", "check", "docs-to-build"], dbPath)
    expect(blocked.status).toBe(1)

    expect(runTx(["gate", "approve", "docs-to-build", "--by", "james", "--note", "approved"], dbPath).status).toBe(0)

    const approved = runTx(["gate", "check", "docs-to-build"], dbPath)
    expect(approved.status).toBe(0)

    expect(runTx(["gate", "revoke", "docs-to-build", "--by", "james", "--reason", "needs review"], dbPath).status).toBe(0)

    const revoked = runTx(["gate", "check", "docs-to-build"], dbPath)
    expect(revoked.status).toBe(1)
  })

  it("prevents accidental overwrite on create unless --force is passed", () => {
    expect(runTx(["gate", "create", "docs-to-build"], dbPath).status).toBe(0)

    const secondCreate = runTx(["gate", "create", "docs-to-build"], dbPath)
    expect(secondCreate.status).toBe(1)
    expect(secondCreate.stderr).toContain("Gate already exists")

    const forced = runTx(["gate", "create", "docs-to-build", "--force"], dbPath)
    expect(forced.status).toBe(0)
  })

  it("returns structured status/list JSON", () => {
    expect(runTx(["gate", "create", "docs-to-build", "--phase-from", "docs", "--phase-to", "build"], dbPath).status).toBe(0)

    const statusResult = runTx(["gate", "status", "docs-to-build", "--json"], dbPath)
    expect(statusResult.status).toBe(0)
    const statusJson = JSON.parse(statusResult.stdout)
    expect(statusJson.id).toBe("gate.docs-to-build")
    expect(statusJson.approved).toBe(false)
    expect(statusJson.phaseFrom).toBe("docs")
    expect(statusJson.phaseTo).toBe("build")

    const listResult = runTx(["gate", "list", "--json"], dbPath)
    expect(listResult.status).toBe(0)
    const listJson = JSON.parse(listResult.stdout) as Array<{ id: string }>
    expect(listJson.some(g => g.id === "gate.docs-to-build")).toBe(true)
  })

  it("persists linked taskId in gate status and list output", () => {
    const addTask = runTx(["add", "Linked gate task", "--json"], dbPath)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    const created = runTx(
      ["gate", "create", "docs-to-build", "--phase-from", "docs", "--phase-to", "build", "--task-id", taskId, "--json"],
      dbPath
    )
    expect(created.status).toBe(0)
    const createdJson = JSON.parse(created.stdout) as { taskId: string | null }
    expect(createdJson.taskId).toBe(taskId)

    const statusResult = runTx(["gate", "status", "docs-to-build", "--json"], dbPath)
    expect(statusResult.status).toBe(0)
    const statusJson = JSON.parse(statusResult.stdout) as { taskId: string | null }
    expect(statusJson.taskId).toBe(taskId)

    const listResult = runTx(["gate", "list", "--json"], dbPath)
    expect(listResult.status).toBe(0)
    const listJson = JSON.parse(listResult.stdout) as Array<{
      id: string
      state: { taskId: string | null } | null
    }>
    expect(listJson.find((gate) => gate.id === "gate.docs-to-build")?.state?.taskId).toBe(taskId)
  })

  it("returns JSON check/list state across approve and revoke transitions", () => {
    expect(runTx(["gate", "create", "docs-to-build", "--phase-from", "docs", "--phase-to", "build"], dbPath).status).toBe(0)

    const blocked = runTx(["gate", "check", "docs-to-build", "--json"], dbPath)
    expect(blocked.status).toBe(1)
    expect(JSON.parse(blocked.stdout)).toEqual({
      id: "gate.docs-to-build",
      approved: false,
    })

    const approved = runTx(
      ["gate", "approve", "docs-to-build", "--by", "james", "--note", "ship it", "--json"],
      dbPath
    )
    expect(approved.status).toBe(0)
    const approvedJson = JSON.parse(approved.stdout) as {
      approved: boolean
      approvedBy: string | null
      note: string | null
    }
    expect(approvedJson.approved).toBe(true)
    expect(approvedJson.approvedBy).toBe("james")
    expect(approvedJson.note).toBe("ship it")

    const listedApproved = runTx(["gate", "list", "--json"], dbPath)
    expect(listedApproved.status).toBe(0)
    const approvedGate = (JSON.parse(listedApproved.stdout) as Array<{
      id: string
      valid: boolean
      state: { approved: boolean } | null
    }>).find(g => g.id === "gate.docs-to-build")
    expect(approvedGate?.valid).toBe(true)
    expect(approvedGate?.state?.approved).toBe(true)

    const revoked = runTx(
      ["gate", "revoke", "docs-to-build", "--by", "james", "--reason", "hold", "--json"],
      dbPath
    )
    expect(revoked.status).toBe(0)
    const revokedJson = JSON.parse(revoked.stdout) as {
      approved: boolean
      revokedBy: string | null
      revokeReason: string | null
      note: string | null
    }
    expect(revokedJson.approved).toBe(false)
    expect(revokedJson.revokedBy).toBe("james")
    expect(revokedJson.revokeReason).toBe("hold")
    expect(revokedJson.note).toBeNull()

    const blockedAgain = runTx(["gate", "check", "docs-to-build", "--json"], dbPath)
    expect(blockedAgain.status).toBe(1)
    expect(JSON.parse(blockedAgain.stdout)).toEqual({
      id: "gate.docs-to-build",
      approved: false,
    })
  })

  it("removes gate pin via gate rm", () => {
    expect(runTx(["gate", "create", "docs-to-build"], dbPath).status).toBe(0)
    const removed = runTx(["gate", "rm", "docs-to-build", "--json"], dbPath)
    expect(removed.status).toBe(0)
    expect(JSON.parse(removed.stdout)).toEqual({
      deleted: true,
      id: "gate.docs-to-build",
    })

    const pins = runTx(["pin", "list", "--json"], dbPath)
    expect(pins.status).toBe(0)
    const parsed = JSON.parse(pins.stdout) as Array<{ id: string }>
    expect(parsed.some(p => p.id === "gate.docs-to-build")).toBe(false)

    const checkRemoved = runTx(["gate", "check", "docs-to-build"], dbPath)
    expect(checkRemoved.status).toBe(1)
    expect(checkRemoved.stderr).toContain("Gate not found")

    const removeAgain = runTx(["gate", "rm", "docs-to-build"], dbPath)
    expect(removeAgain.status).toBe(1)
    expect(removeAgain.stderr).toContain("Gate not found")
  })

  it("composes with verify so human approval gates task completion", () => {
    expect(runTx(["gate", "create", "docs-to-build"], dbPath).status).toBe(0)

    const addTask = runTx(["add", "Gate protected task", "--json"], dbPath)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    const verifyCmd = `bun ${CLI_SRC} gate check docs-to-build --db ${dbPath}`
    const setVerify = runTx(["verify", "set", taskId, verifyCmd], dbPath)
    expect(setVerify.status).toBe(0)

    const blocked = runTx(["verify", "run", taskId], dbPath)
    expect(blocked.status).toBe(1)

    expect(runTx(["gate", "approve", "docs-to-build", "--by", "james"], dbPath).status).toBe(0)

    const approved = runTx(["verify", "run", taskId], dbPath)
    expect(approved.status).toBe(0)

    expect(runTx(["gate", "revoke", "docs-to-build", "--by", "james", "--reason", "re-review"], dbPath).status).toBe(0)

    const blockedAgain = runTx(["verify", "run", taskId], dbPath)
    expect(blockedAgain.status).toBe(1)
  }, 30_000)

  it("blocks agent completion for tasks linked in gate pins and allows explicit human override", () => {
    const addTask = runTx(["add", "Phase linked task", "--json"], dbPath)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    expect(runTx(["update", taskId, "--status", "ready"], dbPath).status).toBe(0)
    expect(runTx(["gate", "create", "docs-to-build", "--task-id", taskId], dbPath).status).toBe(0)

    const blocked = runTx(["done", taskId], dbPath)
    expect(blocked.status).toBe(1)
    expect(`${blocked.stdout}\n${blocked.stderr}`).toContain("linked by gate pin")

    const humanDone = runTx(["done", taskId, "--human", "--json"], dbPath)
    expect(humanDone.status).toBe(0)
    const humanDoneJson = JSON.parse(humanDone.stdout) as { task: { status: string } }
    expect(humanDoneJson.task.status).toBe("done")
  })

  it("allows agent completion when gate-linked task blocking is disabled in config", () => {
    writeConfig(
      tmpDir,
      ["[pins]", "block_agent_done_when_task_id_present = false"].join("\n")
    )

    const addTask = runTx(["add", "Config disabled task", "--json"], dbPath)
    expect(addTask.status).toBe(0)
    const taskId = (JSON.parse(addTask.stdout) as { id: string }).id

    expect(runTx(["update", taskId, "--status", "ready"], dbPath).status).toBe(0)
    expect(runTx(["gate", "create", "docs-to-build", "--task-id", taskId], dbPath).status).toBe(0)

    const completed = runTx(["done", taskId, "--json"], dbPath)
    expect(completed.status).toBe(0)
    const completedJson = JSON.parse(completed.stdout) as { task: { status: string } }
    expect(completedJson.task.status).toBe("done")
  })

  it("prevents agent child completion from auto-completing a gate-linked parent", () => {
    const parent = runTx(["add", "Phase parent", "--json"], dbPath)
    expect(parent.status).toBe(0)
    const parentId = (JSON.parse(parent.stdout) as { id: string }).id

    const child = runTx(["add", "Phase child", "--parent", parentId, "--json"], dbPath)
    expect(child.status).toBe(0)
    const childId = (JSON.parse(child.stdout) as { id: string }).id

    expect(runTx(["update", childId, "--status", "ready"], dbPath).status).toBe(0)
    expect(runTx(["gate", "create", "docs-to-build", "--task-id", parentId], dbPath).status).toBe(0)

    const doneChild = runTx(["done", childId, "--json"], dbPath)
    expect(doneChild.status).toBe(0)
    expect((JSON.parse(doneChild.stdout) as { task: { status: string } }).task.status).toBe("done")

    const parentAfter = runTx(["show", parentId, "--json"], dbPath)
    expect(parentAfter.status).toBe(0)
    expect((JSON.parse(parentAfter.stdout) as { status: string }).status).toBe("backlog")
  })

  it("handles invalid gate pin payloads safely", () => {
    expect(runTx(["gate", "create", "docs-to-build"], dbPath).status).toBe(0)
    expect(runTx(["pin", "set", "gate.docs-to-build", "not-json"], dbPath).status).toBe(0)

    const statusResult = runTx(["gate", "status", "docs-to-build"], dbPath)
    expect(statusResult.status).toBe(1)
    expect(statusResult.stderr).toContain("invalid JSON state")

    const checkResult = runTx(["gate", "check", "docs-to-build"], dbPath)
    expect(checkResult.status).toBe(1)
    expect(checkResult.stderr).toContain("invalid JSON state")

    const listResult = runTx(["gate", "list", "--json"], dbPath)
    expect(listResult.status).toBe(0)
    const listed = JSON.parse(listResult.stdout) as Array<{
      id: string
      valid: boolean
      state: unknown
    }>
    const gate = listed.find(g => g.id === "gate.docs-to-build")
    expect(gate).toBeDefined()
    expect(gate?.valid).toBe(false)
    expect(gate?.state).toBeNull()

    const malformed = JSON.stringify({
      approved: "yes",
      required: true,
      createdAt: "2026-03-05T00:00:00.000Z",
    })
    expect(runTx(["pin", "set", "gate.docs-to-build", malformed], dbPath).status).toBe(0)

    const malformedStatus = runTx(["gate", "status", "docs-to-build"], dbPath)
    expect(malformedStatus.status).toBe(1)
    expect(malformedStatus.stderr).toContain("invalid JSON state")
  })

  it("requires --by for approve and revoke", () => {
    expect(runTx(["gate", "create", "docs-to-build"], dbPath).status).toBe(0)

    const approveWithoutBy = runTx(["gate", "approve", "docs-to-build"], dbPath)
    expect(approveWithoutBy.status).toBe(1)
    expect(approveWithoutBy.stderr).toContain("Usage: tx gate approve")

    const revokeWithoutBy = runTx(["gate", "revoke", "docs-to-build"], dbPath)
    expect(revokeWithoutBy.status).toBe(1)
    expect(revokeWithoutBy.stderr).toContain("Usage: tx gate revoke")
  })
})
