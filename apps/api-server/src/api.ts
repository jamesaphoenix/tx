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
  MessageSerializedSchema,
  PinSerializedSchema,
  MemoryDocumentSerializedSchema,
  MemoryDocumentWithScoreSerializedSchema,
  MemorySourceSchema,
  MemoryLinkSchema,
  MemoryPropertySchema,
  MemoryIndexStatusSchema,
  TASK_STATUSES,
  LEARNING_SOURCE_TYPES,
  RUN_STATUSES,
  DOC_KINDS,
  DOC_STATUSES,
  DOC_LINK_TYPES,
  INVARIANT_ENFORCEMENT_TYPES,
  DocGraphNodeSchema,
  DocGraphEdgeSchema,
  SpecDiscoveryMethodSchema,
  DiscoverResultSchema,
  FciResultSchema,
  BatchRunInputSchema,
  DecisionSerializedSchema,
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
export const mapCoreError = (
  e: unknown
): NotFound | BadRequest | InternalError | ServiceUnavailable | Unauthorized | Forbidden => {
  if (e && typeof e === "object" && "_tag" in e) {
    const tag = (e as { _tag: string })._tag
    const message = "message" in e ? String((e as { message: unknown }).message) : tag
    switch (tag) {
      case "NotFound":
        return new NotFound({ message })
      case "BadRequest":
        return new BadRequest({ message })
      case "InternalError":
        return new InternalError({ message })
      case "ServiceUnavailable":
        return new ServiceUnavailable({ message })
      case "Unauthorized":
        return new Unauthorized({ message })
      case "Forbidden":
        return new Forbidden({ message })
      case "TaskNotFoundError":
      case "LearningNotFoundError":
      case "FileLearningNotFoundError":
      case "AttemptNotFoundError":
      case "MessageNotFoundError":
      case "RunNotFoundError":
      case "DocNotFoundError":
      case "InvariantNotFoundError":
      case "ClaimNotFoundError":
      case "ClaimIdNotFoundError":
      case "MemoryDocumentNotFoundError":
      case "MemorySourceNotFoundError":
      case "WorkerNotFoundError":
      case "DecisionNotFoundError":
        return new NotFound({ message })
      case "DecisionAlreadyReviewedError":
      case "MessageAlreadyAckedError":
        return new BadRequest({ message })
      case "AlreadyClaimedError":
      case "LeaseExpiredError":
      case "MaxRenewalsExceededError":
        return new BadRequest({ message })
      case "ValidationError":
      case "CircularDependencyError":
      case "HasChildrenError":
      case "InvalidDocYamlError":
      case "DocLockedError":
        return new BadRequest({ message })
      case "EmbeddingUnavailableError":
      case "RetrievalError":
        return new ServiceUnavailable({ message })
      case "EmbeddingDimensionMismatchError":
      case "ZeroMagnitudeVectorError":
      case "DependencyNotFoundError":
        return new BadRequest({ message })
      case "GuardExceededError":
        return new BadRequest({ message })
      case "VerifyError":
        // "No verify command set" is a client precondition failure (400)
        // Schema/filesystem/execution failures are server-side (500)
        if (message.includes("No verify command set")) {
          return new BadRequest({ message })
        }
        return new InternalError({ message: "Verify execution failed" })
      case "LabelNotFoundError":
        return new NotFound({ message })
      case "StaleDataError":
        return new BadRequest({ message })
      case "LlmUnavailableError":
        return new ServiceUnavailable({ message })
      case "InvalidStatusError":
      case "InvalidDateError":
      case "EntityFetchError":
      case "UnexpectedRowCountError":
      case "DatabaseError":
        // Don't expose raw SQLite error messages (may contain SQL, schema details)
        return new InternalError({ message: "Internal server error" })
      default:
        return new InternalError({ message: "Internal server error" })
    }
  }
  return new InternalError({ message: "Internal server error" })
}

// =============================================================================
// SAFE PATH SCHEMA
// =============================================================================

/**
 * A Schema.String with basic path traversal protection.
 * Rejects null bytes and '..' traversal sequences at the schema level.
 * Handler-level validation still checks allowed directories (defense-in-depth).
 */
export const SafePathString = Schema.String.pipe(
  Schema.filter((s) =>
    s.includes("\0") || /(^|\/)\.\.($|\/)/.test(s)
      ? "Path must not contain null bytes or '..' traversal sequences"
      : true
  )
)

// =============================================================================
// PATH PARAMETERS
// =============================================================================

const TaskIdParam = HttpApiSchema.param("id", Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,12}$/)
))

const BlockerIdParam = HttpApiSchema.param("blockerId", Schema.String.pipe(
  Schema.pattern(/^tx-[a-z0-9]{6,12}$/)
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
  blockerId: Schema.String.pipe(Schema.pattern(/^tx-[a-z0-9]{6,12}$/)),
})

const SetGroupContextBody = Schema.Struct({
  context: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20000)),
})

// Claim schemas
const ClaimBody = Schema.Struct({
  workerId: Schema.String.pipe(Schema.minLength(1)),
  leaseDurationMinutes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
})

const ReleaseClaimBody = Schema.Struct({
  workerId: Schema.String.pipe(Schema.minLength(1)),
})

const RenewClaimBody = Schema.Struct({
  workerId: Schema.String.pipe(Schema.minLength(1)),
})

const ClaimResponse = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  taskId: Schema.String,
  workerId: Schema.String,
  claimedAt: Schema.String,
  leaseExpiresAt: Schema.String,
  renewedCount: Schema.Number.pipe(Schema.int()),
  status: Schema.String,
})

const ClaimNullableResponse = Schema.Struct({
  claim: Schema.NullOr(ClaimResponse),
})

const ClaimReleaseResponse = Schema.Struct({
  success: Schema.Boolean,
})

