import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { MIGRATIONS, getLatestVersion } from "./migration-service.js"
import { TASK_STATUSES } from "@jamesaphoenix/tx-types"

/**
 * Severity level for validation issues.
 */
export type ValidationSeverity = "error" | "warning" | "info"

/**
 * A single validation issue found during validation.
 */
export interface ValidationIssue {
  readonly check: string
  readonly severity: ValidationSeverity
  readonly message: string
  readonly details?: Record<string, unknown>
}

/**
 * Result of a single validation check.
 */
export interface CheckResult {
  readonly name: string
  readonly passed: boolean
  readonly issues: readonly ValidationIssue[]
  readonly fixable: boolean
  readonly fixed?: number
}

/**
 * Overall validation result.
 */
export interface ValidationResult {
  readonly valid: boolean
  readonly checks: readonly CheckResult[]
  readonly issueCount: {
    readonly error: number
    readonly warning: number
    readonly info: number
  }
  readonly fixedCount: number
}

/**
 * Options for running validation.
 */
export interface ValidateOptions {
  readonly fix?: boolean
}

/**
 * ValidationService performs pre-flight database checks.
 * Follows Effect-TS patterns per DD-002.
 */
export class ValidationService extends Context.Tag("ValidationService")<
  ValidationService,
  {
    /**
     * Run all validation checks.
     * Returns a summary of issues found.
     */
    readonly validate: (options?: ValidateOptions) => Effect.Effect<ValidationResult, DatabaseError>

    /**
     * Run SQLite integrity check.
     */
    readonly checkIntegrity: () => Effect.Effect<CheckResult, DatabaseError>

    /**
     * Verify schema version matches latest migration.
     */
    readonly checkSchemaVersion: () => Effect.Effect<CheckResult, DatabaseError>

    /**
     * Check foreign key constraints.
     */
    readonly checkForeignKeys: () => Effect.Effect<CheckResult, DatabaseError>

    /**
     * Detect orphaned dependencies (referencing non-existent tasks).
     */
    readonly checkOrphanedDependencies: (fix?: boolean) => Effect.Effect<CheckResult, DatabaseError>

    /**
     * Scan for invalid status values.
     */
    readonly checkInvalidStatuses: (fix?: boolean) => Effect.Effect<CheckResult, DatabaseError>

    /**
     * Check for missing task references in parent_id.
     */
    readonly checkMissingParentRefs: (fix?: boolean) => Effect.Effect<CheckResult, DatabaseError>
  }
>() {}

