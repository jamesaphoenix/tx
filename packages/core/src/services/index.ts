/**
 * @tx/core/services - Service exports
 */

export { TaskService, TaskServiceLive } from "./task-service.js"
export { DependencyService, DependencyServiceLive } from "./dep-service.js"
export { ReadyService, ReadyServiceLive } from "./ready-service.js"
export { HierarchyService, HierarchyServiceLive } from "./hierarchy-service.js"
export { ScoreService, ScoreServiceLive, type ScoreBreakdown } from "./score-service.js"
export {
  SyncService,
  SyncServiceLive,
  type ImportResult,
  type LegacySyncExportResult,
  type SyncCompactResult,
  type SyncExportResult,
  type SyncImportResult,
  type SyncHydrateResult,
  type SyncStreamInfoResult,
  type SyncStatus,
  type DependencyImportResult
} from "./sync/index.js"
export {
  StreamService,
  StreamServiceLive,
  type StreamInfo,
  type StreamProgress
} from "./stream-service.js"
export {
  MigrationService,
  MigrationServiceLive,
  MIGRATIONS,
  EMBEDDED_MIGRATIONS,
  getLatestVersion,
  type Migration,
  type AppliedMigration,
  type MigrationStatus
} from "./migration-service.js"
export {
  AutoSyncService,
  AutoSyncServiceLive,
  AutoSyncServiceNoop,
  type AutoSyncEntity
} from "./auto-sync-service.js"
export {
  ValidationService,
  ValidationServiceLive,
  type ValidationSeverity,
  type ValidationIssue,
  type CheckResult,
  type ValidationResult,
  type ValidateOptions
} from "./validation-service.js"
export {
  DocService,
  DocServiceLive
} from "./doc-service.js"
export {
  SPEC_BATCH_MAX_BYTES,
  SPEC_BATCH_MAX_RECORDS,
  SpecTraceService,
  SpecTraceServiceLive,
  parseBatchRunInput,
  type BatchSource,
  type BatchRunResult,
  type SpecTraceStatus,
} from "./spec-trace-service.js"
export { DecisionService, DecisionServiceLive } from "./decision-service.js"

export { getSpecHealth, SpecHealthSchema, type SpecHealth } from "./spec-health.js"
