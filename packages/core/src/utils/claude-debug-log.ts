import { existsSync, mkdirSync, statSync } from "node:fs"
import { join } from "node:path"

const CLAUDE_DEBUG_LOG_PATH_ENV = "CLAUDE_CODE_DEBUG_LOGS_DIR"

/**
 * Claude Agent SDK currently expects CLAUDE_CODE_DEBUG_LOGS_DIR to be a file path.
 * If it is set to a directory, SDK writes fail with EISDIR.
 */
export const normalizeClaudeDebugLogPath = (): void => {
  const configuredPath = process.env[CLAUDE_DEBUG_LOG_PATH_ENV]
  if (!configuredPath) return

  const trimmedPath = configuredPath.trim()
  if (trimmedPath.length === 0) return

  const hasDirectorySuffix = trimmedPath.endsWith("/") || trimmedPath.endsWith("\\")
  let shouldTreatAsDirectory = hasDirectorySuffix

  if (!shouldTreatAsDirectory) {
    try {
      shouldTreatAsDirectory = existsSync(trimmedPath) && statSync(trimmedPath).isDirectory()
    } catch {
      return
    }
  }

  if (!shouldTreatAsDirectory) return

  try {
    mkdirSync(trimmedPath, { recursive: true })
    process.env[CLAUDE_DEBUG_LOG_PATH_ENV] = join(
      trimmedPath,
      `tx-claude-debug-${process.pid}-${Date.now()}.log`
    )
  } catch {
    delete process.env[CLAUDE_DEBUG_LOG_PATH_ENV]
  }
}
