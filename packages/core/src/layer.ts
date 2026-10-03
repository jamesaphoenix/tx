import { Layer } from "effect"
import { SqliteClient, SqliteClientLive } from "./db.js"
import { TaskRepositoryLive } from "./repo/task-repo.js"
import { DependencyRepositoryLive } from "./repo/dep-repo.js"
import { makeDocRepositoryLive } from "./repo/doc-repo.js"
import { LabelRepositoryLive } from "./repo/label-repo.js"
import { makeSpecTraceRepositoryLive } from "./repo/spec-trace-repo.js"
import { TaskServiceLive } from "./services/task-service.js"
import { DependencyServiceLive } from "./services/dep-service.js"
import { ReadyServiceLive } from "./services/ready-service.js"
import { HierarchyServiceLive } from "./services/hierarchy-service.js"
import { ScoreServiceLive } from "./services/score-service.js"
import { SyncServiceLive } from "./services/sync/index.js"
import { StreamServiceLive } from "./services/stream-service.js"
import { AutoSyncServiceLive, AutoSyncServiceNoop } from "./services/auto-sync-service.js"
import { MigrationServiceLive } from "./services/migration-service.js"
import { ValidationServiceLive } from "./services/validation-service.js"
import { makeDocServiceLive } from "./services/doc-service.js"
import { makeSpecTraceServiceLive } from "./services/spec-trace-service.js"
import { legacySpecProjectionContext, type SpecProjectionContext } from "./workspace-context.js"
export { SyncService } from "./services/sync/index.js"
export { StreamService, StreamServiceLive, type StreamInfo, type StreamProgress } from "./services/stream-service.js"
export { MigrationService } from "./services/migration-service.js"
export { AutoSyncService, AutoSyncServiceNoop, AutoSyncServiceLive } from "./services/auto-sync-service.js"
export { TaskService } from "./services/task-service.js"
export { DependencyService } from "./services/dep-service.js"
export { ReadyService, type ReadyCheckResult, isReadyResult } from "./services/ready-service.js"
export { HierarchyService } from "./services/hierarchy-service.js"
export { ScoreService } from "./services/score-service.js"
export { DocService, DocServiceLive } from "./services/doc-service.js"
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
  SpecTraceService,
  SpecTraceServiceLive,
  parseBatchRunInput,
  type BatchSource,
  type BatchRunResult,
  type SpecTraceStatus,
} from "./services/spec-trace-service.js"
export { LabelRepository, LabelRepositoryLive } from "./repo/label-repo.js"
export { SpecTraceRepository, SpecTraceRepositoryLive } from "./repo/spec-trace-repo.js"
export type AppLayerOptions = { readonly contentRoot?: string; readonly projection?: SpecProjectionContext }
/** @spec INV-LEAN-002 */
function appLayer<E>(infra: Layer.Layer<SqliteClient, E>, options: AppLayerOptions, auto: boolean) {
  const projection = options.projection ?? legacySpecProjectionContext(options.contentRoot ?? process.cwd())
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive, makeDocRepositoryLive(projection), LabelRepositoryLive, makeSpecTraceRepositoryLive(projection)).pipe(Layer.provide(infra))
  const stream = StreamServiceLive.pipe(Layer.provide(infra))
  const base = Layer.mergeAll(infra, repos, stream)
  const task = TaskServiceLive.pipe(Layer.provide(repos))
  const sync = SyncServiceLive.pipe(Layer.provide(Layer.merge(base, task)))
  const autosync = auto ? AutoSyncServiceLive.pipe(Layer.provide(Layer.merge(infra, sync))) : AutoSyncServiceNoop
  const tasks = Layer.mergeAll(task, DependencyServiceLive.pipe(Layer.provide(Layer.mergeAll(repos, autosync))), ReadyServiceLive.pipe(Layer.provide(repos)), HierarchyServiceLive.pipe(Layer.provide(repos)))
  const docs = makeDocServiceLive(options.contentRoot).pipe(Layer.provide(repos))
  const services = Layer.mergeAll(tasks, docs, makeSpecTraceServiceLive(options.contentRoot).pipe(Layer.provide(Layer.merge(repos, docs))), ScoreServiceLive.pipe(Layer.provide(Layer.merge(repos, tasks))), ValidationServiceLive.pipe(Layer.provide(infra)), MigrationServiceLive.pipe(Layer.provide(infra)))
  return Layer.mergeAll(base, services, sync, autosync)
}
export const makeAppLayerFromInfra = <E>(infra: Layer.Layer<SqliteClient, E>, options: AppLayerOptions = {}) => appLayer(infra, options, true)
export const makeMinimalLayerFromInfra = <E>(infra: Layer.Layer<SqliteClient, E>, options: AppLayerOptions = {}) => appLayer(infra, options, false)
export const makeAppLayer = (dbPath: string, options: AppLayerOptions = {}) => makeAppLayerFromInfra(SqliteClientLive(dbPath), options)
export const makeMinimalLayer = (dbPath: string, options: AppLayerOptions = {}) => makeMinimalLayerFromInfra(SqliteClientLive(dbPath), options)
