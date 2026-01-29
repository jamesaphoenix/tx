import { Layer } from "effect"
import { SqliteClientLive } from "./db.js"
import { TaskRepositoryLive } from "./repo/task-repo.js"
import { DependencyRepositoryLive } from "./repo/dep-repo.js"
import { TaskServiceLive } from "./services/task-service.js"
import { DependencyServiceLive } from "./services/dep-service.js"
import { ReadyServiceLive } from "./services/ready-service.js"
import { HierarchyServiceLive } from "./services/hierarchy-service.js"

export const makeAppLayer = (dbPath: string) => {
  const infra = SqliteClientLive(dbPath)

  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )

  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive
  ).pipe(
    Layer.provide(repos)
  )

  return services
}
