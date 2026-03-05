/**
 * Shared Sync service result types.
 */

/**
 * Result of a dependency import operation.
 */
export type DependencyImportResult = {
  readonly added: number
  readonly removed: number
  readonly skipped: number
  readonly failures: ReadonlyArray<{ blockerId: string; blockedId: string; error: string }>
}

/**
 * Result of an import operation.
 */
export type ImportResult = {
  readonly imported: number
  readonly skipped: number
  readonly conflicts: number
  readonly dependencies: DependencyImportResult
}

/**
 * Result of importing a simple entity (no dependency sub-results).
 */
export type EntityImportResult = {
  readonly imported: number
  readonly skipped: number
}

/**
 * Status of the sync system.
 */
export type SyncStatus = {
  readonly dbTaskCount: number
  readonly eventOpCount: number
  readonly lastExport: Date | null
  readonly lastImport: Date | null
  readonly isDirty: boolean
  readonly autoSyncEnabled: boolean
}

/**
 * Result of event-log export.
 */
export type SyncExportResult = {
  readonly eventCount: number
  readonly opCount: number
  readonly streamId: string
  readonly path: string
}

/**
 * Result of legacy task JSONL export.
 */
export type LegacySyncExportResult = {
  readonly opCount: number
  readonly path: string
}

/**
 * Result of incremental event import.
 */
export type SyncImportResult = {
  readonly importedEvents: number
  readonly appliedEvents: number
  readonly streamCount: number
  readonly imported: number
  readonly skipped: number
  readonly conflicts: number
  readonly dependencies: DependencyImportResult
}

/**
 * Result of full event rehydration.
 */
export type SyncHydrateResult = {
  readonly importedEvents: number
  readonly appliedEvents: number
  readonly streamCount: number
  readonly rebuilt: boolean
}

/**
 * Result of compacting legacy task JSONL operations.
 */
export type SyncCompactResult = {
  readonly before: number
  readonly after: number
  readonly path: string
}

/**
 * Stream metadata for sync.
 */
export type SyncStreamInfoResult = {
  readonly streamId: string
  readonly nextSeq: number
  readonly lastSeq: number
  readonly eventsDir: string
  readonly configPath: string
  readonly knownStreams: ReadonlyArray<{ streamId: string; lastSeq: number; lastEventAt: string | null }>
}
