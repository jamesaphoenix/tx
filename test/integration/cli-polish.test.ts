import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const entry = resolve(__dirname, "../../apps/cli/src/cli.ts")
const runtime = process.execPath.includes("bun") ? process.execPath : "bun"
let cwd: string
let db: string
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "tx-cli-polish-")); db = join(cwd, "tasks.db") })
afterEach(() => rmSync(cwd, {recursive:true,force:true}))
const run = (args: string[]) => spawnSync(runtime,[entry,...args,"--db",db],{cwd,encoding:"utf8",timeout:60000})

describe("CLI polish contracts",() => {
  it.each(["constructor","toString","__proto__"])("rejects inherited object key %s as a command and help target",name => {
    for (const args of [[name,"--json"],["help",name,"--json"],["schema",name]]) {
      const result = run(args)
      expect(result.status).toBe(1)
      expect(result.stderr).toBe("")
      expect(JSON.parse(result.stdout)).toMatchObject({ok:false,error:{code:"cli/unknown-command"}})
      expect(existsSync(db)).toBe(false)
    }
    const task = run(["task",name,"--json"])
    expect(task.status).toBe(1)
    expect(task.stderr).toBe("")
    expect(JSON.parse(task.stdout)).toMatchObject({ok:false,error:{code:"cli/unknown-subcommand"}})
  })

  it.each([["task","nope"],["task","dep","nope"],["sync","migrate","nope"]])("rejects unknown namespace help %s %s",(...parts) => {
    const result = run([...parts,"--help","--json"])
    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toMatchObject({ok:false,error:{code:"cli/unknown-command"}})
    expect(existsSync(db)).toBe(false)
  })

  it.each([
    ["task","dep","children"],["task","dep","tree"],["task","dep","block"],["task","dep","unblock"],
    ["task","bulk","nope"],["task","label","nope"],["spec","invariant","nope"],["sync","migrate","nope"],
  ])("returns structured canonical usage errors for %s %s %s",(...parts) => {
    const result = run([...parts,"--json"])
    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")
    const output = JSON.parse(result.stdout)
    expect(output.ok).toBe(false)
    expect(output.error.code).toMatch(/^cli\/(usage|unknown-subcommand)$/)
    expect(output.error.usage).toContain(`tx ${parts.slice(0,2).join(" ")}`)
    if (output.error.hint) expect(output.error.hint).toContain(`tx help ${parts.slice(0,2).join(" ")}`)
  })

  it("shows nested migration help without opening storage",() => {
    const result = run(["sync","migrate"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx sync migrate")
    expect(result.stdout).not.toContain("undefined")
    expect(existsSync(db)).toBe(false)
  })

  it("reports the actual custom database location during init",() => {
    const result = run(["init","--codex"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(db)
    expect(existsSync(db)).toBe(true)
  })
})
