/**
 * CompactionService - Compacts completed tasks and exports learnings
 *
 * Implements PRD-006: Task Compaction & Learnings Export
 * See DD-006: LLM Integration for implementation details
 */

import { Context, Effect, Layer } from "effect"
import { writeFileSync, existsSync, readFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { SqliteClient } from "../db.js"
import { DatabaseError, ExtractionUnavailableError, ValidationError } from "../errors.js"
import { CompactionRepository, type CompactionLogEntry } from "../repo/compaction-repo.js"
import { rowToTask, type TaskRow } from "../mappers/task.js"
import type { Task } from "@jamesaphoenix/tx-types"
import { LlmService } from "./llm-service.js"

/**
 * Output mode for compaction learnings.
 * - 'database': Store in compaction_log table only
 * - 'markdown': Append to markdown file only
 * - 'both': Store in DB AND append to markdown (default, per DOCTRINE RULE 2)
 */
export type CompactionOutputMode = 'database' | 'markdown' | 'both'

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  readonly compactedCount: number
  readonly summary: string
  readonly learnings: string
  readonly taskIds: readonly string[]
  readonly learningsExportedTo: string | null
  readonly outputMode: CompactionOutputMode
}

/**
 * Options for compaction.
 */
export interface CompactionOptions {
  /** Compact tasks completed before this date */
  readonly before: Date
  /** Path to export learnings (default: CLAUDE.md) */
  readonly outputFile?: string
  /** If true, preview only without actually compacting */
  readonly dryRun?: boolean
  /**
   * Output mode for learnings: 'database', 'markdown', or 'both'.
   * Default: 'both' (per DOCTRINE RULE 2)
   */
  readonly outputMode?: CompactionOutputMode
}

/**
 * Preview result showing what would be compacted.
 */
export interface CompactionPreview {
  readonly tasks: readonly Task[]
  readonly summary: string | null
  readonly learnings: string | null
}

/**
 * LLM prompt template for compaction.
 */
const COMPACTION_PROMPT = `Analyze these completed tasks and generate two outputs:

Completed Tasks:
{tasks}

Generate a JSON response with two fields:

1. "summary": A 2-4 paragraph summary capturing what was accomplished, grouped by related work. Keep under 500 words.

2. "learnings": Bullet points of actionable learnings that would help an AI agent working on similar tasks in the future. Focus on:
   - Key technical decisions and why they were made
   - Gotchas or pitfalls to avoid
   - Patterns that worked well
   - Things that should be done differently next time

Format learnings as markdown bullet points, suitable for appending to a CLAUDE.md file.

Example response format:
{
  "summary": "## Task Summary\\n\\nCompleted authentication system implementation...",
  "learnings": "- JWT tokens should use RS256 for production signing\\n- Token validation middleware must run before route handlers"
}`

interface CompactionLlmResponse {
  summary: string
  learnings: string
}

/** JSON Schema for structured output from the compaction LLM call */
const COMPACTION_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    learnings: { type: "string" },
  },
  required: ["summary", "learnings"],
  additionalProperties: false,
} as const

/**
 * Validate that a target file path does not escape the project directory
 * via path traversal (e.g. "../../etc/passwd" or absolute paths outside
 * the project root). Returns the resolved absolute path on success.
 */
const validateProjectPath = (targetFile: string): Effect.Effect<string, ValidationError> => {
  const projectRoot = process.cwd()
  const resolved = resolve(projectRoot, targetFile)

  if (!resolved.startsWith(projectRoot + sep)) {
    return Effect.fail(new ValidationError({
      reason: `Path traversal rejected: resolved path '${resolved}' escapes project directory '${projectRoot}'`
    }))
  }

  return Effect.succeed(resolved)
}

/**
 * CompactionService provides compaction operations for completed tasks.
 *
 * Design: Following DD-006 patterns for LLM integration with graceful degradation.
 * Uses centralized LlmService for all LLM calls.
 */
