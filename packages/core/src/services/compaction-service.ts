/**
 * CompactionService - Compacts completed tasks and exports learnings
 *
 * Implements PRD-006: Task Compaction & Learnings Export
 * See DD-006: LLM Integration for implementation details
 */

import { Context, Effect, Layer, Config, Option } from "effect"
import { writeFileSync, existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SqliteClient } from "../db.js"
import { DatabaseError, ExtractionUnavailableError } from "../errors.js"
import { CompactionRepository, type CompactionLogEntry } from "../repo/compaction-repo.js"
import { rowToTask, type TaskRow } from "../mappers/task.js"
import type { Task } from "@jamesaphoenix/tx-types"

// Types for Anthropic SDK (imported dynamically)
interface AnthropicMessage {
  content: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface AnthropicClient {
  messages: {
    create(params: {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: string }>
    }): Promise<AnthropicMessage>
  }
}

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
 * Parse LLM JSON response, handling common formatting issues.
 * Robust parser following DD-006 patterns.
 */
const parseLlmJson = <T>(raw: string): T | null => {
  // Step 1: Try direct parse
  try { return JSON.parse(raw) } catch { /* continue */ }

  // Step 2: Strip markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch && fenceMatch[1]) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch { /* continue */ }
  }

  // Step 3: Find first [ or { and parse from there
  const jsonStart = raw.search(/[[{]/)
  if (jsonStart >= 0) {
    const candidate = raw.slice(jsonStart)
    try { return JSON.parse(candidate) } catch { /* continue */ }

    // Step 4: Find matching bracket and extract
    const openChar = candidate[0]
    const closeChar = openChar === "[" ? "]" : "}"
    const lastClose = candidate.lastIndexOf(closeChar)
    if (lastClose > 0) {
      try { return JSON.parse(candidate.slice(0, lastClose + 1)) } catch { /* continue */ }
    }
  }

  return null
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

/**
 * CompactionService provides compaction operations for completed tasks.
 *
 * Design: Following DD-006 patterns for LLM integration with graceful degradation.
 * When ANTHROPIC_API_KEY is not set, compact() fails gracefully while preview()
 * and getSummaries() still work.
 */
export class CompactionService extends Context.Tag("CompactionService")<
  CompactionService,
  {
    /**
     * Compact tasks completed before the given date.
     * Requires ANTHROPIC_API_KEY to be set.
     */
    readonly compact: (options: CompactionOptions) => Effect.Effect<CompactionResult, ExtractionUnavailableError | DatabaseError>
    /**
     * Preview what would be compacted without LLM processing.
     * Works without ANTHROPIC_API_KEY.
     */
    readonly preview: (before: Date) => Effect.Effect<readonly Task[], DatabaseError>
    /**
     * Get all compaction history.
     */
    readonly getSummaries: () => Effect.Effect<readonly CompactionLogEntry[], DatabaseError>
    /**
     * Export learnings to a markdown file.
     */
    readonly exportLearnings: (learnings: string, targetFile: string) => Effect.Effect<void, DatabaseError>
    /**
     * Check if compaction functionality is available (API key set).
     */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Noop implementation - returns failures for LLM operations.
 * Used for testing and when no API key is configured.
 */
export const CompactionServiceNoop = Layer.effect(
  CompactionService,
  Effect.gen(function* () {
    const compactionRepo = yield* CompactionRepository
    const db = yield* SqliteClient

    const findCompactableTasks = (before: Date): Effect.Effect<readonly Task[], DatabaseError> =>
      Effect.try({
        try: () => {
          // Find tasks that are:
          // 1. Status = 'done'
          // 2. completed_at < before
          // 3. All children are also done (subquery check)
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
          reason: "Task compaction requires ANTHROPIC_API_KEY. Set it as an environment variable to enable this feature."
        })),

      preview: (before) => findCompactableTasks(before),

      getSummaries: () => compactionRepo.findAll(),

      exportLearnings: (learnings, targetFile) =>
        Effect.try({
          try: () => {
            const filePath = resolve(process.cwd(), targetFile)
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
        }),

      isAvailable: () => Effect.succeed(false)
    }
  })
)

/**
 * Live implementation with Anthropic LLM support.
 */
export const CompactionServiceLive = Layer.effect(
  CompactionService,
  Effect.gen(function* () {
    const compactionRepo = yield* CompactionRepository
    const db = yield* SqliteClient

    // Read API key from environment (optional)
    const apiKeyOption = yield* Config.string("ANTHROPIC_API_KEY").pipe(Effect.option)
    const hasApiKey = Option.isSome(apiKeyOption) && apiKeyOption.value.trim().length > 0
    const apiKey = hasApiKey ? apiKeyOption.value : null

    // Lazy-load Anthropic client
    let client: AnthropicClient | null = null

    const ensureClient = Effect.gen(function* () {
      if (!apiKey) {
        return yield* Effect.fail(new ExtractionUnavailableError({
          reason: "Task compaction requires ANTHROPIC_API_KEY. Set it as an environment variable to enable this feature."
        }))
      }

      if (client) return client

      // Dynamic import of Anthropic SDK (optional peer dependency)
      const Anthropic = yield* Effect.tryPromise({
        try: async () => {
          // @ts-expect-error - @anthropic-ai/sdk is an optional peer dependency
          const mod = await import("@anthropic-ai/sdk")
          return mod.default
        },
        catch: () => new ExtractionUnavailableError({
          reason: "@anthropic-ai/sdk is not installed"
        })
      })

      client = new Anthropic({ apiKey }) as unknown as AnthropicClient
      return client
    })

    const findCompactableTasks = (before: Date): Effect.Effect<readonly Task[], DatabaseError> =>
      Effect.try({
        try: () => {
          // Find tasks that are:
          // 1. Status = 'done'
          // 2. completed_at < before
          // 3. All children are also done (subquery check)
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
        const anthropic = yield* ensureClient

        // Build task list for prompt
        const taskList = tasks.map(t =>
          `- ${t.id}: ${t.title} (completed: ${t.completedAt?.toISOString().split("T")[0] ?? "unknown"})\n  ${t.description || "(no description)"}`
        ).join("\n")

        const prompt = COMPACTION_PROMPT.replace("{tasks}", taskList)

        const response = yield* Effect.tryPromise({
          try: () => anthropic.messages.create({
            model: "claude-haiku-4-20250514",
            max_tokens: 2048,
            messages: [{
              role: "user",
              content: prompt
            }]
          }),
          catch: (e) => new ExtractionUnavailableError({
            reason: `Anthropic API call failed: ${String(e)}`
          })
        })

        // Extract text from response
        const textContent = response.content.find(c => c.type === "text")
        if (!textContent || !textContent.text) {
          return {
            summary: "No summary generated",
            learnings: "- No learnings extracted"
          }
        }

        // Parse the JSON response
        const parsed = parseLlmJson<CompactionLlmResponse>(textContent.text)
        if (!parsed || !parsed.summary || !parsed.learnings) {
          // Fallback: treat raw response as summary/learnings
          return {
            summary: textContent.text.slice(0, 1000),
            learnings: "- No structured learnings extracted"
          }
        }

        return parsed
      })

    const exportLearningsToFile = (learnings: string, targetFile: string): Effect.Effect<void, DatabaseError> =>
      Effect.try({
        try: () => {
          const filePath = resolve(process.cwd(), targetFile)
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
          // If file export fails, we fail loudly here before any DB changes.
          // See task tx-b2aa12e1 and regression test in compaction.test.ts.
          if (shouldExportToMarkdown) {
            yield* exportLearningsToFile(learnings, outputFile)
          }

          // Transaction: store log (optionally with learnings) + delete tasks atomically
          yield* Effect.try({
            try: () => {
              db.exec("BEGIN IMMEDIATE")
              try {
                if (shouldStoreInDatabase) {
                  // Insert compaction log
                  // When outputMode is 'both', store learnings in DB as backup
                  // When outputMode is 'database', learnings are stored only in DB
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
                throw e
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

      isAvailable: () => Effect.succeed(hasApiKey)
    }
  })
)

/**
 * Auto-detecting layer that selects the appropriate backend based on environment.
 *
 * Priority:
 * 1. ANTHROPIC_API_KEY set -> Use Live implementation
 * 2. Not set -> Use Noop (graceful degradation)
 */
export const CompactionServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    const anthropicKey = yield* Config.string("ANTHROPIC_API_KEY").pipe(Effect.option)

    if (Option.isSome(anthropicKey) && anthropicKey.value.trim().length > 0) {
      return CompactionServiceLive
    }

    return CompactionServiceNoop
  })
)
