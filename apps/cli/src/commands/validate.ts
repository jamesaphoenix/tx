/**
 * Validate command: Pre-flight database health checks
 */

import { Effect } from "effect"
import { ValidationService } from "@jamesaphoenix/tx-core"
import type { ValidationResult, CheckResult } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

/**
 * Format a severity level with appropriate styling.
 */
function formatSeverity(severity: string): string {
  switch (severity) {
    case "error":
      return "\u274c ERROR"
    case "warning":
      return "\u26a0  WARN"
    case "info":
      return "\u2139  INFO"
    default:
      return severity.toUpperCase()
  }
}

/**
 * Format a check result for display.
 */
function formatCheck(check: CheckResult): string {
  const status = check.passed ? "\u2713" : "\u2717"
  const lines: string[] = []

  let summary = `${status} ${check.name}`
  if (check.fixed !== undefined && check.fixed > 0) {
    summary += ` (${check.fixed} fixed)`
  }
  lines.push(summary)

  for (const issue of check.issues) {
    lines.push(`    ${formatSeverity(issue.severity)}: ${issue.message}`)
  }

  return lines.join("\n")
}

/**
 * Format the overall validation result.
 */
function formatResult(result: ValidationResult): string {
  const lines: string[] = []

  // Header
  lines.push("tx validate - Database Health Check")
  lines.push("=" .repeat(40))
  lines.push("")

  // Individual checks
  for (const check of result.checks) {
    lines.push(formatCheck(check))
    lines.push("")
  }

  // Summary
  lines.push("-".repeat(40))
  if (result.valid) {
    lines.push("\u2705 Database is valid")
  } else {
    lines.push("\u274c Validation failed")
  }

  const { error, warning, info } = result.issueCount
  const parts: string[] = []
  if (error > 0) parts.push(`${error} error(s)`)
  if (warning > 0) parts.push(`${warning} warning(s)`)
  if (info > 0) parts.push(`${info} info`)

  if (parts.length > 0) {
    lines.push(`   Issues: ${parts.join(", ")}`)
  }

  if (result.fixedCount > 0) {
    lines.push(`   Fixed: ${result.fixedCount} issue(s)`)
  }

  return lines.join("\n")
}

export const validate = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* ValidationService

    const fix = flag(flags, "fix")
    const result = yield* svc.validate({ fix })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(formatResult(result))
    }

    // Exit with code 1 if validation failed (errors found)
    if (!result.valid) {
      process.exit(1)
    }
  })
