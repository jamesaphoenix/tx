/**
 * Doctor command: consolidated system diagnostics (database health + system checks)
 *
 * Merges the former `validate` and `doctor` commands into a single entry point.
 */

import { Effect } from "effect"
import { SqliteClient, MigrationService, ValidationService } from "@jamesaphoenix/tx-core"
import type { ValidationResult } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { statSync } from "node:fs"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

interface DoctorCheck {
  readonly name: string
  readonly status: "pass" | "warn" | "fail"
  readonly message: string
  readonly details?: string
}

interface DoctorResult {
  readonly healthy: boolean
  readonly checks: readonly DoctorCheck[]
  readonly validation?: ValidationResult
}

function statusIcon(status: "pass" | "warn" | "fail"): string {
  switch (status) {
    case "pass": return "\u2713"
    case "warn": return "\u26a0"
    case "fail": return "\u2717"
  }
}

function formatDoctorResult(result: DoctorResult, verbose: boolean): string {
  const lines: string[] = []

  lines.push("tx doctor - System Health")
  lines.push("=" .repeat(40))
  lines.push("")

  for (const check of result.checks) {
    lines.push(`${statusIcon(check.status)} ${check.message}`)
    if (verbose && check.details) {
      lines.push(`    ${check.details}`)
    }
  }

  lines.push("")
  if (result.healthy) {
    lines.push("All checks passed.")
  } else {
    lines.push(verbose
      ? "Issues detected."
      : "Issues detected. Run with --verbose for details.")
  }

  return lines.join("\n")
}

