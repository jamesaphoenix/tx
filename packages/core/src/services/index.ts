/**
 * @tx/core/services - Service exports
 */

export { TaskService, TaskServiceLive } from "./task-service.js"
export { DependencyService, DependencyServiceLive } from "./dep-service.js"
export { ReadyService, ReadyServiceLive } from "./ready-service.js"
export { HierarchyService, HierarchyServiceLive } from "./hierarchy-service.js"
export { ScoreService, ScoreServiceLive, type ScoreBreakdown } from "./score-service.js"
export { LearningService, LearningServiceLive } from "./learning-service.js"
export { FileLearningService, FileLearningServiceLive } from "./file-learning-service.js"
export { AttemptService, AttemptServiceLive } from "./attempt-service.js"
export {
  EmbeddingService,
  EmbeddingServiceNoop,
  EmbeddingServiceLive,
  EmbeddingServiceOpenAI,
  EmbeddingServiceAuto,
  createEmbedderLayer,
  isValidLlama,
  isValidLlamaModel,
  isValidLlamaEmbeddingContext,
  isValidOpenAIClient,
  validateEmbeddingDimensions,
  type EmbedderConfig
} from "./embedding-service.js"
export {
  QueryExpansionService,
  QueryExpansionServiceNoop,
  QueryExpansionServiceLive,
  QueryExpansionServiceAuto,
  QueryExpansionUnavailableError,
  MAX_EXPANSION_QUERIES,
  MAX_QUERY_LENGTH,
  validateExpansions,
  type QueryExpansionResult
} from "./query-expansion-service.js"
export {
  RerankerService,
  RerankerServiceNoop,
  RerankerServiceLive,
  RerankerServiceAuto,
  type RerankerResult
} from "./reranker-service.js"
export {
  SyncService,
  SyncServiceLive,
  type ExportResult,
  type ImportResult,
  type SyncStatus,
  type CompactResult,
  type ExportOptions,
  type ExportAllResult,
  type ImportAllResult
} from "./sync-service.js"
export {
  MigrationService,
  MigrationServiceLive,
  MIGRATIONS,
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
  AnchorService,
  AnchorServiceLive,
  type AnchorVerificationResult,
  type BatchVerificationResult,
  type TypedAnchorInput,
  type GraphStatusResult,
  type PruneResult
} from "./anchor-service.js"
export {
  EdgeService,
  EdgeServiceLive,
  type NeighborWithDepth,
  type NeighborWithPath,
  type FindNeighborsOptions
} from "./edge-service.js"
export {
  DeduplicationService,
  DeduplicationServiceLive
} from "./deduplication-service.js"
export {
  CandidateExtractorService,
  CandidateExtractorServiceNoop,
  CandidateExtractorServiceAnthropic,
  CandidateExtractorServiceOpenAI,
  CandidateExtractorServiceAuto
} from "./candidate-extractor-service.js"
export {
  RetrieverService,
  RetrieverServiceNoop,
  RetrieverServiceLive,
  RetrieverServiceAuto
} from "./retriever-service.js"
export {
  GraphExpansionService,
  GraphExpansionServiceNoop,
  GraphExpansionServiceLive,
  type SeedLearning,
  type ExpandedLearning,
  type EdgeTypeFilter,
  type GraphExpansionOptions,
  type GraphExpansionResult
} from "./graph-expansion.js"
export {
  AnchorVerificationService,
  AnchorVerificationServiceLive,
  getAnchorTTL,
  isStale,
  DEFAULT_ANCHOR_CACHE_TTL,
  type FailedAnchor,
  type VerificationResult,
  type VerificationSummary,
  type VerifyOptions
} from "./anchor-verification.js"
export {
  SwarmVerificationService,
  SwarmVerificationServiceLive,
  calculateMajorityVote,
  type VerificationBatch,
  type BatchResult,
  type SwarmMetrics,
  type SwarmVerificationResult,
  type SwarmVerifyOptions,
  type VoteResult
} from "./swarm-verification.js"
export {
  AstGrepService,
  AstGrepServiceLive,
  AstGrepServiceNoop,
  AstGrepServiceAuto,
  EXT_TO_LANGUAGE,
  DEFAULT_SYMBOL_PATTERNS
} from "./ast-grep-service.js"
export {
  DaemonService,
  DaemonServiceLive,
  DaemonServiceNoop,
  PID_FILE_PATH,
  LAUNCHD_PLIST_PATH,
  writePid,
  readPid,
  removePid,
  removePidIfContentMatches,
  isProcessRunning,
  tryAtomicPidCreate,
  acquirePidLock,
  defaultDaemonConfig,
  generateLaunchdPlist,
  generateSystemdService,
  SYSTEMD_SERVICE_PATH,
  type DaemonStatus,
  type DaemonConfig,
  type LaunchdPlistOptions,
  type SystemdServiceOptions
} from "./daemon-service.js"
export {
  FileWatcherService,
  FileWatcherServiceLive,
  FileWatcherServiceNoop,
  type FileEvent,
  type FileEventType,
  type FileWatcherConfig,
  type FileWatcherStatus
} from "./file-watcher-service.js"
export {
  PromotionService,
  PromotionServiceLive,
  type PromotionResult,
  type AutoPromoteResult
} from "./promotion-service.js"
export {
  DiversifierService,
  DiversifierServiceNoop,
  DiversifierServiceLive,
  DiversifierServiceAuto
} from "./diversifier-service.js"
export {
  FeedbackTrackerService,
  FeedbackTrackerServiceNoop,
  FeedbackTrackerServiceLive,
  type LearningUsageFeedback
} from "./feedback-tracker.js"
export {
  WorkerService,
  WorkerServiceLive,
  type WorkerRegistration,
  type WorkerFilter,
  type FindDeadConfig
} from "./worker-service.js"
export {
  ClaimService,
  ClaimServiceLive
} from "./claim-service.js"
export {
  OrchestratorService,
  OrchestratorServiceLive,
  type OrchestratorConfig
} from "./orchestrator-service.js"
export {
  runWorkerProcess,
  type WorkerProcessConfig
} from "./worker-process.js"
export {
  TracingService,
  TracingServiceLive,
  TracingServiceNoop,
  type SpanOptions
} from "./tracing-service.js"
export {
  ClaudeCodeAdapter,
  GenericJSONLAdapter,
  getAdapter,
  registerAdapter,
  type TranscriptAdapter,
  type ToolCall,
  type Message
} from "./transcript-adapter.js"
export {
  CompactionService,
  CompactionServiceNoop,
  CompactionServiceLive,
  CompactionServiceAuto,
  type CompactionResult,
  type CompactionOptions,
  type CompactionPreview
} from "./compaction-service.js"
export {
  ValidationService,
  ValidationServiceLive,
  type ValidationSeverity,
  type ValidationIssue,
  type CheckResult,
  type ValidationResult,
  type ValidateOptions
} from "./validation-service.js"