export const TasksGroup = HttpApiGroup.make("tasks")
  .add(
    HttpApiEndpoint.get("listTasks", "/api/tasks")
      .setUrlParams(Schema.Struct({
        cursor: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
        status: Schema.optional(Schema.String),
        search: Schema.optional(Schema.String),
        labels: Schema.optional(Schema.String),
        excludeLabels: Schema.optional(Schema.String),
      }))
      .addSuccess(PaginatedTasksResponse)
  )
  .add(
    HttpApiEndpoint.get("readyTasks", "/api/tasks/ready")
      .setUrlParams(Schema.Struct({
        limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
        labels: Schema.optional(Schema.String),
        excludeLabels: Schema.optional(Schema.String),
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
      .setUrlParams(Schema.Struct({
        cascade: Schema.optional(Schema.String)
      }))
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
    HttpApiEndpoint.put("setTaskGroupContext")`/api/tasks/${TaskIdParam}/group-context`
      .setPayload(SetGroupContextBody)
      .addSuccess(TaskWithDepsSerializedSchema)
  )
  .add(
    HttpApiEndpoint.del("clearTaskGroupContext")`/api/tasks/${TaskIdParam}/group-context`
      .addSuccess(TaskWithDepsSerializedSchema)
  )
  .add(
    HttpApiEndpoint.get("getTaskTree")`/api/tasks/${TaskIdParam}/tree`
      .addSuccess(TaskTreeResponse)
  )
  .add(
    HttpApiEndpoint.post("claimTask")`/api/tasks/${TaskIdParam}/claim`
      .setPayload(ClaimBody)
      .addSuccess(ClaimResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.del("releaseTaskClaim")`/api/tasks/${TaskIdParam}/claim`
      .setPayload(ReleaseClaimBody)
      .addSuccess(ClaimReleaseResponse)
  )
  .add(
    HttpApiEndpoint.post("renewTaskClaim")`/api/tasks/${TaskIdParam}/claim/renew`
      .setPayload(RenewClaimBody)
      .addSuccess(ClaimResponse)
  )
  .add(
    HttpApiEndpoint.get("getTaskClaim")`/api/tasks/${TaskIdParam}/claim`
      .addSuccess(ClaimNullableResponse)
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

const GraphExpansionStatsResponse = Schema.Struct({
  enabled: Schema.Boolean,
  seedCount: Schema.Number.pipe(Schema.int()),
  expandedCount: Schema.Number.pipe(Schema.int()),
  maxDepthReached: Schema.Number.pipe(Schema.int()),
})

const ContextResponse = Schema.Struct({
  taskId: Schema.String,
  taskTitle: Schema.String,
  learnings: Schema.Array(LearningWithScoreSerializedSchema),
  searchQuery: Schema.String,
  searchDuration: Schema.Number,
  graphExpansion: Schema.optional(GraphExpansionStatsResponse),
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

const RunDetailLogsSchema = Schema.Struct({
  stdout: Schema.NullOr(Schema.String),
  stderr: Schema.NullOr(Schema.String),
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
})

const RunDetailWithMessagesResponse = Schema.Struct({
  run: RunSerializedSchema,
  messages: Schema.Array(ChatMessageSchema),
  logs: RunDetailLogsSchema,
})

const CreateRunBody = Schema.Struct({
  taskId: Schema.optional(Schema.String),
  agent: Schema.String,
  pid: Schema.optional(Schema.Number.pipe(Schema.int())),
  transcriptPath: Schema.optional(SafePathString),
  contextInjected: Schema.optional(SafePathString),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const UpdateRunBody = Schema.Struct({
  status: Schema.optional(Schema.Literal(...RUN_STATUSES)),
  endedAt: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number.pipe(Schema.int())),
  summary: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  transcriptPath: Schema.optional(SafePathString),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const RunHeartbeatBody = Schema.Struct({
  stdoutBytes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
  stderrBytes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
  transcriptBytes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
  deltaBytes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
  checkAt: Schema.optional(Schema.String),
  activityAt: Schema.optional(Schema.String),
})

const RunHeartbeatResponse = Schema.Struct({
  runId: Schema.String,
  checkAt: Schema.String,
  activityAt: Schema.NullOr(Schema.String),
  stdoutBytes: Schema.Number.pipe(Schema.int()),
  stderrBytes: Schema.Number.pipe(Schema.int()),
  transcriptBytes: Schema.Number.pipe(Schema.int()),
  deltaBytes: Schema.Number.pipe(Schema.int()),
})

const StalledRunsParams = Schema.Struct({
  transcriptIdleSeconds: Schema.optional(
    Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))
  ),
  heartbeatLagSeconds: Schema.optional(
    Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))
  ),
})

const StalledRunReasonSchema = Schema.Literal("transcript_idle", "heartbeat_stale")

const StalledRunEntryResponse = Schema.Struct({
  run: RunSerializedSchema,
  reason: StalledRunReasonSchema,
  transcriptIdleSeconds: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  heartbeatLagSeconds: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  lastActivityAt: Schema.NullOr(Schema.String),
  lastCheckAt: Schema.NullOr(Schema.String),
  stdoutBytes: Schema.Number.pipe(Schema.int()),
  stderrBytes: Schema.Number.pipe(Schema.int()),
  transcriptBytes: Schema.Number.pipe(Schema.int()),
})

const StalledRunsResponse = Schema.Struct({
  runs: Schema.Array(StalledRunEntryResponse),
})

const ReapStalledBody = Schema.Struct({
  transcriptIdleSeconds: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))
  ),
  heartbeatLagSeconds: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))
  ),
  resetTask: Schema.optional(Schema.Boolean),
  dryRun: Schema.optional(Schema.Boolean),
})

const ReapedRunEntryResponse = Schema.Struct({
  id: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  pid: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  reason: StalledRunReasonSchema,
  transcriptIdleSeconds: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  heartbeatLagSeconds: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  processTerminated: Schema.Boolean,
  taskReset: Schema.Boolean,
})

const ReapedRunsResponse = Schema.Struct({
  runs: Schema.Array(ReapedRunEntryResponse),
})

const LogTailParams = Schema.Struct({
  tail: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
})

const LogContentResponse = Schema.Struct({
  content: Schema.String,
  truncated: Schema.Boolean,
})

const TraceErrorsParams = Schema.Struct({
  hours: Schema.optional(Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))),
  limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))),
})

const TraceErrorEntryResponse = Schema.Struct({
  timestamp: Schema.String,
  source: Schema.Literal("run", "span", "event"),
  runId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  name: Schema.String,
  error: Schema.String,
  durationMs: Schema.NullOr(Schema.Number.pipe(Schema.int())),
})

const TraceErrorsResponse = Schema.Struct({
  errors: Schema.Array(TraceErrorEntryResponse),
})

