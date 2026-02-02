/**
 * @tx/core/layer - Effect layer composition
 *
 * This module provides pre-composed layers for common use cases.
 * See DD-002 for full specification.
 */

import { Layer } from "effect"
import { SqliteClientLive } from "./db.js"
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
import { EmbeddingServiceNoop } from "./services/embedding-service.js"
import { QueryExpansionServiceNoop } from "./services/query-expansion-service.js"
import { RerankerServiceNoop } from "./services/reranker-service.js"
import { RetrieverServiceLive } from "./services/retriever-service.js"
import { GraphExpansionServiceLive } from "./services/graph-expansion.js"
import { AnchorVerificationServiceLive } from "./services/anchor-verification.js"
import { SwarmVerificationServiceLive } from "./services/swarm-verification.js"
import { PromotionServiceLive } from "./services/promotion-service.js"

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
export { ReadyService } from "./services/ready-service.js"
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
export { CandidateRepository, CandidateRepositoryLive } from "./repo/candidate-repo.js"
export { TrackedProjectRepository, TrackedProjectRepositoryLive } from "./repo/tracked-project-repo.js"

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
  const infra = SqliteClientLive(dbPath)

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
    TrackedProjectRepositoryLive
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

  // EdgeServiceLive needs EdgeRepository from repos
  const edgeService = EdgeServiceLive.pipe(Layer.provide(repos))

  // GraphExpansionServiceLive needs EdgeService and LearningRepository
  const graphExpansionService = GraphExpansionServiceLive.pipe(
    Layer.provide(Layer.merge(repos, edgeService))
  )

  // RetrieverServiceLive needs repos, embedding, query expansion, reranker, and graph expansion
  const retrieverService = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, graphExpansionService))
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
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, retrieverService, autoSyncService))
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

  // Merge all services including edgeService, graphExpansionService, anchorVerificationService, swarmVerificationService, and promotionService
  const allServices = Layer.mergeAll(services, edgeService, graphExpansionService, anchorVerificationService, swarmVerificationService, promotionService)

  // MigrationService only needs SqliteClient
  const migrationService = MigrationServiceLive.pipe(
    Layer.provide(infra)
  )

  // Also expose RunRepository directly for run tracking
  // (Note: Consider creating RunService in future refactor)
  return Layer.mergeAll(allServices, syncServiceWithDeps, migrationService, repos)
}

/**
 * Create a minimal application layer without auto-sync.
 * Useful for testing and simple CLI operations.
 *
 * @param dbPath Path to SQLite database file
 */
export const makeMinimalLayer = (dbPath: string) => {
  const infra = SqliteClientLive(dbPath)

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
    TrackedProjectRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )

  // EdgeServiceLive needs EdgeRepository from repos
  const edgeService = EdgeServiceLive.pipe(Layer.provide(repos))

  // GraphExpansionServiceLive needs EdgeService and LearningRepository
  const graphExpansionService = GraphExpansionServiceLive.pipe(
    Layer.provide(Layer.merge(repos, edgeService))
  )

  // RetrieverServiceLive needs repos, embedding, query expansion, reranker, and graph expansion
  const retrieverService = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, graphExpansionService))
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

  // Merge all services including edgeService, graphExpansionService, anchorVerificationService, swarmVerificationService, and promotionService
  const allServices = Layer.mergeAll(services, edgeService, graphExpansionService, anchorVerificationService, swarmVerificationService, promotionService)

  // MigrationService only needs SqliteClient
  const migrationService = MigrationServiceLive.pipe(
    Layer.provide(infra)
  )

  // SyncService for manual exports
  const syncService = SyncServiceLive.pipe(
    Layer.provide(Layer.mergeAll(
      infra,
      repos,
      TaskServiceLive.pipe(Layer.provide(repos))
    ))
  )

  // Also expose RunRepository directly for run tracking
  return Layer.mergeAll(allServices, migrationService, syncService, repos)
}
