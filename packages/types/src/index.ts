/**
 * @tx/types - Shared TypeScript types for tx
 *
 * Effect Schema definitions providing both compile-time types and runtime validation.
 * Works with any runtime (Node, Bun, Deno).
 *
 * @example
 * ```typescript
 * import { Task, TaskWithDeps, TaskId, TaskStatus } from "@jamesaphoenix/tx-types";
 * import { TaskSchema, TaskWithDepsSchema } from "@jamesaphoenix/tx-types";
 * import { Learning, LearningWithScore } from "@jamesaphoenix/tx-types";
 * import { Attempt, Run } from "@jamesaphoenix/tx-types";
 *
 * // Or import from specific modules:
 * import { TaskSchema, type Task, type TaskWithDeps } from "@tx/types/task";
 * import { LearningSchema, type Learning } from "@tx/types/learning";
 * ```
 */

// Task types & schemas
export {
  TASK_STATUSES,
  TASK_ASSIGNEE_TYPES,
  VALID_TRANSITIONS,
  TASK_ID_PATTERN,
  TaskStatusSchema,
  TaskAssigneeTypeSchema,
  TaskIdSchema,
  TaskSchema,
  TaskWithDepsSchema,
  TaskTreeSchema,
  TaskDependencySchema,
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  TaskCursorSchema,
  TaskFilterSchema,
  isValidTaskId,
  assertTaskId,
  InvalidTaskIdError,
  isValidTaskStatus,
  assertTaskStatus,
  InvalidTaskStatusError,
  type TaskStatus,
  type TaskAssigneeType,
  type TaskId,
  type Task,
  type TaskWithDeps,
  type TaskTree,
  type TaskDependency,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskFilter,
  type TaskCursor,
  type TaskRow,
  type DependencyRow,
} from "./task.js";

// Learning types & schemas
export {
  LEARNING_SOURCE_TYPES,
  LearningSourceTypeSchema,
  LearningIdSchema,
  LearningSchema,
  LearningWithScoreSchema,
  CreateLearningInputSchema,
  UpdateLearningInputSchema,
  GraphExpansionQueryOptionsSchema,
  LearningQuerySchema,
  ContextOptionsSchema,
  GraphExpansionStatsSchema,
  ContextResultSchema,
  LearningSearchResultSchema,
  DiversificationOptionsSchema,
  RetrievalOptionsSchema,
  type LearningSourceType,
  type LearningId,
  type Learning,
  type LearningWithScore,
  type CreateLearningInput,
  type UpdateLearningInput,
  type LearningQuery,
  type ContextOptions,
  type ContextResult,
  type GraphExpansionStats,
  type LearningSearchResult,
  type LearningRow,
  type LearningRowWithBM25,
  type RetrievalOptions,
  type GraphExpansionQueryOptions,
  type DiversificationOptions,
} from "./learning.js";

// File learning types & schemas
export {
  FileLearningIdSchema,
  FileLearningSchema,
  CreateFileLearningInputSchema,
  type FileLearningId,
  type FileLearning,
  type CreateFileLearningInput,
  type FileLearningRow,
} from "./file-learning.js";

// Attempt types & schemas
export {
  ATTEMPT_OUTCOMES,
  AttemptOutcomeSchema,
  AttemptIdSchema,
  AttemptSchema,
  CreateAttemptInputSchema,
  type AttemptOutcome,
  type AttemptId,
  type Attempt,
  type CreateAttemptInput,
  type AttemptRow,
} from "./attempt.js";

// Run types & schemas
export {
  RUN_STATUSES,
  RunStatusSchema,
  RunIdSchema,
  RunSchema,
  CreateRunInputSchema,
  UpdateRunInputSchema,
  type RunId,
  type RunStatus,
  type Run,
  type CreateRunInput,
  type UpdateRunInput,
  type RunRow,
} from "./run.js";

