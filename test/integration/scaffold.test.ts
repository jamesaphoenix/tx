import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync, chmodSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffoldClaude, scaffoldCodex, scaffoldWatchdog } from "../../apps/cli/src/commands/scaffold.js"

let testDir = ""

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

describe("scaffold", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "tx-scaffold-test-"))
  })

  afterEach(() => {
    cleanup()
  })

  describe("scaffoldClaude", () => {
    it("creates CLAUDE.md and skills in empty project", () => {
      const result = scaffoldClaude(testDir)

      expect(result.copied.length).toBeGreaterThan(0)
      expect(result.skipped).toEqual([])

      // CLAUDE.md created
      const claudeMd = join(testDir, "CLAUDE.md")
      expect(existsSync(claudeMd)).toBe(true)
      const content = readFileSync(claudeMd, "utf-8")
      expect(content).toContain("tx ready")
      expect(content).toContain("tx done")
      expect(content).toContain("tx group-context set <id> <context>")
      expect(content).toContain("inherit the same context")
      expect(content).toContain("Example Orchestration")
      expect(content).toContain("Documentation Structure")
      expect(content).toContain("docs/requirements/")
      expect(content).toContain("REQ-NNN")
      expect(content).toContain("docs/system-design/")
      expect(content).toContain("SD-NNN")

      // Bounded Autonomy section
      expect(content).toContain("Bounded Autonomy")
      expect(content).toContain("tx guard set")
      expect(content).toContain("tx verify set")
      expect(content).toContain("tx label add")
      expect(content).toContain("tx label assign")
      expect(content).toContain("tx reflect")

      // Skills created
      const workflowSkill = join(testDir, ".claude", "skills", "tx-workflow", "SKILL.md")
      expect(existsSync(workflowSkill)).toBe(true)
      expect(readFileSync(workflowSkill, "utf-8")).toContain("tx Workflow")

      const cycleSkill = join(testDir, ".claude", "skills", "tx-cycle", "SKILL.md")
      expect(existsSync(cycleSkill)).toBe(true)
      expect(readFileSync(cycleSkill, "utf-8")).toContain("tx cycle")

      // Verify-build skill created (bounded autonomy)
      const verifyBuildSkill = join(testDir, ".claude", "skills", "verify-build", "SKILL.md")
      expect(existsSync(verifyBuildSkill)).toBe(true)
      expect(readFileSync(verifyBuildSkill, "utf-8")).toContain("tx verify run")
      expect(readFileSync(verifyBuildSkill, "utf-8")).toContain("parent task")
    })

    it("appends to existing CLAUDE.md without tx section", () => {
      const claudeMd = join(testDir, "CLAUDE.md")
      writeFileSync(claudeMd, "# My Project\n\nExisting content.\n")

      const result = scaffoldClaude(testDir)

      const content = readFileSync(claudeMd, "utf-8")
      expect(content).toContain("# My Project")
      expect(content).toContain("Existing content.")
      expect(content).toContain("tx ready")
      expect(content).toContain("tx group-context set <id> <context>")
      expect(result.copied).toContain("CLAUDE.md (appended tx section)")
    })

    it("skips CLAUDE.md if tx section already present", () => {
      const claudeMd = join(testDir, "CLAUDE.md")
      writeFileSync(claudeMd, "# tx — Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldClaude(testDir)

      expect(result.skipped).toContain("CLAUDE.md (tx section already present)")
      // Content should not be duplicated
      const content = readFileSync(claudeMd, "utf-8")
      expect(content).toBe("# tx — Headless, Local Infra for AI Agents\n\nAlready here.\n")
    })

    it("skips CLAUDE.md when tx heading uses hyphen variant", () => {
      const claudeMd = join(testDir, "CLAUDE.md")
      writeFileSync(claudeMd, "# tx - Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldClaude(testDir)

      expect(result.skipped).toContain("CLAUDE.md (tx section already present)")
      const content = readFileSync(claudeMd, "utf-8")
      expect(content.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
    })

    it("skips skill files that already exist", () => {
      // First run
      scaffoldClaude(testDir)

      // Second run — everything should be skipped
      const result = scaffoldClaude(testDir)

      expect(result.copied).toEqual([])
      expect(result.skipped.length).toBeGreaterThan(0)
    })

    it("respects options to exclude cycle skill", () => {
      const result = scaffoldClaude(testDir, { cycleSkill: false })

      // Workflow skill should exist
      const workflowSkill = join(testDir, ".claude", "skills", "tx-workflow", "SKILL.md")
      expect(existsSync(workflowSkill)).toBe(true)

      // Cycle skill should NOT exist
      const cycleSkill = join(testDir, ".claude", "skills", "tx-cycle", "SKILL.md")
      expect(existsSync(cycleSkill)).toBe(false)

      // CLAUDE.md should still be created
      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true)
      expect(result.copied.some(f => f.includes("tx-cycle"))).toBe(false)
    })

    it("respects options to exclude verify-build skill", () => {
      const result = scaffoldClaude(testDir, { verifyBuildSkill: false })

      // Workflow skill should exist
      const workflowSkill = join(testDir, ".claude", "skills", "tx-workflow", "SKILL.md")
      expect(existsSync(workflowSkill)).toBe(true)

      // Verify-build skill should NOT exist
      const verifyBuildSkill = join(testDir, ".claude", "skills", "verify-build", "SKILL.md")
      expect(existsSync(verifyBuildSkill)).toBe(false)
      expect(result.copied.some(f => f.includes("verify-build"))).toBe(false)
    })

    it("respects options to exclude CLAUDE.md", () => {
      const result = scaffoldClaude(testDir, { claudeMd: false })

      // Skills should exist
      expect(existsSync(join(testDir, ".claude", "skills", "tx-workflow", "SKILL.md"))).toBe(true)

      // CLAUDE.md should NOT exist
      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(false)
      expect(result.copied.some(f => f.includes("CLAUDE.md"))).toBe(false)
    })

    it("copies ralph script when ralphScript option is true", () => {
      const result = scaffoldClaude(testDir, { ralphScript: true })

      const ralphScript = join(testDir, "scripts", "ralph.sh")
      expect(existsSync(ralphScript)).toBe(true)
      expect(result.copied.some(f => f.includes("ralph.sh"))).toBe(true)

      // Verify it's executable (owner execute bit)
      if (process.platform !== "win32") {
        const stat = statSync(ralphScript)
        expect(stat.mode & 0o100).toBeTruthy()
      }

      // Lock handling should be atomic and owner-safe.
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
    it("creates AGENTS.md and codex agent profiles in empty project", () => {
      const result = scaffoldCodex(testDir)

      expect(result.copied).toContain("AGENTS.md")
      expect(result.skipped).toEqual([])

      const agentsMd = join(testDir, "AGENTS.md")
      expect(existsSync(agentsMd)).toBe(true)
      const content = readFileSync(agentsMd, "utf-8")
      expect(content).toContain("tx ready")
      expect(content).toContain("tx done")
      expect(content).toContain("codex")
      expect(content).toContain("tx group-context set <id> <context>")
      expect(content).toContain("inherit the same context")
      expect(content).toContain("Documentation Structure")
      expect(content).toContain("docs/requirements/")
      expect(content).toContain("REQ-NNN")
      expect(content).toContain("docs/system-design/")
      expect(content).toContain("SD-NNN")

      // Bounded Autonomy section
      expect(content).toContain("Bounded Autonomy")
      expect(content).toContain("tx guard set")
      expect(content).toContain("tx verify set")
      expect(content).toContain("tx label add")
      expect(content).toContain("tx label assign")
      expect(content).toContain("tx reflect")

      const codexImplementer = join(testDir, ".codex", "agents", "tx-implementer.md")
      expect(existsSync(codexImplementer)).toBe(true)
      expect(readFileSync(codexImplementer, "utf-8")).toContain("Read AGENTS.md")
    })

    it("appends to existing AGENTS.md without tx section", () => {
      const agentsMd = join(testDir, "AGENTS.md")
      writeFileSync(agentsMd, "# Agents\n\nExisting instructions.\n")

      scaffoldCodex(testDir)

      const content = readFileSync(agentsMd, "utf-8")
      expect(content).toContain("# Agents")
      expect(content).toContain("Existing instructions.")
      expect(content).toContain("tx ready")
    })

    it("skips AGENTS.md if tx section already present", () => {
      const agentsMd = join(testDir, "AGENTS.md")
      writeFileSync(agentsMd, "# tx — Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldCodex(testDir)

      expect(result.skipped).toContain("AGENTS.md (tx section already present)")
      expect(result.skipped.some(f => f.startsWith(".codex/agents/"))).toBe(false)
    })

    it("skips AGENTS.md when tx heading uses hyphen variant", () => {
      const agentsMd = join(testDir, "AGENTS.md")
      writeFileSync(agentsMd, "# tx - Headless, Local Infra for AI Agents\n\nAlready here.\n")

      const result = scaffoldCodex(testDir)

      expect(result.skipped).toContain("AGENTS.md (tx section already present)")
      const content = readFileSync(agentsMd, "utf-8")
      expect(content.match(/Headless, Local Infra for AI Agents/g)?.length ?? 0).toBe(1)
    })

    it("skips codex agent profiles that already exist", () => {
      scaffoldCodex(testDir)

      const result = scaffoldCodex(testDir)

      expect(result.skipped.some(f => f.startsWith(".codex/agents/"))).toBe(true)
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
