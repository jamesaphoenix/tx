import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
const cli = resolve("apps/cli/src/cli.ts")
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const tx = (cwd: string, args: string[]) => {
  const result = spawnSync("bun", [cli, ...args, "--json"], { cwd, encoding: "utf8" })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  return JSON.parse(result.stdout)
}
describe("spec -> plan -> tasks", () => {
  it("preserves an agent plan, source link and document hierarchy across sync [INV-LEAN-005] [INV-REQ-LEAN-005]", () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-plan-")); roots.push(cwd)
    tx(cwd, ["doc", "add", "design", "checkout-design", "--title", "Checkout design"])
    const plan = tx(cwd, ["doc", "add", "plan", "checkout-plan", "--title", "Checkout plan"])
    const planPath = join(cwd, "specs", plan.filePath)
    const original = join(cwd, "agent-plan.md")
    const content = "## Steps\n\n1. Implement checkout.\n2. Verify payment retries.\n"
    writeFileSync(original, content)
    const scaffold = readFileSync(planPath, "utf8")
    const header = scaffold.match(/^---\n[\s\S]*?\n---\n/)?.[0]
    expect(header).toBeDefined()
    writeFileSync(planPath, header + "\n" + content)
    symlinkSync(original, join(cwd, "specs/plan/checkout-plan.source"))
    tx(cwd, ["doc", "sync", "checkout-plan"])
    tx(cwd, ["doc", "link", "checkout-design", "checkout-plan"])
    const task = tx(cwd, ["task", "add", "Implement checkout"])
    tx(cwd, ["doc", "attach", task.id, "checkout-plan"])
    expect(tx(cwd, ["doc", "drift", "checkout-design"]).warnings).toEqual([])
    const saved = tx(cwd, ["task", "show", task.id])
    expect(saved.linkedDocs).toEqual(expect.arrayContaining([expect.objectContaining({ name: "checkout-plan", kind: "plan" })]))
    const graph = tx(cwd, ["doc", "show", "checkout-plan"])
    expect(JSON.stringify(graph)).toContain("checkout-plan")
    const db = new Database(join(cwd, ".tx/tasks.db"))
    try { expect(db.prepare("SELECT link_type FROM doc_links").get()).toEqual({ link_type: "spec_to_plan" }) } finally { db.close() }
    expect(readFileSync(join(cwd, "specs/index.md"), "utf8")).toContain("## Implementation Plans")
    expect(readFileSync(join(cwd, "specs/index.md"), "utf8")).toContain("[checkout-plan](plan/checkout-plan.md)")
    expect(readFileSync(planPath, "utf8")).toContain(content)
    expect(realpathSync(join(cwd, "specs/plan/checkout-plan.source"))).toBe(realpathSync(original))
    expect(readFileSync(original, "utf8")).toBe(content)
    tx(cwd, ["sync", "export"])
    tx(cwd, ["sync", "hydrate"])
    expect(tx(cwd, ["task", "show", task.id]).linkedDocs[0].name).toBe("checkout-plan")
  })
})
