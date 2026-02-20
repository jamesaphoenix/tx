/**
 * @tx/core/layer - Effect layer composition
 *
 * This module provides pre-composed layers for common use cases.
 * See DD-002 for full specification.
 */

import { Layer } from "effect"
import { type SqliteClient, SqliteClientLive } from "./db.js"
import { TaskRepositoryLive } from "./repo/task-repo.js"
import { DependencyRepositoryLive } from "./repo/dep-repo.js"
import { LearningRepositoryLive } from "./repo/learning-repo.js"
import { FileLearningRepositoryLive } from "./repo/file-learning-repo.js"
import { AttemptRepositoryLive } from "./repo/attempt-repo.js"
import { RunRepositoryLive } from "./repo/run-repo.js"
import { AnchorRepositoryLive } from "./repo/anchor-repo.js"
import { EdgeRepositoryLive } from "./repo/edge-repo.js"
import { DeduplicationRepositoryLive } from "./repo/deduplication-repo.js"
import { CandidateRepositoryLive } from "./repo/candidate-repo.js"
import { TrackedProjectRepositoryLive } from "./repo/tracked-project-repo.js"
import { WorkerRepositoryLive } from "./repo/worker-repo.js"
import { ClaimRepositoryLive } from "./repo/claim-repo.js"
import { OrchestratorStateRepositoryLive } from "./repo/orchestrator-state-repo.js"
import { TaskServiceLive } from "./services/task-service.js"
import { DependencyServiceLive } from "./services/dep-service.js"
import { ReadyServiceLive } from "./services/ready-service.js"
import { HierarchyServiceLive } from "./services/hierarchy-service.js"
import { LearningServiceLive } from "./services/learning-service.js"
import { FileLearningServiceLive } from "./services/file-learning-service.js"
import { AttemptServiceLive } from "./services/attempt-service.js"
import { AnchorServiceLive } from "./services/anchor-service.js"
import { EdgeServiceLive } from "./services/edge-service.js"
import { DeduplicationServiceLive } from "./services/deduplication-service.js"
import { SyncServiceLive } from "./services/sync-service.js"
import { AutoSyncServiceLive, AutoSyncServiceNoop } from "./services/auto-sync-service.js"
import { MigrationServiceLive } from "./services/migration-service.js"
import { EmbeddingServiceNoop, EmbeddingServiceAuto } from "./services/embedding-service.js"
import { QueryExpansionServiceNoop, QueryExpansionServiceAuto } from "./services/query-expansion-service.js"
import { RerankerServiceNoop, RerankerServiceAuto } from "./services/reranker-service.js"
import { LlmServiceAuto } from "./services/llm-service.js"
import { RetrieverServiceLive } from "./services/retriever-service.js"
import { GraphExpansionServiceLive } from "./services/graph-expansion.js"
import { AnchorVerificationServiceLive } from "./services/anchor-verification.js"
import { SwarmVerificationServiceLive } from "./services/swarm-verification.js"
import { PromotionServiceLive } from "./services/promotion-service.js"
import { FeedbackTrackerServiceLive } from "./services/feedback-tracker.js"
import { DiversifierServiceLive } from "./services/diversifier-service.js"
import { WorkerServiceLive } from "./services/worker-service.js"
import { RunHeartbeatServiceLive } from "./services/run-heartbeat-service.js"
import { ClaimServiceLive } from "./services/claim-service.js"
import { OrchestratorServiceLive } from "./services/orchestrator-service.js"
import { DaemonServiceLive, DaemonServiceNoop } from "./services/daemon-service.js"
import { TracingServiceLive, TracingServiceNoop } from "./services/tracing-service.js"
import { CompactionRepositoryLive } from "./repo/compaction-repo.js"
import { CompactionServiceLive, CompactionServiceNoop } from "./services/compaction-service.js"
import { ValidationServiceLive } from "./services/validation-service.js"
import { MessageRepositoryLive } from "./repo/message-repo.js"
import { MessageServiceLive } from "./services/message-service.js"
import { DocRepositoryLive } from "./repo/doc-repo.js"
import { DocServiceLive } from "./services/doc-service.js"
// AgentService + CycleScanService are NOT in the default layer.
// They are provided by the cycle CLI command via Effect.provide overlay.
// Re-exports below make them available from @jamesaphoenix/tx-core.

