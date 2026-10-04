import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffoldClaude, scaffoldCodex } from "../../apps/cli/src/commands/scaffold.js"

let testDir = ""

const BUNDLED_SPEC_SKILLS = ["tx-plan", "tx-tasks", "tx-docs", "verify-invariants"] as const

function cleanup() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true })
  }
}

function skillRoot(target: "claude" | "codex"): string {
  return target === "claude"
    ? join(testDir, ".claude", "skills")
    : join(testDir, ".codex", "skills")
}

function expectBundledSpecSkills(target: "claude" | "codex") {
  const root = skillRoot(target)
  for (const skillId of BUNDLED_SPEC_SKILLS) {
    expect(existsSync(join(root, skillId, "SKILL.md"))).toBe(true)
  }
}

function readManifest(target: "claude" | "codex") {
  const manifestPath = target === "claude"
    ? join(testDir, ".claude", "skills", "manifest.json")
    : join(testDir, ".codex", "skills", "manifest.json")

  return JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    skillCount: number
    skills: Array<{ id: string }>
  }
}

describe("scaffold", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "tx-scaffold-test-"))
  })

  afterEach(() => {
    cleanup()
  })

  describe("scaffoldClaude", () => {
    it("installs the four Claude guides by default", () => {
      const result = scaffoldClaude(testDir)
      const root = skillRoot("claude")

      expect(result.copied.length).toBeGreaterThan(0)
      expect(result.skipped).toEqual([])
      expect(result.copied).toContain(".claude/skills/manifest.json")

      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(false)
      expect(existsSync(join(root, "manifest.json"))).toBe(true)
      expect(existsSync(join(root, "tx-tasks", "SKILL.md"))).toBe(true)
      expect(existsSync(join(root, "tx-tasks", "references", "commands.md"))).toBe(false)
      expect(existsSync(join(root, "tx-workflow", "SKILL.md"))).toBe(false)

      const coreSkill = readFileSync(join(root, "tx-tasks", "SKILL.md"), "utf-8")
      expect(coreSkill).toContain("Create tasks")
      expect(coreSkill).toContain("tx task add")

      const prdSkill = readFileSync(join(root, "tx-docs", "SKILL.md"), "utf-8")
      expect(prdSkill).toContain("tx doc add prd")
      expect(existsSync(join(root, "tx-docs", "SKILL.md"))).toBe(true)

      expectBundledSpecSkills("claude")
    })

    it("is idempotent and skips generated Claude skill files on rerun", () => {
      scaffoldClaude(testDir)

      const result = scaffoldClaude(testDir)

      expect(result.copied).toEqual([])
      expect(result.skipped).toContain(".claude/skills/manifest.json")
      expect(result.skipped.some((file) => file.startsWith(".claude/skills/tx-tasks/"))).toBe(true)
    })

    it("lets onboarding install only the selected Claude skills", () => {
      const result = scaffoldClaude(testDir, {
        skills: ["tx-tasks", "tx-docs", "verify-invariants"],
      })

      expect(result.copied).toContain(".claude/skills/manifest.json")
      expect(existsSync(join(skillRoot("claude"), "tx-tasks", "SKILL.md"))).toBe(true)
      expect(existsSync(join(skillRoot("claude"), "tx-docs", "SKILL.md"))).toBe(true)
      expect(existsSync(join(skillRoot("claude"), "tx-docs", "SKILL.md"))).toBe(true)
      expect(existsSync(join(skillRoot("claude"), "tx-docs-specs", "SKILL.md"))).toBe(false)
      expect(existsSync(join(skillRoot("claude"), "ralph-loop", "SKILL.md"))).toBe(false)

      const manifest = readManifest("claude")
      expect(manifest.skillCount).toBe(3)
      expect(manifest.skills.map((skill) => skill.id)).toEqual([
        "tx-tasks",
        "tx-docs",
        "verify-invariants",
      ])
    })

    it("can still create CLAUDE.md as an opt-in compatibility file", () => {
      const result = scaffoldClaude(testDir, { claudeMd: true })

      expect(result.copied).toContain("CLAUDE.md")
      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true)

      const content = readFileSync(join(testDir, "CLAUDE.md"), "utf-8")
      expect(content).toContain("tx task and spec workflow")
      expect(content).toContain("tx task")
    })

    it("skips opt-in CLAUDE.md when the tx heading is already present", () => {
      const claudeMd = join(testDir, "CLAUDE.md")
      writeFileSync(claudeMd, "# tx - Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldClaude(testDir, { claudeMd: true })

      expect(result.skipped).toContain("CLAUDE.md (tx section already present)")
      const content = readFileSync(claudeMd, "utf-8")
      expect(content.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
    })

    it("does not copy ralph script by default", () => {
      scaffoldClaude(testDir)

      expect(existsSync(join(testDir, "scripts", "ralph.sh"))).toBe(false)
    })
  })

  describe("scaffoldCodex", () => {
    it("installs the four Codex guides without rules by default", () => {
      const result = scaffoldCodex(testDir)
      const root = skillRoot("codex")

      expect(result.copied.length).toBeGreaterThan(0)
      expect(result.skipped).toEqual([])
      expect(result.copied).toContain(".codex/skills/manifest.json")

      expect(existsSync(join(testDir, "AGENTS.md"))).toBe(false)
      expect(existsSync(join(testDir, ".codex", "agents"))).toBe(false)
      expect(existsSync(join(root, "manifest.json"))).toBe(true)
      expect(existsSync(join(root, "tx-tasks", "SKILL.md"))).toBe(true)
      expect(existsSync(join(root, "tx-tasks", "references", "commands.md"))).toBe(false)
      expect(existsSync(join(testDir, ".codex", "rules", "default.rules"))).toBe(false)

      const designDocSkill = readFileSync(join(root, "tx-docs", "SKILL.md"), "utf-8")
      expect(designDocSkill).toContain("tx doc add design")
      expect(designDocSkill).not.toContain("~/.claude/plans/")
      expect(designDocSkill).toContain("project instructions")
      expect(designDocSkill).toContain("tx doc add prd")
      expect(existsSync(join(root, "tx-docs", "SKILL.md"))).toBe(true)

      expectBundledSpecSkills("codex")
    })

    it("is idempotent and skips generated Codex skill files on rerun", () => {
      scaffoldCodex(testDir)

      const result = scaffoldCodex(testDir)

      expect(result.copied).toEqual([])
      expect(result.skipped).toContain(".codex/skills/manifest.json")
      expect(result.skipped.some((file) => file.startsWith(".codex/skills/tx-tasks/"))).toBe(true)
      expect(result.skipped.some((file) => file.startsWith(".codex/rules/"))).toBe(false)
    })

    it("lets onboarding install only the selected Codex skills while keeping rules", () => {
      const result = scaffoldCodex(testDir, {
        skills: ["tx-tasks", "verify-invariants"],
      })

      expect(result.copied).toContain(".codex/skills/manifest.json")
      expect(existsSync(join(skillRoot("codex"), "tx-tasks", "SKILL.md"))).toBe(true)
      expect(existsSync(join(skillRoot("codex"), "verify-invariants", "SKILL.md"))).toBe(true)
      expect(existsSync(join(skillRoot("codex"), "tx-docs", "SKILL.md"))).toBe(false)
      expect(existsSync(join(testDir, ".codex", "rules", "default.rules"))).toBe(false)

      const manifest = readManifest("codex")
      expect(manifest.skillCount).toBe(2)
      expect(manifest.skills.map((skill) => skill.id)).toEqual([
        "tx-tasks",
        "verify-invariants",
      ])
    })

    it("can still create AGENTS.md as an opt-in compatibility file", () => {
      const result = (scaffoldCodex as (projectDir: string, options?: { agentsMd?: boolean }) => ReturnType<typeof scaffoldCodex>)(
        testDir,
        { agentsMd: true }
      )

      expect(result.copied).toContain("AGENTS.md")
      expect(existsSync(join(testDir, "AGENTS.md"))).toBe(true)

      const content = readFileSync(join(testDir, "AGENTS.md"), "utf-8")
      expect(content).toContain("tx task and spec workflow")
      expect(content).toContain("tx task")
    })

    it("skips opt-in AGENTS.md when the tx heading is already present", () => {
      const agentsMd = join(testDir, "AGENTS.md")
      writeFileSync(agentsMd, "# tx - Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = (scaffoldCodex as (projectDir: string, options?: { agentsMd?: boolean }) => ReturnType<typeof scaffoldCodex>)(
        testDir,
        { agentsMd: true }
      )

      expect(result.skipped).toContain("AGENTS.md (tx section already present)")
      const content = readFileSync(agentsMd, "utf-8")
      expect(content.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
    })

    it("throws a clear error when .codex path collides with a file", () => {
      writeFileSync(join(testDir, ".codex"), "not-a-directory")

      expect(() => scaffoldCodex(testDir)).toThrow(/parent path exists as a file/i)
    })
  })
})
