import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { dashboardSpecHealth } from "../../apps/dashboard/server/spec-health.js"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true, force:true}) })
const cli = resolve("apps/cli/src/cli.ts")
const tx = (cwd: string, args: string[]) => {
  const result = spawnSync("bun", [cli, ...args, "--json"], {cwd, encoding:"utf8"})
  expect(result.status, result.stderr || result.stdout).toBe(0)
  return JSON.parse(result.stdout)
}

describe("dashboardSpecHealth", () => {
  it("shows the same missing checkout evidence as the CLI [INV-LEAN-004]", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-dashboard-health-")); roots.push(cwd)
    const doc = tx(cwd, ["doc", "add", "design", "checkout", "--title", "Checkout"])
    const path = join(cwd, "specs", doc.filePath)
    const content = readFileSync(path, "utf8").replace("invariants: []", "invariants:\n  - id: INV-DASH-001\n    statement: payment retries preserve one order\n    severity: high\n    verified_by:\n      - test/payment.test.ts")
    expect(content).toContain("INV-DASH-001")
    writeFileSync(path, content)
    tx(cwd, ["doc", "sync", "checkout"])
    const expected = tx(cwd, ["spec", "health"])
    expect(expected.specTest.total).toBe(1)
    expect(expected.status).not.toBe("synced")
    expect(await dashboardSpecHealth(join(cwd, ".tx/tasks.db"), cwd)).toEqual(expected)
  })

  it("reports the latest version once and includes its stable navigation identity", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-dashboard-health-version-")); roots.push(cwd)
    const first = tx(cwd, ["doc", "add", "design", "checkout", "--title", "Checkout design"])
    tx(cwd, ["doc", "lock", first.docId])
    const second = tx(cwd, ["doc", "version", first.docId])
    expect(second.version).toBe(2)
    const health = tx(cwd, ["spec", "health"])
    expect(health.docDrift.totalDocs).toBe(1)
    expect(health.docs).toEqual([expect.objectContaining({name:"design/checkout",title:"Checkout design",docId:first.docId,version:2})])
    expect(await dashboardSpecHealth(join(cwd,".tx/tasks.db"),cwd)).toEqual(health)
  })

  it("honours an explicit content root while using shared task state [INV-LEAN-004]", async () => {
    const state = mkdtempSync(join(tmpdir(), "tx-dashboard-state-")); roots.push(state)
    const content = mkdtempSync(join(tmpdir(), "tx-dashboard-content-")); roots.push(content)
    const doc = tx(content, ["doc", "add", "design", "worktree-design", "--state-root", state])
    const path = join(content, "specs", doc.filePath)
    writeFileSync(path, readFileSync(path, "utf8").replace("invariants: []", "invariants:\n  - id: INV-WORKTREE-001\n    statement: worktree evidence remains scoped\n    severity: high\n    verified_by:\n      - test/worktree.test.ts"))
    tx(content, ["doc", "sync", "worktree-design", "--state-root", state])
    const expected = tx(state, ["spec", "health", "--content-root", content])
    expect(expected.specTest.total).toBe(1)
    expect(expected.docDrift.totalDocs).toBe(1)
    expect(await dashboardSpecHealth(join(state, ".tx/tasks.db"), state, content)).toEqual(expected)
  })
})
