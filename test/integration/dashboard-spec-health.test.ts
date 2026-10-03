import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { dashboardSpecHealth } from "../../apps/dashboard/server/spec-health"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true, force:true}) })
const cli = resolve("apps/cli/src/cli.ts")
const tx = (cwd: string, args: string[]) => {
  const result = spawnSync("bun", [cli, ...args, "--json"], {cwd, encoding:"utf8"})
  expect(result.status, result.stderr || result.stdout).toBe(0)
  return JSON.parse(result.stdout)
}

describe("dashboard evidence scope", () => {
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
})
