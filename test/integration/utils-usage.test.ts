/**
 * Integration tests for tx utils claude-usage and tx utils codex-usage.
 *
 * These tests use REAL CLIs and REAL API calls to catch upstream regressions.
 * They are excluded from the default test suite (see vitest.config.ts) and
 * should be run explicitly with the dedicated config:
 *
 *   bunx --bun vitest run --config test/integration/vitest.utils-usage.config.ts
 *
 * The file-level beforeAll updates both CLIs to their latest versions.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const TIMEOUT = 30_000

const hasClaudeCreds = (() => {
  try {
    const p = join(homedir(), ".claude", ".credentials.json")
    if (!existsSync(p)) return false
    const c = JSON.parse(readFileSync(p, "utf-8"))
    return !!c?.claudeAiOauth?.accessToken
  } catch {
    return false
  }
})()

const hasCodex = spawnSync("which", ["codex"], { encoding: "utf-8" }).status === 0

function runTx(args: string[], env?: Record<string, string>): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("bun", [CLI_SRC, ...args], {
    encoding: "utf-8",
    timeout: TIMEOUT,
    env: env ? { ...process.env, ...env } : undefined,
  })
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  }
}

// Update CLIs to latest before all tests
beforeAll(() => {
  console.log("Updating Claude Code via brew...")
  const brewResult = spawnSync("brew", ["upgrade", "claude"], {
    encoding: "utf-8",
    timeout: 120_000,
  })
  if (brewResult.status !== 0) {
    console.warn(`brew upgrade claude (non-fatal): ${(brewResult.stderr || "").slice(0, 200)}`)
  }

  console.log("Updating Codex via npm...")
  const npmResult = spawnSync("npm", ["install", "-g", "codex@latest"], {
    encoding: "utf-8",
    timeout: 120_000,
  })
  if (npmResult.status !== 0) {
    console.warn(`npm install -g codex@latest (non-fatal): ${(npmResult.stderr || "").slice(0, 200)}`)
  }
}, 300_000) // 5 min timeout for CLI updates

describe("utils usage commands", () => {
  // --- Claude Code Usage ---

  describe.skipIf(!hasClaudeCreds)("claude-usage", () => {
    it("displays usage in human-readable format", () => {
      const result = runTx(["utils", "claude-usage"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Claude Code Usage")
      expect(result.stdout).toMatch(/\d+% used/)
      expect(result.stdout).toMatch(/\d+% left/)
      expect(result.stdout).toMatch(/resets/)
    })

    it("outputs valid JSON with --json flag", () => {
      const result = runTx(["utils", "claude-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("five_hour")
      expect(json.five_hour).toHaveProperty("utilization")
      expect(typeof json.five_hour.utilization).toBe("number")
      expect(json.five_hour.utilization).toBeGreaterThanOrEqual(0)
      expect(json.five_hour.utilization).toBeLessThanOrEqual(100)
    })

    it("JSON contains seven_day data with reset timestamps", () => {
      const result = runTx(["utils", "claude-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("seven_day")
      expect(json.seven_day).toHaveProperty("utilization")
      expect(json.seven_day).toHaveProperty("resets_at")
      expect(typeof json.seven_day.utilization).toBe("number")
    })

    it("JSON contains five_hour reset timestamp", () => {
      const result = runTx(["utils", "claude-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.five_hour).toHaveProperty("resets_at")
    })

    it("human-readable shows plan type from credentials", () => {
      const result = runTx(["utils", "claude-usage"])
      expect(result.status).toBe(0)
      // Plan type is shown in parentheses after "Claude Code Usage"
      expect(result.stdout).toMatch(/Claude Code Usage \(\w+\)/)
    })
  })

  // --- Codex Usage ---

  describe.skipIf(!hasCodex)("codex-usage", () => {
    it("displays usage in human-readable format", () => {
      const result = runTx(["utils", "codex-usage"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Codex Usage")
      expect(result.stdout).toMatch(/\d+% used/)
      expect(result.stdout).toMatch(/\d+% left/)
    })

    it("outputs valid JSON with --json flag", () => {
      const result = runTx(["utils", "codex-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("rateLimits")
      expect(json.rateLimits).toHaveProperty("primary")
      expect(json.rateLimits.primary).toHaveProperty("usedPercent")
      expect(typeof json.rateLimits.primary.usedPercent).toBe("number")
    })

    it("JSON contains secondary (weekly) limits", () => {
      const result = runTx(["utils", "codex-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json.rateLimits).toHaveProperty("secondary")
      expect(json.rateLimits.secondary).toHaveProperty("usedPercent")
    })

    it("JSON contains resetsAt as unix timestamps", () => {
      const result = runTx(["utils", "codex-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(typeof json.rateLimits.primary.resetsAt).toBe("number")
      expect(json.rateLimits.primary.resetsAt).toBeGreaterThan(1_700_000_000)
    })

    it("usedPercent values are in 0-100 range", () => {
      const result = runTx(["utils", "codex-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      const primary = json.rateLimits.primary.usedPercent
      const secondary = json.rateLimits.secondary.usedPercent
      expect(primary).toBeGreaterThanOrEqual(0)
      expect(primary).toBeLessThanOrEqual(100)
      expect(secondary).toBeGreaterThanOrEqual(0)
      expect(secondary).toBeLessThanOrEqual(100)
    })

    it("JSON contains rateLimitsByLimitId for per-model breakdown", () => {
      const result = runTx(["utils", "codex-usage", "--json"])
      expect(result.status).toBe(0)
      const json = JSON.parse(result.stdout)
      expect(json).toHaveProperty("rateLimitsByLimitId")
      expect(typeof json.rateLimitsByLimitId).toBe("object")
    })

    it("human-readable shows plan type", () => {
      const result = runTx(["utils", "codex-usage"])
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/Codex Usage \(\w+\)/)
    })
  })

  // --- Error handling (always runs) ---

  describe("error handling", () => {
    it("claude-usage fails gracefully with missing credentials", () => {
      const result = runTx(["utils", "claude-usage"], { HOME: "/nonexistent" })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("credentials not found")
    })

    it("codex-usage fails gracefully when codex not in PATH", () => {
      // Keep bun in PATH but exclude directories containing codex
      const codexDir = spawnSync("which", ["codex"], { encoding: "utf-8" }).stdout.trim().replace(/\/codex$/, "")
      const bunDir = spawnSync("which", ["bun"], { encoding: "utf-8" }).stdout.trim().replace(/\/bun$/, "")
      const filteredPath = (process.env.PATH || "")
        .split(":")
        .filter(p => p !== codexDir)
        .join(":")
      // Only run if we can actually exclude codex while keeping bun
      if (bunDir === codexDir) {
        // bun and codex share a dir — skip since we can't isolate
        return
      }
      const result = runTx(["utils", "codex-usage"], { PATH: filteredPath })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("codex CLI not found")
    })

    it("unknown subcommand shows error", () => {
      const result = runTx(["utils", "nonexistent"])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("Unknown utils subcommand")
    })

    it("utils with no subcommand shows help", () => {
      const result = runTx(["utils"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("claude-usage")
      expect(result.stdout).toContain("codex-usage")
    })

    it("utils --help shows help text", () => {
      const result = runTx(["utils", "--help"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("claude-usage")
      expect(result.stdout).toContain("codex-usage")
    })

    it("help utils shows help text", () => {
      const result = runTx(["help", "utils"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("claude-usage")
    })

    it("help utils claude-usage shows detailed help", () => {
      const result = runTx(["help", "utils", "claude-usage"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("credentials")
      expect(result.stdout).toContain("Anthropic")
    })

    it("help utils codex-usage shows detailed help", () => {
      const result = runTx(["help", "utils", "codex-usage"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("app-server")
      expect(result.stdout).toContain("JSON-RPC")
    })
  })
})
