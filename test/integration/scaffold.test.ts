import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { scaffoldClaude, scaffoldCodex, scaffoldWatchdog } from "../../apps/cli/src/commands/scaffold.js"

const TEST_DIR = join("/tmp", `tx-scaffold-test-${process.pid}`)

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
}

function createMockRuntime(name: string): string {
  const binDir = join(TEST_DIR, ".bin")
  mkdirSync(binDir, { recursive: true })
  const cmdPath = join(binDir, name)
  writeFileSync(cmdPath, "#!/bin/bash\nexit 0\n")
  chmodSync(cmdPath, 0o755)
  return binDir
}

describe("scaffold", () => {
  beforeEach(() => {
    cleanup()
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    cleanup()
  })

  describe("scaffoldClaude", () => {
    it("creates CLAUDE.md and skills in empty project", () => {
      const result = scaffoldClaude(TEST_DIR)

      expect(result.copied.length).toBeGreaterThan(0)
      expect(result.skipped).toEqual([])

      // CLAUDE.md created
      const claudeMd = join(TEST_DIR, "CLAUDE.md")
      expect(existsSync(claudeMd)).toBe(true)
      const content = readFileSync(claudeMd, "utf-8")
      expect(content).toContain("tx ready")
      expect(content).toContain("tx done")
      expect(content).toContain("Example Orchestration")

      // Skills created
      const workflowSkill = join(TEST_DIR, ".claude", "skills", "tx-workflow", "SKILL.md")
      expect(existsSync(workflowSkill)).toBe(true)
      expect(readFileSync(workflowSkill, "utf-8")).toContain("tx Workflow")

      const cycleSkill = join(TEST_DIR, ".claude", "skills", "tx-cycle", "SKILL.md")
      expect(existsSync(cycleSkill)).toBe(true)
      expect(readFileSync(cycleSkill, "utf-8")).toContain("tx cycle")
    })

    it("appends to existing CLAUDE.md without tx section", () => {
      const claudeMd = join(TEST_DIR, "CLAUDE.md")
      writeFileSync(claudeMd, "# My Project\n\nExisting content.\n")

      const result = scaffoldClaude(TEST_DIR)

      const content = readFileSync(claudeMd, "utf-8")
      expect(content).toContain("# My Project")
      expect(content).toContain("Existing content.")
      expect(content).toContain("tx ready")
      expect(result.copied).toContain("CLAUDE.md (appended tx section)")
    })

    it("skips CLAUDE.md if tx section already present", () => {
      const claudeMd = join(TEST_DIR, "CLAUDE.md")
      writeFileSync(claudeMd, "# tx — Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldClaude(TEST_DIR)

      expect(result.skipped).toContain("CLAUDE.md (tx section already present)")
      // Content should not be duplicated
      const content = readFileSync(claudeMd, "utf-8")
      expect(content).toBe("# tx — Headless, Local Infra for AI Agents\n\nAlready here.\n")
    })

    it("skips CLAUDE.md when tx heading uses hyphen variant", () => {
      const claudeMd = join(TEST_DIR, "CLAUDE.md")
      writeFileSync(claudeMd, "# tx - Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldClaude(TEST_DIR)

      expect(result.skipped).toContain("CLAUDE.md (tx section already present)")
      const content = readFileSync(claudeMd, "utf-8")
      expect(content.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
    })

    it("skips skill files that already exist", () => {
      // First run
      scaffoldClaude(TEST_DIR)

      // Second run — everything should be skipped
      const result = scaffoldClaude(TEST_DIR)

      expect(result.copied).toEqual([])
      expect(result.skipped.length).toBeGreaterThan(0)
    })

    it("respects options to exclude cycle skill", () => {
      const result = scaffoldClaude(TEST_DIR, { cycleSkill: false })

      // Workflow skill should exist
      const workflowSkill = join(TEST_DIR, ".claude", "skills", "tx-workflow", "SKILL.md")
      expect(existsSync(workflowSkill)).toBe(true)

      // Cycle skill should NOT exist
      const cycleSkill = join(TEST_DIR, ".claude", "skills", "tx-cycle", "SKILL.md")
      expect(existsSync(cycleSkill)).toBe(false)

      // CLAUDE.md should still be created
      expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(true)
      expect(result.copied.some(f => f.includes("tx-cycle"))).toBe(false)
    })

    it("respects options to exclude CLAUDE.md", () => {
      const result = scaffoldClaude(TEST_DIR, { claudeMd: false })

      // Skills should exist
      expect(existsSync(join(TEST_DIR, ".claude", "skills", "tx-workflow", "SKILL.md"))).toBe(true)

      // CLAUDE.md should NOT exist
      expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(false)
      expect(result.copied.some(f => f.includes("CLAUDE.md"))).toBe(false)
    })

    it("copies ralph script when ralphScript option is true", () => {
      const result = scaffoldClaude(TEST_DIR, { ralphScript: true })

      const ralphScript = join(TEST_DIR, "scripts", "ralph.sh")
      expect(existsSync(ralphScript)).toBe(true)
      expect(result.copied.some(f => f.includes("ralph.sh"))).toBe(true)

      // Verify it's executable (owner execute bit)
      const stat = statSync(ralphScript)
      expect(stat.mode & 0o100).toBeTruthy()
    })

    it("does not copy ralph script by default", () => {
      scaffoldClaude(TEST_DIR)

      expect(existsSync(join(TEST_DIR, "scripts", "ralph.sh"))).toBe(false)
    })
  })

  describe("scaffoldCodex", () => {
    it("creates AGENTS.md and codex agent profiles in empty project", () => {
      const result = scaffoldCodex(TEST_DIR)

      expect(result.copied).toContain("AGENTS.md")
      expect(result.skipped).toEqual([])

      const agentsMd = join(TEST_DIR, "AGENTS.md")
      expect(existsSync(agentsMd)).toBe(true)
      const content = readFileSync(agentsMd, "utf-8")
      expect(content).toContain("tx ready")
      expect(content).toContain("tx done")
      expect(content).toContain("codex")

      const codexImplementer = join(TEST_DIR, ".codex", "agents", "tx-implementer.md")
      expect(existsSync(codexImplementer)).toBe(true)
      expect(readFileSync(codexImplementer, "utf-8")).toContain("Read AGENTS.md")
    })

    it("appends to existing AGENTS.md without tx section", () => {
      const agentsMd = join(TEST_DIR, "AGENTS.md")
      writeFileSync(agentsMd, "# Agents\n\nExisting instructions.\n")

      scaffoldCodex(TEST_DIR)

      const content = readFileSync(agentsMd, "utf-8")
      expect(content).toContain("# Agents")
      expect(content).toContain("Existing instructions.")
      expect(content).toContain("tx ready")
    })

    it("skips AGENTS.md if tx section already present", () => {
      const agentsMd = join(TEST_DIR, "AGENTS.md")
      writeFileSync(agentsMd, "# tx — Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldCodex(TEST_DIR)

      expect(result.skipped).toContain("AGENTS.md (tx section already present)")
      expect(result.skipped.some(f => f.startsWith(".codex/agents/"))).toBe(false)
    })

    it("skips AGENTS.md when tx heading uses hyphen variant", () => {
      const agentsMd = join(TEST_DIR, "AGENTS.md")
      writeFileSync(agentsMd, "# tx - Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldCodex(TEST_DIR)

      expect(result.skipped).toContain("AGENTS.md (tx section already present)")
      const content = readFileSync(agentsMd, "utf-8")
      expect(content.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
    })

    it("skips codex agent profiles that already exist", () => {
      scaffoldCodex(TEST_DIR)

      const result = scaffoldCodex(TEST_DIR)

      expect(result.skipped.some(f => f.startsWith(".codex/agents/"))).toBe(true)
    })

    it("throws a clear error when .codex path collides with a file", () => {
      writeFileSync(join(TEST_DIR, ".codex"), "not-a-directory")

      expect(() => scaffoldCodex(TEST_DIR)).toThrow(/parent path exists as a file/i)
    })
  })

  describe("scaffoldWatchdog", () => {
    it("creates watchdog scripts/service assets and runtime-enabled env config", () => {
      const pathEnv = createMockRuntime("codex")
      const result = scaffoldWatchdog(TEST_DIR, { runtimeMode: "auto", pathEnv })

      expect(result.warnings).toEqual([])
      expect(result.watchdogEnabled).toBe(true)
      expect(result.codexEnabled).toBe(true)
      expect(result.claudeEnabled).toBe(false)

      expect(existsSync(join(TEST_DIR, "scripts", "ralph-watchdog.sh"))).toBe(true)
      expect(existsSync(join(TEST_DIR, "scripts", "ralph-hourly-supervisor.sh"))).toBe(true)
      expect(existsSync(join(TEST_DIR, "scripts", "watchdog-launcher.sh"))).toBe(true)
      expect(existsSync(join(TEST_DIR, "ops", "watchdog", "com.tx.ralph-watchdog.plist"))).toBe(true)
      expect(existsSync(join(TEST_DIR, "ops", "watchdog", "tx-ralph-watchdog.service"))).toBe(true)
      expect(existsSync(join(TEST_DIR, ".tx", "watchdog.env"))).toBe(true)

      const env = readFileSync(join(TEST_DIR, ".tx", "watchdog.env"), "utf-8")
      expect(env).toContain("WATCHDOG_ENABLED=1")
      expect(env).toContain("WATCHDOG_RUNTIME_MODE=auto")
      expect(env).toContain("WATCHDOG_CODEX_ENABLED=1")
      expect(env).toContain("WATCHDOG_CLAUDE_ENABLED=0")
      expect(env).toContain("WATCHDOG_DETACHED=1")

      const stat = statSync(join(TEST_DIR, "scripts", "watchdog-launcher.sh"))
      expect(stat.mode & 0o100).toBeTruthy()
    })

    it("fails clearly when runtime mode requires unavailable CLIs", () => {
      expect(() => scaffoldWatchdog(TEST_DIR, { runtimeMode: "both", pathEnv: "" }))
        .toThrow(/requires codex and claude; missing: codex, claude/i)
    })

    it("does not overwrite existing watchdog assets", () => {
      mkdirSync(join(TEST_DIR, "scripts"), { recursive: true })
      mkdirSync(join(TEST_DIR, ".tx"), { recursive: true })
      writeFileSync(join(TEST_DIR, "scripts", "ralph-watchdog.sh"), "# sentinel-watchdog\n")
      writeFileSync(join(TEST_DIR, ".tx", "watchdog.env"), "WATCHDOG_ENABLED=0\n")

      const result = scaffoldWatchdog(TEST_DIR, { runtimeMode: "auto", pathEnv: "" })

      expect(result.skipped).toContain("scripts/ralph-watchdog.sh")
      expect(result.skipped).toContain(".tx/watchdog.env")
      expect(readFileSync(join(TEST_DIR, "scripts", "ralph-watchdog.sh"), "utf-8")).toBe("# sentinel-watchdog\n")
      expect(readFileSync(join(TEST_DIR, ".tx", "watchdog.env"), "utf-8")).toBe("WATCHDOG_ENABLED=0\n")
    })
  })
})