export const RunsGroup = HttpApiGroup.make("runs")
  .add(
    HttpApiEndpoint.get("listRuns", "/api/runs")
      .setUrlParams(RunListParams)
      .addSuccess(PaginatedRunsResponse)
  )
  .add(
    HttpApiEndpoint.get("listStalledRuns", "/api/runs/stalled")
      .setUrlParams(StalledRunsParams)
      .addSuccess(StalledRunsResponse)
  )
  .add(
    HttpApiEndpoint.post("reapStalledRuns", "/api/runs/stalled/reap")
      .setPayload(ReapStalledBody)
      .addSuccess(ReapedRunsResponse)
  )
  .add(
    HttpApiEndpoint.get("getRun")`/api/runs/${RunIdParam}`
      .addSuccess(RunDetailWithMessagesResponse)
  )
  .add(
    HttpApiEndpoint.get("getRunErrors", "/api/runs/errors")
      .setUrlParams(TraceErrorsParams)
      .addSuccess(TraceErrorsResponse)
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
  .add(
    HttpApiEndpoint.post("heartbeatRun")`/api/runs/${RunIdParam}/heartbeat`
      .setPayload(RunHeartbeatBody)
      .addSuccess(RunHeartbeatResponse)
  )
  .add(
    HttpApiEndpoint.get("getRunStdout")`/api/runs/${RunIdParam}/stdout`
      .setUrlParams(LogTailParams)
      .addSuccess(LogContentResponse)
  )
  .add(
    HttpApiEndpoint.get("getRunStderr")`/api/runs/${RunIdParam}/stderr`
      .setUrlParams(LogTailParams)
      .addSuccess(LogContentResponse)
  )
  .add(
    HttpApiEndpoint.get("getRunContext")`/api/runs/${RunIdParam}/context`
      .addSuccess(LogContentResponse)
  )

// =============================================================================
// SYNC GROUP
// =============================================================================

const ExportResultResponse = Schema.Struct({
  eventCount: Schema.Number.pipe(Schema.int()),
  streamId: Schema.String,
  path: Schema.String,
})

const ImportResultResponse = Schema.Struct({
  importedEvents: Schema.Number.pipe(Schema.int()),
  appliedEvents: Schema.Number.pipe(Schema.int()),
  streamCount: Schema.Number.pipe(Schema.int()),
})

const SyncStatusResponse = Schema.Struct({
  dbTaskCount: Schema.Number.pipe(Schema.int()),
  eventOpCount: Schema.Number.pipe(Schema.int()),
  lastExport: Schema.NullOr(Schema.String),
  lastImport: Schema.NullOr(Schema.String),
  isDirty: Schema.Boolean,
  autoSyncEnabled: Schema.Boolean,
})

const SyncStreamInfoResponse = Schema.Struct({
  streamId: Schema.String,
  nextSeq: Schema.Number.pipe(Schema.int()),
  lastSeq: Schema.Number.pipe(Schema.int()),
  eventsDir: Schema.String,
  configPath: Schema.String,
  knownStreams: Schema.Array(Schema.Struct({
    streamId: Schema.String,
    lastSeq: Schema.Number.pipe(Schema.int()),
    lastEventAt: Schema.NullOr(Schema.String),
  })),
})

const SyncHydrateResponse = Schema.Struct({
  importedEvents: Schema.Number.pipe(Schema.int()),
  appliedEvents: Schema.Number.pipe(Schema.int()),
  streamCount: Schema.Number.pipe(Schema.int()),
  rebuilt: Schema.Boolean,
})

export const SyncGroup = HttpApiGroup.make("sync")
  .add(
    HttpApiEndpoint.post("syncExport", "/api/sync/export")
      .addSuccess(ExportResultResponse)
  )
  .add(
    HttpApiEndpoint.post("syncImport", "/api/sync/import")
      .addSuccess(ImportResultResponse)
  )
  .add(
    HttpApiEndpoint.get("syncStatus", "/api/sync/status")
      .addSuccess(SyncStatusResponse)
  )
  .add(
    HttpApiEndpoint.get("syncStream", "/api/sync/stream")
      .addSuccess(SyncStreamInfoResponse)
  )
  .add(
    HttpApiEndpoint.post("syncHydrate", "/api/sync/hydrate")
      .addSuccess(SyncHydrateResponse)
  )

// =============================================================================
// MESSAGES GROUP
// =============================================================================

const MessageIdParam = HttpApiSchema.param("id", Schema.NumberFromString.pipe(Schema.int()))

const ChannelParam = HttpApiSchema.param("channel", Schema.String.pipe(Schema.minLength(1)))

const SendMessageBody = Schema.Struct({
  channel: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.String.pipe(Schema.minLength(1)),
  sender: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  ttlSeconds: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  correlationId: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const InboxParams = Schema.Struct({
  afterId: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
  limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
  sender: Schema.optional(Schema.String),
  correlationId: Schema.optional(Schema.String),
  includeAcked: Schema.optional(Schema.String),
})

const InboxResponse = Schema.Struct({
  messages: Schema.Array(MessageSerializedSchema),
  channel: Schema.String,
  count: Schema.Number.pipe(Schema.int()),
})

const AckResponse = Schema.Struct({
  message: MessageSerializedSchema,
})

const AckAllResponse = Schema.Struct({
  channel: Schema.String,
  ackedCount: Schema.Number.pipe(Schema.int()),
})

const PendingCountResponse = Schema.Struct({
  channel: Schema.String,
  count: Schema.Number.pipe(Schema.int()),
})

const GcBody = Schema.Struct({
  ackedOlderThanHours: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
})

const GcResponse = Schema.Struct({
  expired: Schema.Number.pipe(Schema.int()),
  acked: Schema.Number.pipe(Schema.int()),
})

export const MessagesGroup = HttpApiGroup.make("messages")
  .add(
    HttpApiEndpoint.post("sendMessage", "/api/messages")
      .setPayload(SendMessageBody)
      .addSuccess(MessageSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get("inbox")`/api/messages/inbox/${ChannelParam}`
      .setUrlParams(InboxParams)
      .addSuccess(InboxResponse)
  )
  .add(
    HttpApiEndpoint.post("ackMessage")`/api/messages/${MessageIdParam}/ack`
      .addSuccess(AckResponse)
  )
  .add(
    HttpApiEndpoint.post("ackAllMessages")`/api/messages/inbox/${ChannelParam}/ack`
      .addSuccess(AckAllResponse)
  )
  .add(
    HttpApiEndpoint.get("pendingCount")`/api/messages/inbox/${ChannelParam}/count`
      .addSuccess(PendingCountResponse)
  )
  .add(
    HttpApiEndpoint.post("gcMessages", "/api/messages/gc")
      .setPayload(GcBody)
      .addSuccess(GcResponse)
  )

// =============================================================================
// CYCLES GROUP
// =============================================================================

const CycleRunSchema = Schema.Struct({
  id: Schema.String,
  cycle: Schema.Number.pipe(Schema.int()),
  name: Schema.String,
  description: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  status: Schema.String,
  rounds: Schema.Number.pipe(Schema.int()),
  totalNewIssues: Schema.Number.pipe(Schema.int()),
  existingIssues: Schema.Number.pipe(Schema.int()),
  finalLoss: Schema.Number,
  converged: Schema.Boolean,
})

const RoundMetricSchema = Schema.Struct({
  cycle: Schema.Number.pipe(Schema.int()),
  round: Schema.Number.pipe(Schema.int()),
  loss: Schema.Number,
  newIssues: Schema.Number.pipe(Schema.int()),
  existingIssues: Schema.Number.pipe(Schema.int()),
  duplicates: Schema.Number.pipe(Schema.int()),
  high: Schema.Number.pipe(Schema.int()),
  medium: Schema.Number.pipe(Schema.int()),
  low: Schema.Number.pipe(Schema.int()),
})

const CycleIssueSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  severity: Schema.String,
  issueType: Schema.String,
  file: Schema.String,
  line: Schema.Number.pipe(Schema.int()),
  cycle: Schema.Number.pipe(Schema.int()),
  round: Schema.Number.pipe(Schema.int()),
})

const CycleListResponse = Schema.Struct({
  cycles: Schema.Array(CycleRunSchema),
})

const CycleDetailResponse = Schema.Struct({
  cycle: CycleRunSchema,
  roundMetrics: Schema.Array(RoundMetricSchema),
  issues: Schema.Array(CycleIssueSchema),
})

const CycleIdParam = HttpApiSchema.param("id", Schema.String.pipe(
  Schema.pattern(/^run-[a-f0-9]{8}$/)
))

const CycleDeleteResponse = Schema.Struct({
  success: Schema.Boolean,
  id: Schema.String,
  deletedIssues: Schema.Number.pipe(Schema.int()),
})

const DeleteIssuesBody = Schema.Struct({
  issueIds: Schema.Array(Schema.String),
})

const DeleteIssuesResponse = Schema.Struct({
  success: Schema.Boolean,
  deletedCount: Schema.Number.pipe(Schema.int()),
})

export const CyclesGroup = HttpApiGroup.make("cycles")
  .add(
    HttpApiEndpoint.get("listCycles", "/api/cycles")
      .addSuccess(CycleListResponse)
  )
  .add(
    HttpApiEndpoint.get("getCycle")`/api/cycles/${CycleIdParam}`
      .addSuccess(CycleDetailResponse)
  )
  .add(
    HttpApiEndpoint.del("deleteCycle")`/api/cycles/${CycleIdParam}`
      .addSuccess(CycleDeleteResponse)
  )
  .add(
    HttpApiEndpoint.post("deleteIssues", "/api/cycles/issues/delete")
      .setPayload(DeleteIssuesBody)
      .addSuccess(DeleteIssuesResponse)
  )

// =============================================================================
// DOCS GROUP
// =============================================================================

const DocNameParam = HttpApiSchema.param("name", Schema.String.pipe(Schema.minLength(1)))

const DocSerializedSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  hash: Schema.String,
  kind: Schema.Literal(...DOC_KINDS),
  name: Schema.String,
  title: Schema.String,
  version: Schema.Number.pipe(Schema.int()),
  status: Schema.Literal(...DOC_STATUSES),
  filePath: Schema.String,
  parentDocId: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  createdAt: Schema.String,
  lockedAt: Schema.NullOr(Schema.String),
})

