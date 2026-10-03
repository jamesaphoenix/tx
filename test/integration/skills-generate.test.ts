import { afterEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parse } from "yaml"
const cli = resolve(__dirname,"../../apps/cli/src/cli.ts")
const roots: string[] = []
const sandbox = () => { const root=mkdtempSync(join(tmpdir(),"tx-generate-"));roots.push(root);return root }
const run = (args: string[], cwd: string) => spawnSync("bun",[cli,...args],{cwd,encoding:"utf8",timeout:90000})
afterEach(() => { for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}) })
describe("tx skills generate", () => {
  it("exposes output and clean options in CLI help", () => {
    const result=run(["help","skills","generate"],sandbox())
    expect(result.status).toBe(0);expect(result.stdout).toContain("--output-dir");expect(result.stdout).toContain("--clean")
  })
  it("generates three install-ready guides for each target with valid manifests", () => {
    const root=sandbox(), out=join(root,"out")
    const result=run(["skills","generate","--output-dir",out,"--clean","--json"],root)
    expect(result.status).toBe(0)
    const parsed=JSON.parse(result.stdout) as {targets:Array<{target:string;manifestPath:string;skillCount:number;fileCount:number}>}
    expect(parsed.targets).toHaveLength(2)
    for(const target of parsed.targets){
      expect(target.skillCount).toBe(3);expect(target.fileCount).toBe(4)
      const manifest=JSON.parse(readFileSync(target.manifestPath,"utf8")) as {skills:Array<{id:string;installPath:string}>}
      expect(manifest.skills.map(s=>s.id)).toEqual(["tx-tasks","tx-docs","verify-invariants"])
      for(const skill of manifest.skills){
        const dir=join(out,target.target,skill.installPath), content=readFileSync(join(dir,"SKILL.md"),"utf8")
        expect(readdirSync(dir)).toEqual(["SKILL.md"])
        const header=content.match(/^---\n([\s\S]*?)\n---/)!
        expect(parse(header[1]).name).toBe(skill.id);expect(content).not.toContain("—")
      }
    }
    const before=readFileSync(parsed.targets[0].manifestPath,"utf8")
    expect(run(["skills","generate","--output-dir",out,"--clean"],root).status).toBe(0)
    expect(readFileSync(parsed.targets[0].manifestPath,"utf8")).toBe(before)
  })
  it("honours target selection", () => {
    const root=sandbox(),out=join(root,"out")
    expect(run(["skills","generate","--target","codex","--output-dir",out],root).status).toBe(0)
    expect(existsSync(join(out,"codex",".codex","skills","manifest.json"))).toBe(true)
    expect(existsSync(join(out,"claude"))).toBe(false)
  })
  it("rejects invalid targets without writing a bundle", () => {
    const root=sandbox()
    const result=run(["skills","generate","--target","bad"],root)
    expect(result.status).not.toBe(0);expect(result.stderr).toContain("Invalid --target")
    expect(existsSync(join(root,".tx","generated-skills"))).toBe(false)
  })
})
