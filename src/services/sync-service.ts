import { Context, Effect } from "effect"
import { DatabaseError, ValidationError } from "../errors.js"

/**
 * Result of an export operation.
 */
export interface ExportResult {
  readonly opCount: number
  readonly path: string
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  readonly imported: number
  readonly skipped: number
  readonly conflicts: number
}

/**
 * Status of the sync system.
 */
export interface SyncStatus {
  readonly dbTaskCount: number
  readonly jsonlOpCount: number
  readonly lastExport: Date | null
  readonly lastImport: Date | null
  readonly isDirty: boolean
}

/**
 * SyncService provides JSONL-based export/import for git-tracked task syncing.
 * See DD-009 for full specification.
 */
export class SyncService extends Context.Tag("SyncService")<
  SyncService,
  {
    /**
     * Export all tasks and dependencies to JSONL file.
     * @param path Optional path (default: .tx/tasks.jsonl)
     */
    readonly export: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import tasks and dependencies from JSONL file.
     * Uses timestamp-based conflict resolution (later wins).
     * @param path Optional path (default: .tx/tasks.jsonl)
     */
    readonly import: (path?: string) => Effect.Effect<ImportResult, ValidationError | DatabaseError>

    /**
     * Get current sync status.
     */
    readonly status: () => Effect.Effect<SyncStatus, DatabaseError>
  }
>() {}