const DocListResponse = Schema.Struct({
  docs: Schema.Array(DocSerializedSchema),
})

const DocListParams = Schema.Struct({
  kind: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
})

const CreateDocBody = Schema.Struct({
  kind: Schema.Literal(...DOC_KINDS),
  name: Schema.String.pipe(Schema.minLength(1)),
  title: Schema.String.pipe(Schema.minLength(1)),
  yamlContent: Schema.String.pipe(Schema.minLength(1)),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const UpdateDocBody = Schema.Struct({
  yamlContent: Schema.String.pipe(Schema.minLength(1)),
})

const DocLinkBody = Schema.Struct({
  fromName: Schema.String.pipe(Schema.minLength(1)),
  toName: Schema.String.pipe(Schema.minLength(1)),
  linkType: Schema.optional(Schema.Literal(...DOC_LINK_TYPES)),
})

const DocLinkResponse = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  fromDocId: Schema.Number.pipe(Schema.int()),
  toDocId: Schema.Number.pipe(Schema.int()),
  linkType: Schema.Literal(...DOC_LINK_TYPES),
  createdAt: Schema.String,
})

const RenderDocsBody = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
})

const RenderDocsResponse = Schema.Struct({
  rendered: Schema.Array(Schema.String),
})

const DocSourceResponse = Schema.Struct({
  name: Schema.String,
  filePath: Schema.String,
  yamlContent: Schema.NullOr(Schema.String),
  renderedContent: Schema.NullOr(Schema.String),
})

const DocGraphResponse = Schema.Struct({
  nodes: Schema.Array(DocGraphNodeSchema),
  edges: Schema.Array(DocGraphEdgeSchema),
})

const DocDeleteResponse = Schema.Struct({
  success: Schema.Boolean,
  name: Schema.String,
})

