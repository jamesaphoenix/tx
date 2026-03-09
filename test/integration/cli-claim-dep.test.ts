import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = 30000
const TEST_TIMEOUT = 30000

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

/**
 * Force a WAL checkpoint so writes are visible to the next subprocess.
 */
function walCheckpoint(dbPath: string): void {
  const { Database } = require("bun:sqlite")
  const db = new Database(dbPath)
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()
}

function runTx(args: string[], dbPath: string): ExecResult {
  try {
    const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: process.cwd(),
    })
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status: result.status ?? 1,
    }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      status: err.status ?? 1,
    }
  }
}

function parseJsonFromOutput<T>(output: string): T {
  const objectStart = output.indexOf("{")
  const arrayStart = output.indexOf("[")
  const start =
    objectStart === -1
      ? arrayStart
      : arrayStart === -1
        ? objectStart
        : Math.min(objectStart, arrayStart)

  if (start === -1) {
    throw new Error(`No JSON found in output:\n${output}`)
  }
  return JSON.parse(output.slice(start)) as T
}

describe("CLI claim/dependency critical flows", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-cli-claim-dep-"))
    dbPath = join(tmpDir, "test.db")
    const init = runTx(["init"], dbPath)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("claim and release affect tx ready eligibility", () => {
    const taskA = JSON.parse(runTx(["add", "Task A", "--score", "900", "--json"], dbPath).stdout) as { id: string }
    const taskB = JSON.parse(runTx(["add", "Task B", "--score", "800", "--json"], dbPath).stdout) as { id: string }

    const readyBefore = JSON.parse(runTx(["ready", "--json", "--limit", "10"], dbPath).stdout) as Array<{ id: string }>
    expect(readyBefore.map((t) => t.id)).toEqual(expect.arrayContaining([taskA.id, taskB.id]))

    const claim = runTx(["claim", taskA.id, "worker-alpha", "--json"], dbPath)
    expect(claim.status).toBe(0)
    const claimJson = parseJsonFromOutput<{ taskId: string; workerId: string }>(claim.stdout)
    expect(claimJson.taskId).toBe(taskA.id)
    expect(claimJson.workerId).toBe("worker-alpha")

    const readyWhileClaimed = JSON.parse(runTx(["ready", "--json", "--limit", "10"], dbPath).stdout) as Array<{ id: string }>
    expect(readyWhileClaimed.map((t) => t.id)).not.toContain(taskA.id)
    expect(readyWhileClaimed.map((t) => t.id)).toContain(taskB.id)

    const release = runTx(["claim", "release", taskA.id, "worker-alpha", "--json"], dbPath)
    expect(release.status).toBe(0)
    const releaseJson = parseJsonFromOutput<{ released: boolean; taskId: string; workerId: string }>(
      release.stdout
    )
    expect(releaseJson).toEqual({
      released: true,
      taskId: taskA.id,
      workerId: "worker-alpha",
    })

    const readyAfter = JSON.parse(runTx(["ready", "--json", "--limit", "10"], dbPath).stdout) as Array<{ id: string }>
    expect(readyAfter.map((t) => t.id)).toEqual(expect.arrayContaining([taskA.id, taskB.id]))
  }, TEST_TIMEOUT)

  it("claim renew updates claim metadata", () => {
    const task = JSON.parse(runTx(["add", "Renew target", "--json"], dbPath).stdout) as { id: string }

    const claimed = parseJsonFromOutput<{ leaseExpiresAt: string; renewedCount: number }>(
      runTx(["claim", task.id, "worker-renew", "--lease", "30", "--json"], dbPath).stdout
    )
    const renewedResult = runTx(["claim", "renew", task.id, "worker-renew", "--json"], dbPath)
    expect(renewedResult.status).toBe(0)

    const renewed = parseJsonFromOutput<{ leaseExpiresAt: string; renewedCount: number }>(renewedResult.stdout)
    expect(renewed.renewedCount).toBeGreaterThanOrEqual(claimed.renewedCount + 1)
    expect(new Date(renewed.leaseExpiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(claimed.leaseExpiresAt).getTime()
    )
  }, TEST_TIMEOUT)

  it("block/unblock changes dependency state and ready visibility", () => {
    const blocker = JSON.parse(runTx(["add", "Blocker", "--json"], dbPath).stdout) as { id: string }
    const blocked = JSON.parse(runTx(["add", "Blocked", "--json"], dbPath).stdout) as { id: string }
    walCheckpoint(dbPath)

    const blockResult = runTx(["block", blocked.id, blocker.id, "--json"], dbPath)
    expect(blockResult.status).toBe(0)
    const blockJson = JSON.parse(blockResult.stdout) as {
      success: boolean
      task: { id: string; blockedBy: string[] }
    }
    expect(blockJson.success).toBe(true)
    expect(blockJson.task.id).toBe(blocked.id)
    expect(blockJson.task.blockedBy).toContain(blocker.id)
    walCheckpoint(dbPath)

    const readyBlocked = JSON.parse(runTx(["ready", "--json", "--limit", "10"], dbPath).stdout) as Array<{ id: string }>
    expect(readyBlocked.map((t) => t.id)).toContain(blocker.id)
    expect(readyBlocked.map((t) => t.id)).not.toContain(blocked.id)

    const unblockResult = runTx(["unblock", blocked.id, blocker.id, "--json"], dbPath)
    expect(unblockResult.status).toBe(0)
    const unblockJson = JSON.parse(unblockResult.stdout) as {
      success: boolean
      task: { id: string; blockedBy: string[] }
    }
    expect(unblockJson.success).toBe(true)
    expect(unblockJson.task.id).toBe(blocked.id)
    expect(unblockJson.task.blockedBy).toEqual([])
    walCheckpoint(dbPath)

    const readyUnblocked = JSON.parse(runTx(["ready", "--json", "--limit", "10"], dbPath).stdout) as Array<{ id: string }>
    expect(readyUnblocked.map((t) => t.id)).toEqual(expect.arrayContaining([blocker.id, blocked.id]))
  }, TEST_TIMEOUT)

  it("rejects dependency cycle through CLI block command", () => {
    const taskA = JSON.parse(runTx(["add", "Cycle A", "--json"], dbPath).stdout) as { id: string }
    const taskB = JSON.parse(runTx(["add", "Cycle B", "--json"], dbPath).stdout) as { id: string }

    const first = runTx(["block", taskB.id, taskA.id], dbPath)
    expect(first.status).toBe(0)

    const cycle = runTx(["block", taskA.id, taskB.id], dbPath)
    expect(cycle.status).not.toBe(0)
    expect(`${cycle.stderr}\n${cycle.stdout}`.toLowerCase()).toContain("cycle")
  }, TEST_TIMEOUT)
})
