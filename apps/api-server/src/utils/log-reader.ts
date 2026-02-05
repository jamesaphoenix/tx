/**
 * Log File Reader
 *
 * Safely reads per-run log files (stdout, stderr, context) from .tx/runs/ directories.
 * Includes path traversal protection and tail support for large files.
 */

import { Effect } from "effect"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Read a log file with optional tail support.
 * Validates the path is under .tx/runs/ to prevent path traversal.
 *
 * @param filePath - Absolute path to the log file
 * @param tailLines - If > 0, return only the last N lines
 * @returns The file content and whether it was truncated
 */
export const readLogFile = (
  filePath: string,
  tailLines: number = 0
): Effect.Effect<{ content: string; truncated: boolean }, Error> =>
  Effect.gen(function* () {
    if (!existsSync(filePath)) {
      return { content: "", truncated: false }
    }

    // Security: ensure path is under .tx/runs/
    const resolved = resolve(filePath)
    if (!resolved.includes("/.tx/runs/")) {
      return yield* Effect.fail(
        new Error("Path traversal attempt: log path must be under .tx/runs/")
      )
    }

    const content = yield* Effect.tryPromise({
      try: () => readFile(filePath, "utf-8"),
      catch: (err) => new Error(`Failed to read log file: ${String(err)}`),
    })

    if (tailLines > 0) {
      const lines = content.split("\n")
      if (lines.length > tailLines) {
        return {
          content: lines.slice(-tailLines).join("\n"),
          truncated: true,
        }
      }
    }

    return { content, truncated: false }
  })