export const DocsGroup = HttpApiGroup.make("docs")
  .add(
    HttpApiEndpoint.get("listDocs", "/api/docs")
      .setUrlParams(DocListParams)
      .addSuccess(DocListResponse)
  )
  .add(
    HttpApiEndpoint.post("createDoc", "/api/docs")
      .setPayload(CreateDocBody)
      .addSuccess(DocSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get("getDoc")`/api/docs/${DocNameParam}`
      .addSuccess(DocSerializedSchema)
  )
  .add(
    HttpApiEndpoint.patch("updateDoc")`/api/docs/${DocNameParam}`
      .setPayload(UpdateDocBody)
      .addSuccess(DocSerializedSchema)
  )
  .add(
    HttpApiEndpoint.del("deleteDoc")`/api/docs/${DocNameParam}`
      .addSuccess(DocDeleteResponse)
  )
  .add(
    HttpApiEndpoint.post("lockDoc")`/api/docs/${DocNameParam}/lock`
      .addSuccess(DocSerializedSchema)
  )
  .add(
    HttpApiEndpoint.post("linkDocs", "/api/docs/link")
      .setPayload(DocLinkBody)
      .addSuccess(DocLinkResponse)
  )
  .add(
    HttpApiEndpoint.post("renderDocs", "/api/docs/render")
      .setPayload(RenderDocsBody)
      .addSuccess(RenderDocsResponse)
  )
  .add(
    HttpApiEndpoint.get("getDocSource")`/api/docs/${DocNameParam}/source`
      .addSuccess(DocSourceResponse)
  )
  .add(
    HttpApiEndpoint.get("getDocGraph", "/api/docs/graph")
      .addSuccess(DocGraphResponse)
  )

// =============================================================================
// PINS GROUP
// =============================================================================

const PinIdParam = HttpApiSchema.param("id", Schema.String.pipe(
  Schema.pattern(/^(?!sync$|targets$)[a-z0-9][a-z0-9._-]*[a-z0-9]$/),
  Schema.annotations({ description: "Pin ID (kebab-case, min 2 chars, not 'sync' or 'targets')" })
))

const SetPinBody = Schema.Struct({
  content: Schema.String.pipe(Schema.minLength(1), Schema.annotations({ description: "Pin content (markdown)" })),
})

const PinListResponse = Schema.Struct({
  pins: Schema.Array(PinSerializedSchema),
})

const PinSyncResponse = Schema.Struct({
  synced: Schema.Array(Schema.String),
})

const PinTargetsResponse = Schema.Struct({
  files: Schema.Array(Schema.String),
})

const SetPinTargetsBody = Schema.Struct({
  files: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
})

const PinDeleteResponse = Schema.Struct({
  deleted: Schema.Boolean,
})

export const PinsGroup = HttpApiGroup.make("pins")
  .add(
    HttpApiEndpoint.post("setPin")`/api/pins/${PinIdParam}`
      .setPayload(SetPinBody)
      .addSuccess(PinSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get("listPins", "/api/pins")
      .addSuccess(PinListResponse)
  )
  .add(
    HttpApiEndpoint.get("getPin")`/api/pins/${PinIdParam}`
      .addSuccess(PinSerializedSchema)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.del("deletePin")`/api/pins/${PinIdParam}`
      .addSuccess(PinDeleteResponse)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("syncPins", "/api/pins/sync")
      .addSuccess(PinSyncResponse)
  )
  .add(
    HttpApiEndpoint.get("getPinTargets", "/api/pins/targets")
      .addSuccess(PinTargetsResponse)
  )
  .add(
    HttpApiEndpoint.put("setPinTargets", "/api/pins/targets")
      .setPayload(SetPinTargetsBody)
      .addSuccess(PinTargetsResponse)
  )

// =============================================================================
// MEMORY GROUP
// =============================================================================

const MemoryDocIdParam = HttpApiSchema.param("id", Schema.String.pipe(
  Schema.pattern(/^mem-[a-f0-9]{12}$/)
))

const PropKeyParam = HttpApiSchema.param("key", Schema.String.pipe(Schema.minLength(1)))

const AddSourceBody = Schema.Struct({
  dir: Schema.String.pipe(Schema.minLength(1)),
  label: Schema.optional(Schema.String),
})

const RemoveSourceBody = Schema.Struct({
  dir: Schema.String.pipe(Schema.minLength(1)),
})

const SourceListResponse = Schema.Struct({
  sources: Schema.Array(MemorySourceSchema),
})

const CreateMemoryDocBody = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  properties: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  dir: Schema.optional(Schema.String),
})

const MemoryDocListResponse = Schema.Struct({
  documents: Schema.Array(MemoryDocumentSerializedSchema),
})

const MemorySearchResponse = Schema.Struct({
  results: Schema.Array(MemoryDocumentWithScoreSerializedSchema),
})

const IndexDocumentsBody = Schema.Struct({
  incremental: Schema.optional(Schema.Boolean),
})

const IndexResultResponse = Schema.Struct({
  indexed: Schema.Number.pipe(Schema.int()),
  skipped: Schema.Number.pipe(Schema.int()),
  removed: Schema.Number.pipe(Schema.int()),
})

const AddTagsBody = Schema.Struct({
  tags: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
})

const RemoveTagsBody = Schema.Struct({
  tags: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
})

const AddRelationBody = Schema.Struct({
  target: Schema.String.pipe(Schema.minLength(1)),
})

const SetPropertyBody = Schema.Struct({
  value: Schema.String.pipe(Schema.minLength(1)),
})

const PropertiesResponse = Schema.Struct({
  properties: Schema.Array(MemoryPropertySchema),
})

const LinksResponse = Schema.Struct({
  links: Schema.Array(MemoryLinkSchema),
})

const CreateLinkBody = Schema.Struct({
  sourceId: Schema.String.pipe(Schema.pattern(/^mem-[a-f0-9]{12}$/)),
  targetRef: Schema.String.pipe(Schema.minLength(1)),
})

const SuccessResponse = Schema.Struct({
  success: Schema.Boolean,
})

const MemoryDocListParams = Schema.Struct({
  source: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.String),
})

const MemorySearchParams = Schema.Struct({
  query: Schema.String.pipe(Schema.minLength(1)),
  limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
  minScore: Schema.optional(Schema.NumberFromString),
  semantic: Schema.optional(Schema.String),
  expand: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.String),
  props: Schema.optional(Schema.String),
})

