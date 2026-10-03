import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateSkillBundles, listAvailableSkills } from "../../apps/cli/src/skills/generate.js"
import { syncSkillBundles } from "../../apps/cli/src/skills/sync.js"
import { embeddedSkills } from "../../apps/cli/src/skills/embedded.js"
import { scaffoldCodex } from "../../apps/cli/src/commands/scaffold.js"
const roots: string[] = []
const sandbox = () => { const root = mkdtempSync(join(tmpdir(), "tx-minimal-")); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe("minimal skill bundle", () => {
  it("embeds the current canonical guides for compiled releases [INV-MINIMAL-004]", () => {
    expect(Object.keys(embeddedSkills)).toEqual(listAvailableSkills().map(s => s.id))
    for (const [id, content] of Object.entries(embeddedSkills)) {
      expect(content).toBe(readFileSync(new URL(`../../apps/cli/src/templates/shared-skills/${id}/SKILL.md`, import.meta.url), "utf8"))
    }
  })
  it("ships exactly three guides and no harness [INV-MINIMAL-001]", () => {
    expect(listAvailableSkills().map(s => s.id)).toEqual(["tx-tasks", "tx-docs", "verify-invariants"])
    const root = sandbox()
    scaffoldCodex(root)
    expect(readdirSync(join(root, ".codex")).sort()).toEqual(["skills"])
    expect(readdirSync(join(root, ".codex", "skills")).sort()).toEqual(["manifest.json", "tx-docs", "tx-tasks", "verify-invariants"])
    const result = generateSkillBundles({ outputDir: sandbox(), clean: true })
    for (const target of result.targets) { expect(target.skillCount).toBe(3); expect(target.fileCount).toBe(4) }
  })
  it("prunes retired manifest skills while preserving custom guides [INV-MINIMAL-002]", () => {
    const root = sandbox(), skills = join(root, ".codex", "skills")
    for (const id of ["ralph-loop", "custom-local"]) { mkdirSync(join(skills,id), {recursive:true}); writeFileSync(join(skills,id,"SKILL.md"), id) }
    writeFileSync(join(skills,"manifest.json"), JSON.stringify({generator:"tx skills generate", target:"codex", skills:[{id:"ralph-loop",installPath:".codex/skills/ralph-loop"}]}))
    syncSkillBundles({ projectDir: root, target: "codex" })
    expect(readdirSync(skills).sort()).toEqual(["custom-local", "manifest.json", "tx-docs", "tx-tasks", "verify-invariants"])
    expect(readFileSync(join(skills,"custom-local","SKILL.md"),"utf8")).toBe("custom-local")
    expect(syncSkillBundles({projectDir:root,target:"codex"}).targets[0]?.updated).toEqual([])
  })
  it("rejects dangling destination links before pruning retired guides [INV-MINIMAL-002]", () => {
    const root = sandbox(), skills = join(root, ".codex", "skills")
    mkdirSync(join(skills, "ralph-loop"), {recursive:true})
    writeFileSync(join(skills, "ralph-loop", "SKILL.md"), "retired")
    writeFileSync(join(skills,"manifest.json"),JSON.stringify({generator:"tx skills generate",skills:[{id:"ralph-loop",installPath:".codex/skills/ralph-loop"}]}))
    symlinkSync(join(root, "missing"), join(skills, "tx-docs"))
    expect(() => syncSkillBundles({projectDir:root,target:"codex"})).toThrow(/symlink/i)
    expect(readFileSync(join(skills,"ralph-loop","SKILL.md"),"utf8")).toBe("retired")
  })
  it("rejects an escaping legacy manifest before deleting anything", () => {
    const root = sandbox(), skills = join(root,".codex","skills"), outside = join(root,"keep")
    mkdirSync(skills,{recursive:true}); writeFileSync(outside,"keep")
    writeFileSync(join(skills,"manifest.json"),JSON.stringify({generator:"tx skills generate", target:"codex",skills:[{id:"ralph-loop",installPath:"keep"}]}))
    expect(() => syncSkillBundles({projectDir:root,target:"codex"})).toThrow(/manifest/i)
    expect(readFileSync(outside,"utf8")).toBe("keep")
  })
})
