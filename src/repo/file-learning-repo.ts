import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import {
  type FileLearning,
  type FileLearningRow,
  type CreateFileLearningInput,
  rowToFileLearning
} from "../schemas/file-learning.js"

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

export class FileLearningRepository extends Context.Tag("FileLearningRepository")<
  FileLearningRepository,
  {
    readonly insert: (input: CreateFileLearningInput) => Effect.Effect<FileLearning, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<FileLearning | null, DatabaseError>
    readonly findAll: () => Effect.Effect<readonly FileLearning[], DatabaseError>
    readonly findByPath: (path: string) => Effect.Effect<readonly FileLearning[], DatabaseError>
    readonly remove: (id: number) => Effect.Effect<void, DatabaseError>
    readonly count: () => Effect.Effect<number, DatabaseError>
  }
>() {}

export const FileLearningRepositoryLive = Layer.effect(
  FileLearningRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db.prepare(
              `INSERT INTO file_learnings (file_pattern, note, task_id, created_at)
               VALUES (?, ?, ?, ?)`
            ).run(
              input.filePattern,
              input.note,
              input.taskId ?? null,
              now
            )
            // Fetch the inserted row
            const row = db.prepare("SELECT * FROM file_learnings WHERE id = ?").get(result.lastInsertRowid) as FileLearningRow
            return rowToFileLearning(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM file_learnings WHERE id = ?").get(id) as FileLearningRow | undefined
            return row ? rowToFileLearning(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM file_learnings ORDER BY created_at DESC`
            ).all() as FileLearningRow[]
            return rows.map(rowToFileLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByPath: (path) =>
        Effect.try({
          try: () => {
            // Get all file learnings and filter by pattern matching
            const rows = db.prepare(
              `SELECT * FROM file_learnings ORDER BY created_at DESC`
            ).all() as FileLearningRow[]

            return rows
              .filter(row => matchesPattern(row.file_pattern, path))
              .map(rowToFileLearning)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (id) =>
        Effect.try({
          try: () => {
            db.prepare("DELETE FROM file_learnings WHERE id = ?").run(id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      count: () =>
        Effect.try({
          try: () => {
            const result = db.prepare("SELECT COUNT(*) as cnt FROM file_learnings").get() as { cnt: number }
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
