/**
 * TX API Definition
 *
 * Declarative API definition using Effect HttpApi.
 * Defines all endpoints, groups, errors, and their schemas.
 * Handlers are implemented separately in routes/*.ts files.
 */

import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"
import {
  TaskWithDepsSerializedSchema,
  LearningWithScoreSerializedSchema,
  LearningSerializedSchema,
  FileLearningsSerializedSchema,
  RunSerializedSchema,
  TASK_STATUSES,
  LEARNING_SOURCE_TYPES,
  RUN_STATUSES,
} from "@jamesaphoenix/tx-types"

// =============================================================================
// ERROR TYPES
// =============================================================================

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}

export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  message: Schema.String,
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()("InternalError", {
  message: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  message: Schema.String,
}) {}

export class ServiceUnavailable extends Schema.TaggedError<ServiceUnavailable>()("ServiceUnavailable", {
  message: Schema.String,
}) {}

// =============================================================================
// ERROR MAPPING HELPER
// =============================================================================

/**
 * Maps tx-core tagged errors to API error types.
 * Used by all route handlers for consistent error handling.
 */
export const mapCoreError = (e: unknown): NotFound | BadRequest | InternalError | ServiceUnavailable => {
  if (e && typeof e === "object" && "_tag" in e) {
    const tag = (e as { _tag: string })._tag
    const message = "message" in e ? String((e as { message: unknown }).message) : tag
    switch (tag) {
      case "TaskNotFoundError":
      case "LearningNotFoundError":
      case "FileLearningNotFoundError":
      case "AttemptNotFoundError":
        return new NotFound({ message })
      case "ValidationError":
      case "CircularDependencyError":
        return new BadRequest({ message })
      case "EmbeddingUnavailableError":
        return new ServiceUnavailable({ message })
      case "DatabaseError":
      default:
        return new InternalError({ message })
    }
  }
  return new InternalError({ message: String(e) })
}

// =============================================================================
// PATH PARAMETERS
// =============================================================================

const TaskIdParam = HttpApiSchema.param("id", Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,8}$/)
))

const BlockerIdParam = HttpApiSchema.param("blockerId", Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,8}$/)
))

const LearningIdParam = HttpApiSchema.param("id", Schema.NumberFromString.pipe(Schema.int()))

const RunIdParam = HttpApiSchema.param("id", Schema.String.pipe(
  Schema.pattern(/^run-[a-f0-9]{8}$/)
))

const TaskIdContextParam = HttpApiSchema.param("taskId", Schema.String)

// =============================================================================
// HEALTH GROUP
// =============================================================================

const HealthResponse = Schema.Struct({
  status: Schema.Literal("healthy", "degraded", "unhealthy"),
  timestamp: Schema.String,
  version: Schema.String,
  database: Schema.Struct({
    connected: Schema.Boolean,
    path: Schema.NullOr(Schema.String),
  }),
})

const StatsResponse = Schema.Struct({
  tasks: Schema.Number.pipe(Schema.int()),
  done: Schema.Number.pipe(Schema.int()),
  ready: Schema.Number.pipe(Schema.int()),
  learnings: Schema.Number.pipe(Schema.int()),
  runsRunning: Schema.optional(Schema.Number.pipe(Schema.int())),
  runsTotal: Schema.optional(Schema.Number.pipe(Schema.int())),
})

const RalphResponse = Schema.Struct({
  running: Schema.Boolean,
  pid: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  currentIteration: Schema.Number.pipe(Schema.int()),
  currentTask: Schema.NullOr(Schema.String),
  recentActivity: Schema.Array(Schema.Struct({
    timestamp: Schema.String,
    iteration: Schema.Number.pipe(Schema.int()),
    task: Schema.String,
    taskTitle: Schema.String,
    agent: Schema.String,
    status: Schema.Literal("started", "completed", "failed"),
  })),
})

export const HealthGroup = HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("health", "/health")
      .addSuccess(HealthResponse)
  )
  .add(
    HttpApiEndpoint.get("stats", "/api/stats")
      .addSuccess(StatsResponse)
  )
  .add(
    HttpApiEndpoint.get("ralph", "/api/ralph")
      .addSuccess(RalphResponse)
  )

// =============================================================================
// TASKS GROUP
// =============================================================================

const PaginatedTasksResponse = Schema.Struct({
  tasks: Schema.Array(TaskWithDepsSerializedSchema),
  nextCursor: Schema.NullOr(Schema.String),
  hasMore: Schema.Boolean,
  total: Schema.Number.pipe(Schema.int()),
})

const TaskDetailResponse = Schema.Struct({
  task: TaskWithDepsSerializedSchema,
  blockedByTasks: Schema.Array(TaskWithDepsSerializedSchema),
  blocksTasks: Schema.Array(TaskWithDepsSerializedSchema),
  childTasks: Schema.Array(TaskWithDepsSerializedSchema),
})

const TaskCompletionResponse = Schema.Struct({
  task: TaskWithDepsSerializedSchema,
  nowReady: Schema.Array(TaskWithDepsSerializedSchema),
})