export const MemoryGroup = HttpApiGroup.make("memory")
  .add(
    HttpApiEndpoint.post("addSource", "/api/memory/sources")
      .setPayload(AddSourceBody)
      .addSuccess(MemorySourceSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.del("removeSource", "/api/memory/sources")
      .setPayload(RemoveSourceBody)
      .addSuccess(SuccessResponse)
  )
  .add(
    HttpApiEndpoint.get("listSources", "/api/memory/sources")
      .addSuccess(SourceListResponse)
  )
  .add(
    HttpApiEndpoint.post("createMemoryDocument", "/api/memory/documents")
      .setPayload(CreateMemoryDocBody)
      .addSuccess(MemoryDocumentSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get("getMemoryDocument")`/api/memory/documents/${MemoryDocIdParam}`
      .addSuccess(MemoryDocumentSerializedSchema)
  )
  .add(
    HttpApiEndpoint.get("listMemoryDocuments", "/api/memory/documents")
      .setUrlParams(MemoryDocListParams)
      .addSuccess(MemoryDocListResponse)
  )
  .add(
    HttpApiEndpoint.get("searchMemoryDocuments", "/api/memory/search")
      .setUrlParams(MemorySearchParams)
      .addSuccess(MemorySearchResponse)
  )
  .add(
    HttpApiEndpoint.post("indexMemoryDocuments", "/api/memory/index")
      .setPayload(IndexDocumentsBody)
      .addSuccess(IndexResultResponse)
  )
  .add(
    HttpApiEndpoint.get("getMemoryIndexStatus", "/api/memory/index/status")
      .addSuccess(MemoryIndexStatusSchema)
  )
  .add(
    HttpApiEndpoint.post("addMemoryTags")`/api/memory/documents/${MemoryDocIdParam}/tags`
      .setPayload(AddTagsBody)
      .addSuccess(MemoryDocumentSerializedSchema)
  )
  .add(
    HttpApiEndpoint.del("removeMemoryTags")`/api/memory/documents/${MemoryDocIdParam}/tags`
      .setPayload(RemoveTagsBody)
      .addSuccess(MemoryDocumentSerializedSchema)
  )
  .add(
    HttpApiEndpoint.post("addMemoryRelation")`/api/memory/documents/${MemoryDocIdParam}/relate`
      .setPayload(AddRelationBody)
      .addSuccess(MemoryDocumentSerializedSchema)
  )
  .add(
    HttpApiEndpoint.put("setMemoryProperty")`/api/memory/documents/${MemoryDocIdParam}/props/${PropKeyParam}`
      .setPayload(SetPropertyBody)
      .addSuccess(SuccessResponse)
  )
  .add(
    HttpApiEndpoint.del("removeMemoryProperty")`/api/memory/documents/${MemoryDocIdParam}/props/${PropKeyParam}`
      .addSuccess(SuccessResponse)
  )
  .add(
    HttpApiEndpoint.get("getMemoryProperties")`/api/memory/documents/${MemoryDocIdParam}/props`
      .addSuccess(PropertiesResponse)
  )
  .add(
    HttpApiEndpoint.get("getMemoryLinks")`/api/memory/documents/${MemoryDocIdParam}/links`
      .addSuccess(LinksResponse)
  )
  .add(
    HttpApiEndpoint.get("getMemoryBacklinks")`/api/memory/documents/${MemoryDocIdParam}/backlinks`
      .addSuccess(LinksResponse)
  )
  .add(
    HttpApiEndpoint.post("createMemoryLink", "/api/memory/links")
      .setPayload(CreateLinkBody)
      .addSuccess(SuccessResponse, { status: 201 })
  )

// INVARIANTS GROUP
// =============================================================================

const InvariantIdParam = HttpApiSchema.param("id", Schema.String.pipe(Schema.minLength(1)))

const InvariantSerializedSchema = Schema.Struct({
  id: Schema.String,
  rule: Schema.String,
  enforcement: Schema.Literal(...INVARIANT_ENFORCEMENT_TYPES),
  docId: Schema.Number.pipe(Schema.int()),
  subsystem: Schema.NullOr(Schema.String),
  status: Schema.String,
  testRef: Schema.NullOr(Schema.String),
  lintRule: Schema.NullOr(Schema.String),
  promptRef: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})

const InvariantCheckSerializedSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  invariantId: Schema.String,
  passed: Schema.Boolean,
  details: Schema.NullOr(Schema.String),
  durationMs: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  checkedAt: Schema.String,
})

const InvariantListResponse = Schema.Struct({
  invariants: Schema.Array(InvariantSerializedSchema),
})

const InvariantListParams = Schema.Struct({
  subsystem: Schema.optional(Schema.String),
  enforcement: Schema.optional(Schema.String),
})

const RecordCheckBody = Schema.Struct({
  passed: Schema.Boolean,
  details: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
})

export const InvariantsGroup = HttpApiGroup.make("invariants")
  .add(
    HttpApiEndpoint.get("listInvariants", "/api/invariants")
      .setUrlParams(InvariantListParams)
      .addSuccess(InvariantListResponse)
  )
  .add(
    HttpApiEndpoint.get("getInvariant")`/api/invariants/${InvariantIdParam}`
      .addSuccess(InvariantSerializedSchema)
  )
  .add(
    HttpApiEndpoint.post("recordInvariantCheck")`/api/invariants/${InvariantIdParam}/check`
      .setPayload(RecordCheckBody)
      .addSuccess(InvariantCheckSerializedSchema, { status: 201 })
  )

// =============================================================================
// SPEC TRACEABILITY GROUP
// =============================================================================

const SpecInvariantIdParam = HttpApiSchema.param("invariantId", Schema.String.pipe(Schema.minLength(1)))

const SpecScopeParams = Schema.Struct({
  doc: Schema.optional(Schema.String),
  subsystem: Schema.optional(Schema.String),
})

const SpecTestSerializedSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  invariantId: Schema.String,
  testId: Schema.String,
  testFile: Schema.String,
  testName: Schema.NullOr(Schema.String),
  framework: Schema.NullOr(Schema.String),
  discovery: SpecDiscoveryMethodSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

const SpecTestsResponse = Schema.Struct({
  tests: Schema.Array(SpecTestSerializedSchema),
})

const SpecGapSchema = Schema.Struct({
  id: Schema.String,
  rule: Schema.String,
  subsystem: Schema.NullOr(Schema.String),
  docName: Schema.String,
})

const SpecGapsResponse = Schema.Struct({
  gaps: Schema.Array(SpecGapSchema),
})

const SpecDiscoverBody = Schema.Struct({
  doc: Schema.optional(Schema.String),
  patterns: Schema.optional(Schema.Array(Schema.String.pipe(Schema.minLength(1)))),
})

const SpecLinkBody = Schema.Struct({
  invariantId: Schema.String.pipe(Schema.minLength(1)),
  file: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.optional(Schema.String),
  framework: Schema.optional(Schema.String),
})

const SpecUnlinkBody = Schema.Struct({
  invariantId: Schema.String.pipe(Schema.minLength(1)),
  testId: Schema.String.pipe(Schema.minLength(1)),
})

const SpecRunBody = Schema.Struct({
  testId: Schema.String.pipe(Schema.minLength(1)),
  passed: Schema.Boolean,
  durationMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
  details: Schema.optional(Schema.String),
  runAt: Schema.optional(Schema.String),
})

const SPEC_BATCH_RAW_MAX_BYTES = 5 * 1024 * 1024
const SPEC_BATCH_MAX_RECORDS = 50_000

const SpecBatchBody = Schema.Struct({
  from: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.String.pipe(Schema.maxLength(SPEC_BATCH_RAW_MAX_BYTES))),
  results: Schema.optional(Schema.Array(BatchRunInputSchema).pipe(Schema.maxItems(SPEC_BATCH_MAX_RECORDS))),
  runAt: Schema.optional(Schema.String),
})

