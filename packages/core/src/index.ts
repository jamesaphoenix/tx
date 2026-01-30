/**
 * @tx/core - Core business logic for tx
 *
 * This package provides Effect-TS services and repositories for
 * task management, learnings, file-learnings, attempts, and sync.
 *
 * See DD-002 for design specification.
 */

// =============================================================================
// Errors
// =============================================================================
export {
  TaskNotFoundError,
  LearningNotFoundError,
  FileLearningNotFoundError,
  AttemptNotFoundError,
  ValidationError,
  CircularDependencyError,
  DatabaseError,
  EmbeddingUnavailableError
} from "./errors.js"

// =============================================================================
// Database
// =============================================================================
export {
  SqliteClient,
  SqliteClientLive,
  makeSqliteClient,
  getSchemaVersion,
  applyMigrations,
  type SqliteDatabase,
  type SqliteStatement
} from "./db.js"

// =============================================================================
// ID Generation
// =============================================================================
export { generateTaskId, fixtureId } from "./id.js"

// =============================================================================
// Layers
// =============================================================================
export {
  makeAppLayer,
  makeMinimalLayer,
  // Re-exports for convenience
  SyncService,
  MigrationService,
  AutoSyncService,
  AutoSyncServiceNoop,
  AutoSyncServiceLive,
  LearningService,
  FileLearningService,
  EmbeddingService,
  EmbeddingServiceNoop,
  EmbeddingServiceLive,
  EmbeddingServiceAuto,
  AttemptService,
  TaskService,
  DependencyService,
  ReadyService,
  HierarchyService,
  ScoreService
} from "./layer.js"

// =============================================================================
// Services (full exports)
// =============================================================================
export {
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  ScoreServiceLive,
  LearningServiceLive,
  FileLearningServiceLive,
  AttemptServiceLive,
  SyncServiceLive,
  MigrationServiceLive,
  MIGRATIONS,
  getLatestVersion,
  type ScoreBreakdown,
  type ExportResult,
  type ImportResult,
  type SyncStatus,
  type CompactResult,
  type ExportOptions,
  type ExportAllResult,
  type ImportAllResult,
  type Migration,
  type AppliedMigration,
  type MigrationStatus,
  type AutoSyncEntity
} from "./services/index.js"

// =============================================================================
// Repositories
// =============================================================================
export {
  TaskRepository,
  TaskRepositoryLive,
  DependencyRepository,
  DependencyRepositoryLive,
  LearningRepository,
  LearningRepositoryLive,
  type BM25Result,
  FileLearningRepository,
  FileLearningRepositoryLive,
  AttemptRepository,
  AttemptRepositoryLive,
  RunRepository,
  RunRepositoryLive
} from "./repo/index.js"

// =============================================================================
// Schemas
// =============================================================================
export * from "./schemas/index.js"

// =============================================================================
// Mappers
// =============================================================================
export {
  rowToTask,
  rowToDependency,
  isValidStatus,
  isValidTransition,
  VALID_TRANSITIONS,
  type TaskRow,
  type DependencyRow
} from "./mappers/task.js"

export {
  rowToLearning,
  float32ArrayToBuffer,
  type LearningRow
} from "./mappers/learning.js"

export {
  rowToFileLearning,
  type FileLearningRow
} from "./mappers/file-learning.js"

export {
  rowToAttempt,
  type AttemptRow
} from "./mappers/attempt.js"
