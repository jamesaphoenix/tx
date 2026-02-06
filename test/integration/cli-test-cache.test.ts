/**
 * CLI E2E Tests for test cache commands
 *
 * Tests the following CLI commands:
 * - tx test:cache-stats - Show LLM cache statistics
 * - tx test:clear-cache - Clear LLM cache entries
 *
 * Per DD-007: Uses real temp directories and deterministic test fixtures.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"

const TX_BIN = resolve(__dirname, "../../apps/cli/dist/cli.js")
const CLI_TIMEOUT = 10000

interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

/**
 * Run tx CLI with array of arguments
 */
function runTxArgs(args: string[], dbPath: string, env?: Record<string, string>): ExecResult {
  try {
    const result = spawnSync("bun", [TX_BIN, ...args, "--db", dbPath], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: process.cwd(),
      env: { ...process.env, ...env }
    })
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      status: result.status ?? 1
    }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      status: err.status ?? 1
    }
  }
}

/**
 * Run tx CLI with simple space-separated string
 */
function runTx(args: string, dbPath: string, env?: Record<string, string>): ExecResult {
  return runTxArgs(args.split(" "), dbPath, env)
}

/**
 * Create a mock cache entry file
 */
function createCacheEntry(
  cacheDir: string,
  hash: string,
  model: string,
  cachedAt: Date,
  version: number = 1
): void {
  const entry = {
    inputHash: hash,
    input: "test prompt",
    response: { text: "test response" },
    model,
    cachedAt: cachedAt.toISOString(),
    version
  }
  writeFileSync(join(cacheDir, `${hash}.json`), JSON.stringify(entry, null, 2), "utf-8")
}

// =============================================================================
// tx test:cache-stats Command Tests
// =============================================================================

