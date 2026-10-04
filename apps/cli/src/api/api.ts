import { SpecHealthSchema } from "@jamesaphoenix/tx"
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
  TASK_STATUSES,
  DOC_STATUSES,
  DOC_LINK_TYPES,
  INVARIANT_ENFORCEMENT_TYPES,
  DocGraphNodeSchema,
  DocGraphEdgeSchema,
  SpecDiscoveryMethodSchema,
  DiscoverResultSchema,
  FciResultSchema,
  BatchRunInputSchema,
} from "@jamesaphoenix/tx/types"

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
      case "DocNotFoundError":
      case "InvariantNotFoundError":
        return new NotFound({ message })
      case "ValidationError":
      case "CircularDependencyError":
      case "HasChildrenError":
      case "InvalidDocYamlError":
      case "DocLockedError":
        return new BadRequest({ message })
      case "DependencyNotFoundError":
        return new BadRequest({ message })
      case "LabelNotFoundError":
        return new NotFound({ message })
      case "StaleDataError":
        return new BadRequest({ message })
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
    HttpApiEndpoint.get("getTaskTree")`/api/tasks/${TaskIdParam}/tree`
      .addSuccess(TaskTreeResponse)
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
  ignoredEvents: Schema.Number.pipe(Schema.int()),
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
  ignoredEvents: Schema.Number.pipe(Schema.int()),
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
// DOCS GROUP
// =============================================================================

const DocNameParam = HttpApiSchema.param("name", SafePathString.pipe(Schema.minLength(1)))

const DocSerializedSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  docId: Schema.String,
  hash: Schema.String,
  // Any configured spec type; see [spec.types.*] in .tx/config.toml.
  kind: Schema.String,
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
  // Any configured spec type; see [spec.types.*] in .tx/config.toml.
  kind: Schema.String,
  name: SafePathString.pipe(Schema.minLength(1)),
  title: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.String.pipe(Schema.minLength(1)),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

const UpdateDocBody = Schema.Struct({
  content: Schema.String.pipe(Schema.minLength(1)),
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
  docId: Schema.String,
  name: Schema.String,
  version: Schema.Number.pipe(Schema.int()),
  filePath: Schema.String,
  content: Schema.NullOr(Schema.String),
  renderedContent: Schema.NullOr(Schema.String),
})

const DocGraphResponse = Schema.Struct({
  nodes: Schema.Array(DocGraphNodeSchema),
  edges: Schema.Array(DocGraphEdgeSchema),
})

const DocHealthIssueResponse = Schema.Struct({
  docId: Schema.String,
  docName: Schema.String,
  kind: Schema.String,
  problems: Schema.Array(Schema.String),
})

const DocHealthResponse = Schema.Struct({
  total: Schema.Number.pipe(Schema.int()),
  healthy: Schema.Number.pipe(Schema.int()),
  issues: Schema.Array(DocHealthIssueResponse),
})

const DocDeleteResponse = Schema.Struct({
  success: Schema.Boolean,
  docId: Schema.String,
  name: Schema.String,
  version: Schema.Number.pipe(Schema.int()),
})

export const DocsGroup = HttpApiGroup.make("docs")
  .add(
    HttpApiEndpoint.get("listDocs", "/api/docs")
      .setUrlParams(DocListParams)
      .addSuccess(DocListResponse)
  )
  .add(
    HttpApiEndpoint.get("getDocsHealth", "/api/docs/health")
      .addSuccess(DocHealthResponse)
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
  doc: Schema.optional(Schema.String),
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
  dryRun: Schema.optional(Schema.Boolean),
  prune: Schema.optional(Schema.Boolean),
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
  sourceRefs: Schema.optional(Schema.Array(Schema.String)),
})

const SpecMatrixResponse = Schema.Struct({
  matrix: Schema.Array(SpecMatrixEntrySchema),
})

export const SpecGroup = HttpApiGroup.make("spec")
  .add(HttpApiEndpoint.get("specHealth", "/api/spec/health").addSuccess(SpecHealthSchema))
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
  .add(SyncGroup)
  .add(DocsGroup)
  .add(InvariantsGroup)
  .add(SpecGroup)
 {}
