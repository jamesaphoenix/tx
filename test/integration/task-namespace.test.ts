import { describe, expect, it } from "vitest"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const cli = resolve("apps/cli/src/cli.ts")

describe("task namespace", () => {
  it.each([
    ["task"], ["task","help"], ["task","dep"], ["task","bulk"],
    ["spec"], ["diag"], ["sync"], ["skills"], ["doc","help"], ["task","label","help"],
  ])("shows namespace usage without initialising storage: %j",(...args) => {
    const cwd = mkdtempSync(join(tmpdir(),"tx-namespace-usage-"))
    try {
      const result = spawnSync("bun",[cli,...args],{cwd,encoding:"utf8"})
      expect(result.status,result.stderr).toBe(0)
      expect(result.stdout).toContain(`tx ${args.filter(arg => arg !== "help").join(" ")}`)
      expect(existsSync(join(cwd,".tx"))).toBe(false)
    } finally {rmSync(cwd,{recursive:true,force:true})}
  })

  it("syncs authoring skills without creating a task database",() => {
    const cwd = mkdtempSync(join(tmpdir(),"tx-skill-only-"))
    try {
      const result = spawnSync("bun",[cli,"skills","sync","--project-dir",cwd,"--json"],{cwd,encoding:"utf8"})
      expect(result.status,result.stderr).toBe(0)
      expect(existsSync(join(cwd,".codex/skills/tx-plan/SKILL.md"))).toBe(true)
      expect(existsSync(join(cwd,".tx"))).toBe(false)
    } finally {rmSync(cwd,{recursive:true,force:true})}
  })

  it.each(["--score","--description","--db","--content-root"])("rejects missing option values before creating state: %s",option => {
    const cwd = mkdtempSync(join(tmpdir(),"tx-missing-value-"))
    try {
      const result = spawnSync("bun",[cli,"task","add","Must not exist",option,"--json"],{cwd,encoding:"utf8"})
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).error).toMatchObject({code:"cli/missing-flag-value",message:`${option} requires a value.`})
      expect(existsSync(join(cwd,".tx"))).toBe(false)
    } finally {rmSync(cwd,{recursive:true,force:true})}
  })
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
