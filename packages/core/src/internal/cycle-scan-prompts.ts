/**
 * Prompt composition and JSON schema constants for CycleScanService.
 */

import { resolve } from "node:path"
import { readFileSync, existsSync, statSync } from "node:fs"
import { randomBytes } from "node:crypto"
import type { Finding } from "../types/index.js"

// =============================================================================
// JSON Schemas for Structured Output
// =============================================================================

export const FINDINGS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, descriptive issue title" },
          description: { type: "string", description: "Detailed explanation of the issue and why it matters" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          issueType: { type: "string", description: "Category: bug, anti-pattern, security, performance, testing, ddd, etc." },
          file: { type: "string", description: "File path relative to project root" },
          line: { type: "number", description: "Approximate line number" },
        },
        required: ["title", "description", "severity", "issueType", "file", "line"],
      },
    },
  },
  required: ["findings"],
}

export const DEDUP_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    newIssues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          issueType: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
        },
        required: ["title", "description", "severity", "issueType", "file", "line"],
      },
    },
    duplicates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          findingIdx: { type: "number", description: "Index into the findings array" },
          existingIssueId: { type: "string", description: "Task ID of the existing issue this duplicates" },
          reason: { type: "string", description: "Why this is considered a duplicate" },
        },
        required: ["findingIdx", "existingIssueId", "reason"],
      },
    },
  },
  required: ["newIssues", "duplicates"],
}

// =============================================================================
// Prompt Composition
// =============================================================================

export function composeScanPrompt(task: string, scan: string): string {
  return `## Context
${task}

## Your Mission
${scan}

## Instructions
Explore the codebase thoroughly using Read, Glob, and Grep.
Look for real issues — not style nits. Focus on bugs, logic errors,
missing error handling, security vulnerabilities, and structural problems.

Return your findings as structured JSON. Only report issues you are
confident about after reading the actual code.`
}

export function composeDedupPrompt(
  findings: readonly Finding[],
  existingIssues: Array<{ id: string; title: string; description: string; severity: string; file: string; line: number }>
): string {
  return `## Task
Compare these new findings against known issues. Return only genuinely new issues.

## New Findings (${findings.length} total)
${JSON.stringify(findings, null, 2)}

## Known Issues (${existingIssues.length} total)
${JSON.stringify(existingIssues, null, 2)}

## Instructions
For each new finding, check if it describes the same problem as any known issue.
Use semantic understanding — the same issue might be worded differently or reference
a slightly different line number in the same file. Be conservative: if in doubt,
treat it as new rather than duplicate.

Return your analysis as structured JSON.`
}

export function composeFixPrompt(issues: readonly Finding[]): string {
  const issuesSummary = issues
    .map(
      (i, idx) =>
        `${idx + 1}. [${i.severity.toUpperCase()}] ${i.title} (${i.file}:${i.line})\n   ${i.description}`
    )
    .join("\n\n")
  return `## Task
Fix these ${issues.length} issues found in the codebase:

${issuesSummary}

## Instructions
Work through the issues above. For each one:
1. Read the relevant file to understand context
2. Make the minimal fix needed
3. Move to the next issue

Focus on correctness. Skip issues you're not confident about fixing safely.`
}

/** If `value` is a path to an existing file, return its contents; otherwise return `value` verbatim. */
export function resolvePrompt(value: string): string {
  const filePath = resolve(value)
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return readFileSync(filePath, "utf-8").trim()
  }
  return value
}

export function generateId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`
}
