/**
 * Claude Code task directory writer.
 *
 * Pure functions that transform TaskWithDeps[] into Claude Code's
 * on-disk task format (individual JSON files per task).
 *
 * Claude Code stores team tasks at ~/.claude/tasks/{team-name}/
 * with files: {id}.json, .highwatermark, .lock
 */

import { Schema } from "effect"
import type { TaskWithDeps, TaskId } from "@jamesaphoenix/tx-types"

// =============================================================================
// Types
// =============================================================================

const ClaudeTaskStatusSchema = Schema.Literal("pending", "in_progress", "completed")

/** A single Claude Code task file (written as {id}.json) */
export const ClaudeTaskFileSchema = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  description: Schema.String,
  activeForm: Schema.String,
  status: ClaudeTaskStatusSchema,
  blocks: Schema.Array(Schema.String),
  blockedBy: Schema.Array(Schema.String),
})
export type ClaudeTaskFile = typeof ClaudeTaskFileSchema.Type

/** Result of building Claude task files from tx tasks */
export const ClaudeSyncResultSchema = Schema.Struct({
  files: Schema.Array(ClaudeTaskFileSchema),
  highwatermark: Schema.Number,
})
export type ClaudeSyncResult = typeof ClaudeSyncResultSchema.Type & {
  /** Mapping from tx task ID to Claude numeric ID (for debugging) */
  readonly txIdMap: ReadonlyMap<string, string>
}

// =============================================================================
// Status Mapping
// =============================================================================

function mapStatus(txStatus: string): "pending" | "in_progress" {
  switch (txStatus) {
    case "active":
    case "review":
    case "human_needs_to_review":
      return "in_progress"
    default:
      return "pending"
  }
}

// =============================================================================
// Description Builder
// =============================================================================

function buildClaudeDescription(
  task: TaskWithDeps,
  txIdMap: ReadonlyMap<string, string>,
): string {
  const lines: string[] = []

  if (task.description) {
    lines.push(task.description)
    lines.push("")
  }

  lines.push("---")
  lines.push(`**tx ID**: ${task.id} | **Priority**: ${task.score} | **Status**: ${task.status}`)

  if (task.blockedBy.length > 0) {
    const refs = task.blockedBy.map((id: TaskId) => {
      const numId = txIdMap.get(id as string)
      return numId ? `#${numId} (${id})` : `${id}`
    })
    lines.push(`**Blocked by**: ${refs.join(", ")}`)
  }
  if (task.blocks.length > 0) {
    const refs = task.blocks.map((id: TaskId) => {
      const numId = txIdMap.get(id as string)
      return numId ? `#${numId} (${id})` : `${id}`
    })
    lines.push(`**Blocks**: ${refs.join(", ")}`)
  }
  if (task.parentId) {
    lines.push(`**Parent**: ${task.parentId}`)
  }
  if (task.children.length > 0) {
    lines.push(`**Children**: ${task.children.join(", ")}`)
  }

  lines.push("")
  lines.push(`Run \`tx context ${task.id}\` for relevant learnings before starting.`)
  lines.push(`Run \`tx done ${task.id}\` when complete.`)

  return lines.join("\n")
}

// =============================================================================
// Main Builder
// =============================================================================

/**
 * Transform tx tasks into Claude Code task files.
 *
 * - Filters out done tasks
 * - Sorts: ready tasks first (highest score first), then non-ready by score
 * - Assigns sequential numeric IDs
 * - Maps blockedBy/blocks references to numeric IDs
 */
export function buildClaudeTaskFiles(tasks: readonly TaskWithDeps[]): ClaudeSyncResult {
  // Filter out done tasks
  const nonDone = tasks.filter(t => t.status !== "done")

  // Sort: ready first (highest score), then non-ready (highest score)
  // Tie-break by tx ID for deterministic ordering across syncs
  const sorted = [...nonDone].sort((a, b) => {
    if (a.isReady !== b.isReady) {
      return a.isReady ? -1 : 1
    }
    if (a.score !== b.score) {
      return b.score - a.score
    }
    return (a.id as string).localeCompare(b.id as string)
  })

  // Build tx ID -> numeric ID mapping
  const txIdMap = new Map<string, string>()
  for (let i = 0; i < sorted.length; i++) {
    txIdMap.set(sorted[i].id as string, String(i + 1))
  }

  // Build task files
  const files: ClaudeTaskFile[] = sorted.map((task, i) => {
    const numericId = String(i + 1)

    // Map blockedBy/blocks to numeric IDs, filtering out done tasks
    const blockedBy = task.blockedBy
      .map((id: TaskId) => txIdMap.get(id as string))
      .filter((id): id is string => id !== undefined)

    const blocks = task.blocks
      .map((id: TaskId) => txIdMap.get(id as string))
      .filter((id): id is string => id !== undefined)

    return {
      id: numericId,
      subject: task.title,
      description: buildClaudeDescription(task, txIdMap),
      activeForm: `Working on ${task.id}: ${task.title}`,
      status: mapStatus(task.status),
      blocks,
      blockedBy,
    }
  })

  return {
    files,
    highwatermark: files.length + 1,
    txIdMap,
  }
}
