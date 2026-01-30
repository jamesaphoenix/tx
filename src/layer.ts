import { Layer } from "effect"
import { SqliteClientLive } from "./db.js"
import { TaskRepositoryLive } from "./repo/task-repo.js"
import { DependencyRepositoryLive } from "./repo/dep-repo.js"
import { LearningRepositoryLive } from "./repo/learning-repo.js"
import { FileLearningRepositoryLive } from "./repo/file-learning-repo.js"
import { AttemptRepositoryLive } from "./repo/attempt-repo.js"
import { TaskServiceLive } from "./services/task-service.js"
import { DependencyServiceLive } from "./services/dep-service.js"
import { ReadyServiceLive } from "./services/ready-service.js"
import { HierarchyServiceLive } from "./services/hierarchy-service.js"
import { LearningServiceLive } from "./services/learning-service.js"
import { FileLearningServiceLive } from "./services/file-learning-service.js"
import { AttemptServiceLive } from "./services/attempt-service.js"
import { SyncService, SyncServiceLive } from "./services/sync-service.js"
import { AutoSyncServiceLive } from "./services/auto-sync-service.js"
import { MigrationService, MigrationServiceLive } from "./services/migration-service.js"
import { EmbeddingServiceAuto, EmbeddingServiceNoop } from "./services/embedding-service.js"

// Re-export services for cleaner imports
export { SyncService }
export { MigrationService }
export { AutoSyncService } from "./services/auto-sync-service.js"
export { LearningService } from "./services/learning-service.js"
export { FileLearningService } from "./services/file-learning-service.js"
export { EmbeddingService, EmbeddingServiceNoop, EmbeddingServiceLive, EmbeddingServiceAuto } from "./services/embedding-service.js"
export { AttemptService } from "./services/attempt-service.js"

export const makeAppLayer = (dbPath: string) => {
  const infra = SqliteClientLive(dbPath)

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive,
    AttemptRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )

  // SyncServiceLive only needs repos and infra (no longer depends on TaskService)
  const syncService = SyncServiceLive.pipe(
    Layer.provide(Layer.merge(infra, repos))
  )

  // AutoSyncServiceLive needs SyncService and infra
  const autoSyncService = AutoSyncServiceLive.pipe(
    Layer.provide(Layer.merge(infra, syncService))
  )

  // Use real embeddings if TX_EMBEDDINGS=1, otherwise noop (fast for tests)
  const embeddingService = process.env.TX_EMBEDDINGS === "1"
    ? EmbeddingServiceAuto
    : EmbeddingServiceNoop

  // Services need repos, embedding, and autoSyncService
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive,
    FileLearningServiceLive,
    AttemptServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, embeddingService, autoSyncService))
  )

  // MigrationService only needs SqliteClient
  const migrationService = MigrationServiceLive.pipe(
    Layer.provide(infra)
  )

  return Layer.mergeAll(services, syncService, migrationService)
}