// Re-export services for cleaner imports
export { SyncService } from "./services/sync-service.js"
export { MigrationService } from "./services/migration-service.js"
export { AutoSyncService, AutoSyncServiceNoop, AutoSyncServiceLive } from "./services/auto-sync-service.js"
export { LearningService } from "./services/learning-service.js"
export { FileLearningService } from "./services/file-learning-service.js"
export {
  EmbeddingService,
  EmbeddingServiceNoop,
  EmbeddingServiceLive,
  EmbeddingServiceOpenAI,
  EmbeddingServiceAuto,
  createEmbedderLayer,
  type EmbedderConfig
} from "./services/embedding-service.js"
export {
  QueryExpansionService,
  QueryExpansionServiceNoop,
  QueryExpansionServiceLive,
  QueryExpansionServiceAuto,
  QueryExpansionUnavailableError,
  type QueryExpansionResult
} from "./services/query-expansion-service.js"
export { AttemptService } from "./services/attempt-service.js"
export { TaskService } from "./services/task-service.js"
export { DependencyService } from "./services/dep-service.js"
export { ReadyService, type ReadyCheckResult, isReadyResult } from "./services/ready-service.js"
export { HierarchyService } from "./services/hierarchy-service.js"
export { ScoreService } from "./services/score-service.js"
export { RunRepository } from "./repo/run-repo.js"
export {
  RerankerService,
  RerankerServiceNoop,
  RerankerServiceLive,
  RerankerServiceAuto,
  type RerankerResult
} from "./services/reranker-service.js"
export { DeduplicationService, DeduplicationServiceLive } from "./services/deduplication-service.js"
export { MessageService, MessageServiceLive } from "./services/message-service.js"
export { AgentService, AgentServiceLive, AgentServiceNoop } from "./services/agent-service.js"
export { CycleScanService, CycleScanServiceLive } from "./services/cycle-scan-service.js"
export { DocService, DocServiceLive } from "./services/doc-service.js"
export {
  RetrieverService,
  RetrieverServiceNoop,
  RetrieverServiceLive,
  RetrieverServiceAuto
} from "./services/retriever-service.js"
export {
  GraphExpansionService,
  GraphExpansionServiceNoop,
  GraphExpansionServiceLive,
  type SeedLearning,
  type ExpandedLearning,
  type GraphExpansionOptions,
  type GraphExpansionResult
} from "./services/graph-expansion.js"
export {
  AnchorVerificationService,
  AnchorVerificationServiceLive,
  type VerificationResult,
  type VerificationSummary,
  type VerifyOptions
} from "./services/anchor-verification.js"
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
} from "./services/swarm-verification.js"
export {
  PromotionService,
  PromotionServiceLive,
  type PromotionResult,
  type AutoPromoteResult
} from "./services/promotion-service.js"
export {
  FeedbackTrackerService,
  FeedbackTrackerServiceNoop,
  FeedbackTrackerServiceLive,
  type LearningUsageFeedback
} from "./services/feedback-tracker.js"
export {
  DiversifierService,
  DiversifierServiceNoop,
  DiversifierServiceLive,
  DiversifierServiceAuto
} from "./services/diversifier-service.js"
export {
  RunHeartbeatService,
  RunHeartbeatServiceLive,
  type RunHeartbeatInput,
  type StalledRun,
  type StalledRunQuery,
  type ReapStalledOptions,
  type ReapedRun
} from "./services/run-heartbeat-service.js"
export { CandidateRepository, CandidateRepositoryLive } from "./repo/candidate-repo.js"
export { TrackedProjectRepository, TrackedProjectRepositoryLive } from "./repo/tracked-project-repo.js"
export {
  DaemonService,
  DaemonServiceLive,
  DaemonServiceNoop,
  type DaemonStatus
} from "./services/daemon-service.js"
export {
  TracingService,
  TracingServiceLive,
  TracingServiceNoop,
  type SpanOptions
} from "./services/tracing-service.js"
export {
  CompactionService,
  CompactionServiceLive,
  CompactionServiceNoop,
  CompactionServiceAuto,
  type CompactionOutputMode,
  type CompactionResult,
  type CompactionOptions,
  type CompactionPreview
} from "./services/compaction-service.js"
export {
  ValidationService,
  ValidationServiceLive,
  type ValidationSeverity,
  type ValidationIssue,
  type CheckResult,
  type ValidationResult,
  type ValidateOptions
} from "./services/validation-service.js"
export {
  LlmService,
  LlmServiceNoop,
  LlmServiceAgentSdk,
  LlmServiceAnthropic,
  LlmServiceAuto,
  type LlmCompletionRequest,
  type LlmCompletionResult
} from "./services/llm-service.js"

