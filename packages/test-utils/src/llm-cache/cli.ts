/**
 * CLI utilities for LLM cache management.
 *
 * Provides functions to inspect, clear, and manage the LLM response cache.
 *
 * @module @tx/test-utils/llm-cache/cli
 */

import * as fs from "fs/promises"
import * as path from "path"
import { getCacheConfig, CacheEntry } from "./cache.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Statistics about the LLM cache.
 */
export interface CacheStats {
  /** Total number of cache entries */
  count: number
  /** Total size in bytes */
  totalBytes: number
  /** Oldest cache entry date (null if empty) */
  oldestDate: Date | null
  /** Newest cache entry date (null if empty) */
  newestDate: Date | null
  /** Count of entries by model */
  byModel: Record<string, number>
  /** Count of entries by version */
  byVersion: Record<number, number>
}

/**
 * Options for clearing cache.
 */
export interface ClearCacheOptions {
  /** Delete entries older than this date */
  olderThan?: Date
  /** Delete entries for specific model */
  model?: string
  /** Delete entries with specific version */
  version?: number
  /** Delete all entries */
  all?: boolean
}

// =============================================================================
// Cache Statistics
// =============================================================================

/**
 * Get statistics about the LLM cache.
 *
 * @example
 * ```typescript
 * const stats = await getCacheStats()
 * console.log(`Cache has ${stats.count} entries using ${stats.totalBytes} bytes`)
 * console.log(`Models: ${Object.keys(stats.byModel).join(', ')}`)
 * ```
 */
export const getCacheStats = async (): Promise<CacheStats> => {
  const config = getCacheConfig()
  const stats: CacheStats = {
    count: 0,
    totalBytes: 0,
    oldestDate: null,
    newestDate: null,
    byModel: {},
    byVersion: {}
  }

  let files: string[]
  try {
    files = await fs.readdir(config.cacheDir)
  } catch {
    // Directory doesn't exist - return empty stats
    return stats
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"))
  stats.count = jsonFiles.length

  for (const file of jsonFiles) {
    const filePath = path.join(config.cacheDir, file)

    try {
      const stat = await fs.stat(filePath)
      stats.totalBytes += stat.size

      const content = await fs.readFile(filePath, "utf-8")
      const entry = JSON.parse(content) as CacheEntry<unknown>

      // Track by model
      stats.byModel[entry.model] = (stats.byModel[entry.model] ?? 0) + 1

      // Track by version
      stats.byVersion[entry.version] = (stats.byVersion[entry.version] ?? 0) + 1

      // Track date range
      const date = new Date(entry.cachedAt)
      if (!stats.oldestDate || date < stats.oldestDate) {
        stats.oldestDate = date
      }
      if (!stats.newestDate || date > stats.newestDate) {
        stats.newestDate = date
      }
    } catch {
      // Skip corrupted files
      continue
    }
  }

  return stats
}

// =============================================================================
// Cache Clearing
// =============================================================================

/**
 * Clear cache entries based on options.
 *
 * @returns Number of entries deleted (-1 if unknown when using `all`)
 *
 * @example
 * ```typescript
 * // Clear all cache
 * await clearCache({ all: true })
 *
 * // Clear entries older than 30 days
 * const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
 * const deleted = await clearCache({ olderThan: thirtyDaysAgo })
 *
 * // Clear entries for specific model
 * await clearCache({ model: 'claude-haiku' })
 *
 * // Clear entries with specific version (useful after schema changes)
 * await clearCache({ version: 1 })
 * ```
 */
export const clearCache = async (options: ClearCacheOptions = {}): Promise<number> => {
  const config = getCacheConfig()

  // Clear all - fastest path
  if (options.all) {
    try {
      await fs.rm(config.cacheDir, { recursive: true, force: true })
      await fs.mkdir(config.cacheDir, { recursive: true })
    } catch {
      // Directory may not exist
    }
    return -1 // Unknown count
  }

  let files: string[]
  try {
    files = await fs.readdir(config.cacheDir)
  } catch {
    return 0 // Directory doesn't exist
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"))
  let deleted = 0

  for (const file of jsonFiles) {
    const filePath = path.join(config.cacheDir, file)

    try {
      const content = await fs.readFile(filePath, "utf-8")
      const entry = JSON.parse(content) as CacheEntry<unknown>

      const shouldDelete =
        (options.olderThan && new Date(entry.cachedAt) < options.olderThan) ||
        (options.model && entry.model === options.model) ||
        (options.version !== undefined && entry.version === options.version)

      if (shouldDelete) {
        await fs.unlink(filePath)
        deleted++
      }
    } catch {
      // Skip files that can't be read
      continue
    }
  }

  return deleted
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format bytes into human-readable string.
 */
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B"

  const units = ["B", "KB", "MB", "GB"]
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

/**
 * Format date for display.
 */
const formatDate = (date: Date | null): string => {
  if (!date) return "N/A"
  return date.toISOString().split("T")[0]
}

/**
 * Format cache statistics for display.
 *
 * @example
 * ```typescript
 * const stats = await getCacheStats()
 * console.log(formatCacheStats(stats))
 * // Output:
 * // LLM Cache Statistics:
 * //   Entries: 142
 * //   Size: 3.2 MB
 * //   Date range: 2024-01-15 to 2024-02-01
 * //   By model:
 * //     claude-sonnet-4: 98
 * //     claude-haiku: 44
 * ```
 */
export const formatCacheStats = (stats: CacheStats): string => {
  const lines: string[] = [
    "LLM Cache Statistics:",
    `  Entries: ${stats.count}`,
    `  Size: ${formatBytes(stats.totalBytes)}`
  ]

  if (stats.oldestDate && stats.newestDate) {
    lines.push(`  Date range: ${formatDate(stats.oldestDate)} to ${formatDate(stats.newestDate)}`)
  }

  const models = Object.entries(stats.byModel)
  if (models.length > 0) {
    lines.push("  By model:")
    for (const [model, count] of models.sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${model}: ${count}`)
    }
  }

  const versions = Object.entries(stats.byVersion)
  if (versions.length > 1) {
    lines.push("  By version:")
    for (const [version, count] of versions.sort((a, b) => Number(b[0]) - Number(a[0]))) {
      lines.push(`    v${version}: ${count}`)
    }
  }

  return lines.join("\n")
}

// =============================================================================
// Cache Entry Inspection
// =============================================================================

/**
 * Get a specific cache entry by hash.
 *
 * @example
 * ```typescript
 * const entry = await getCacheEntry('a1b2c3d4...')
 * if (entry) {
 *   console.log(`Cached at: ${entry.cachedAt}`)
 *   console.log(`Model: ${entry.model}`)
 * }
 * ```
 */
export const getCacheEntry = async <T = unknown>(hash: string): Promise<CacheEntry<T> | null> => {
  const config = getCacheConfig()
  const filePath = path.join(config.cacheDir, `${hash}.json`)

  try {
    const content = await fs.readFile(filePath, "utf-8")
    return JSON.parse(content) as CacheEntry<T>
  } catch {
    return null
  }
}

/**
 * List all cache entry hashes.
 *
 * @example
 * ```typescript
 * const hashes = await listCacheEntries()
 * console.log(`Found ${hashes.length} cached responses`)
 * ```
 */
export const listCacheEntries = async (): Promise<string[]> => {
  const config = getCacheConfig()

  try {
    const files = await fs.readdir(config.cacheDir)
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
  } catch {
    return []
  }
}
