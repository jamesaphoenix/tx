import { describe, expect, it } from "vitest"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const cli = resolve("apps/cli/src/cli.ts")

describe("task namespace", () => {
  it("clears descriptions and rejects explicitly empty titles", () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-empty-task-fields-"))
    const run = (...args:string[]) => spawnSync("bun", [cli, ...args, "--db", join(cwd,"tasks.db"), "--json"], {cwd,encoding:"utf8"})
    try {
      const created = run("task","add","Original title","--description","Original description")
      expect(created.status, created.stderr).toBe(0)
      const id = JSON.parse(created.stdout).id
      const cleared = run("task","update",id,"--description=")
      expect(cleared.status, cleared.stderr).toBe(0)
      expect(JSON.parse(cleared.stdout).description).toBe("")
      expect(run("task","update",id,"--title=").status).not.toBe(0)
      const shown = run("task","show",id)
      expect(JSON.parse(shown.stdout).title).toBe("Original title")
    } finally { rmSync(cwd, {recursive:true, force:true}) }
  })
  it.each([
    ["--help", "task", "dep"],
    ["--json", "task", "dep", "--help"],
    ["task", "--json", "dep", "--help"],
  ])("supports boolean flags before command parts: %j", (...args) => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-leading-help-"))
    try {
      const result = spawnSync("bun", [cli, ...args], {cwd, encoding:"utf8"})
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain("tx task dep")
      expect(existsSync(join(cwd, ".tx/tasks.db"))).toBe(false)
    } finally { rmSync(cwd, {recursive:true, force:true}) }
  })

  it("rejects old syntax before opening a database [INV-LEAN-001] [INV-REQ-LEAN-001]", () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-old-task-"))
    try {
      const result = spawnSync("bun", [cli, "add", "Must not exist", "--json"], { cwd, encoding: "utf8" })
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain("tx task add")
      expect(existsSync(join(cwd, ".tx/tasks.db"))).toBe(false)
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })

  it("exposes nested task help without creating state [INV-LEAN-001] [INV-REQ-LEAN-001]", () => {
    const cwd = mkdtempSync(join(tmpdir(), "tx-task-help-"))
    try {
      const result = spawnSync("bun", [cli, "task", "dep", "--help"], { cwd, encoding: "utf8" })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx task dep block")
      expect(existsSync(join(cwd, ".tx/tasks.db"))).toBe(false)
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })
})