/**
 * Create the full application layer from an existing SqliteClient infra layer.
 *
 * Use this when you already have a SqliteClient layer (e.g., from Layer.succeed
 * with a pre-created database instance). This is useful for test utilities that
 * need to share a single database across test runs while getting fresh service
 * instances via Layer.fresh.
 *
 * @param infra A layer providing SqliteClient
 */
export const makeAppLayerFromInfra = <E>(infra: Layer.Layer<SqliteClient, E>) => {
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive,
    RunRepositoryLive,
    AnchorRepositoryLive,
    EdgeRepositoryLive,
    DeduplicationRepositoryLive,
    CandidateRepositoryLive,
    TrackedProjectRepositoryLive,
    WorkerRepositoryLive,
    ClaimRepositoryLive,
    OrchestratorStateRepositoryLive,
    CompactionRepositoryLive,
    MessageRepositoryLive,
    DocRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )

  // SyncServiceLive needs TaskService, repos, and infra
  const syncServiceWithDeps = SyncServiceLive.pipe(
    Layer.provide(Layer.mergeAll(
      infra,
      repos,
      TaskServiceLive.pipe(Layer.provide(repos))
    ))
  )

  // AutoSyncServiceLive needs SyncService and infra
  const autoSyncService = AutoSyncServiceLive.pipe(
    Layer.provide(Layer.merge(infra, syncServiceWithDeps))
  )

  // LlmService (auto-detects Agent SDK → Anthropic → Noop)
  const llmService = LlmServiceAuto

  // EmbeddingService (auto-detects local node-llama-cpp)
  const embeddingService = EmbeddingServiceAuto

  // RerankerService (auto-detects local node-llama-cpp)
  const rerankerService = RerankerServiceAuto

  // QueryExpansionService (auto-detects LlmService availability)
  const queryExpansionService = QueryExpansionServiceAuto.pipe(Layer.provide(llmService))

  // EdgeServiceLive needs EdgeRepository from repos
  const edgeService = EdgeServiceLive.pipe(Layer.provide(repos))

  // FeedbackTrackerServiceLive needs EdgeService (created early for RetrieverService optional dependency)
  const feedbackTrackerService = FeedbackTrackerServiceLive.pipe(
    Layer.provide(edgeService)
  )

  // GraphExpansionServiceLive needs EdgeService, LearningRepository, and AnchorRepository
  const graphExpansionService = GraphExpansionServiceLive.pipe(
    Layer.provide(Layer.merge(repos, edgeService))
  )

  // RetrieverServiceLive needs repos, embedding, query expansion, reranker, graph expansion, diversifier, and optionally feedback tracker
  const retrieverService = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, embeddingService, queryExpansionService, rerankerService, graphExpansionService, feedbackTrackerService, DiversifierServiceLive))
  )

  // Services need repos, embedding, query expansion, reranker, retriever, and autoSyncService
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive,
    FileLearningServiceLive,
    AttemptServiceLive,
    AnchorServiceLive,
    DeduplicationServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, embeddingService, queryExpansionService, rerankerService, retrieverService, autoSyncService))
  )

  // AnchorVerificationServiceLive needs AnchorRepository from repos
  const anchorVerificationService = AnchorVerificationServiceLive.pipe(Layer.provide(repos))

  // SwarmVerificationServiceLive needs AnchorVerificationService and AnchorRepository
  const swarmVerificationService = SwarmVerificationServiceLive.pipe(
    Layer.provide(Layer.merge(repos, anchorVerificationService))
  )

  // PromotionServiceLive needs CandidateRepository, LearningService, and EdgeService
  const promotionService = PromotionServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, services, edgeService))
  )

  // WorkerServiceLive needs WorkerRepository and OrchestratorStateRepository (from repos)
  const workerService = WorkerServiceLive.pipe(Layer.provide(repos))

  // ClaimServiceLive needs ClaimRepository and OrchestratorStateRepository (from repos)
  const claimService = ClaimServiceLive.pipe(Layer.provide(repos))

  // OrchestratorServiceLive needs WorkerService, ClaimService, TaskService, OrchestratorStateRepository, and SqliteClient
  const orchestratorService = OrchestratorServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, services, workerService, claimService, infra))
  )

  // TracingServiceLive needs SqliteClient
  const tracingService = TracingServiceLive.pipe(Layer.provide(infra))

  // CompactionServiceLive needs CompactionRepository (from repos), SqliteClient (from infra), and LlmService
  const compactionService = CompactionServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, infra, llmService))
  )

  // ValidationServiceLive needs SqliteClient
  const validationService = ValidationServiceLive.pipe(Layer.provide(infra))

  // MessageServiceLive needs MessageRepository (from repos)
  const messageService = MessageServiceLive.pipe(Layer.provide(repos))

  // DocServiceLive needs DocRepository (from repos)
  const docService = DocServiceLive.pipe(Layer.provide(repos))

  // Merge all services
  const runHeartbeatService = RunHeartbeatServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, services, infra))
  )

  const allServices = Layer.mergeAll(services, edgeService, graphExpansionService, anchorVerificationService, swarmVerificationService, promotionService, feedbackTrackerService, retrieverService, DiversifierServiceLive, workerService, runHeartbeatService, claimService, orchestratorService, DaemonServiceLive, tracingService, compactionService, validationService, messageService, docService)

  // MigrationService only needs SqliteClient
  const migrationService = MigrationServiceLive.pipe(
    Layer.provide(infra)
  )

  // Also expose RunRepository directly for run tracking
  // (Note: Consider creating RunService in future refactor)
  // Also expose SqliteClient directly for direct database access (e.g., trace commands)
  return Layer.mergeAll(allServices, syncServiceWithDeps, migrationService, repos, infra)
}

