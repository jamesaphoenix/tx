/**
 * Integration tests for LLM response caching.
 *
 * @module @tx/test-utils/llm-cache/cache.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import {
  hashInput,
  cachedLLMCall,
  withLLMCache,
  configureLLMCache,
  resetCacheConfig,
  getCacheStats,
  clearCache,
  formatCacheStats,
  getCacheEntry,
  listCacheEntries,
  type CacheEntry
} from "./index.js"

// =============================================================================
// Test Setup
// =============================================================================

describe("LLM Cache", () => {
  let tempDir: string

  beforeEach(async () => {
    // Create isolated temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tx-llm-cache-test-"))
    configureLLMCache({ cacheDir: tempDir, logging: false })
  })

  afterEach(async () => {
    // Clean up temp directory
    resetCacheConfig()
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  // ===========================================================================
  // hashInput Tests
  // ===========================================================================

  describe("hashInput", () => {
    it("should return deterministic SHA256 hash", () => {
      const input = "What is the capital of France?"
      const hash1 = hashInput(input)
      const hash2 = hashInput(input)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA256 hex = 64 chars
      expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    })

    it("should produce different hashes for different inputs", () => {
      const hash1 = hashInput("input one")
      const hash2 = hashInput("input two")

      expect(hash1).not.toBe(hash2)
    })

    it("should handle empty string", () => {
      const hash = hashInput("")

      expect(hash).toHaveLength(64)
      // SHA256 of empty string is a known value
      expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    })

    it("should handle unicode input", () => {
      const hash = hashInput("こんにちは世界 🌍")

      expect(hash).toHaveLength(64)
      expect(hashInput("こんにちは世界 🌍")).toBe(hash)
    })

    it("should handle very long input", () => {
      const longInput = "a".repeat(100000)
      const hash = hashInput(longInput)

      expect(hash).toHaveLength(64)
    })
  })

  // ===========================================================================
  // cachedLLMCall Tests
  // ===========================================================================

  describe("cachedLLMCall", () => {
    it("should call function on cache miss and store result", async () => {
      const mockCall = vi.fn().mockResolvedValue({ answer: "Paris" })

      const result = await cachedLLMCall(
        "What is the capital of France?",
        "claude-sonnet-4",
        mockCall
      )

      expect(result).toEqual({ answer: "Paris" })
      expect(mockCall).toHaveBeenCalledTimes(1)

      // Verify cache file was created
      const files = await fs.readdir(tempDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/)
    })

    it("should return cached value on cache hit without calling function", async () => {
      const mockCall = vi.fn().mockResolvedValue({ answer: "Paris" })
      const input = "What is the capital of France?"

      // First call - cache miss
      await cachedLLMCall(input, "claude-sonnet-4", mockCall)
      expect(mockCall).toHaveBeenCalledTimes(1)

      // Second call - cache hit
      const result = await cachedLLMCall(input, "claude-sonnet-4", mockCall)

      expect(result).toEqual({ answer: "Paris" })
      expect(mockCall).toHaveBeenCalledTimes(1) // Not called again
    })

    it("should bypass cache when TX_NO_LLM_CACHE=1", async () => {
      const originalEnv = process.env.TX_NO_LLM_CACHE
      process.env.TX_NO_LLM_CACHE = "1"

      try {
        const mockCall = vi.fn().mockResolvedValue({ answer: "Paris" })
        const input = "What is the capital of France?"

        // First call
        await cachedLLMCall(input, "claude-sonnet-4", mockCall)
        // Second call - should still call function
        await cachedLLMCall(input, "claude-sonnet-4", mockCall)

        expect(mockCall).toHaveBeenCalledTimes(2)

        // Cache should not have been written
        const files = await fs.readdir(tempDir)
        expect(files.length).toBe(0)
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TX_NO_LLM_CACHE
        } else {
          process.env.TX_NO_LLM_CACHE = originalEnv
        }
      }
    })

    it("should bypass cache when forceRefresh=true", async () => {
      const mockCall = vi.fn()
        .mockResolvedValueOnce({ answer: "Paris" })
        .mockResolvedValueOnce({ answer: "Paris (updated)" })

      const input = "What is the capital of France?"

      // First call - cache miss
      await cachedLLMCall(input, "claude-sonnet-4", mockCall)

      // Second call with forceRefresh - should call function
      const result = await cachedLLMCall(input, "claude-sonnet-4", mockCall, { forceRefresh: true })

      expect(result).toEqual({ answer: "Paris (updated)" })
      expect(mockCall).toHaveBeenCalledTimes(2)
    })

    it("should trigger cache miss on version mismatch", async () => {
      const mockCall = vi.fn()
        .mockResolvedValueOnce({ answer: "Paris v1" })
        .mockResolvedValueOnce({ answer: "Paris v2" })

      const input = "What is the capital of France?"

      // First call with version 1
      await cachedLLMCall(input, "claude-sonnet-4", mockCall, { version: 1 })

      // Second call with version 2 - should be cache miss
      const result = await cachedLLMCall(input, "claude-sonnet-4", mockCall, { version: 2 })

      expect(result).toEqual({ answer: "Paris v2" })
      expect(mockCall).toHaveBeenCalledTimes(2)
    })

    it("should store correct cache entry format", async () => {
      const mockCall = vi.fn().mockResolvedValue({ answer: "Paris" })
      const input = "What is the capital of France?"

      await cachedLLMCall(input, "claude-sonnet-4", mockCall, { version: 3 })

      const hash = hashInput(input)
      const cacheFile = path.join(tempDir, `${hash}.json`)
      const content = JSON.parse(await fs.readFile(cacheFile, "utf-8")) as CacheEntry<unknown>

      expect(content.inputHash).toBe(hash)
      expect(content.input).toBe(input)
      expect(content.response).toEqual({ answer: "Paris" })
      expect(content.model).toBe("claude-sonnet-4")
      expect(content.version).toBe(3)
      expect(content.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it("should truncate long input in cache entry", async () => {
      const mockCall = vi.fn().mockResolvedValue({ answer: "42" })
      const longInput = "a".repeat(2000)

      await cachedLLMCall(longInput, "claude-sonnet-4", mockCall)

      const hash = hashInput(longInput)
      const cacheFile = path.join(tempDir, `${hash}.json`)
      const content = JSON.parse(await fs.readFile(cacheFile, "utf-8")) as CacheEntry<unknown>

      expect(content.input.length).toBe(1000) // Truncated
      expect(content.inputHash).toBe(hash) // Full hash preserved
    })
  })

  // ===========================================================================
  // withLLMCache Tests
  // ===========================================================================

  describe("withLLMCache", () => {
    it("should wrap function with caching", async () => {
      const mockFn = vi.fn().mockResolvedValue("result")
      const cachedFn = withLLMCache(mockFn, { model: "claude-sonnet-4" })

      const result1 = await cachedFn("input")
      const result2 = await cachedFn("input")

      expect(result1).toBe("result")
      expect(result2).toBe("result")
      expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it("should use custom serializer", async () => {
      interface ComplexInput {
        query: string
        context: string[]
      }

      const mockFn = vi.fn().mockResolvedValue("result")
      const cachedFn = withLLMCache(mockFn, {
        model: "claude-sonnet-4",
        // Only use query for cache key (ignore context)
        serialize: (input: ComplexInput) => input.query
      })

      // Same query, different context - should hit cache
      await cachedFn({ query: "test", context: ["a"] })
      await cachedFn({ query: "test", context: ["b", "c"] })

      expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it("should pass version to cachedLLMCall", async () => {
      const mockFn = vi.fn()
        .mockResolvedValueOnce("v1 result")
        .mockResolvedValueOnce("v2 result")

      const cachedFnV1 = withLLMCache(mockFn, { model: "claude-sonnet-4", version: 1 })
      const cachedFnV2 = withLLMCache(mockFn, { model: "claude-sonnet-4", version: 2 })

      await cachedFnV1("input")
      const result = await cachedFnV2("input")

      expect(result).toBe("v2 result")
      expect(mockFn).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // CLI Utilities Tests
  // ===========================================================================

  describe("getCacheStats", () => {
    it("should return empty stats for empty cache", async () => {
      const stats = await getCacheStats()

      expect(stats.count).toBe(0)
      expect(stats.totalBytes).toBe(0)
      expect(stats.oldestDate).toBeNull()
      expect(stats.newestDate).toBeNull()
      expect(stats.byModel).toEqual({})
      expect(stats.byVersion).toEqual({})
    })

    it("should return correct stats for populated cache", async () => {
      // Create some cache entries
      await cachedLLMCall("input1", "claude-sonnet-4", () => Promise.resolve("r1"), { version: 1 })
      await cachedLLMCall("input2", "claude-sonnet-4", () => Promise.resolve("r2"), { version: 1 })
      await cachedLLMCall("input3", "claude-haiku", () => Promise.resolve("r3"), { version: 2 })

      const stats = await getCacheStats()

      expect(stats.count).toBe(3)
      expect(stats.totalBytes).toBeGreaterThan(0)
      expect(stats.oldestDate).toBeInstanceOf(Date)
      expect(stats.newestDate).toBeInstanceOf(Date)
      expect(stats.byModel).toEqual({
        "claude-sonnet-4": 2,
        "claude-haiku": 1
      })
      expect(stats.byVersion).toEqual({
        1: 2,
        2: 1
      })
    })
  })

  describe("clearCache", () => {
    it("should clear all entries with all=true", async () => {
      await cachedLLMCall("input1", "claude-sonnet-4", () => Promise.resolve("r1"))
      await cachedLLMCall("input2", "claude-sonnet-4", () => Promise.resolve("r2"))

      const deleted = await clearCache({ all: true })

      expect(deleted).toBe(-1) // Unknown count for all
      const files = await fs.readdir(tempDir)
      expect(files.length).toBe(0)
    })

    it("should clear entries by model", async () => {
      await cachedLLMCall("input1", "claude-sonnet-4", () => Promise.resolve("r1"))
      await cachedLLMCall("input2", "claude-haiku", () => Promise.resolve("r2"))

      const deleted = await clearCache({ model: "claude-sonnet-4" })

      expect(deleted).toBe(1)
      const stats = await getCacheStats()
      expect(stats.count).toBe(1)
      expect(stats.byModel).toEqual({ "claude-haiku": 1 })
    })

    it("should clear entries by version", async () => {
      await cachedLLMCall("input1", "claude-sonnet-4", () => Promise.resolve("r1"), { version: 1 })
      await cachedLLMCall("input2", "claude-sonnet-4", () => Promise.resolve("r2"), { version: 2 })

      const deleted = await clearCache({ version: 1 })

      expect(deleted).toBe(1)
      const stats = await getCacheStats()
      expect(stats.byVersion).toEqual({ 2: 1 })
    })

    it("should clear entries older than date", async () => {
      await cachedLLMCall("input1", "claude-sonnet-4", () => Promise.resolve("r1"))

      // Clear entries older than 1 second in the future (all entries)
      const futureDate = new Date(Date.now() + 1000)
      const deleted = await clearCache({ olderThan: futureDate })

      expect(deleted).toBe(1)
    })
  })

  describe("formatCacheStats", () => {
    it("should format stats as readable string", async () => {
      await cachedLLMCall("input1", "claude-sonnet-4", () => Promise.resolve("r1"), { version: 1 })
      await cachedLLMCall("input2", "claude-haiku", () => Promise.resolve("r2"), { version: 2 })

      const stats = await getCacheStats()
      const formatted = formatCacheStats(stats)

      expect(formatted).toContain("LLM Cache Statistics:")
      expect(formatted).toContain("Entries: 2")
      expect(formatted).toContain("By model:")
      expect(formatted).toContain("claude-sonnet-4: 1")
      expect(formatted).toContain("claude-haiku: 1")
    })
  })

  describe("getCacheEntry", () => {
    it("should return entry by hash", async () => {
      const input = "test input"
      await cachedLLMCall(input, "claude-sonnet-4", () => Promise.resolve("result"))

      const hash = hashInput(input)
      const entry = await getCacheEntry(hash)

      expect(entry).not.toBeNull()
      expect(entry?.response).toBe("result")
      expect(entry?.model).toBe("claude-sonnet-4")
    })

    it("should return null for non-existent hash", async () => {
      const entry = await getCacheEntry("nonexistent")

      expect(entry).toBeNull()
    })
  })

  describe("listCacheEntries", () => {
    it("should list all cache entry hashes", async () => {
      await cachedLLMCall("input1", "claude-sonnet-4", () => Promise.resolve("r1"))
      await cachedLLMCall("input2", "claude-sonnet-4", () => Promise.resolve("r2"))

      const entries = await listCacheEntries()

      expect(entries.length).toBe(2)
      expect(entries[0]).toHaveLength(64)
      expect(entries[1]).toHaveLength(64)
    })

    it("should return empty array for empty cache", async () => {
      const entries = await listCacheEntries()

      expect(entries).toEqual([])
    })
  })
})
