import { Layer } from "effect"
import { SqliteClientLive } from "./db.js"
import { TaskRepositoryLive } from "./repo/task-repo.js"
import { DependencyRepositoryLive } from "./repo/dep-repo.js"
import { LearningRepositoryLive } from "./repo/learning-repo.js"
import { FileLearningRepositoryLive } from "./repo/file-learning-repo.js"
import { TaskServiceLive } from "./services/task-service.js"
import { DependencyServiceLive } from "./services/dep-service.js"
import { ReadyServiceLive } from "./services/ready-service.js"
import { HierarchyServiceLive } from "./services/hierarchy-service.js"
import { LearningServiceLive } from "./services/learning-service.js"
import { FileLearningServiceLive } from "./services/file-learning-service.js"
import { SyncService, SyncServiceLive } from "./services/sync-service.js"
import { MigrationService, MigrationServiceLive } from "./services/migration-service.js"

// Re-export services for cleaner imports
export { SyncService }
export { MigrationService }
export { LearningService } from "./services/learning-service.js"
export { FileLearningService } from "./services/file-learning-service.js"

export const makeAppLayer = (dbPath: string) => {
  const infra = SqliteClientLive(dbPath)

  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )

  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive,
    FileLearningServiceLive
  ).pipe(
    Layer.provide(repos)
  )

  // SyncServiceLive needs TaskService (from services) and DependencyRepository (from repos)
  const syncService = SyncServiceLive.pipe(
    Layer.provide(Layer.merge(repos, services))
  )

  // MigrationService only needs SqliteClient
  const migrationService = MigrationServiceLive.pipe(
    Layer.provide(infra)
  )

  return Layer.mergeAll(services, syncService, migrationService)
}