const TaskDeleteResponse = Schema.Struct({
  success: Schema.Boolean,
  id: Schema.String,
})

const TaskTreeResponse = Schema.Struct({
  tasks: Schema.Array(TaskWithDepsSerializedSchema),
})

const ReadyTasksResponse = Schema.Struct({
  tasks: Schema.Array(TaskWithDepsSerializedSchema),
})

const CreateTaskBody = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.String),
  score: Schema.optional(Schema.Number.pipe(Schema.int())),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const UpdateTaskBody = Schema.Struct({
  title: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  description: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literal(...TASK_STATUSES)),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  score: Schema.optional(Schema.Number.pipe(Schema.int())),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const BlockBody = Schema.Struct({
  blockerId: Schema.String.pipe(Schema.pattern(/^tx-[a-z0-9]{6,8}$/)),
})

export const TasksGroup = HttpApiGroup.make("tasks")
  .add(
    HttpApiEndpoint.get("listTasks", "/api/tasks")
      .setUrlParams(Schema.Struct({
        cursor: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
        status: Schema.optional(Schema.String),
        search: Schema.optional(Schema.String),
      }))
      .addSuccess(PaginatedTasksResponse)
  )
  .add(
    HttpApiEndpoint.get("readyTasks", "/api/tasks/ready")
      .setUrlParams(Schema.Struct({
        limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
      }))
      .addSuccess(ReadyTasksResponse)
  )
  .add(
    HttpApiEndpoint.get("getTask")`/api/tasks/${TaskIdParam}`
      .addSuccess(TaskDetailResponse)
  )
  .add(
    HttpApiEndpoint.post("createTask", "/api/tasks")
      .setPayload(CreateTaskBody)
      .addSuccess(TaskWithDepsSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch("updateTask")`/api/tasks/${TaskIdParam}`
      .setPayload(UpdateTaskBody)
      .addSuccess(TaskWithDepsSerializedSchema)
  )
  .add(
    HttpApiEndpoint.post("completeTask")`/api/tasks/${TaskIdParam}/done`
      .addSuccess(TaskCompletionResponse)
  )
  .add(
    HttpApiEndpoint.del("deleteTask")`/api/tasks/${TaskIdParam}`
      .addSuccess(TaskDeleteResponse)
  )
  .add(
    HttpApiEndpoint.post("blockTask")`/api/tasks/${TaskIdParam}/block`
      .setPayload(BlockBody)
      .addSuccess(TaskWithDepsSerializedSchema)
  )
  .add(
    HttpApiEndpoint.del("unblockTask")`/api/tasks/${TaskIdParam}/block/${BlockerIdParam}`
      .addSuccess(TaskWithDepsSerializedSchema)
  )
  .add(
    HttpApiEndpoint.get("getTaskTree")`/api/tasks/${TaskIdParam}/tree`
      .addSuccess(TaskTreeResponse)
  )

// =============================================================================
// LEARNINGS GROUP
// =============================================================================

const LearningSearchParams = Schema.Struct({
  query: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
  minScore: Schema.optional(Schema.NumberFromString),
  category: Schema.optional(Schema.String),
})

const LearningSearchResponse = Schema.Struct({
  learnings: Schema.Array(LearningWithScoreSerializedSchema),
})

const CreateLearningBody = Schema.Struct({
  content: Schema.String.pipe(Schema.minLength(1)),
  sourceType: Schema.optional(Schema.Literal(...LEARNING_SOURCE_TYPES)),
  sourceRef: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
})

const HelpfulnessBody = Schema.Struct({
  score: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0), Schema.lessThanOrEqualTo(1)),
})

const HelpfulnessResponse = Schema.Struct({
  success: Schema.Boolean,
  id: Schema.Number.pipe(Schema.int()),
  score: Schema.Number,
})

const ContextResponse = Schema.Struct({
  taskId: Schema.String,
  taskTitle: Schema.String,
  learnings: Schema.Array(LearningWithScoreSerializedSchema),
  searchQuery: Schema.String,
  searchDuration: Schema.Number,
})

const FileLearningListResponse = Schema.Struct({
  learnings: Schema.Array(FileLearningsSerializedSchema),
})

const CreateFileLearningBody = Schema.Struct({
  filePattern: Schema.String.pipe(Schema.minLength(1)),
  note: Schema.String.pipe(Schema.minLength(1)),
  taskId: Schema.optional(Schema.String),
})