/**
 * Create the full application layer with all services.
 *
 * This is the standard entry point for CLI, MCP, and SDK consumers.
 * Provides: TaskService, DependencyService, ReadyService, HierarchyService,
 * LearningService, FileLearningService, AttemptService, SyncService, MigrationService
 *
 * @param dbPath Path to SQLite database file
 */
export const makeAppLayer = (dbPath: string) => {
  return makeAppLayerFromInfra(SqliteClientLive(dbPath))
}

/**
 * Create a minimal application layer from an existing SqliteClient infra layer.
 *
 * Uses Noop variants for LLM-dependent services (embedding, query expansion,
 * reranker, compaction, auto-sync). Useful for tests and environments where
 * external services (LLM APIs, node-llama-cpp) are not available.
 *
 * @param infra A layer providing SqliteClient
 */
export const makeMinimalLayerFromInfra = <E>(infra: Layer.Layer<SqliteClient, E>) => {
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive,
    RunRepositoryLive,
    AnchorRepositoryLive,
    EdgeRepositoryLive,
    DeduplicationRepositoryLive,
    CandidateRepositoryLive,
    TrackedProjectRepositoryLive,
    WorkerRepositoryLive,
    ClaimRepositoryLive,
    OrchestratorStateRepositoryLive,
    CompactionRepositoryLive,
    MessageRepositoryLive,
    DocRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )

  // SyncServiceLive needs TaskService, repos, and infra
  const syncServiceWithDeps = SyncServiceLive.pipe(
    Layer.provide(Layer.mergeAll(
      infra,
      repos,
      TaskServiceLive.pipe(Layer.provide(repos))
    ))
  )

  // EdgeServiceLive needs EdgeRepository from repos
  const edgeService = EdgeServiceLive.pipe(Layer.provide(repos))

  // FeedbackTrackerServiceLive needs EdgeService
  const feedbackTrackerService = FeedbackTrackerServiceLive.pipe(
    Layer.provide(edgeService)
  )

  // GraphExpansionServiceLive needs EdgeService, LearningRepository, and AnchorRepository
  const graphExpansionService = GraphExpansionServiceLive.pipe(
    Layer.provide(Layer.merge(repos, edgeService))
  )

  // RetrieverServiceLive with Noop variants for LLM-dependent services
  const retrieverService = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, graphExpansionService, feedbackTrackerService, DiversifierServiceLive))
  )

  // Services with Noop embedding, query expansion, reranker, retriever, and auto-sync
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive,
    FileLearningServiceLive,
    AttemptServiceLive,
    AnchorServiceLive,
    DeduplicationServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, retrieverService, AutoSyncServiceNoop))
  )

  // AnchorVerificationServiceLive needs AnchorRepository from repos
  const anchorVerificationService = AnchorVerificationServiceLive.pipe(Layer.provide(repos))

  // SwarmVerificationServiceLive needs AnchorVerificationService and AnchorRepository
  const swarmVerificationService = SwarmVerificationServiceLive.pipe(
    Layer.provide(Layer.merge(repos, anchorVerificationService))
  )

  // PromotionServiceLive needs CandidateRepository, LearningService, and EdgeService
  const promotionService = PromotionServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, services, edgeService))
  )

  // WorkerServiceLive needs WorkerRepository and OrchestratorStateRepository (from repos)
  const workerService = WorkerServiceLive.pipe(Layer.provide(repos))

  // ClaimServiceLive needs ClaimRepository and OrchestratorStateRepository (from repos)
  const claimService = ClaimServiceLive.pipe(Layer.provide(repos))

  // OrchestratorServiceLive needs WorkerService, ClaimService, TaskService, OrchestratorStateRepository, and SqliteClient
  const orchestratorService = OrchestratorServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, services, workerService, claimService, infra))
  )

  // CompactionServiceNoop for minimal layer (no LLM features)
  const compactionService = CompactionServiceNoop.pipe(
    Layer.provide(Layer.merge(repos, infra))
  )

  // ValidationServiceLive needs SqliteClient
  const validationService = ValidationServiceLive.pipe(Layer.provide(infra))

  // MessageServiceLive needs MessageRepository (from repos)
  const messageService = MessageServiceLive.pipe(Layer.provide(repos))

  // DocServiceLive needs DocRepository (from repos)
  const docService = DocServiceLive.pipe(Layer.provide(repos))

  // Merge all services
  const runHeartbeatService = RunHeartbeatServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, services, infra))
  )

  const allServices = Layer.mergeAll(services, edgeService, graphExpansionService, anchorVerificationService, swarmVerificationService, promotionService, feedbackTrackerService, retrieverService, DiversifierServiceLive, workerService, runHeartbeatService, claimService, orchestratorService, DaemonServiceNoop, TracingServiceNoop, compactionService, validationService, messageService, docService)

  // MigrationService only needs SqliteClient
  const migrationService = MigrationServiceLive.pipe(
    Layer.provide(infra)
  )

  // Also expose RunRepository directly for run tracking and SqliteClient for direct access
  return Layer.mergeAll(allServices, syncServiceWithDeps, migrationService, repos, infra)
}

/**
 * Create a minimal application layer without auto-sync.
 * Useful for testing and simple CLI operations.
 *
 * @param dbPath Path to SQLite database file
 */
export const makeMinimalLayer = (dbPath: string) => {
  return makeMinimalLayerFromInfra(SqliteClientLive(dbPath))
}
