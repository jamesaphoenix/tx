/**
 * File learning mappers - convert database rows to domain objects
 */

import type {
  FileLearning,
  FileLearningId,
  FileLearningRow
} from "@jamesaphoenix/tx-types"

// Re-export type from @tx/types for convenience
export type { FileLearningRow } from "@jamesaphoenix/tx-types"

/**
 * Convert a database row to a FileLearning domain object.
 */
export const rowToFileLearning = (row: FileLearningRow): FileLearning => ({
  id: row.id as FileLearningId,
  filePattern: row.file_pattern,
  note: row.note,
  taskId: row.task_id,
  createdAt: new Date(row.created_at)
})

/**
 * Simple glob pattern matching.
 * Supports:
 * - * matches any characters except /
 * - ** matches any characters including / (zero or more path segments)
 * - ? matches single character
 */
const globToRegex = (pattern: string): RegExp => {
  let regex = ""
  let i = 0
  while (i < pattern.length) {
    const char = pattern[i]
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // ** followed by / means zero or more path segments
        if (pattern[i + 2] === "/") {
          // **/ matches zero or more path segments
          // Use non-greedy match: (?:.*/)? to optionally match paths ending with /
          regex += "(?:.*/)?"
          i += 3
        } else {
          // ** at end or not followed by / - matches anything
          regex += ".*"
          i += 2
        }
      } else {
        // * matches anything except /
        regex += "[^/]*"
        i++
      }
    } else if (char === "?") {
      regex += "[^/]"
      i++
    } else if (char === "." || char === "(" || char === ")" || char === "[" || char === "]" || char === "^" || char === "$" || char === "+" || char === "{" || char === "}" || char === "|" || char === "\\") {
      regex += "\\" + char
      i++
    } else {
      regex += char
      i++
    }
  }
  return new RegExp("^" + regex + "$")
}

/**
 * Check if a path matches a glob pattern.
 */
export const matchesPattern = (pattern: string, path: string): boolean => {
  try {
    const regex = globToRegex(pattern)
    return regex.test(path)
  } catch {
    // If pattern is invalid, do exact match
    return pattern === path
  }
}
