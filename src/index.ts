// Public API for programmatic use
export * from "./schema.js"
export * from "./errors.js"
export * from "./layer.js"

// Services
export { TaskService, TaskServiceLive } from "./services/task-service.js"
export { DependencyService, DependencyServiceLive } from "./services/dep-service.js"
export { ReadyService, ReadyServiceLive } from "./services/ready-service.js"
export { HierarchyService, HierarchyServiceLive } from "./services/hierarchy-service.js"
export { ScoreService, ScoreServiceLive } from "./services/score-service.js"
export { SyncService, SyncServiceLive } from "./services/sync-service.js"

// Repositories (for advanced use)
export { TaskRepository, TaskRepositoryLive } from "./repo/task-repo.js"
export { DependencyRepository, DependencyRepositoryLive } from "./repo/dep-repo.js"

// Embedding
export { EmbeddingService, EmbeddingServiceNoop, EmbeddingServiceLive, EmbeddingServiceAuto } from "./services/embedding-service.js"

// Database
export { SqliteClient, SqliteClientLive } from "./db.js"