export const LearningsGroup = HttpApiGroup.make("learnings")
  .add(
    HttpApiEndpoint.get("searchLearnings", "/api/learnings")
      .setUrlParams(LearningSearchParams)
      .addSuccess(LearningSearchResponse)
  )
  .add(
    HttpApiEndpoint.get("getLearning")`/api/learnings/${LearningIdParam}`
      .addSuccess(LearningSerializedSchema)
  )
  .add(
    HttpApiEndpoint.post("createLearning", "/api/learnings")
      .setPayload(CreateLearningBody)
      .addSuccess(LearningSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.post("updateHelpfulness")`/api/learnings/${LearningIdParam}/helpful`
      .setPayload(HelpfulnessBody)
      .addSuccess(HelpfulnessResponse)
  )
  .add(
    HttpApiEndpoint.get("getContext")`/api/context/${TaskIdContextParam}`
      .addSuccess(ContextResponse)
  )
  .add(
    HttpApiEndpoint.get("listFileLearnings", "/api/file-learnings")
      .setUrlParams(Schema.Struct({
        path: Schema.optional(Schema.String),
      }))
      .addSuccess(FileLearningListResponse)
  )
  .add(
    HttpApiEndpoint.post("createFileLearning", "/api/file-learnings")
      .setPayload(CreateFileLearningBody)
      .addSuccess(FileLearningsSerializedSchema, { status: 201 })
  )

// =============================================================================
// RUNS GROUP
// =============================================================================

const RunListParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
  agent: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
})

const PaginatedRunsResponse = Schema.Struct({
  runs: Schema.Array(RunSerializedSchema),
  nextCursor: Schema.NullOr(Schema.String),
  hasMore: Schema.Boolean,
  total: Schema.Number.pipe(Schema.int()),
})

const ChatMessageSchema = Schema.Struct({
  role: Schema.Literal("user", "assistant", "system"),
  content: Schema.Unknown,
  type: Schema.optional(Schema.Literal("tool_use", "tool_result", "text", "thinking")),
  tool_name: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
})

const RunDetailWithMessagesResponse = Schema.Struct({
  run: RunSerializedSchema,
  messages: Schema.Array(ChatMessageSchema),
})

const CreateRunBody = Schema.Struct({
  taskId: Schema.optional(Schema.String),
  agent: Schema.String,
  pid: Schema.optional(Schema.Number.pipe(Schema.int())),
  transcriptPath: Schema.optional(Schema.String),
  contextInjected: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const UpdateRunBody = Schema.Struct({
  status: Schema.optional(Schema.Literal(...RUN_STATUSES)),
  endedAt: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number.pipe(Schema.int())),
  summary: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  transcriptPath: Schema.optional(Schema.String),
})

export const RunsGroup = HttpApiGroup.make("runs")
  .add(
    HttpApiEndpoint.get("listRuns", "/api/runs")
      .setUrlParams(RunListParams)
      .addSuccess(PaginatedRunsResponse)
  )
  .add(
    HttpApiEndpoint.get("getRun")`/api/runs/${RunIdParam}`
      .addSuccess(RunDetailWithMessagesResponse)
  )
  .add(
    HttpApiEndpoint.post("createRun", "/api/runs")
      .setPayload(CreateRunBody)
      .addSuccess(RunSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch("updateRun")`/api/runs/${RunIdParam}`
      .setPayload(UpdateRunBody)
      .addSuccess(RunSerializedSchema)
  )

// =============================================================================
// SYNC GROUP
// =============================================================================

const SyncPathBody = Schema.Struct({
  path: Schema.optional(Schema.String),
})

const ExportResultResponse = Schema.Struct({
  opCount: Schema.Number.pipe(Schema.int()),
  path: Schema.String,
})

const ImportResultResponse = Schema.Struct({
  imported: Schema.Number.pipe(Schema.int()),
  skipped: Schema.Number.pipe(Schema.int()),
  conflicts: Schema.Number.pipe(Schema.int()),
})

const SyncStatusResponse = Schema.Struct({
  dbTaskCount: Schema.Number.pipe(Schema.int()),
  jsonlOpCount: Schema.Number.pipe(Schema.int()),
  lastExport: Schema.NullOr(Schema.String),
  lastImport: Schema.NullOr(Schema.String),
  isDirty: Schema.Boolean,
  autoSyncEnabled: Schema.Boolean,
})

const CompactResultResponse = Schema.Struct({
  before: Schema.Number.pipe(Schema.int()),
  after: Schema.Number.pipe(Schema.int()),
})

export const SyncGroup = HttpApiGroup.make("sync")
  .add(
    HttpApiEndpoint.post("syncExport", "/api/sync/export")
      .setPayload(SyncPathBody)
      .addSuccess(ExportResultResponse)
  )
  .add(
    HttpApiEndpoint.post("syncImport", "/api/sync/import")
      .setPayload(SyncPathBody)
      .addSuccess(ImportResultResponse)
  )
  .add(
    HttpApiEndpoint.get("syncStatus", "/api/sync/status")
      .addSuccess(SyncStatusResponse)
  )
  .add(
    HttpApiEndpoint.post("syncCompact", "/api/sync/compact")
      .setPayload(SyncPathBody)
      .addSuccess(CompactResultResponse)
  )

// =============================================================================
// TOP-LEVEL API
// =============================================================================

export class TxApi extends HttpApi.make("tx")
  .addError(NotFound, { status: 404 })
  .addError(BadRequest, { status: 400 })
  .addError(InternalError, { status: 500 })
  .addError(Unauthorized, { status: 401 })
  .addError(Forbidden, { status: 403 })
  .addError(ServiceUnavailable, { status: 503 })
  .add(HealthGroup)
  .add(TasksGroup)
  .add(LearningsGroup)
  .add(RunsGroup)
  .add(SyncGroup) {}
