/**
 * Git Hook Integration Tests
 *
 * Tests for PRD-017: Add git hook integration for post-refactor verification
 *
 * Tests cover:
 * - hooks:install command creates post-commit hook
 * - hooks:uninstall removes the hook
 * - hooks:status shows correct state
 * - .txrc configuration is respected
 * - Hook triggers verification based on file count threshold
 * - Hook triggers verification for high-value files
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { Effect } from "effect"

// Import hooks module functions for testing
import {
  readTxrc,
  writeTxrc,
  findGitRoot,
  generatePostCommitHook,
  isValidHookPattern,
  hooksInstall,
  hooksUninstall,
  hooksStatus,
  type TxrcConfig
} from "../../apps/cli/src/commands/hooks.js"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`hooks-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  TEST_DIR: fixtureId("test-dir"),
  CONFIG_1: fixtureId("config-1"),
  CONFIG_2: fixtureId("config-2"),
} as const

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary test directory with optional git initialization
 */
function createTestDir(name: string, initGit = false): string {
  const testDir = resolve(tmpdir(), `tx-hooks-test-${name}-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })

  if (initGit) {
    execSync("git init", { cwd: testDir, stdio: "pipe" })
    // Configure git user for commits
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: "pipe" })
    execSync('git config user.name "Test"', { cwd: testDir, stdio: "pipe" })
  }

  return testDir
}

/**
 * Clean up test directory
 */
function cleanupTestDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// .txrc Configuration Tests
// =============================================================================

describe("TxrcConfig", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir(FIXTURES.CONFIG_1)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("readTxrc returns empty object when no config file exists", () => {
    const config = readTxrc(testDir)
    expect(config).toEqual({})
  })

  it("readTxrc reads .txrc.json file", () => {
    const expectedConfig: TxrcConfig = {
      hooks: {
        enabled: true,
        fileThreshold: 5,
        highValueFiles: ["custom.json"]
      }
    }

    writeFileSync(
      resolve(testDir, ".txrc.json"),
      JSON.stringify(expectedConfig, null, 2)
    )

    const config = readTxrc(testDir)
    expect(config).toEqual(expectedConfig)
  })

  it("readTxrc reads .txrc file (without .json extension)", () => {
    const expectedConfig: TxrcConfig = {
      hooks: {
        enabled: false
      }
    }

    writeFileSync(
      resolve(testDir, ".txrc"),
      JSON.stringify(expectedConfig)
    )

    const config = readTxrc(testDir)
    expect(config).toEqual(expectedConfig)
  })

  it("readTxrc prefers .txrc.json over .txrc", () => {
    const jsonConfig: TxrcConfig = { hooks: { enabled: true } }
    const plainConfig: TxrcConfig = { hooks: { enabled: false } }

    writeFileSync(resolve(testDir, ".txrc.json"), JSON.stringify(jsonConfig))
    writeFileSync(resolve(testDir, ".txrc"), JSON.stringify(plainConfig))

    const config = readTxrc(testDir)
    expect(config.hooks?.enabled).toBe(true)
  })

  it("readTxrc handles malformed JSON gracefully", () => {
    writeFileSync(resolve(testDir, ".txrc.json"), "{ invalid json")

    const config = readTxrc(testDir)
    expect(config).toEqual({})
  })

  it("writeTxrc creates .txrc.json file", () => {
    const config: TxrcConfig = {
      hooks: {
        enabled: true,
        fileThreshold: 15
      }
    }

    writeTxrc(testDir, config)

    const content = readFileSync(resolve(testDir, ".txrc.json"), "utf-8")
    const parsed = JSON.parse(content)
    expect(parsed).toEqual(config)
  })

  it("writeTxrc overwrites existing config", () => {
    const oldConfig: TxrcConfig = { hooks: { enabled: false } }
    const newConfig: TxrcConfig = { hooks: { enabled: true, fileThreshold: 20 } }

    writeTxrc(testDir, oldConfig)
    writeTxrc(testDir, newConfig)

    const config = readTxrc(testDir)
    expect(config.hooks?.enabled).toBe(true)
    expect(config.hooks?.fileThreshold).toBe(20)
  })
})

// =============================================================================
// Git Root Detection Tests
// =============================================================================

describe("findGitRoot", () => {
  let testDir: string

  afterEach(() => {
    if (testDir) {
      cleanupTestDir(testDir)
    }
  })

  it("returns null for non-git directory", () => {
    testDir = createTestDir(FIXTURES.CONFIG_2, false)

    const result = findGitRoot(testDir)
    expect(result).toBeNull()
  })

  it("finds git root in current directory", () => {
    testDir = createTestDir("git-root", true)

    const result = findGitRoot(testDir)
    expect(result).toBe(testDir)
  })

  it("finds git root from nested subdirectory", () => {
    testDir = createTestDir("git-nested", true)
    const nestedDir = resolve(testDir, "src", "components")
    mkdirSync(nestedDir, { recursive: true })

    const result = findGitRoot(nestedDir)
    expect(result).toBe(testDir)
  })
})

// =============================================================================
// Post-Commit Hook Generation Tests
// =============================================================================

describe("generatePostCommitHook", () => {
  it("generates hook with default configuration", () => {
    const config: TxrcConfig = {}
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("#!/bin/bash")
    expect(hook).toContain("tx post-commit hook")
    expect(hook).toContain("tx graph:verify")
    expect(hook).toContain("-gt 10") // Default threshold
  })

  it("generates hook with custom file threshold", () => {
    const config: TxrcConfig = {
      hooks: {
        fileThreshold: 25
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("-gt 25")
  })

  it("generates hook with custom high-value files", () => {
    const config: TxrcConfig = {
      hooks: {
        highValueFiles: ["custom.config.ts", "important.json"]
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("custom\\.config\\.ts")
    expect(hook).toContain("important\\.json")
  })

  it("hook checks for .txrc enabled flag", () => {
    const config: TxrcConfig = {}
    const hook = generatePostCommitHook(config)

    expect(hook).toContain(".txrc.json")
    expect(hook).toContain("enabled")
  })

  it("hook runs verification in background", () => {
    const config: TxrcConfig = {}
    const hook = generatePostCommitHook(config)

    // Check for background execution pattern
    expect(hook).toContain(") &")
    expect(hook).toContain("background")
  })

  it("hook gracefully handles missing tx command", () => {
    const config: TxrcConfig = {}
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("command -v tx")
    expect(hook).toContain("exit 0")
  })
})

// =============================================================================
// Hook Installation Integration Tests
// =============================================================================

describe("Hook Installation", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir("hook-install", true)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("creates post-commit hook file in .git/hooks", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    // Simulate hook installation
    mkdirSync(hooksDir, { recursive: true })
    const hookContent = generatePostCommitHook({})
    writeFileSync(hookPath, hookContent)
    chmodSync(hookPath, 0o755)

    expect(existsSync(hookPath)).toBe(true)

    const content = readFileSync(hookPath, "utf-8")
    expect(content).toContain("tx post-commit hook")
  })

  it("hook file is executable", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(hookPath, generatePostCommitHook({}))
    chmodSync(hookPath, 0o755)

    // Check file permissions (on Unix-like systems)
    const stats = require("fs").statSync(hookPath)
    const isExecutable = (stats.mode & 0o111) !== 0
    expect(isExecutable).toBe(true)
  })

  it("creates .txrc.json with hook configuration", () => {
    const config: TxrcConfig = {
      hooks: {
        enabled: true,
        verifyOnCommit: true,
        fileThreshold: 10
      }
    }

    writeTxrc(testDir, config)

    const savedConfig = readTxrc(testDir)
    expect(savedConfig.hooks?.enabled).toBe(true)
    expect(savedConfig.hooks?.verifyOnCommit).toBe(true)
  })
})

// =============================================================================
// Hook Trigger Condition Tests
// =============================================================================

describe("Hook Trigger Conditions", () => {
  it("hook script contains file count threshold check", () => {
    const config: TxrcConfig = { hooks: { fileThreshold: 15 } }
    const hook = generatePostCommitHook(config)

    // Verify the threshold comparison is present
    expect(hook).toMatch(/FILE_COUNT.*-gt.*15/)
  })

  it("hook script contains high-value file patterns", () => {
    const config: TxrcConfig = {
      hooks: {
        highValueFiles: ["package.json", "tsconfig.json"]
      }
    }
    const hook = generatePostCommitHook(config)

    // Patterns should be escaped for grep
    expect(hook).toContain("package\\.json")
    expect(hook).toContain("tsconfig\\.json")
  })

  it("hook script supports glob patterns in high-value files", () => {
    const config: TxrcConfig = {
      hooks: {
        highValueFiles: ["*.config.ts", "src/*.ts"]
      }
    }
    const hook = generatePostCommitHook(config)

    // * should be converted to .* for regex matching
    expect(hook).toContain(".*\\.config\\.ts")
    expect(hook).toContain("src/.*\\.ts")
  })
})

// =============================================================================
// Hook Uninstall Tests
// =============================================================================

describe("Hook Uninstall", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir("hook-uninstall", true)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("removes post-commit hook file", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    // Install hook first
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(hookPath, generatePostCommitHook({}))

    expect(existsSync(hookPath)).toBe(true)

    // Simulate uninstall
    rmSync(hookPath)

    expect(existsSync(hookPath)).toBe(false)
  })

  it("updates .txrc.json to disable hooks", () => {
    const config: TxrcConfig = {
      hooks: {
        enabled: true,
        verifyOnCommit: true
      }
    }

    writeTxrc(testDir, config)

    // Simulate uninstall config update
    const updatedConfig = readTxrc(testDir)
    updatedConfig.hooks = {
      ...updatedConfig.hooks,
      enabled: false,
      verifyOnCommit: false
    }
    writeTxrc(testDir, updatedConfig)

    const finalConfig = readTxrc(testDir)
    expect(finalConfig.hooks?.enabled).toBe(false)
    expect(finalConfig.hooks?.verifyOnCommit).toBe(false)
  })
})

// =============================================================================
// Hook Status Tests
// =============================================================================

describe("Hook Status", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir("hook-status", true)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("detects when hook is installed", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(hookPath, generatePostCommitHook({}))

    const content = readFileSync(hookPath, "utf-8")
    const isInstalled = content.includes("tx post-commit hook")

    expect(isInstalled).toBe(true)
  })

  it("detects when hook is not installed", () => {
    const hookPath = resolve(testDir, ".git", "hooks", "post-commit")

    const isInstalled = existsSync(hookPath)

    expect(isInstalled).toBe(false)
  })

  it("detects when hook is disabled via config", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    // Install hook
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(hookPath, generatePostCommitHook({}))

    // Disable in config
    writeTxrc(testDir, { hooks: { enabled: false } })

    const config = readTxrc(testDir)
    const hookExists = existsSync(hookPath)
    const isEnabled = hookExists && config.hooks?.enabled !== false

    expect(hookExists).toBe(true)
    expect(isEnabled).toBe(false)
  })

  it("reports correct enabled status", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    // Install hook and enable
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(hookPath, generatePostCommitHook({}))
    writeTxrc(testDir, { hooks: { enabled: true } })

    const config = readTxrc(testDir)
    const hookExists = existsSync(hookPath)
    const content = readFileSync(hookPath, "utf-8")
    const isTxHook = content.includes("tx post-commit hook")
    const isEnabled = hookExists && isTxHook && config.hooks?.enabled !== false

    expect(isEnabled).toBe(true)
  })
})

// =============================================================================
// Edge Cases and Error Handling Tests
// =============================================================================

describe("Edge Cases", () => {
  let testDir: string

  afterEach(() => {
    if (testDir) {
      cleanupTestDir(testDir)
    }
  })

  it("handles non-tx post-commit hook gracefully", () => {
    testDir = createTestDir("edge-non-tx", true)
    const hooksDir = resolve(testDir, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(hookPath, "#!/bin/bash\necho 'Custom hook'\n")

    const content = readFileSync(hookPath, "utf-8")
    const isTxHook = content.includes("tx post-commit hook")

    expect(isTxHook).toBe(false)
  })

  it("handles missing .git/hooks directory", () => {
    testDir = createTestDir("edge-no-hooks", true)

    // Remove hooks directory if it exists
    const hooksDir = resolve(testDir, ".git", "hooks")
    if (existsSync(hooksDir)) {
      rmSync(hooksDir, { recursive: true })
    }

    const hookPath = resolve(hooksDir, "post-commit")
    const hookExists = existsSync(hookPath)

    expect(hookExists).toBe(false)
  })

  it("handles empty high-value files array", () => {
    const config: TxrcConfig = {
      hooks: {
        highValueFiles: []
      }
    }

    // Should not throw
    const hook = generatePostCommitHook(config)
    expect(hook).toContain("tx post-commit hook")
  })

  it("handles special characters in file patterns", () => {
    const config: TxrcConfig = {
      hooks: {
        highValueFiles: ["file[1].json", "test-file.ts"]
      }
    }

    const hook = generatePostCommitHook(config)
    // Dots are escaped for regex, brackets are kept as-is (valid in grep -E)
    expect(hook).toContain("file[1]\\.json")
    expect(hook).toContain("test-file\\.ts")
  })
})

// =============================================================================
// Command Injection Prevention Tests
// =============================================================================

describe("isValidHookPattern", () => {
  it("accepts safe file patterns", () => {
    expect(isValidHookPattern("package.json")).toBe(true)
    expect(isValidHookPattern("tsconfig.json")).toBe(true)
    expect(isValidHookPattern("*.config.ts")).toBe(true)
    expect(isValidHookPattern("src/index.ts")).toBe(true)
    expect(isValidHookPattern("src/**/*.tsx")).toBe(true)
    expect(isValidHookPattern("file[1].json")).toBe(true)
    expect(isValidHookPattern("test-file.ts")).toBe(true)
    expect(isValidHookPattern("my_module/index.js")).toBe(true)
  })

  it("rejects single quote injection", () => {
    expect(isValidHookPattern("'; rm -rf / ;'")).toBe(false)
    expect(isValidHookPattern("file'.json")).toBe(false)
  })

  it("rejects double quote injection", () => {
    expect(isValidHookPattern('"; rm -rf /"')).toBe(false)
  })

  it("rejects backtick injection", () => {
    expect(isValidHookPattern("`whoami`")).toBe(false)
  })

  it("rejects dollar sign / subshell injection", () => {
    expect(isValidHookPattern("$(rm -rf /)")).toBe(false)
    expect(isValidHookPattern("${PATH}")).toBe(false)
  })

  it("rejects semicolon command chaining", () => {
    expect(isValidHookPattern("file.ts; rm -rf /")).toBe(false)
  })

  it("rejects pipe injection", () => {
    expect(isValidHookPattern("file.ts | cat /etc/passwd")).toBe(false)
  })

  it("rejects ampersand injection", () => {
    expect(isValidHookPattern("file.ts && rm -rf /")).toBe(false)
  })

  it("rejects newline injection", () => {
    expect(isValidHookPattern("file.ts\nrm -rf /")).toBe(false)
  })

  it("rejects empty strings", () => {
    expect(isValidHookPattern("")).toBe(false)
  })

  it("rejects backslash injection", () => {
    expect(isValidHookPattern("file\\ntest")).toBe(false)
  })

  it("rejects spaces (could separate commands)", () => {
    expect(isValidHookPattern("file name.ts")).toBe(false)
  })
})

describe("generatePostCommitHook command injection prevention", () => {
  it("filters out unsafe patterns from config", () => {
    const config: TxrcConfig = {
      hooks: {
        highValueFiles: ["safe.json", "'; rm -rf / ;'", "also-safe.ts"]
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("safe\\.json")
    expect(hook).toContain("also-safe\\.ts")
    expect(hook).not.toContain("rm -rf")
  })

  it("handles all-unsafe patterns gracefully", () => {
    const config: TxrcConfig = {
      hooks: {
        highValueFiles: ["$(evil)", "'; drop tables;'"] // eslint-disable-line tx/no-inline-sql
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("tx post-commit hook")
    expect(hook).not.toContain("evil")
    expect(hook).not.toContain("drop tables") // eslint-disable-line tx/no-inline-sql
  })

  it("sanitizes non-numeric fileThreshold from config", () => {
    const config: TxrcConfig = {
      hooks: {
        fileThreshold: "10; rm -rf /" as unknown as number,
      }
    }
    const hook = generatePostCommitHook(config)

    // Should fall back to default (10), not inject the string
    expect(hook).toContain("-gt 10")
    expect(hook).not.toContain("rm -rf")
  })

  it("sanitizes NaN fileThreshold", () => {
    const config: TxrcConfig = {
      hooks: {
        fileThreshold: NaN,
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("-gt 10")
  })

  it("sanitizes negative fileThreshold", () => {
    const config: TxrcConfig = {
      hooks: {
        fileThreshold: -5,
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("-gt 10")
  })

  it("sanitizes Infinity fileThreshold", () => {
    const config: TxrcConfig = {
      hooks: {
        fileThreshold: Infinity,
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("-gt 10")
  })

  it("floors fractional fileThreshold", () => {
    const config: TxrcConfig = {
      hooks: {
        fileThreshold: 7.9,
      }
    }
    const hook = generatePostCommitHook(config)

    expect(hook).toContain("-gt 7")
  })
})

describe("hooksInstall rejects unsafe patterns via CLI", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir("cmd-inject", true)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("returns JSON error for single-quote injection attempt", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], { json: true, "high-value": "'; rm -rf / ;'" }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toBe("invalid_patterns")
    } finally {
      cleanup()
    }
  })

  it("returns JSON error for subshell injection attempt", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], { json: true, "high-value": "$(whoami)" }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toBe("invalid_patterns")
    } finally {
      cleanup()
    }
  })

  it("accepts safe patterns via CLI", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], { json: true, "high-value": "src/*.ts,package.json" }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(true)
      expect(result.config.highValueFiles).toEqual(["src/*.ts", "package.json"])
    } finally {
      cleanup()
    }
  })
})

// =============================================================================
// Command Function Tests (hooksInstall, hooksUninstall, hooksStatus)
// =============================================================================

/**
 * Helper to capture console output and mock process.cwd for command testing.
 * Returns captured output arrays and cleanup function.
 */
function setupCommandTest(testDir: string) {
  const logs: string[] = []
  const errors: string[] = []
  const origCwd = process.cwd
  const origLog = console.log
  const origError = console.error

  process.cwd = () => testDir
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "))
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "))

  return {
    logs,
    errors,
    cleanup() {
      process.cwd = origCwd
      console.log = origLog
      console.error = origError
    }
  }
}

describe("hooksInstall command", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir("cmd-install", true)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("installs hook and outputs text by default", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], {}))
      expect(logs.some(l => l.includes("installed successfully"))).toBe(true)

      const hookPath = resolve(testDir, ".git", "hooks", "post-commit")
      expect(existsSync(hookPath)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("installs hook and outputs JSON with --json flag", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], { json: true }))
      expect(logs.length).toBe(1)

      const result = JSON.parse(logs[0])
      expect(result.success).toBe(true)
      expect(result.hookPath).toContain("post-commit")
      expect(result.config.enabled).toBe(true)
      expect(result.config.fileThreshold).toBe(10)
      expect(result.config.highValueFiles).toBeInstanceOf(Array)
    } finally {
      cleanup()
    }
  })

  it("returns JSON error when already installed without --force", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      // Install first
      Effect.runSync(hooksInstall([], { json: true }))
      logs.length = 0

      // Try again without --force
      Effect.runSync(hooksInstall([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toBe("already_installed")
    } finally {
      cleanup()
    }
  })

  it("reinstalls with --force and --json", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], { json: true }))
      logs.length = 0

      Effect.runSync(hooksInstall([], { json: true, force: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("returns JSON error when non-tx hook exists", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(resolve(hooksDir, "post-commit"), "#!/bin/bash\necho custom\n")

    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toBe("hook_exists")
    } finally {
      cleanup()
    }
  })

  it("returns JSON error when not a git repo", () => {
    const nonGitDir = createTestDir("cmd-install-nogit", false)
    const { logs, cleanup } = setupCommandTest(nonGitDir)
    try {
      Effect.runSync(hooksInstall([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toContain("Not a git repository")
    } finally {
      cleanup()
      cleanupTestDir(nonGitDir)
    }
  })

  it("applies custom threshold and high-value with --json", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], { json: true, threshold: "5", "high-value": "a.ts,b.ts" }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(true)
      expect(result.config.fileThreshold).toBe(5)
      expect(result.config.highValueFiles).toEqual(["a.ts", "b.ts"])
    } finally {
      cleanup()
    }
  })
})

describe("hooksUninstall command", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir("cmd-uninstall", true)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("uninstalls hook and outputs text by default", () => {
    // Install first
    const { cleanup: installCleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], {}))
    } finally {
      installCleanup()
    }

    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksUninstall([], {}))
      expect(logs.some(l => l.includes("uninstalled"))).toBe(true)

      const hookPath = resolve(testDir, ".git", "hooks", "post-commit")
      expect(existsSync(hookPath)).toBe(false)
    } finally {
      cleanup()
    }
  })

  it("uninstalls hook and outputs JSON with --json flag", () => {
    // Install first
    const { cleanup: installCleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], {}))
    } finally {
      installCleanup()
    }

    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksUninstall([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(true)
      expect(result.hookPath).toContain("post-commit")
      expect(result.message).toContain("uninstalled")
    } finally {
      cleanup()
    }
  })

  it("returns JSON error when no hook found", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksUninstall([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toBe("not_found")
    } finally {
      cleanup()
    }
  })

  it("returns JSON error when hook is not tx-installed", () => {
    const hooksDir = resolve(testDir, ".git", "hooks")
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(resolve(hooksDir, "post-commit"), "#!/bin/bash\necho custom\n")

    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksUninstall([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toBe("not_tx_hook")
    } finally {
      cleanup()
    }
  })

  it("returns JSON error when not a git repo", () => {
    const nonGitDir = createTestDir("cmd-uninstall-nogit", false)
    const { logs, cleanup } = setupCommandTest(nonGitDir)
    try {
      Effect.runSync(hooksUninstall([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.success).toBe(false)
      expect(result.error).toContain("Not a git repository")
    } finally {
      cleanup()
      cleanupTestDir(nonGitDir)
    }
  })
})

describe("hooksStatus command", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir("cmd-status", true)
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  it("outputs text status by default", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksStatus([], {}))
      expect(logs.some(l => l.includes("Git Hook Status"))).toBe(true)
      expect(logs.some(l => l.includes("Hook installed"))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("outputs JSON status with --json flag", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksStatus([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result).toHaveProperty("gitRoot")
      expect(result).toHaveProperty("hookInstalled")
      expect(result).toHaveProperty("hookPath")
      expect(result).toHaveProperty("config")
      expect(result).toHaveProperty("enabled")
    } finally {
      cleanup()
    }
  })

  it("reports hook not installed in JSON", () => {
    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksStatus([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.hookInstalled).toBe(false)
      expect(result.enabled).toBe(false)
    } finally {
      cleanup()
    }
  })

  it("reports hook installed and enabled in JSON", () => {
    // Install hook first
    const { cleanup: installCleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], {}))
    } finally {
      installCleanup()
    }

    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksStatus([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.hookInstalled).toBe(true)
      expect(result.enabled).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("reports hook installed but disabled in JSON", () => {
    // Install hook first
    const { cleanup: installCleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], {}))
    } finally {
      installCleanup()
    }

    // Disable in config
    writeTxrc(testDir, { hooks: { enabled: false } })

    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksStatus([], { json: true }))
      const result = JSON.parse(logs[0])
      expect(result.hookInstalled).toBe(true)
      expect(result.enabled).toBe(false)
    } finally {
      cleanup()
    }
  })

  it("shows config details in text mode when config exists", () => {
    // Install hook first to create config
    const { cleanup: installCleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksInstall([], {}))
    } finally {
      installCleanup()
    }

    const { logs, cleanup } = setupCommandTest(testDir)
    try {
      Effect.runSync(hooksStatus([], {}))
      expect(logs.some(l => l.includes("Configuration"))).toBe(true)
      expect(logs.some(l => l.includes("File threshold"))).toBe(true)
    } finally {
      cleanup()
    }
  })
})