export const ValidationServiceLive = Layer.effect(
  ValidationService,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    const checkIntegrity = (): Effect.Effect<CheckResult, DatabaseError> =>
      Effect.try({
        try: () => {
          const rows = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>
          const issues: ValidationIssue[] = []

          for (const row of rows) {
            if (row.integrity_check !== "ok") {
              issues.push({
                check: "integrity",
                severity: "error",
                message: row.integrity_check
              })
            }
          }

          return {
            name: "Database Integrity",
            passed: issues.length === 0,
            issues,
            fixable: false
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const checkSchemaVersion = (): Effect.Effect<CheckResult, DatabaseError> =>
      Effect.try({
        try: () => {
          const issues: ValidationIssue[] = []
          const latestVersion = getLatestVersion()

          // Get current schema version
          let currentVersion = 0
          try {
            const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number } | null
            currentVersion = row?.version ?? 0
          } catch {
            // Table doesn't exist
            issues.push({
              check: "schema_version",
              severity: "error",
              message: "schema_version table does not exist"
            })
            return {
              name: "Schema Version",
              passed: false,
              issues,
              fixable: true
            }
          }

          if (currentVersion < latestVersion) {
            issues.push({
              check: "schema_version",
              severity: "warning",
              message: `Schema is outdated: current=${currentVersion}, latest=${latestVersion}`,
              details: {
                currentVersion,
                latestVersion,
                pendingMigrations: MIGRATIONS.filter(m => m.version > currentVersion).length
              }
            })
          }

          if (currentVersion > latestVersion) {
            issues.push({
              check: "schema_version",
              severity: "error",
              message: `Schema version is ahead of known migrations: current=${currentVersion}, latest=${latestVersion}`,
              details: { currentVersion, latestVersion }
            })
          }

          return {
            name: "Schema Version",
            passed: issues.filter(i => i.severity === "error").length === 0,
            issues,
            fixable: currentVersion < latestVersion
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const checkForeignKeys = (): Effect.Effect<CheckResult, DatabaseError> =>
      Effect.try({
        try: () => {
          const issues: ValidationIssue[] = []

          // Check if foreign keys are enabled
          const fkEnabled = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number } | null
          if (!fkEnabled || fkEnabled.foreign_keys !== 1) {
            issues.push({
              check: "foreign_keys",
              severity: "warning",
              message: "Foreign keys are not enabled"
            })
          }

          // Run foreign key check
          const violations = db.prepare("PRAGMA foreign_key_check").all() as Array<{
            table: string
            rowid: number
            parent: string
            fkid: number
          }>

          for (const violation of violations) {
            issues.push({
              check: "foreign_keys",
              severity: "error",
              message: `Foreign key violation in ${violation.table} row ${violation.rowid} referencing ${violation.parent}`,
              details: violation
            })
          }

          return {
            name: "Foreign Key Constraints",
            passed: violations.length === 0,
            issues,
            fixable: false
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const checkOrphanedDependencies = (fix = false): Effect.Effect<CheckResult, DatabaseError> =>
      Effect.try({
        try: () => {
          const issues: ValidationIssue[] = []
          let fixed = 0

          // Find dependencies where blocker or blocked task doesn't exist
          // This shouldn't happen with ON DELETE CASCADE, but can occur from manual edits or corruption
          const orphanedBlockers = db.prepare(`
            SELECT td.id, td.blocker_id, td.blocked_id
            FROM task_dependencies td
            LEFT JOIN tasks t ON t.id = td.blocker_id
            WHERE t.id IS NULL
          `).all() as Array<{ id: number; blocker_id: string; blocked_id: string }>

          const orphanedBlocked = db.prepare(`
            SELECT td.id, td.blocker_id, td.blocked_id
            FROM task_dependencies td
            LEFT JOIN tasks t ON t.id = td.blocked_id
            WHERE t.id IS NULL
          `).all() as Array<{ id: number; blocker_id: string; blocked_id: string }>

          for (const row of orphanedBlockers) {
            issues.push({
              check: "orphaned_dependencies",
              severity: "error",
              message: `Dependency ${row.id} references non-existent blocker task ${row.blocker_id}`,
              details: row
            })
          }

          for (const row of orphanedBlocked) {
            issues.push({
              check: "orphaned_dependencies",
              severity: "error",
              message: `Dependency ${row.id} references non-existent blocked task ${row.blocked_id}`,
              details: row
            })
          }

          if (fix && issues.length > 0) {
            // Delete orphaned dependencies
            const orphanedIds = [...orphanedBlockers, ...orphanedBlocked].map(r => r.id)
            const uniqueIds = [...new Set(orphanedIds)]
            if (uniqueIds.length > 0) {
              const result = db.prepare(`
                DELETE FROM task_dependencies
                WHERE id IN (${uniqueIds.map(() => "?").join(",")})
              `).run(...uniqueIds)
              fixed = result.changes
            }
          }

          return {
            name: "Orphaned Dependencies",
            passed: issues.length === 0,
            issues,
            fixable: true,
            fixed: fix ? fixed : undefined
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const checkInvalidStatuses = (fix = false): Effect.Effect<CheckResult, DatabaseError> =>
      Effect.try({
        try: () => {
          const issues: ValidationIssue[] = []
          let fixed = 0

          // Find tasks with invalid status values
          const validStatuses = TASK_STATUSES
          const placeholders = validStatuses.map(() => "?").join(",")

          const invalidTasks = db.prepare(`
            SELECT id, status FROM tasks WHERE status NOT IN (${placeholders})
          `).all(...validStatuses) as Array<{ id: string; status: string }>

          for (const task of invalidTasks) {
            issues.push({
              check: "invalid_status",
              severity: "error",
              message: `Task ${task.id} has invalid status '${task.status}'`,
              details: { id: task.id, status: task.status, validStatuses }
            })
          }

          if (fix && issues.length > 0) {
            // Reset invalid statuses to 'backlog' (safe default)
            const result = db.prepare(`
              UPDATE tasks SET status = 'backlog', updated_at = datetime('now')
              WHERE status NOT IN (${placeholders})
            `).run(...validStatuses)
            fixed = result.changes
          }

          return {
            name: "Task Status Values",
            passed: issues.length === 0,
            issues,
            fixable: true,
            fixed: fix ? fixed : undefined
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const checkMissingParentRefs = (fix = false): Effect.Effect<CheckResult, DatabaseError> =>
      Effect.try({
        try: () => {
          const issues: ValidationIssue[] = []
          let fixed = 0

          // Find tasks referencing non-existent parents
          const orphanedChildren = db.prepare(`
            SELECT t.id, t.parent_id
            FROM tasks t
            LEFT JOIN tasks p ON p.id = t.parent_id
            WHERE t.parent_id IS NOT NULL AND p.id IS NULL
          `).all() as Array<{ id: string; parent_id: string }>

          for (const task of orphanedChildren) {
            issues.push({
              check: "missing_parent_refs",
              severity: "error",
              message: `Task ${task.id} references non-existent parent ${task.parent_id}`,
              details: { id: task.id, parentId: task.parent_id }
            })
          }

          if (fix && issues.length > 0) {
            // Clear orphaned parent references
            const result = db.prepare(`
              UPDATE tasks SET parent_id = NULL, updated_at = datetime('now')
              WHERE parent_id IS NOT NULL
              AND parent_id NOT IN (SELECT id FROM tasks)
            `).run()
            fixed = result.changes
          }

          return {
            name: "Missing Parent References",
            passed: issues.length === 0,
            issues,
            fixable: true,
            fixed: fix ? fixed : undefined
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const validate = (options?: ValidateOptions): Effect.Effect<ValidationResult, DatabaseError> =>
      Effect.gen(function* () {
        const fix = options?.fix ?? false

        // Run all checks
        const checks: CheckResult[] = []

        checks.push(yield* checkIntegrity())
        checks.push(yield* checkSchemaVersion())
        checks.push(yield* checkForeignKeys())
        checks.push(yield* checkOrphanedDependencies(fix))
        checks.push(yield* checkInvalidStatuses(fix))
        checks.push(yield* checkMissingParentRefs(fix))

        // Count issues by severity
        const issueCount = { error: 0, warning: 0, info: 0 }
        let fixedCount = 0

        for (const check of checks) {
          for (const issue of check.issues) {
            issueCount[issue.severity]++
          }
          if (check.fixed !== undefined) {
            fixedCount += check.fixed
          }
        }

        const valid = issueCount.error === 0

        return {
          valid,
          checks,
          issueCount,
          fixedCount
        }
      })

    return {
      validate,
      checkIntegrity,
      checkSchemaVersion,
      checkForeignKeys,
      checkOrphanedDependencies,
      checkInvalidStatuses,
      checkMissingParentRefs
    }
  })
)