const SpecBatchResultSchema = Schema.Struct({
  received: Schema.Number.pipe(Schema.int()),
  recorded: Schema.Number.pipe(Schema.int()),
  unmatched: Schema.Array(Schema.String),
})

const SpecStatusResultSchema = Schema.Struct({
  phase: Schema.Literal("BUILD", "HARDEN", "COMPLETE"),
  fci: Schema.Number,
  gaps: Schema.Number.pipe(Schema.int()),
  total: Schema.Number.pipe(Schema.int()),
  covered: Schema.Number.pipe(Schema.int()),
  uncovered: Schema.Number.pipe(Schema.int()),
  passing: Schema.Number.pipe(Schema.int()),
  failing: Schema.Number.pipe(Schema.int()),
  untested: Schema.Number.pipe(Schema.int()),
  signedOff: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
})

const SpecSignoffSerializedSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  scopeType: Schema.Literal("doc", "subsystem", "global"),
  scopeValue: Schema.NullOr(Schema.String),
  signedOffBy: Schema.String,
  notes: Schema.NullOr(Schema.String),
  signedOffAt: Schema.String,
})

const SpecCompleteBody = Schema.Struct({
  doc: Schema.optional(Schema.String),
  subsystem: Schema.optional(Schema.String),
  signedOffBy: Schema.String.pipe(Schema.minLength(1)),
  notes: Schema.optional(Schema.String),
})

const SpecInvariantsForTestParams = Schema.Struct({
  testId: Schema.String.pipe(Schema.minLength(1)),
})

const SpecInvariantsForTestResponse = Schema.Struct({
  testId: Schema.String,
  invariants: Schema.Array(Schema.String),
})

const SpecMatrixLatestRunSchema = Schema.Struct({
  passed: Schema.NullOr(Schema.Boolean),
  runAt: Schema.NullOr(Schema.String),
})

const SpecMatrixTestSchema = Schema.Struct({
  specTestId: Schema.Number.pipe(Schema.int()),
  testId: Schema.String,
  testFile: Schema.String,
  testName: Schema.NullOr(Schema.String),
  framework: Schema.NullOr(Schema.String),
  discovery: SpecDiscoveryMethodSchema,
  latestRun: SpecMatrixLatestRunSchema,
})

const SpecMatrixEntrySchema = Schema.Struct({
  invariantId: Schema.String,
  rule: Schema.String,
  subsystem: Schema.NullOr(Schema.String),
  tests: Schema.Array(SpecMatrixTestSchema),
})

const SpecMatrixResponse = Schema.Struct({
  matrix: Schema.Array(SpecMatrixEntrySchema),
})

export const SpecGroup = HttpApiGroup.make("spec")
  .add(
    HttpApiEndpoint.post("discoverSpec", "/api/spec/discover")
      .setPayload(SpecDiscoverBody)
      .addSuccess(DiscoverResultSchema)
  )
  .add(
    HttpApiEndpoint.get("listSpecTests")`/api/spec/tests/${SpecInvariantIdParam}`
      .addSuccess(SpecTestsResponse)
  )
  .add(
    HttpApiEndpoint.get("listSpecGaps", "/api/spec/gaps")
      .setUrlParams(SpecScopeParams)
      .addSuccess(SpecGapsResponse)
  )
  .add(
    HttpApiEndpoint.get("getSpecFci", "/api/spec/fci")
      .setUrlParams(SpecScopeParams)
      .addSuccess(FciResultSchema)
  )
  .add(
    HttpApiEndpoint.get("getSpecMatrix", "/api/spec/matrix")
      .setUrlParams(SpecScopeParams)
      .addSuccess(SpecMatrixResponse)
  )
  .add(
    HttpApiEndpoint.get("getSpecStatus", "/api/spec/status")
      .setUrlParams(SpecScopeParams)
      .addSuccess(SpecStatusResultSchema)
  )
  .add(
    HttpApiEndpoint.get("listSpecInvariantsForTest", "/api/spec/invariants")
      .setUrlParams(SpecInvariantsForTestParams)
      .addSuccess(SpecInvariantsForTestResponse)
  )
  .add(
    HttpApiEndpoint.post("linkSpecTest", "/api/spec/link")
      .setPayload(SpecLinkBody)
      .addSuccess(SpecTestSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.post("unlinkSpecTest", "/api/spec/unlink")
      .setPayload(SpecUnlinkBody)
      .addSuccess(Schema.Struct({ removed: Schema.Boolean }))
  )
  .add(
    HttpApiEndpoint.post("recordSpecRun", "/api/spec/run")
      .setPayload(SpecRunBody)
      .addSuccess(SpecBatchResultSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.post("batchSpecRuns", "/api/spec/batch")
      .setPayload(SpecBatchBody)
      .addSuccess(SpecBatchResultSchema)
  )
  .add(
    HttpApiEndpoint.post("completeSpec", "/api/spec/complete")
      .setPayload(SpecCompleteBody)
      .addSuccess(SpecSignoffSerializedSchema)
  )

// =============================================================================
// GUARDS GROUP
// =============================================================================

const GuardSetBody = Schema.Struct({
  scope: Schema.optional(Schema.String),
  maxPending: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
  maxChildren: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
  maxDepth: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
  enforce: Schema.optional(Schema.Boolean),
})

const GuardSerializedSchema = Schema.Struct({
  id: Schema.Number,
  scope: Schema.String,
  maxPending: Schema.NullOr(Schema.Number),
  maxChildren: Schema.NullOr(Schema.Number),
  maxDepth: Schema.NullOr(Schema.Number),
  enforce: Schema.Boolean,
  createdAt: Schema.String,
})

const GuardListResponse = Schema.Struct({
  guards: Schema.Array(GuardSerializedSchema),
})

const GuardCheckResponse = Schema.Struct({
  passed: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
})

const GuardClearParams = Schema.Struct({
  scope: Schema.optional(Schema.String),
})

export const GuardsGroup = HttpApiGroup.make("guards")
  .add(
    HttpApiEndpoint.post("setGuard", "/api/guards")
      .setPayload(GuardSetBody)
      .addSuccess(GuardSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get("listGuards", "/api/guards")
      .addSuccess(GuardListResponse)
  )
  .add(
    HttpApiEndpoint.del("clearGuards", "/api/guards")
      .setUrlParams(GuardClearParams)
      .addSuccess(Schema.Struct({ cleared: Schema.Boolean }))
  )
  .add(
    HttpApiEndpoint.get("checkGuard", "/api/guards/check")
      .setUrlParams(Schema.Struct({
        parentId: Schema.optional(Schema.String),
      }))
      .addSuccess(GuardCheckResponse)
  )

// =============================================================================
// VERIFY GROUP
// =============================================================================

const VerifySetBody = Schema.Struct({
  cmd: Schema.String.pipe(Schema.minLength(1)),
  schema: Schema.optional(Schema.String),
})

const VerifyShowResponse = Schema.Struct({
  cmd: Schema.NullOr(Schema.String),
  schema: Schema.NullOr(Schema.String),
})

const VerifyRunResponse = Schema.Struct({
  taskId: Schema.String,
  exitCode: Schema.Number,
  passed: Schema.Boolean,
  stdout: Schema.String,
  stderr: Schema.String,
  durationMs: Schema.Number,
  output: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  schemaValid: Schema.optional(Schema.Boolean),
})

const VerifyRunParams = Schema.Struct({
  timeout: Schema.optional(Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThan(0))),
})

export const VerifyGroup = HttpApiGroup.make("verify")
  .add(
    HttpApiEndpoint.put("setVerify")`/api/tasks/${TaskIdParam}/verify`
      .setPayload(VerifySetBody)
      .addSuccess(Schema.Struct({ message: Schema.String }), { status: 200 })
  )
  .add(
    HttpApiEndpoint.get("showVerify")`/api/tasks/${TaskIdParam}/verify`
      .addSuccess(VerifyShowResponse)
  )
  .add(
    HttpApiEndpoint.post("runVerify")`/api/tasks/${TaskIdParam}/verify/run`
      .setUrlParams(VerifyRunParams)
      .addSuccess(VerifyRunResponse)
  )
  .add(
    HttpApiEndpoint.del("clearVerify")`/api/tasks/${TaskIdParam}/verify`
      .addSuccess(Schema.Struct({ message: Schema.String }))
  )

// =============================================================================
// REFLECT GROUP
// =============================================================================

const ReflectSignalSchema = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  severity: Schema.Literal("info", "warning", "critical"),
})

const StuckTaskSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  failedAttempts: Schema.Number,
  lastError: Schema.NullOr(Schema.String),
})

const ReflectResponse = Schema.Struct({
  sessions: Schema.Struct({
    total: Schema.Number,
    completed: Schema.Number,
    failed: Schema.Number,
    timeout: Schema.Number,
    avgDurationMinutes: Schema.Number,
  }),
  throughput: Schema.Struct({
    created: Schema.Number,
    completed: Schema.Number,
    net: Schema.Number,
    completionRate: Schema.Number,
  }),
  proliferation: Schema.Struct({
    avgCreatedPerSession: Schema.Number,
    maxCreatedPerSession: Schema.Number,
    maxDepth: Schema.Number,
    orphanChains: Schema.Number,
  }),
  stuckTasks: Schema.Array(StuckTaskSchema),
  signals: Schema.Array(ReflectSignalSchema),
  analysis: Schema.NullOr(Schema.String),
})

const ReflectParams = Schema.Struct({
  sessions: Schema.optional(Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThan(0))),
  hours: Schema.optional(Schema.NumberFromString.pipe(Schema.greaterThan(0))),
  analyze: Schema.optional(Schema.Literal("true", "false")),
})

export const ReflectGroup = HttpApiGroup.make("reflect")
  .add(
    HttpApiEndpoint.get("reflect", "/api/reflect")
      .setUrlParams(ReflectParams)
      .addSuccess(ReflectResponse)
  )

// =============================================================================
// DECISIONS GROUP
// =============================================================================

const DecisionIdParam = HttpApiSchema.param("id", Schema.String.pipe(
  Schema.pattern(/^dec-[a-f0-9]{12}$/)
))

const CreateDecisionBody = Schema.Struct({
  content: Schema.String.pipe(Schema.minLength(1)),
  question: Schema.optional(Schema.NullOr(Schema.String)),
  source: Schema.optional(Schema.Literal("manual", "diff", "transcript", "agent")),
  taskId: Schema.optional(Schema.NullOr(Schema.String)),
  docId: Schema.optional(Schema.NullOr(Schema.Number)),
  commitSha: Schema.optional(Schema.NullOr(Schema.String)),
})

const DecisionListParams = Schema.Struct({
  status: Schema.optional(Schema.Literal("pending", "approved", "rejected", "edited", "superseded")),
  source: Schema.optional(Schema.Literal("manual", "diff", "transcript", "agent")),
  limit: Schema.optional(Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThan(0))),
})

const DecisionListResponse = Schema.Struct({
  decisions: Schema.Array(DecisionSerializedSchema),
})

const ApproveDecisionBody = Schema.Struct({
  reviewer: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
})

const RejectDecisionBody = Schema.Struct({
  reviewer: Schema.optional(Schema.String),
  reason: Schema.String.pipe(Schema.minLength(1)),
})

const EditDecisionBody = Schema.Struct({
  content: Schema.String.pipe(Schema.minLength(1)),
  reviewer: Schema.optional(Schema.String),
})

export const DecisionsGroup = HttpApiGroup.make("decisions")
  .add(
    HttpApiEndpoint.post("createDecision", "/api/decisions")
      .setPayload(CreateDecisionBody)
      .addSuccess(DecisionSerializedSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get("listDecisions", "/api/decisions")
      .setUrlParams(DecisionListParams)
      .addSuccess(DecisionListResponse)
  )
  .add(
    HttpApiEndpoint.get("getDecision")`/api/decisions/${DecisionIdParam}`
      .addSuccess(DecisionSerializedSchema)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("approveDecision")`/api/decisions/${DecisionIdParam}/approve`
      .setPayload(ApproveDecisionBody)
      .addSuccess(DecisionSerializedSchema)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("rejectDecision")`/api/decisions/${DecisionIdParam}/reject`
      .setPayload(RejectDecisionBody)
      .addSuccess(DecisionSerializedSchema)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("editDecision")`/api/decisions/${DecisionIdParam}/edit`
      .setPayload(EditDecisionBody)
      .addSuccess(DecisionSerializedSchema)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get("pendingDecisions", "/api/decisions/pending")
      .addSuccess(DecisionListResponse)
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
  .add(SyncGroup)
  .add(MessagesGroup)
  .add(CyclesGroup)
  .add(DocsGroup)
  .add(PinsGroup)
  .add(MemoryGroup)
  .add(InvariantsGroup)
  .add(SpecGroup)
  .add(GuardsGroup)
  .add(VerifyGroup)
  .add(ReflectGroup)
  .add(DecisionsGroup) {}