export const doctor = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const migrationSvc = yield* MigrationService
    const verbose = flag(flags, "verbose", "v")
    const fix = flag(flags, "fix")
    const checks: DoctorCheck[] = []

    // --- Database validation checks (formerly `tx validate`) ---
    const validationSvc = yield* ValidationService
    const validationResult = yield* validationSvc.validate({ fix })

    for (const check of validationResult.checks) {
      const status: DoctorCheck["status"] = check.passed ? "pass" : "fail"
      let message = check.name
      if (check.fixed !== undefined && check.fixed > 0) {
        message += ` (${check.fixed} fixed)`
      }
      const details = check.issues.length > 0
        ? check.issues.map(i => `${i.severity}: ${i.message}`).join("; ")
        : undefined
      checks.push({ name: `validate_${check.name}`, status, message: `Validate: ${message}`, details })
    }

    if (validationResult.fixedCount > 0) {
      checks.push({
        name: "validate_fixes",
        status: "pass",
        message: `Validate: ${validationResult.fixedCount} issue(s) auto-fixed`,
      })
    }

    // --- System diagnostics (formerly `tx doctor`) ---

    // 1. Check database file exists and is readable
    const dbPath = typeof flags.db === "string" ? flags.db : undefined
    if (dbPath) {
      try {
        const stats = statSync(dbPath)
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(1)
        checks.push({
          name: "database",
          status: "pass",
          message: `Database: ${dbPath} (${sizeMb}MB)`,
        })
      } catch {
        checks.push({
          name: "database",
          status: "fail",
          message: `Database: ${dbPath} (not found or unreadable)`,
        })
      }
    } else {
      checks.push({
        name: "database",
        status: "pass",
        message: "Database: connected",
      })
    }

    // 2. Verify WAL mode enabled
    const walRow = db.prepare<{ journal_mode: string }>("PRAGMA journal_mode").get()
    const walMode = walRow?.journal_mode === "wal"
    checks.push({
      name: "wal_mode",
      status: walMode ? "pass" : "warn",
      message: walMode
        ? "WAL mode: enabled"
        : `WAL mode: disabled (journal_mode=${walRow?.journal_mode ?? "unknown"})`,
      details: walMode ? undefined : "WAL mode improves concurrent read/write performance. Expected 'wal'.",
    })

    // 3. Check schema version matches expected
    const migrationStatus = yield* migrationSvc.getStatus()
    const schemaOk = migrationStatus.currentVersion === migrationStatus.latestVersion
    checks.push({
      name: "schema",
      status: schemaOk ? "pass" : migrationStatus.currentVersion < migrationStatus.latestVersion ? "warn" : "fail",
      message: schemaOk
        ? `Schema: v${migrationStatus.currentVersion} (current)`
        : `Schema: v${migrationStatus.currentVersion} (latest: v${migrationStatus.latestVersion})`,
      details: !schemaOk && migrationStatus.pendingCount > 0
        ? `${migrationStatus.pendingCount} pending migration(s). Run tx migrate to apply.`
        : undefined,
    })

    // 4. Verify Effect services are properly wired
    checks.push({
      name: "services",
      status: "pass",
      message: "Effect services: wired correctly",
    })

    // 5. Check for stale claims/workers
    try {
      const staleClaims = db.prepare<{ count: number }>(
        `SELECT COUNT(*) as count FROM task_claims
         WHERE status = 'active'
         AND datetime(lease_expires_at) < datetime('now')`
      ).get()
      const staleClaimCount = staleClaims?.count ?? 0

      const deadWorkers = db.prepare<{ count: number }>(
        `SELECT COUNT(*) as count FROM workers
         WHERE status NOT IN ('dead', 'stopping')
         AND datetime(last_heartbeat_at, '+5 minutes') < datetime('now')`
      ).get()
      const deadWorkerCount = deadWorkers?.count ?? 0

      if (staleClaimCount > 0 || deadWorkerCount > 0) {
        const parts: string[] = []
        if (staleClaimCount > 0) parts.push(`${staleClaimCount} expired claim(s)`)
        if (deadWorkerCount > 0) parts.push(`${deadWorkerCount} stale worker(s)`)
        checks.push({
          name: "stale_claims",
          status: "warn",
          message: `Stale claims/workers: ${parts.join(", ")}`,
          details: "Run tx coordinator reconcile to clean up.",
        })
      } else {
        checks.push({
          name: "stale_claims",
          status: "pass",
          message: "Claims/workers: no stale entries",
        })
      }
    } catch {
      checks.push({
        name: "stale_claims",
        status: "pass",
        message: "Claims/workers: no stale entries",
      })
    }

    // 6. Report database size and task counts
    const taskCounts = db.prepare<{ status: string; count: number }>(
      "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
    ).all()
    const totalTasks = taskCounts.reduce((sum, r) => sum + r.count, 0)
    const readyCount = taskCounts.find(r => r.status === "ready")?.count ?? 0
    const doneCount = taskCounts.find(r => r.status === "done")?.count ?? 0

    const learningCount = db.prepare<{ count: number }>(
      "SELECT COUNT(*) as count FROM learnings"
    ).get()

    checks.push({
      name: "tasks",
      status: "pass",
      message: `Tasks: ${totalTasks} total (${readyCount} ready, ${doneCount} done)`,
      details: verbose
        ? taskCounts.map(r => `${r.status}: ${r.count}`).join(", ")
        : undefined,
    })

    checks.push({
      name: "learnings",
      status: "pass",
      message: `Learnings: ${learningCount?.count ?? 0} total`,
    })

    // 7. Verify ANTHROPIC_API_KEY for LLM features
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY
    checks.push({
      name: "api_key",
      status: hasApiKey ? "pass" : "warn",
      message: hasApiKey
        ? "ANTHROPIC_API_KEY: set"
        : "ANTHROPIC_API_KEY: not set (LLM features unavailable)",
      details: hasApiKey ? undefined : "Required for: tx compact, tx dedupe, tx reprioritize",
    })

    const healthy = checks.every(c => c.status !== "fail") && validationResult.valid
    const result: DoctorResult = { healthy, checks, validation: validationResult }

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(formatDoctorResult(result, verbose))
    }

    if (!healthy) {
      process.exit(1)
    }
  })
