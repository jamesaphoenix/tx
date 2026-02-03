/**
 * Test commands: cache-stats, clear-cache
 *
 * CLI commands for managing the LLM response cache.
 */

import { Effect } from "effect"
import { getCacheStats, clearCache, formatCacheStats, ClearCacheOptions } from "@jamesaphoenix/tx-test-utils"
import { toJson } from "../output.js"
import { commandHelp } from "../help.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

function opt(flags: Flags, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === "string") return v
  }
  return undefined
}

/**
 * Parse duration string like "30d" to milliseconds
 */
function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)([dhms])$/)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  }

  return value * multipliers[unit]
}

/**
 * tx test:cache-stats - Show LLM cache statistics
 */
export const testCacheStats = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    // Check for --help
    if (flag(flags, "help", "h")) {
      console.log(commandHelp["test:cache-stats"])
      return
    }

    const stats = yield* Effect.promise(() => getCacheStats())

    if (flag(flags, "json")) {
      // Convert dates to ISO strings for JSON output
      const jsonStats = {
        count: stats.count,
        totalBytes: stats.totalBytes,
        oldestDate: stats.oldestDate?.toISOString() ?? null,
        newestDate: stats.newestDate?.toISOString() ?? null,
        byModel: stats.byModel,
        byVersion: stats.byVersion
      }
      console.log(toJson(jsonStats))
    } else {
      console.log(formatCacheStats(stats))
    }
  })

/**
 * tx test:clear-cache - Clear LLM cache entries
 */
export const testClearCache = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    // Check for --help
    if (flag(flags, "help", "h")) {
      console.log(commandHelp["test:clear-cache"])
      return
    }

    const options: ClearCacheOptions = {}

    // --all flag
    if (flag(flags, "all")) {
      options.all = true
    }

    // --older-than <n>d
    const olderThan = opt(flags, "older-than")
    if (olderThan) {
      const ms = parseDuration(olderThan)
      if (ms === null) {
        console.error(`Invalid duration format: ${olderThan}`)
        console.error(`Use format like: 30d (30 days), 2h (2 hours), 60m (60 minutes)`)
        process.exit(1)
      }
      options.olderThan = new Date(Date.now() - ms)
    }

    // --model <name>
    const model = opt(flags, "model")
    if (model) {
      options.model = model
    }

    // --version <n>
    const version = opt(flags, "version")
    if (version) {
      const v = parseInt(version, 10)
      if (isNaN(v)) {
        console.error(`Invalid version: ${version} (must be a number)`)
        process.exit(1)
      }
      options.version = v
    }

    // Require at least one option
    if (!options.all && !options.olderThan && !options.model && options.version === undefined) {
      console.error("Error: Must specify at least one option: --all, --older-than, --model, or --version")
      console.error("Run 'tx test:clear-cache --help' for usage information")
      process.exit(1)
    }

    const deleted = yield* Effect.promise(() => clearCache(options))

    if (flag(flags, "json")) {
      const result = {
        deleted: deleted === -1 ? null : deleted,
        all: options.all ?? false
      }
      console.log(toJson(result))
    } else {
      if (options.all) {
        console.log("Cache cleared")
      } else {
        console.log(`Deleted ${deleted} cache entries`)
      }
    }
  })