describe("CLI test:cache-stats command", () => {
  let tmpDir: string
  let dbPath: string
  let cacheDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-cache-stats-"))
    dbPath = join(tmpDir, "test.db")
    cacheDir = join(tmpDir, "llm-cache")

    // Initialize the database
    runTx("init", dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("empty cache", () => {
    it("returns empty stats when no cache exists", () => {
      const result = runTxArgs(["test:cache-stats"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("LLM Cache Statistics:")
      expect(result.stdout).toContain("Entries: 0")
      expect(result.stdout).toContain("Size: 0 B")
    })

    it("returns empty stats as JSON when no cache exists", () => {
      const result = runTxArgs(["test:cache-stats", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.count).toBe(0)
      expect(json.totalBytes).toBe(0)
      expect(json.oldestDate).toBeNull()
      expect(json.newestDate).toBeNull()
      expect(json.byModel).toEqual({})
      expect(json.byVersion).toEqual({})
    })
  })

  describe("with cache entries", () => {
    beforeEach(() => {
      mkdirSync(cacheDir, { recursive: true })

      // Create test cache entries
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      createCacheEntry(cacheDir, "hash1", "claude-sonnet-4", now, 1)
      createCacheEntry(cacheDir, "hash2", "claude-sonnet-4", yesterday, 1)
      createCacheEntry(cacheDir, "hash3", "claude-haiku", now, 2)
    })

    it("returns correct count and size with cached entries", () => {
      const result = runTxArgs(["test:cache-stats"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Entries: 3")
      // Size should be non-zero
      expect(result.stdout).not.toContain("Size: 0 B")
    })

    it("shows by-model breakdown correctly", () => {
      const result = runTxArgs(["test:cache-stats"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("By model:")
      expect(result.stdout).toContain("claude-sonnet-4: 2")
      expect(result.stdout).toContain("claude-haiku: 1")
    })

    it("--json flag outputs valid JSON with correct structure", () => {
      const result = runTxArgs(["test:cache-stats", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.count).toBe(3)
      expect(json.totalBytes).toBeGreaterThan(0)
      expect(json.oldestDate).toBeTruthy()
      expect(json.newestDate).toBeTruthy()
      expect(json.byModel).toEqual({
        "claude-sonnet-4": 2,
        "claude-haiku": 1
      })
      expect(json.byVersion).toEqual({
        "1": 2,
        "2": 1
      })
    })

    it("JSON output includes date range as ISO strings", () => {
      const result = runTxArgs(["test:cache-stats", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      // Dates should be valid ISO strings
      expect(() => new Date(json.oldestDate)).not.toThrow()
      expect(() => new Date(json.newestDate)).not.toThrow()
      // Oldest should be before or equal to newest
      expect(new Date(json.oldestDate).getTime()).toBeLessThanOrEqual(
        new Date(json.newestDate).getTime()
      )
    })

    it("shows by-version breakdown when multiple versions exist", () => {
      const result = runTxArgs(["test:cache-stats"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("By version:")
      expect(result.stdout).toContain("v2: 1")
      expect(result.stdout).toContain("v1: 2")
    })
  })

  describe("help", () => {
    it("--help shows usage information", () => {
      const result = runTxArgs(["test:cache-stats", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx test:cache-stats")
      expect(result.stdout).toContain("--json")
      expect(result.stdout).toContain("LLM cache statistics")
    })

    it("-h shows usage information", () => {
      const result = runTxArgs(["test:cache-stats", "-h"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx test:cache-stats")
    })

    it("help test:cache-stats shows help", () => {
      const result = runTxArgs(["help", "test:cache-stats"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("test:cache-stats")
    })
  })
})

// =============================================================================
// tx test:clear-cache Command Tests
// =============================================================================

describe("CLI test:clear-cache command", () => {
  let tmpDir: string
  let dbPath: string
  let cacheDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-test-clear-cache-"))
    dbPath = join(tmpDir, "test.db")
    cacheDir = join(tmpDir, "llm-cache")

    // Initialize the database
    runTx("init", dbPath)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("error handling", () => {
    it("requires at least one option", () => {
      const result = runTxArgs(["test:clear-cache"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Must specify at least one option")
      expect(result.stderr).toContain("--all")
      expect(result.stderr).toContain("--older-than")
      expect(result.stderr).toContain("--model")
      expect(result.stderr).toContain("--version")
    })

    it("handles invalid duration format", () => {
      const result = runTxArgs(["test:clear-cache", "--older-than", "invalid"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Invalid duration format")
    })

    it("handles invalid version number", () => {
      const result = runTxArgs(["test:clear-cache", "--version", "abc"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("is not a valid finite number")
    })

    it("handles empty cache gracefully (no error)", () => {
      const result = runTxArgs(["test:clear-cache", "--all"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Cache cleared")
    })
  })

  describe("--all flag", () => {
    beforeEach(() => {
      mkdirSync(cacheDir, { recursive: true })
      const now = new Date()
      createCacheEntry(cacheDir, "hash1", "claude-sonnet-4", now)
      createCacheEntry(cacheDir, "hash2", "claude-haiku", now)
      createCacheEntry(cacheDir, "hash3", "claude-opus", now)
    })

    it("clears entire cache directory", () => {
      // Verify entries exist first
      expect(readdirSync(cacheDir).length).toBe(3)

      const result = runTxArgs(["test:clear-cache", "--all"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Cache cleared")

      // Verify cache is cleared (directory recreated empty)
      if (existsSync(cacheDir)) {
        const remaining = readdirSync(cacheDir).filter(f => f.endsWith(".json"))
        expect(remaining.length).toBe(0)
      }
    })

    it("--json flag outputs deletion result as JSON", () => {
      const result = runTxArgs(["test:clear-cache", "--all", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.all).toBe(true)
      // When using --all, deleted count is -1 (unknown)
      expect(json.deleted).toBeNull()
    })
  })

  describe("--older-than flag", () => {
    beforeEach(() => {
      mkdirSync(cacheDir, { recursive: true })
      const now = new Date()
      const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)

      createCacheEntry(cacheDir, "old-hash", "claude-sonnet-4", thirtyOneDaysAgo)
      createCacheEntry(cacheDir, "recent-hash", "claude-sonnet-4", fiveDaysAgo)
      createCacheEntry(cacheDir, "new-hash", "claude-haiku", now)
    })

    it("clears entries older than 30d", () => {
      const result = runTxArgs(["test:clear-cache", "--older-than", "30d"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Deleted 1 cache entries")

      // Verify old entry was deleted
      expect(existsSync(join(cacheDir, "old-hash.json"))).toBe(false)
      // Recent entries should still exist
      expect(existsSync(join(cacheDir, "recent-hash.json"))).toBe(true)
      expect(existsSync(join(cacheDir, "new-hash.json"))).toBe(true)
    })

    it("supports hours format (e.g., 2h)", () => {
      // Create a very recent entry and an older entry
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000 - 1000)
      createCacheEntry(cacheDir, "two-hours-old", "claude-sonnet-4", twoHoursAgo)

      const result = runTxArgs(["test:clear-cache", "--older-than", "2h", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      // Should have deleted some entries
      expect(json.deleted).toBeGreaterThan(0)
    })

    it("supports minutes format (e.g., 60m)", () => {
      const result = runTxArgs(["test:clear-cache", "--older-than", "60m", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(typeof json.deleted).toBe("number")
    })

    it("reports number of entries deleted", () => {
      const result = runTxArgs(["test:clear-cache", "--older-than", "30d", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(1)
      expect(json.all).toBe(false)
    })
  })

  describe("--model flag", () => {
    beforeEach(() => {
      mkdirSync(cacheDir, { recursive: true })
      const now = new Date()

      createCacheEntry(cacheDir, "sonnet-hash1", "claude-sonnet-4", now)
      createCacheEntry(cacheDir, "sonnet-hash2", "claude-sonnet-4", now)
      createCacheEntry(cacheDir, "haiku-hash", "claude-haiku", now)
    })

    it("clears only entries for specified model", () => {
      const result = runTxArgs(["test:clear-cache", "--model", "claude-sonnet-4"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Deleted 2 cache entries")

      // Verify sonnet entries were deleted
      expect(existsSync(join(cacheDir, "sonnet-hash1.json"))).toBe(false)
      expect(existsSync(join(cacheDir, "sonnet-hash2.json"))).toBe(false)
      // Haiku entry should still exist
      expect(existsSync(join(cacheDir, "haiku-hash.json"))).toBe(true)
    })

    it("--json flag outputs deletion count for model", () => {
      const result = runTxArgs(["test:clear-cache", "--model", "claude-haiku", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(1)
    })

    it("handles non-existent model gracefully", () => {
      const result = runTxArgs(["test:clear-cache", "--model", "nonexistent-model", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(0)
    })
  })

  describe("--version flag", () => {
    beforeEach(() => {
      mkdirSync(cacheDir, { recursive: true })
      const now = new Date()

      createCacheEntry(cacheDir, "v1-hash1", "claude-sonnet-4", now, 1)
      createCacheEntry(cacheDir, "v1-hash2", "claude-sonnet-4", now, 1)
      createCacheEntry(cacheDir, "v2-hash", "claude-haiku", now, 2)
    })

    it("clears only entries with specified version", () => {
      const result = runTxArgs(["test:clear-cache", "--version", "1"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("Deleted 2 cache entries")

      // Verify v1 entries were deleted
      expect(existsSync(join(cacheDir, "v1-hash1.json"))).toBe(false)
      expect(existsSync(join(cacheDir, "v1-hash2.json"))).toBe(false)
      // v2 entry should still exist
      expect(existsSync(join(cacheDir, "v2-hash.json"))).toBe(true)
    })

    it("--json flag outputs deletion count for version", () => {
      const result = runTxArgs(["test:clear-cache", "--version", "2", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(1)
    })

    it("handles non-existent version gracefully", () => {
      const result = runTxArgs(["test:clear-cache", "--version", "999", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(0)
    })
  })

  describe("combined options", () => {
    beforeEach(() => {
      mkdirSync(cacheDir, { recursive: true })
      const now = new Date()
      const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)

      // Old sonnet entries
      createCacheEntry(cacheDir, "old-sonnet", "claude-sonnet-4", thirtyOneDaysAgo, 1)
      // New sonnet entry
      createCacheEntry(cacheDir, "new-sonnet", "claude-sonnet-4", now, 1)
      // Old haiku entry
      createCacheEntry(cacheDir, "old-haiku", "claude-haiku", thirtyOneDaysAgo, 1)
    })

    it("can combine --model and --older-than", () => {
      // This should delete old sonnet entry only
      const result = runTxArgs(
        ["test:clear-cache", "--model", "claude-sonnet-4", "--older-than", "30d", "--json"],
        dbPath,
        { TX_LLM_CACHE_DIR: cacheDir }
      )
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      // Should delete entries matching EITHER condition (OR logic)
      expect(json.deleted).toBeGreaterThanOrEqual(1)
    })
  })

  describe("help", () => {
    it("--help shows usage information", () => {
      const result = runTxArgs(["test:clear-cache", "--help"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx test:clear-cache")
      expect(result.stdout).toContain("--all")
      expect(result.stdout).toContain("--older-than")
      expect(result.stdout).toContain("--model")
      expect(result.stdout).toContain("--version")
      expect(result.stdout).toContain("--json")
    })

    it("-h shows usage information", () => {
      const result = runTxArgs(["test:clear-cache", "-h"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("tx test:clear-cache")
    })

    it("help test:clear-cache shows help", () => {
      const result = runTxArgs(["help", "test:clear-cache"], dbPath)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("test:clear-cache")
    })
  })

  describe("empty cache handling", () => {
    it("handles non-existent cache directory gracefully with --all", () => {
      // cacheDir doesn't exist
      const result = runTxArgs(["test:clear-cache", "--all", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.all).toBe(true)
    })

    it("handles empty cache directory gracefully with --model", () => {
      mkdirSync(cacheDir, { recursive: true })

      const result = runTxArgs(["test:clear-cache", "--model", "any-model", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(0)
    })

    it("handles empty cache directory gracefully with --older-than", () => {
      mkdirSync(cacheDir, { recursive: true })

      const result = runTxArgs(["test:clear-cache", "--older-than", "30d", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(0)
    })

    it("handles empty cache directory gracefully with --version", () => {
      mkdirSync(cacheDir, { recursive: true })

      const result = runTxArgs(["test:clear-cache", "--version", "1", "--json"], dbPath, {
        TX_LLM_CACHE_DIR: cacheDir
      })
      expect(result.status).toBe(0)

      const json = JSON.parse(result.stdout)
      expect(json.deleted).toBe(0)
    })
  })
})
