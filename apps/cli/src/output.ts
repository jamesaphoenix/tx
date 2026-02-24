/**
 * Output formatters for JSON/text CLI output
 */

import type { TaskWithDeps, LearningWithScore, ContextResult } from "@jamesaphoenix/tx-types"

// --- JSON serializer (handles Date objects) ---

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

export function toJson(data: unknown): string {
  return JSON.stringify(data, jsonReplacer, 2)
}

// --- Task formatters ---

export function formatTaskWithDeps(t: TaskWithDeps): string {
  const lines = [
    `Task: ${t.id}`,
    `  Title: ${t.title}`,
    `  Status: ${t.status}`,
    `  Score: ${t.score}`,
    `  Ready: ${t.isReady ? "yes" : "no"}`,
  ]
  if (t.description) lines.push(`  Description: ${t.description}`)
  if (t.parentId) lines.push(`  Parent: ${t.parentId}`)
  lines.push(`  Group Context: ${t.groupContext ?? "(none)"}`)
  lines.push(`  Effective Group Context: ${t.effectiveGroupContext ?? "(none)"}`)
  lines.push(`  Effective Group Source: ${t.effectiveGroupContextSourceTaskId ?? "(none)"}`)
  lines.push(`  Blocked by: ${t.blockedBy.length > 0 ? t.blockedBy.join(", ") : "(none)"}`)
  lines.push(`  Blocks: ${t.blocks.length > 0 ? t.blocks.join(", ") : "(none)"}`)
  lines.push(`  Children: ${t.children.length > 0 ? t.children.join(", ") : "(none)"}`)
  lines.push(`  Created: ${t.createdAt.toISOString()}`)
  lines.push(`  Updated: ${t.updatedAt.toISOString()}`)
  if (t.completedAt) lines.push(`  Completed: ${t.completedAt.toISOString()}`)
  return lines.join("\n")
}

export function formatTaskLine(t: TaskWithDeps): string {
  const readyMark = t.isReady ? "+" : " "
  return `  ${readyMark} ${t.id} [${t.status}] [${t.score}] ${t.title}`
}

export function formatReadyTaskLine(t: TaskWithDeps): string {
  const blocksInfo = t.blocks.length > 0 ? ` (unblocks ${t.blocks.length})` : ""
  const contextInfo = t.effectiveGroupContext ? " [ctx]" : ""
  return `  ${t.id} [${t.score}] ${t.title}${blocksInfo}${contextInfo}`
}

// --- Context formatter ---

export function formatContextMarkdown(result: ContextResult): string {
  const lines = [
    `## Contextual Learnings for ${result.taskId}`,
    ``,
    `Task: ${result.taskTitle}`,
    ``,
    `### Relevant Learnings`,
    ``
  ]

  if (result.learnings.length === 0) {
    lines.push("_No relevant learnings found._")
  } else {
    for (const l of result.learnings) {
      const score = (l.relevanceScore * 100).toFixed(0)
      const category = l.category ? ` [${l.category}]` : ""
      lines.push(`- **${score}%**${category} ${l.content}`)
    }
  }

  lines.push("")
  return lines.join("\n")
}

// --- Learning formatters ---

export function formatLearningSearchResult(r: LearningWithScore): string {
  const score = (r.relevanceScore * 100).toFixed(0)
  const category = r.category ? ` [${r.category}]` : ""
  return `  #${r.id} (${score}%)${category} ${r.content}`
}

// --- Helpers ---

export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str
}