export class CompactionService extends Context.Tag("CompactionService")<
  CompactionService,
  {
    /**
     * Compact tasks completed before the given date.
     * Requires an LLM backend to be available.
     */
    readonly compact: (options: CompactionOptions) => Effect.Effect<CompactionResult, ExtractionUnavailableError | DatabaseError | ValidationError>
    /**
     * Preview what would be compacted without LLM processing.
     * Works without any LLM backend.
     */
    readonly preview: (before: Date) => Effect.Effect<readonly Task[], DatabaseError>
    /**
     * Get all compaction history.
     */
    readonly getSummaries: () => Effect.Effect<readonly CompactionLogEntry[], DatabaseError>
    /**
     * Export learnings to a markdown file.
     */
    readonly exportLearnings: (learnings: string, targetFile: string) => Effect.Effect<void, DatabaseError | ValidationError>
    /**
     * Check if compaction functionality is available (LLM backend available).
     */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Noop implementation - returns failures for LLM operations.
 * Used for testing and when no LLM backend is configured.
 */
export const CompactionServiceNoop = Layer.effect(
  CompactionService,
  Effect.gen(function* () {
    const compactionRepo = yield* CompactionRepository
    const db = yield* SqliteClient

    const findCompactableTasks = (before: Date): Effect.Effect<readonly Task[], DatabaseError> =>
      Effect.try({
        try: () => {
          const beforeStr = before.toISOString()
          const rows = db.prepare(`
            SELECT t.*
            FROM tasks t
            WHERE t.status = 'done'
              AND t.completed_at IS NOT NULL
              AND t.completed_at < ?
              AND NOT EXISTS (
                SELECT 1 FROM tasks child
                WHERE child.parent_id = t.id
                  AND child.status != 'done'
              )
            ORDER BY t.completed_at ASC
          `).all(beforeStr) as TaskRow[]
          return rows.map(rowToTask)
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    return {
      compact: (_options) =>
        Effect.fail(new ExtractionUnavailableError({
          reason: "Task compaction requires an LLM backend. Ensure Agent SDK or ANTHROPIC_API_KEY is available."
        })),

      preview: (before) => findCompactableTasks(before),

      getSummaries: () => compactionRepo.findAll(),

      exportLearnings: (learnings, targetFile) =>
        Effect.gen(function* () {
          const filePath = yield* validateProjectPath(targetFile)
          yield* Effect.try({
            try: () => {
              const date = new Date().toISOString().split("T")[0]
              const content = `\n\n## Agent Learnings (${date})\n\n${learnings}\n`

              if (existsSync(filePath)) {
                const existing = readFileSync(filePath, "utf-8")
                writeFileSync(filePath, existing + content)
              } else {
                writeFileSync(filePath, `# Project Context\n${content}`)
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })
        }),

      isAvailable: () => Effect.succeed(false)
    }
  })
)

/**
 * Live implementation using centralized LlmService.
 */
export const CompactionServiceLive = Layer.effect(
  CompactionService,
  Effect.gen(function* () {
    const compactionRepo = yield* CompactionRepository
    const db = yield* SqliteClient
    const llmService = yield* LlmService

    const findCompactableTasks = (before: Date): Effect.Effect<readonly Task[], DatabaseError> =>
      Effect.try({
        try: () => {
          const beforeStr = before.toISOString()
          const rows = db.prepare(`
            SELECT t.*
            FROM tasks t
            WHERE t.status = 'done'
              AND t.completed_at IS NOT NULL
              AND t.completed_at < ?
              AND NOT EXISTS (
                SELECT 1 FROM tasks child
                WHERE child.parent_id = t.id
                  AND child.status != 'done'
              )
            ORDER BY t.completed_at ASC
          `).all(beforeStr) as TaskRow[]
          return rows.map(rowToTask)
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const generateSummary = (tasks: readonly Task[]): Effect.Effect<CompactionLlmResponse, ExtractionUnavailableError> =>
      Effect.gen(function* () {
        // Build task list for prompt
        const taskList = tasks.map(t =>
          `- ${t.id}: ${t.title} (completed: ${t.completedAt?.toISOString().split("T")[0] ?? "unknown"})\n  ${t.description || "(no description)"}`
        ).join("\n")

        const prompt = COMPACTION_PROMPT.replace("{tasks}", taskList)

        const result = yield* llmService.complete({
          prompt,
          model: "claude-haiku-4-20250514",
          maxTokens: 2048,
          jsonSchema: COMPACTION_SCHEMA,
        }).pipe(
          Effect.mapError((e) => new ExtractionUnavailableError({
            reason: `LLM completion failed: ${e.reason}`
          }))
        )

        // Structured outputs guarantee valid JSON matching the schema
        const parsed = JSON.parse(result.text) as CompactionLlmResponse
        return parsed
      })

    const exportLearningsToFile = (learnings: string, targetFile: string): Effect.Effect<void, DatabaseError | ValidationError> =>
      Effect.gen(function* () {
        const filePath = yield* validateProjectPath(targetFile)
        yield* Effect.try({
          try: () => {
            const date = new Date().toISOString().split("T")[0]
            const content = `\n\n## Agent Learnings (${date})\n\n${learnings}\n`

            if (existsSync(filePath)) {
              const existing = readFileSync(filePath, "utf-8")
              writeFileSync(filePath, existing + content)
            } else {
              writeFileSync(filePath, `# Project Context\n${content}`)
            }
          },
          catch: (cause) => new DatabaseError({ cause })
        })
      })

    return {
      compact: (options) =>
        Effect.gen(function* () {
          const tasks = yield* findCompactableTasks(options.before)
          // Default to 'both' per DOCTRINE RULE 2
          const outputMode = options.outputMode ?? 'both'

          if (tasks.length === 0) {
            return {
              compactedCount: 0,
              summary: "No tasks to compact",
              learnings: "",
              taskIds: [],
              learningsExportedTo: null,
              outputMode
            }
          }

          // Generate LLM summary (outside transaction - LLM calls are slow)
          const { summary, learnings } = yield* generateSummary(tasks)

          const taskIds = tasks.map(t => t.id)
          const outputFile = options.outputFile ?? "CLAUDE.md"
          const shouldExportToMarkdown = outputMode === 'markdown' || outputMode === 'both'
          const shouldStoreInDatabase = outputMode === 'database' || outputMode === 'both'

          if (options.dryRun) {
            // Preview mode: return what would be compacted without making changes
            return {
              compactedCount: tasks.length,
              summary,
              learnings,
              taskIds,
              learningsExportedTo: shouldExportToMarkdown ? outputFile : null,
              outputMode
            }
          }

          // CRITICAL: Export learnings to file FIRST, before database transaction.
          // This ordering prevents a false positive where the database records
          // learnings_exported_to but the file export actually failed.
          if (shouldExportToMarkdown) {
            yield* exportLearningsToFile(learnings, outputFile)
          }

          // Transaction: store log (optionally with learnings) + delete tasks atomically
          yield* Effect.try({
            try: () => {
              db.exec("BEGIN IMMEDIATE")
              try {
                if (shouldStoreInDatabase) {
                  const now = new Date().toISOString()
                  db.prepare(
                    `INSERT INTO compaction_log (compacted_at, task_count, summary, task_ids, learnings_exported_to, learnings)
                     VALUES (?, ?, ?, ?, ?, ?)`
                  ).run(
                    now,
                    tasks.length,
                    summary,
                    JSON.stringify(taskIds),
                    shouldExportToMarkdown ? outputFile : null,
                    learnings
                  )
                }

                // Delete compacted tasks
                for (const task of tasks) {
                  // First delete any dependencies involving this task
                  db.prepare("DELETE FROM task_dependencies WHERE blocker_id = ? OR blocked_id = ?").run(task.id, task.id)
                  // Then delete the task
                  db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id)
                }

                db.exec("COMMIT")
              } catch (e) {
                db.exec("ROLLBACK")
                throw e // eslint-disable-line tx/no-throw-in-services -- re-throw for Effect.try catch
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })

          return {
            compactedCount: tasks.length,
            summary,
            learnings,
            taskIds,
            learningsExportedTo: shouldExportToMarkdown ? outputFile : null,
            outputMode
          }
        }),

      preview: (before) => findCompactableTasks(before),

      getSummaries: () => compactionRepo.findAll(),

      exportLearnings: exportLearningsToFile,

      isAvailable: () => llmService.isAvailable()
    }
  })
)

/**
 * Auto-detecting layer that selects the appropriate backend based on LlmService availability.
 *
 * Priority:
 * 1. LlmService available -> Use Live implementation
 * 2. Not available -> Use Noop (graceful degradation)
 */
export const CompactionServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    const opt = yield* Effect.serviceOption(LlmService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const }))
    )

    if (opt._tag === "Some") {
      const available = yield* opt.value.isAvailable()
      if (available) return CompactionServiceLive
    }
    return CompactionServiceNoop
  })
)
