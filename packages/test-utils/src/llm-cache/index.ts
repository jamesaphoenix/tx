/**
 * LLM response caching for deterministic tests.
 *
 * Caches expensive LLM API calls by hashing inputs with SHA256.
 * Enables fast, repeatable tests without hitting real APIs.
 *
 * @example
 * ```typescript
 * import { cachedLLMCall, withLLMCache, hashInput } from '@tx/test-utils/llm-cache'
 *
 * // Direct caching
 * const result = await cachedLLMCall(
 *   "What is 2+2?",
 *   "claude-sonnet-4",
 *   () => anthropic.messages.create({...})
 * )
 *
 * // Wrapper pattern
 * const cachedExtract = withLLMCache(extractCandidates, {
 *   model: "claude-sonnet-4",
 *   version: 1
 * })
 * ```
 *
 * @module @tx/test-utils/llm-cache
 */

// Core caching functions
export {
  hashInput,
  cachedLLMCall,
  withLLMCache,
  configureLLMCache,
  getCacheConfig,
  resetCacheConfig
} from "./cache.js"

// Types from cache
export type {
  CacheEntry,
  CachedLLMCallOptions,
  WithLLMCacheOptions
} from "./cache.js"

// CLI utilities
export {
  getCacheStats,
  clearCache,
  formatCacheStats,
  getCacheEntry,
  listCacheEntries
} from "./cli.js"

// Types from CLI
export type { CacheStats, ClearCacheOptions } from "./cli.js"
