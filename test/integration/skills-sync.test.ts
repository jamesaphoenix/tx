import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..")
const CLI_SRC = resolve(REPO_ROOT, "apps/cli/src/cli.ts")
const sandboxes: string[] = []

function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "tx-skills-sync-"))
  sandboxes.push(dir)
  return dir
}

function runSkillsSync(args: string[]) {
  return spawnSync("bun", [CLI_SRC, "skills", "sync", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 90000,
  })
}

afterEach(() => {
  for (const dir of sandboxes.splice(0, sandboxes.length)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe("tx skills sync", () => {
  it("syncs Claude and Codex skills into a target project from the canonical tx path", () => {
    const sandbox = makeSandbox()
    const result = runSkillsSync(["--project-dir", sandbox, "--json"])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as {
      projectDir: string
      targets: Array<{
        target: string
        installRoot: string
        manifestPath: string
        added: string[]
        updated: string[]
        unchanged: string[]
      }>
    }

    expect(parsed.projectDir).toBe(sandbox)
    expect(parsed.targets).toHaveLength(2)

    const claude = parsed.targets.find((target) => target.target === "claude")
    const codex = parsed.targets.find((target) => target.target === "codex")

    expect(claude).toBeTruthy()
    expect(codex).toBeTruthy()
    expect(claude!.added.length).toBeGreaterThan(0)
    expect(codex!.added.length).toBeGreaterThan(0)
    expect(claude!.updated).toEqual([])
    expect(codex!.updated).toEqual([])

    expect(existsSync(join(sandbox, ".claude", "skills", "manifest.json"))).toBe(true)
    expect(existsSync(join(sandbox, ".codex", "skills", "manifest.json"))).toBe(true)

    const codexSyncSkill = readFileSync(join(sandbox, ".codex", "skills", "skills-sync", "SKILL.md"), "utf-8")
    const claudeSyncSkill = readFileSync(join(sandbox, ".claude", "skills", "skills-sync", "SKILL.md"), "utf-8")
    expect(codexSyncSkill).toContain("tx skills sync")
    expect(claudeSyncSkill).toContain("tx skills sync")
  })

  it("updates changed tx-managed skills in place, preserves custom skills, and honors target filters", () => {
    const sandbox = makeSandbox()
    const first = runSkillsSync(["--project-dir", sandbox, "--target", "codex"])

    expect(first.status).toBe(0)
    expect(existsSync(join(sandbox, ".claude"))).toBe(false)

    const managedSkill = join(sandbox, ".codex", "skills", "skills-sync", "SKILL.md")
    writeFileSync(managedSkill, "# drifted\n")

    const customSkillDir = join(sandbox, ".codex", "skills", "custom-local")
    mkdirSync(customSkillDir, { recursive: true })
    writeFileSync(join(customSkillDir, "SKILL.md"), "# custom local skill\n")

    const second = runSkillsSync(["--project-dir", sandbox, "--target", "codex", "--json"])

    expect(second.status).toBe(0)
    const parsed = JSON.parse(second.stdout) as {
      targets: Array<{
        target: string
        added: string[]
        updated: string[]
        unchanged: string[]
      }>
    }

    expect(parsed.targets).toHaveLength(1)
    expect(parsed.targets[0]?.target).toBe("codex")
    expect(parsed.targets[0]?.updated).toContain(".codex/skills/skills-sync/SKILL.md")

    const restoredManagedSkill = readFileSync(managedSkill, "utf-8")
    expect(restoredManagedSkill).toContain("Use this skill when the user wants to install or refresh")
    expect(readFileSync(join(customSkillDir, "SKILL.md"), "utf-8")).toBe("# custom local skill\n")
    expect(existsSync(join(sandbox, ".claude"))).toBe(false)
  })

  it("fails clearly when the install root is a symlink", () => {
    const sandbox = makeSandbox()
    const outside = makeSandbox()
    symlinkSync(outside, join(sandbox, ".codex"), "dir")

    const result = runSkillsSync(["--project-dir", sandbox, "--target", "codex"])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("symlinked destination paths are not supported")
    expect(existsSync(join(outside, "skills"))).toBe(false)
  })

  it("fails clearly when a managed skill file was replaced with a symlink", () => {
    const sandbox = makeSandbox()
    const first = runSkillsSync(["--project-dir", sandbox, "--target", "codex"])

    expect(first.status).toBe(0)

    const managedSkill = join(sandbox, ".codex", "skills", "skills-sync", "SKILL.md")
    const redirectedTarget = join(sandbox, "redirected-skill.md")
    writeFileSync(redirectedTarget, "# redirected\n")
    unlinkSync(managedSkill)
    symlinkSync(redirectedTarget, managedSkill)

    const second = runSkillsSync(["--project-dir", sandbox, "--target", "codex"])

    expect(second.status).not.toBe(0)
    expect(second.stderr).toContain("symlinked destination paths are not supported")
    expect(readFileSync(redirectedTarget, "utf-8")).toBe("# redirected\n")
  })

  it("surfaces invalid project targets without a stack trace", () => {
    const result = runSkillsSync(["--project-dir", "/dev/null", "--target", "codex"])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Failed to sync tx skill bundles.")
    expect(result.stderr).toContain("project path exists and is not a directory")
    expect(result.stderr).not.toContain("at validateProjectDir")
  })
})