// Anchor types & schemas
export {
  ANCHOR_TYPES,
  ANCHOR_STATUSES,
  INVALIDATION_SOURCES,
  AnchorIdSchema,
  AnchorTypeSchema,
  AnchorStatusSchema,
  InvalidationSourceSchema,
  AnchorSchema,
  CreateAnchorInputSchema,
  UpdateAnchorInputSchema,
  InvalidationLogSchema,
  type AnchorId,
  type AnchorType,
  type AnchorStatus,
  type Anchor,
  type AnchorWithFreshness,
  type CreateAnchorInput,
  type UpdateAnchorInput,
  type AnchorRow,
  type InvalidationSource,
  type InvalidationLog,
  type InvalidationLogRow,
} from "./anchor.js"

// Edge types & schemas
export {
  NODE_TYPES,
  EDGE_TYPES,
  NodeTypeSchema,
  EdgeTypeSchema,
  EdgeIdSchema,
  EdgeSchema,
  CreateEdgeInputSchema,
  UpdateEdgeInputSchema,
  NeighborNodeSchema,
  type EdgeId,
  type NodeType,
  type EdgeType,
  type Edge,
  type CreateEdgeInput,
  type UpdateEdgeInput,
  type EdgeRow,
  type NeighborNode,
} from "./edge.js";

// Deduplication types & schemas
export {
  ProcessedHashSchema,
  CreateProcessedHashInputSchema,
  FileProgressSchema,
  UpsertFileProgressInputSchema,
  HashCheckResultSchema,
  LineProcessResultSchema,
  FileProcessResultSchema,
  DeduplicationOptionsSchema,
  type ProcessedHashId,
  type ProcessedHash,
  type CreateProcessedHashInput,
  type ProcessedHashRow,
  type FileProgressId,
  type FileProgress,
  type UpsertFileProgressInput,
  type FileProgressRow,
  type HashCheckResult,
  type LineProcessResult,
  type FileProcessResult,
  type DeduplicationOptions,
} from "./deduplication.js";

// Candidate types & schemas (learning extraction from transcripts)
export {
  CANDIDATE_CONFIDENCES,
  CANDIDATE_CATEGORIES,
  CANDIDATE_STATUSES,
  CandidateConfidenceSchema,
  CandidateCategorySchema,
  CandidateStatusSchema,
  TranscriptChunkSchema,
  ExtractedCandidateSchema,
  LearningCandidateSchema,
  CreateCandidateInputSchema,
  UpdateCandidateInputSchema,
  CandidateFilterSchema,
  ExtractionResultSchema,
  type CandidateConfidence,
  type CandidateCategory,
  type CandidateStatus,
  type CandidateId,
  type TranscriptChunk,
  type ExtractedCandidate,
  type LearningCandidate,
  type CreateCandidateInput,
  type UpdateCandidateInput,
  type CandidateFilter,
  type ExtractionResult,
  type CandidateRow,
} from "./candidate.js";

// Symbol extraction types & schemas (code intelligence)
export {
  SYMBOL_KINDS,
  IMPORT_KINDS,
  SymbolKindSchema,
  ImportKindSchema,
  SymbolInfoSchema,
  ImportInfoSchema,
  SymbolPatternSchema,
  MatchSchema,
  type SymbolKind,
  type SymbolInfo,
  type ImportKind,
  type ImportInfo,
  type SymbolPattern,
  type Match,
} from "./symbol.js"

// Message types & schemas (agent outbox)
export {
  MESSAGE_STATUSES,
  MessageStatusSchema,
  MessageIdSchema,
  MessageSchema,
  SendMessageInputSchema,
  InboxFilterSchema,
  isValidMessageStatus,
  assertMessageStatus,
  InvalidMessageStatusError,
  type MessageStatus,
  type MessageId,
  type Message,
  type SendMessageInput,
  type InboxFilter,
  type MessageRow,
} from "./message.js"

// Tracked project types & schemas (daemon monitoring)
export {
  SOURCE_TYPES,
  SourceTypeSchema,
  TrackedProjectSchema,
  CreateTrackedProjectInputSchema,
  type SourceType,
  type TrackedProjectId,
  type TrackedProject,
  type CreateTrackedProjectInput,
  type TrackedProjectRow,
} from "./tracked-project.js";

// Cycle types & schemas (cycle-based issue discovery)
export {
  FINDING_SEVERITIES,
  LOSS_WEIGHTS,
  FindingSeveritySchema,
  FindingSchema,
  DuplicateSchema,
  DedupResultSchema,
  CycleConfigSchema,
  RoundMetricsSchema,
  CycleResultSchema,
  type FindingSeverity,
  type Finding,
  type Duplicate,
  type DedupResult,
  type CycleConfig,
  type RoundMetrics,
  type CycleResult,
  type CycleProgressEvent,
} from "./cycle.js"

