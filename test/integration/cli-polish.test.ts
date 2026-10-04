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
const run = (args: string[]) => spawnSync(runtime,[entry,"--db",db,...args],{cwd,encoding:"utf8",timeout:60000})

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

  it.each([
    ["spec","invariant","show"], ["spec","invariant","record"],
    ["spec","invariant","record","INV-ANY"],
    ["spec","invariant","record","INV-ANY","--passed","--failed"],
    ["task","label","add"], ["task","label","delete"],
    ["task","label","assign"], ["task","label","unassign"],
    ["task","bulk","done"], ["task","bulk","score"],
    ["task","bulk","reset"], ["task","bulk","delete"],
  ])("keeps leaf argument errors machine-readable: %j",(...parts) => {
    const result = run([...parts,"--json"])
    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toMatchObject({ok:false,error:{code:"cli/usage"}})
  })

  it.each(["3.7","12oops","Infinity","9007199254740993"])("rejects invalid bulk score %s without updating tasks",score => {
    const added = run(["task","add","Keep score","--score","8","--json"])
    expect(added.status).toBe(0)
    const task = JSON.parse(added.stdout)
    const result = run(["task","bulk","score",score,task.id,"--json"])
    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toMatchObject({ok:false,error:{code:"cli/validation"}})
    const shown = run(["task","show",task.id,"--json"])
    expect(JSON.parse(shown.stdout).score).toBe(8)
  })

  it.each([["done"],["score","17"],["reset"],["delete"]])("validates every bulk ID before %j mutates tasks",(...operation) => {
    const added = run(["task","add","Preserve before validation","--score","8","--json"])
    const task = JSON.parse(added.stdout)
    expect(run(["task","update",task.id,"--status","active","--json"]).status).toBe(0)
    const result = run(["task","bulk",...operation,task.id,"invalid-id","--json"])
    expect(result.status).toBe(1)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout).ok).toBe(false)
    const shown = run(["task","show",task.id,"--json"])
    expect(shown.status).toBe(0)
    expect(JSON.parse(shown.stdout)).toMatchObject({status:"active",score:8})
  })

  it("preserves per-task bulk failures after all input IDs validate",() => {
    const task = JSON.parse(run(["task","add","Complete valid task","--json"]).stdout)
    const result = run(["task","bulk","done",task.id,"tx-000000000000","--json"])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({succeeded:[task.id],failed:[{id:"tx-000000000000"}]})
    expect(JSON.parse(run(["task","show",task.id,"--json"]).stdout).status).toBe("done")
  })

  it("returns an actionable JSON error when assigning an unknown label",() => {
    const task = JSON.parse(run(["task","add","Needs a label","--json"]).stdout)
    const result = run(["task","label","assign",task.id,"missing-label","--json"])
    expect(result.status).toBe(2)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toMatchObject({ok:false,error:{code:"service/label-not-found",
      hint:'Create it first with: tx task label add -- "missing-label"'}})
  })

  it("returns a JSON service error when assigning a label to an unknown task",() => {
    expect(run(["task","label","add","known","--json"]).status).toBe(0)
    const result = run(["task","label","assign","tx-000000000000","known","--json"])
    expect(result.status).toBe(2)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toMatchObject({ok:false,error:{code:"service/task-not-found"}})
  })

  it("quotes a label recovery command so its name round-trips through a shell",() => {
    const name = '-Tutor\'s "lab" $TX_HINT_PROBE `printf substituted` \\ equipment'
    const task = JSON.parse(run(["task","add","Needs a named label","--json"]).stdout)
    const result = run(["task","label","assign",task.id,"--json","--",name])
    const hint = JSON.parse(result.stdout).error.hint as string
    const command = hint.replace(/^Create it first with: /,"")
    const parsed = spawnSync("bash",["-c",`tx() { printf '%s\\n' "$@"; }\n${command}`],{
      encoding:"utf8",env:{PATH:process.env.PATH,TX_HINT_PROBE:"unexpected-expansion"},
    })
    expect(parsed.status,parsed.stderr).toBe(0)
    expect(parsed.stdout.trim().split("\n")).toEqual(["task","label","add","--",name])
  })

  it("reports the actual custom database location during init",() => {
    const result = run(["init","--codex"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(db)
    expect(existsSync(db)).toBe(true)
  })
})
