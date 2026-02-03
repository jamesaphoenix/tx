/**
 * LLM response caching with SHA256 keys.
 *
 * Caches expensive LLM API calls by hashing inputs with SHA256.
 * Supports version-based cache invalidation and various bypass modes.
 *
 * @module @tx/test-utils/llm-cache/cache
 */

import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

// =============================================================================
// Configuration
// =============================================================================

/**
 * Global cache configuration.
 */
interface LLMCacheConfig {
  /** Directory for cache files. Default: test/fixtures/llm-cache */
  cacheDir: string
  /** Enable console logging. Default: true in non-CI environments */
  logging: boolean
}

/**
 * Get the default cache directory.
 * Checks TX_LLM_CACHE_DIR environment variable first, then falls back to default.
 */
const getDefaultCacheDir = (): string => {
  return process.env.TX_LLM_CACHE_DIR || "test/fixtures/llm-cache"
}

let config: LLMCacheConfig = {
  cacheDir: getDefaultCacheDir(),
  logging: !process.env.CI
}

/**
 * Configure LLM cache settings.
 *
 * @example
 * ```typescript
 * configureLLMCache({
 *   cacheDir: 'custom/cache/path',
 *   logging: false
 * })
 * ```
 */
export const configureLLMCache = (options: Partial<LLMCacheConfig>): void => {
  config = { ...config, ...options }
}

/**
 * Get current cache configuration.
 */
export const getCacheConfig = (): Readonly<LLMCacheConfig> => config

/**
 * Reset cache configuration to defaults.
 */
export const resetCacheConfig = (): void => {
  config = {
    cacheDir: getDefaultCacheDir(),
    logging: !process.env.CI
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Cache entry stored in JSON files.
 */
export interface CacheEntry<T> {
  /** SHA256 hash of input (also the filename) */
  inputHash: string
  /** Truncated input for human readability */
  input: string
  /** Cached response data */
  response: T
  /** Model identifier (for debugging) */
  model: string
  /** ISO timestamp when cached */
  cachedAt: string
  /** Version for cache invalidation */
  version: number
}

/**
 * Options for cachedLLMCall.
 */
export interface CachedLLMCallOptions {
  /** Cache version - mismatch triggers cache miss */
  version?: number
  /** Force refresh even if cached */
  forceRefresh?: boolean
}

/**
 * Options for withLLMCache wrapper.
 */
export interface WithLLMCacheOptions<TInput> {
  /** Model identifier for cache metadata */
  model: string
  /** Custom serializer for input (default: JSON.stringify) */
  serialize?: (input: TInput) => string
  /** Cache version for invalidation */
  version?: number
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Compute SHA256 hash of input string for cache key.
 *
 * @example
 * ```typescript
 * const hash = hashInput("What is the capital of France?")
 * // -> "a1b2c3d4e5f6..." (64 hex chars)
 * ```
 */
export const hashInput = (input: string): string => {
  return crypto.createHash("sha256").update(input).digest("hex")
}

/**
 * Internal logging helper.
 */
const log = (message: string): void => {
  if (config.logging) {
    console.log(message)
  }
}

/**
 * Get cache file path for a given hash.
 */
const getCacheFilePath = (hash: string): string => {
  return path.join(config.cacheDir, `${hash}.json`)
}

/**
 * Get cached LLM response or execute and cache.
 *
 * Features:
 * - TX_NO_LLM_CACHE=1 env var bypasses cache entirely
 * - forceRefresh option forces fresh call even if cached
 * - version option enables cache invalidation on version mismatch
 *
 * @example
 * ```typescript
 * const result = await cachedLLMCall(
 *   "What is the capital of France?",
 *   "claude-sonnet-4",
 *   async () => {
 *     const response = await anthropic.messages.create({...})
 *     return response.content[0].text
 *   },
 *   { version: 2 }
 * )
 * ```
 */
export const cachedLLMCall = async <T>(
  input: string,
  model: string,
  call: () => Promise<T>,
  options: CachedLLMCallOptions = {}
): Promise<T> => {
  // Bypass cache if env var is set or forceRefresh is true
  if (process.env.TX_NO_LLM_CACHE === "1" || options.forceRefresh) {
    log(`[LLM Cache BYPASS] Calling ${model} directly`)
    return call()
  }

  const inputHash = hashInput(input)
  const cacheFile = getCacheFilePath(inputHash)

  // Try to read from cache
  try {
    const content = await fs.readFile(cacheFile, "utf-8")
    const cached = JSON.parse(content) as CacheEntry<T>

    // Version mismatch triggers cache miss
    if (options.version !== undefined && cached.version !== options.version) {
      log(
        `[LLM Cache VERSION MISMATCH] ${inputHash.slice(0, 12)}... (cached: v${cached.version}, requested: v${options.version})`
      )
      throw new Error("Version mismatch")
    }

    log(`[LLM Cache HIT] ${inputHash.slice(0, 12)}...`)
    return cached.response
  } catch {
    // Cache miss - file doesn't exist, is corrupted, or version mismatch
  }

  // Execute the call
  log(`[LLM Cache MISS] ${inputHash.slice(0, 12)}... calling ${model}`)
  const response = await call()

  // Store in cache
  try {
    await fs.mkdir(config.cacheDir, { recursive: true })

    const entry: CacheEntry<T> = {
      inputHash,
      input: input.slice(0, 1000), // Truncate for readability
      response,
      model,
      cachedAt: new Date().toISOString(),
      version: options.version ?? 1
    }

    await fs.writeFile(cacheFile, JSON.stringify(entry, null, 2), "utf-8")
    log(`[LLM Cache STORED] ${inputHash.slice(0, 12)}...`)
  } catch (error) {
    // Don't fail on cache write errors - just log and continue
    log(`[LLM Cache WRITE ERROR] ${error instanceof Error ? error.message : "Unknown error"}`)
  }

  return response
}

// =============================================================================
// Higher-Order Function Wrapper
// =============================================================================

/**
 * Wrap an async function to use LLM caching.
 *
 * Creates a cached version of any async function. The input is serialized
 * and hashed to create a cache key.
 *
 * @example
 * ```typescript
 * // Wrap an extraction function
 * const cachedExtract = withLLMCache(
 *   async (transcript: string) => {
 *     const response = await anthropic.messages.create({
 *       model: "claude-sonnet-4-20250514",
 *       messages: [{ role: "user", content: extractPrompt(transcript) }]
 *     })
 *     return JSON.parse(response.content[0].text)
 *   },
 *   { model: "claude-sonnet-4", version: 1 }
 * )
 *
 * // Use it - results are cached
 * const result1 = await cachedExtract("some transcript")
 * const result2 = await cachedExtract("some transcript") // cache hit!
 * ```
 *
 * @example
 * ```typescript
 * // With custom serializer for complex input
 * interface ComplexInput {
 *   transcript: string
 *   metadata: { source: string }
 * }
 *
 * const cachedProcess = withLLMCache(
 *   async (input: ComplexInput) => processInput(input),
 *   {
 *     model: "claude-sonnet-4",
 *     serialize: (input) => `${input.metadata.source}::${input.transcript}`,
 *     version: 2
 *   }
 * )
 * ```
 */
export const withLLMCache = <TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options: WithLLMCacheOptions<TInput>
): ((input: TInput) => Promise<TOutput>) => {
  const serialize = options.serialize ?? JSON.stringify

  return async (input: TInput): Promise<TOutput> => {
    const serialized = serialize(input)
    return cachedLLMCall(
      serialized,
      options.model,
      () => fn(input),
      { version: options.version }
    )
  }
}
