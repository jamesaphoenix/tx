import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, relative } from "node:path"
import { parse } from "yaml"
import { commandHelp } from "../../apps/cli/src/help.js"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const BUNDLED_SHARED_SKILLS = ["design-doc", "map-invariants", "overview-spec", "prd", "ralph-loop", "skills-sync", "task-spec-loop", "verify-invariants"] as const
const sandboxes: string[] = []

function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "tx-skills-generate-"))
  sandboxes.push(dir)
  return dir
}

function runTx(args: string[], cwd: string) {
  return spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 90000,
  })
}

function snapshotFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {}

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const absolutePath = join(dir, entry)
      const relPath = relative(root, absolutePath)
      const stat = statSync(absolutePath)
      if (stat.isDirectory()) {
        visit(absolutePath)
      } else {
        files[relPath] = readFileSync(absolutePath, "utf-8")
      }
    }
  }

  visit(root)
  return files
}

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!match) {
    throw new Error("Missing SKILL.md frontmatter")
  }
  return (parse(match[1]) ?? {}) as Record<string, unknown>
}

afterEach(() => {
  for (const dir of sandboxes.splice(0, sandboxes.length)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe("tx skills generate", () => {
  it("shows help for the command surface", () => {
    const sandbox = makeSandbox()
    const result = runTx(["help", "skills", "generate"], sandbox)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx skills generate")
    expect(result.stdout).toContain("--output-dir")
    expect(result.stdout).toContain("--clean")
  })

  it("generates install-ready Claude and Codex bundles with full help coverage", () => {
    const sandbox = makeSandbox()
    const outputDir = join(sandbox, "generated")
    const result = runTx(["skills", "generate", "--output-dir", outputDir, "--clean", "--json"], sandbox)

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as {
      outputDir: string
      targets: Array<{ target: string; outputDir: string; manifestPath: string; skillCount: number; fileCount: number; commandCount: number }>
    }

    expect(parsed.targets).toHaveLength(2)

    for (const target of parsed.targets) {
      expect(target.skillCount).toBeGreaterThan(0)
      expect(target.fileCount).toBeGreaterThan(target.skillCount)
      expect(target.commandCount).toBe(Object.keys(commandHelp).length)
      expect(existsSync(target.manifestPath)).toBe(true)

      const manifest = JSON.parse(readFileSync(target.manifestPath, "utf-8")) as {
        target: string
        skillCount: number
        commandCount: number
        skills: Array<{ id: string; commandKeys: string[]; installPath: string; source: "generated" | "bundled" }>
      }

      expect(manifest.target).toBe(target.target)
      expect(manifest.skillCount).toBe(target.skillCount)
      expect(manifest.commandCount).toBe(Object.keys(commandHelp).length)

      const covered = manifest.skills.flatMap((skill) => skill.commandKeys).sort((a, b) => a.localeCompare(b))
      expect(covered).toEqual(Object.keys(commandHelp).sort((a, b) => a.localeCompare(b)))

      const installRoot = target.target === "claude" ? ".claude" : ".codex"
      const generatedSkill = manifest.skills.find((skill) => skill.source === "generated")
      expect(generatedSkill).toBeTruthy()
      expect(existsSync(join(target.outputDir, generatedSkill!.installPath, "SKILL.md"))).toBe(true)
      expect(existsSync(join(target.outputDir, generatedSkill!.installPath, "references", "commands.md"))).toBe(true)
      expect(generatedSkill!.installPath.startsWith(`${installRoot}/skills/`)).toBe(true)

      for (const skill of manifest.skills) {
        const skillContent = readFileSync(join(target.outputDir, skill.installPath, "SKILL.md"), "utf-8")
        expect(() => parseFrontmatter(skillContent)).not.toThrow()
      }

      for (const skillId of BUNDLED_SHARED_SKILLS) {
        const bundledSkill = manifest.skills.find((skill) => skill.id === skillId)
        expect(bundledSkill?.source).toBe("bundled")
        expect(existsSync(join(target.outputDir, bundledSkill!.installPath, "SKILL.md"))).toBe(true)
      }

      const syncSkill = manifest.skills.find((skill) => skill.id === "skills-sync")
      const syncSkillContent = readFileSync(join(target.outputDir, syncSkill!.installPath, "SKILL.md"), "utf-8")
      expect(syncSkillContent).toContain("tx skills sync")

      const ralphSkill = manifest.skills.find((skill) => skill.id === "ralph-loop")
      const ralphSkillContent = readFileSync(join(target.outputDir, ralphSkill!.installPath, "SKILL.md"), "utf-8")
      expect(ralphSkillContent).toContain("--design-doc <name>")
      expect(ralphSkillContent).toContain("--all-tasks")

      const designDocSkill = manifest.skills.find((skill) => skill.id === "design-doc")
      const designDocContent = readFileSync(join(target.outputDir, designDocSkill!.installPath, "SKILL.md"), "utf-8")
      if (target.target === "codex") {
        expect(designDocContent).toContain("~/.codex/plans/")
        expect(designDocContent).not.toContain("~/.claude/plans/")
        expect(designDocContent).toContain("project instructions")

        const prdSkill = manifest.skills.find((skill) => skill.id === "prd")
        const prdContent = readFileSync(join(target.outputDir, prdSkill!.installPath, "SKILL.md"), "utf-8")
        expect(prdContent).toContain("specs/prd/<name>.md")
      } else {
        expect(designDocContent).toContain("~/.claude/plans/")
      }
    }
  })

  it("is deterministic across regeneration runs", () => {
    const sandbox = makeSandbox()
    const outputA = join(sandbox, "run-a")
    const outputB = join(sandbox, "run-b")

    const first = runTx(["skills", "generate", "--output-dir", outputA, "--clean"], sandbox)
    expect(first.status).toBe(0)

    const second = runTx(["skills", "generate", "--output-dir", outputB, "--clean"], sandbox)
    expect(second.status).toBe(0)

    expect(snapshotFiles(outputA)).toEqual(snapshotFiles(outputB))
  })

  it("includes explicit shell and search recovery guidance in generated skills", () => {
    const sandbox = makeSandbox()
    const outputDir = join(sandbox, "generated")
    const result = runTx(["skills", "generate", "--target", "codex", "--output-dir", outputDir, "--clean"], sandbox)

    expect(result.status).toBe(0)

    const skillPath = join(outputDir, "codex", ".codex", "skills", "tx-core-loop", "SKILL.md")
    const content = readFileSync(skillPath, "utf-8")
    expect(content).toContain("rg -n <pattern> <path>")
    expect(content).toContain("grep -r")
    expect(content).toContain("truncated paths")
    expect(content).toContain("unterminated quotes")
  })
})
