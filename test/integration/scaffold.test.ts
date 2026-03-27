import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  chmodSync,
  mkdtempSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffoldClaude, scaffoldCodex, scaffoldWatchdog } from "../../apps/cli/src/commands/scaffold.js"

let testDir = ""

const BUNDLED_SPEC_SKILLS = ["decompose-spec", "design-doc", "overview-spec", "prd", "ralph-loop", "task-spec-loop", "verify-invariants"] as const

function cleanup() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true })
  }
}

function createMockRuntime(name: string): string {
  const binDir = join(testDir, ".bin")
  mkdirSync(binDir, { recursive: true })
  const cmdPath = join(binDir, name)
  writeFileSync(cmdPath, "#!/bin/bash\nexit 0\n")
  chmodSync(cmdPath, 0o755)
  return binDir
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

describe("scaffold", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "tx-scaffold-test-"))
  })

  afterEach(() => {
    cleanup()
  })

  describe("scaffoldClaude", () => {
    it("installs generated Claude skills and bundled spec skills by default", () => {
      const result = scaffoldClaude(testDir)
      const root = skillRoot("claude")

      expect(result.copied.length).toBeGreaterThan(0)
      expect(result.skipped).toEqual([])
      expect(result.copied).toContain(".claude/skills/manifest.json")

      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(false)
      expect(existsSync(join(root, "manifest.json"))).toBe(true)
      expect(existsSync(join(root, "tx-core-loop", "SKILL.md"))).toBe(true)
      expect(existsSync(join(root, "tx-core-loop", "references", "commands.md"))).toBe(true)
      expect(existsSync(join(root, "tx-workflow", "SKILL.md"))).toBe(false)

      const coreSkill = readFileSync(join(root, "tx-core-loop", "SKILL.md"), "utf-8")
      expect(coreSkill).toContain("tx Core Loop")
      expect(coreSkill).toContain("Claude Code")

      const prdSkill = readFileSync(join(root, "prd", "SKILL.md"), "utf-8")
      expect(prdSkill).toContain("~/.claude/plans/")
      expect(existsSync(join(root, "skills-sync", "SKILL.md"))).toBe(true)

      expectBundledSpecSkills("claude")
    })

    it("is idempotent and skips generated Claude skill files on rerun", () => {
      scaffoldClaude(testDir)

      const result = scaffoldClaude(testDir)

      expect(result.copied).toEqual([])
      expect(result.skipped).toContain(".claude/skills/manifest.json")
      expect(result.skipped.some((file) => file.startsWith(".claude/skills/tx-core-loop/"))).toBe(true)
    })

    it("can still create CLAUDE.md as an opt-in compatibility file", () => {
      const result = scaffoldClaude(testDir, { claudeMd: true })

      expect(result.copied).toContain("CLAUDE.md")
      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true)

      const content = readFileSync(join(testDir, "CLAUDE.md"), "utf-8")
      expect(content).toContain("Start Here")
      expect(content).toContain("tx ready")
    })

    it("skips opt-in CLAUDE.md when the tx heading is already present", () => {
      const claudeMd = join(testDir, "CLAUDE.md")
      writeFileSync(claudeMd, "# tx - Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldClaude(testDir, { claudeMd: true })

      expect(result.skipped).toContain("CLAUDE.md (tx section already present)")
      const content = readFileSync(claudeMd, "utf-8")
      expect(content.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
    })

    it("copies ralph script when ralphScript option is true", () => {
      const result = scaffoldClaude(testDir, { ralphScript: true })

      const ralphScript = join(testDir, "scripts", "ralph.sh")
      expect(existsSync(ralphScript)).toBe(true)
      expect(result.copied.some((file) => file.includes("ralph.sh"))).toBe(true)

      if (process.platform !== "win32") {
        const stat = statSync(ralphScript)
        expect(stat.mode & 0o100).toBeTruthy()
      }

      const content = readFileSync(ralphScript, "utf-8")
      expect(content).toContain("set -o noclobber")
      expect(content).toContain("remove_owned_lock_file")
    })

    it("does not copy ralph script by default", () => {
      scaffoldClaude(testDir)

      expect(existsSync(join(testDir, "scripts", "ralph.sh"))).toBe(false)
    })
  })

  describe("scaffoldCodex", () => {
    it("installs generated Codex skills, bundled spec skills, and rules by default", () => {
      const result = scaffoldCodex(testDir)
      const root = skillRoot("codex")

      expect(result.copied.length).toBeGreaterThan(0)
      expect(result.skipped).toEqual([])
      expect(result.copied).toContain(".codex/skills/manifest.json")

      expect(existsSync(join(testDir, "AGENTS.md"))).toBe(false)
      expect(existsSync(join(testDir, ".codex", "agents"))).toBe(false)
      expect(existsSync(join(root, "manifest.json"))).toBe(true)
      expect(existsSync(join(root, "tx-core-loop", "SKILL.md"))).toBe(true)
      expect(existsSync(join(root, "tx-core-loop", "references", "commands.md"))).toBe(true)
      expect(existsSync(join(testDir, ".codex", "rules", "default.rules"))).toBe(true)

      const designDocSkill = readFileSync(join(root, "design-doc", "SKILL.md"), "utf-8")
      expect(designDocSkill).toContain("~/.codex/plans/")
      expect(designDocSkill).not.toContain("~/.claude/plans/")
      expect(designDocSkill).toContain("project instructions")
      expect(designDocSkill).toContain("`prd`")
      expect(existsSync(join(root, "skills-sync", "SKILL.md"))).toBe(true)

      expectBundledSpecSkills("codex")
    })

    it("is idempotent and skips generated Codex skill files on rerun", () => {
      scaffoldCodex(testDir)

      const result = scaffoldCodex(testDir)

      expect(result.copied).toEqual([])
      expect(result.skipped).toContain(".codex/skills/manifest.json")
      expect(result.skipped.some((file) => file.startsWith(".codex/skills/tx-core-loop/"))).toBe(true)
      expect(result.skipped.some((file) => file.startsWith(".codex/rules/"))).toBe(true)
    })

    it("can still create AGENTS.md as an opt-in compatibility file", () => {
      const result = (scaffoldCodex as (projectDir: string, options?: { agentsMd?: boolean }) => ReturnType<typeof scaffoldCodex>)(
        testDir,
        { agentsMd: true }
      )

      expect(result.copied).toContain("AGENTS.md")
      expect(existsSync(join(testDir, "AGENTS.md"))).toBe(true)

      const content = readFileSync(join(testDir, "AGENTS.md"), "utf-8")
      expect(content).toContain("Start Here")
      expect(content).toContain("tx ready")
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

  describe("scaffoldWatchdog", () => {
    it("creates watchdog scripts/service assets and runtime-enabled env config", () => {
      const pathEnv = createMockRuntime("codex")
      const result = scaffoldWatchdog(testDir, { runtimeMode: "auto", pathEnv })

      expect(result.warnings).toEqual([])
      expect(result.watchdogEnabled).toBe(true)
      expect(result.codexEnabled).toBe(true)
      expect(result.claudeEnabled).toBe(false)

      expect(existsSync(join(testDir, "scripts", "ralph-watchdog.sh"))).toBe(true)
      expect(existsSync(join(testDir, "scripts", "ralph-hourly-supervisor.sh"))).toBe(true)
      expect(existsSync(join(testDir, "scripts", "watchdog-launcher.sh"))).toBe(true)
      expect(existsSync(join(testDir, "ops", "watchdog", "com.tx.ralph-watchdog.plist"))).toBe(true)
      expect(existsSync(join(testDir, "ops", "watchdog", "tx-ralph-watchdog.service"))).toBe(true)
      expect(existsSync(join(testDir, ".tx", "watchdog.env"))).toBe(true)

      const env = readFileSync(join(testDir, ".tx", "watchdog.env"), "utf-8")
      expect(env).toContain("WATCHDOG_ENABLED=1")
      expect(env).toContain("WATCHDOG_RUNTIME_MODE=auto")
      expect(env).toContain("WATCHDOG_CODEX_ENABLED=1")
      expect(env).toContain("WATCHDOG_CLAUDE_ENABLED=0")
      expect(env).toContain("WATCHDOG_TRANSCRIPT_IDLE_SECONDS=600")
      expect(env).toContain("WATCHDOG_CLAUDE_STALL_GRACE_SECONDS=900")
      expect(env).toContain("WATCHDOG_ERROR_BURST_GRACE_SECONDS=600")
      expect(env).toContain("WATCHDOG_DETACHED=1")

      if (process.platform !== "win32") {
        const stat = statSync(join(testDir, "scripts", "watchdog-launcher.sh"))
        expect(stat.mode & 0o100).toBeTruthy()
      }
    })

    it("auto runtime with no detected CLIs scaffolds disabled watchdog config and warnings", () => {
      const result = scaffoldWatchdog(testDir, { runtimeMode: "auto", pathEnv: "" })

      expect(result.watchdogEnabled).toBe(false)
      expect(result.codexEnabled).toBe(false)
      expect(result.claudeEnabled).toBe(false)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((warning) => warning.includes("auto-detect found no codex/claude"))).toBe(true)

      expect(existsSync(join(testDir, "scripts", "ralph-watchdog.sh"))).toBe(true)
      expect(existsSync(join(testDir, "scripts", "ralph-hourly-supervisor.sh"))).toBe(true)
      expect(existsSync(join(testDir, "scripts", "watchdog-launcher.sh"))).toBe(true)
      expect(existsSync(join(testDir, "ops", "watchdog", "com.tx.ralph-watchdog.plist"))).toBe(true)
      expect(existsSync(join(testDir, "ops", "watchdog", "tx-ralph-watchdog.service"))).toBe(true)
      expect(existsSync(join(testDir, ".tx", "watchdog.env"))).toBe(true)

      const env = readFileSync(join(testDir, ".tx", "watchdog.env"), "utf-8")
      expect(env).toContain("WATCHDOG_ENABLED=0")
      expect(env).toContain("WATCHDOG_RUNTIME_MODE=auto")
      expect(env).toContain("WATCHDOG_CODEX_ENABLED=0")
      expect(env).toContain("WATCHDOG_CLAUDE_ENABLED=0")
      expect(env).toContain("WATCHDOG_DETACHED=1")
    })

    it("fails clearly when runtime mode requires unavailable CLIs", () => {
      expect(() => scaffoldWatchdog(testDir, { runtimeMode: "both", pathEnv: "" }))
        .toThrow(/requires codex and claude; missing: codex, claude/i)
    })

    it("does not overwrite existing watchdog assets", () => {
      mkdirSync(join(testDir, "scripts"), { recursive: true })
      mkdirSync(join(testDir, ".tx"), { recursive: true })
      writeFileSync(join(testDir, "scripts", "ralph-watchdog.sh"), "# sentinel-watchdog\n")
      writeFileSync(join(testDir, ".tx", "watchdog.env"), "WATCHDOG_ENABLED=0\n")

      const result = scaffoldWatchdog(testDir, { runtimeMode: "auto", pathEnv: "" })

      expect(result.skipped).toContain("scripts/ralph-watchdog.sh")
      expect(result.skipped).toContain(".tx/watchdog.env")
      expect(readFileSync(join(testDir, "scripts", "ralph-watchdog.sh"), "utf-8")).toBe("# sentinel-watchdog\n")
      expect(readFileSync(join(testDir, ".tx", "watchdog.env"), "utf-8")).toBe("WATCHDOG_ENABLED=0\n")
    })
  })
})
