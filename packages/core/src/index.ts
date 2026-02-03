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
  EmbeddingUnavailableError,
  EdgeNotFoundError,
  AnchorNotFoundError,
  CandidateNotFoundError,
  ExtractionUnavailableError,
  RerankerUnavailableError,
  RetrievalError,
  AstGrepError,
  DaemonError,
  // Orchestration errors (PRD-018)
  RegistrationError,
  WorkerNotFoundError,
  AlreadyClaimedError,
  ClaimNotFoundError,
  ClaimIdNotFoundError,
  LeaseExpiredError,
  MaxRenewalsExceededError,
  OrchestratorError
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
  EmbeddingServiceOpenAI,
  EmbeddingServiceAuto,
  createEmbedderLayer,
  type EmbedderConfig,
  AttemptService,
  TaskService,
  DependencyService,
  ReadyService,
  HierarchyService,
  ScoreService,
  DeduplicationService,
  DeduplicationServiceLive,
  DiversifierService,
  DiversifierServiceNoop,
  DiversifierServiceLive,
  DiversifierServiceAuto
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
  AnchorService,
  AnchorServiceLive,
  EdgeService,
  EdgeServiceLive,
  CandidateExtractorService,
  CandidateExtractorServiceNoop,
  CandidateExtractorServiceAnthropic,
  CandidateExtractorServiceOpenAI,
  CandidateExtractorServiceAuto,
  QueryExpansionService,
  QueryExpansionServiceNoop,
  QueryExpansionServiceLive,
  QueryExpansionServiceAuto,
  RerankerService,
  RerankerServiceNoop,
  RerankerServiceLive,
  RerankerServiceAuto,
  RetrieverService,
  RetrieverServiceNoop,
  RetrieverServiceLive,
  RetrieverServiceAuto,
  GraphExpansionService,
  GraphExpansionServiceLive,
  AnchorVerificationService,
  AnchorVerificationServiceLive,
  SwarmVerificationService,
  SwarmVerificationServiceLive,
  calculateMajorityVote,
  AstGrepService,
  AstGrepServiceLive,
  AstGrepServiceNoop,
  AstGrepServiceAuto,
  EXT_TO_LANGUAGE,
  DEFAULT_SYMBOL_PATTERNS,
  DaemonService,
  DaemonServiceLive,
  DaemonServiceNoop,
  PID_FILE_PATH,
  LAUNCHD_PLIST_PATH,
  SYSTEMD_SERVICE_PATH,
  writePid,
  readPid,
  removePid,
  isProcessRunning,
  defaultDaemonConfig,
  generateLaunchdPlist,
  generateSystemdService,
  type DaemonStatus,
  type DaemonConfig,
  type LaunchdPlistOptions,
  type SystemdServiceOptions,
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
  type AutoSyncEntity,
  type AnchorVerificationResult,
  type BatchVerificationResult,
  type TypedAnchorInput,
  type GraphStatusResult,
  type PruneResult,
  type NeighborWithDepth,
  type NeighborWithPath,
  type FindNeighborsOptions,
  type QueryExpansionResult,
  type RerankerResult,
  type SeedLearning,
  type ExpandedLearning,
  type GraphExpansionOptions,
  type GraphExpansionResult,
  type VerificationResult,
  type VerificationSummary,
  type VerifyOptions,
  type VerificationBatch,
  type BatchResult,
  type SwarmMetrics,
  type SwarmVerificationResult,
  type SwarmVerifyOptions,
  type VoteResult,
  PromotionService,
  type PromotionResult,
  type AutoPromoteResult,
  FeedbackTrackerService,
  FeedbackTrackerServiceNoop,
  FeedbackTrackerServiceLive,
  type LearningUsageFeedback,
  WorkerService,
  WorkerServiceLive,
  type WorkerRegistration,
  type WorkerFilter,
  type FindDeadConfig,
  ClaimService,
  ClaimServiceLive,
  OrchestratorService,
  OrchestratorServiceLive,
  type OrchestratorConfig,
  runWorkerProcess,
  type WorkerProcessConfig
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
  RunRepositoryLive,
  AnchorRepository,
  AnchorRepositoryLive,
  EdgeRepository,
  EdgeRepositoryLive,
  DeduplicationRepository,
  DeduplicationRepositoryLive,
  CandidateRepository,
  CandidateRepositoryLive,
  TrackedProjectRepository,
  TrackedProjectRepositoryLive,
  WorkerRepository,
  WorkerRepositoryLive,
  ClaimRepository,
  ClaimRepositoryLive,
  OrchestratorStateRepository,
  OrchestratorStateRepositoryLive,
  type OrchestratorStateUpdate
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
  matchesPattern,
  type FileLearningRow
} from "./mappers/file-learning.js"

export {
  rowToAttempt,
  type AttemptRow
} from "./mappers/attempt.js"

export {
  rowToAnchor,
  rowToInvalidationLog,
  type AnchorRow,
  type InvalidationLogRow
} from "./mappers/anchor.js"

export {
  rowToEdge,
  type EdgeRow
} from "./mappers/edge.js"

export {
  rowToWorker,
  isValidWorkerStatus,
  WORKER_STATUSES,
  type WorkerRow
} from "./mappers/worker.js"

// =============================================================================
// Utils
// =============================================================================
export { cosineSimilarity } from "./utils/math.js"
export { matchesGlob } from "./utils/glob.js"

// =============================================================================
// Worker (PRD-018 headless worker system)
// =============================================================================
export {
  type ExecutionResult,
  type IOCapture,
  type WorkerContext,
  type WorkerHooks,
  type WorkerConfig,
  runWorker
} from "./worker/index.js"

// =============================================================================
// Transcript Adapters (PRD-019 Execution Tracing)
// =============================================================================
export {
  ClaudeCodeAdapter,
  GenericJSONLAdapter,
  getAdapter,
  registerAdapter,
  type TranscriptAdapter,
  type ToolCall,
  type Message
} from "./services/transcript-adapter.js"

// =============================================================================
// Tracing Service (PRD-019 Execution Tracing)
// =============================================================================
export {
  TracingService,
  TracingServiceLive,
  TracingServiceNoop,
  type SpanOptions
} from "./services/tracing-service.js"
