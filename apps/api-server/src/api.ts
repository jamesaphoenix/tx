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
  TASK_STATUSES,
  LEARNING_SOURCE_TYPES,
  RUN_STATUSES,
  DOC_KINDS,
  DOC_STATUSES,
  DOC_LINK_TYPES,
  DocGraphNodeSchema,
  DocGraphEdgeSchema,
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
        return new NotFound({ message })
      case "MessageAlreadyAckedError":
        return new BadRequest({ message })
      case "ValidationError":
      case "CircularDependencyError":
      case "HasChildrenError":
      case "InvalidDocYamlError":
      case "DocLockedError":
        return new BadRequest({ message })
      case "EmbeddingUnavailableError":
        return new ServiceUnavailable({ message })
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
    HttpApiEndpoint.get("getDocGraph", "/api/docs/graph")
      .addSuccess(DocGraphResponse)
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
  .add(DocsGroup) {}