// Doc types & schemas (docs-as-primitives, DD-023)
export {
  DOC_KINDS,
  DOC_STATUSES,
  DOC_LINK_TYPES,
  TASK_DOC_LINK_TYPES,
  INVARIANT_ENFORCEMENT_TYPES,
  INVARIANT_STATUSES,
  DocKindSchema,
  DocStatusSchema,
  DocLinkTypeSchema,
  TaskDocLinkTypeSchema,
  DocIdSchema,
  DocSchema,
  DocWithLinksSchema,
  DocLinkSchema,
  TaskDocLinkSchema,
  CreateDocInputSchema,
  InvariantEnforcementSchema,
  InvariantStatusSchema,
  InvariantIdSchema,
  InvariantSchema,
  InvariantCheckSchema,
  UpsertInvariantInputSchema,
  RecordInvariantCheckInputSchema,
  DocGraphNodeSchema,
  DocGraphEdgeSchema,
  DocGraphSchema,
  isValidDocKind,
  InvalidDocKindError,
  assertDocKind,
  isValidDocStatus,
  InvalidDocStatusError,
  assertDocStatus,
  isValidDocLinkType,
  InvalidDocLinkTypeError,
  assertDocLinkType,
  type DocKind,
  type DocStatus,
  type DocLinkType,
  type TaskDocLinkType,
  type DocId,
  type Doc,
  type DocWithLinks,
  type DocLink,
  type TaskDocLink,
  type CreateDocInput,
  type InvariantEnforcement,
  type InvariantStatus,
  type InvariantId,
  type Invariant,
  type InvariantCheck,
  type UpsertInvariantInput,
  type RecordInvariantCheckInput,
  type DocGraphNode,
  type DocGraphEdge,
  type DocGraph,
  type DocRow,
  type DocLinkRow,
  type TaskDocLinkRow,
  type InvariantRow,
  type InvariantCheckRow,
} from "./doc.js"

// Response types & schemas (shared schemas for CLI, MCP, API, SDK)
export {
  // Serialized entity schemas
  TaskWithDepsSerializedSchema,
  LearningSerializedSchema,
  LearningWithScoreSerializedSchema,
  FileLearningsSerializedSchema,
  RunSerializedSchema,
  AttemptSerializedSchema,
  // Serialized entity types
  type TaskWithDepsSerialized,
  type LearningSerialized,
  type LearningWithScoreSerialized,
  type FileLearningsSerialized,
  type RunSerialized,
  type AttemptSerialized,
  // Serialization functions
  serializeTask,
  serializeLearning,
  serializeLearningWithScore,
  serializeFileLearning,
  serializeRun,
  serializeAttempt,
  // Message serialized schemas & types
  MessageSerializedSchema,
  type MessageSerialized,
  serializeMessage,
  InboxResponseSchema,
  type InboxResponse,
  // Response envelope schemas
  ErrorResponseSchema,
  // Response envelopes
  type ListResponse,
  type PaginatedResponse,
  type ActionResponse,
  type ErrorResponse,
  // Task response schemas & types
  TaskReadyResponseSchema,
  TaskListResponseSchema,
  TaskDetailResponseSchema,
  TaskCompletionResponseSchema,
  TaskTreeResponseSchema,
  type TaskReadyResponse,
  type TaskListResponse,
  type TaskDetailResponse,
  type TaskCompletionResponse,
  type TaskTreeResponse,
  // Learning response schemas & types
  LearningSearchResponseSchema,
  ContextResponseSchema,
  FileLearningListResponseSchema,
  type LearningSearchResponse,
  type ContextResponse,
  type FileLearningListResponse,
  // Run response schemas & types
  RunListResponseSchema,
  RunDetailResponseSchema,
  type RunListResponse,
  type RunDetailResponse,
  // Sync response schemas & types
  SyncExportResponseSchema,
  SyncImportResponseSchema,
  type SyncExportResponse,
  type SyncImportResponse,
} from "./response.js";
