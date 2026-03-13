/**
 * @jamesaphoenix/tx-agent-sdk Types
 *
 * Re-exports all types from @tx/types for convenience.
 * SDK consumers can import types directly from the SDK.
 *
 * @example
 * ```typescript
 * import { TaskWithDeps, Learning, TaskStatus } from "@jamesaphoenix/tx-agent-sdk/types";
 * ```
 */

// Import types needed for local use in this file
import type {
  TaskStatus as _TaskStatus,
  LearningSourceType as _LearningSourceType
} from "@jamesaphoenix/tx-types"

// Re-export for consumers - using local aliases
export type TaskStatus = _TaskStatus
export type LearningSourceType = _LearningSourceType

// Task types
export {
  TASK_STATUSES,
  VALID_TRANSITIONS,
  type TaskId,
  type Task,
  type TaskWithDeps,
  type TaskTree,
  type TaskDependency,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskFilter
} from "@jamesaphoenix/tx-types"

// Learning types
export {
  LEARNING_SOURCE_TYPES,
  type LearningId,
  type Learning,
  type LearningWithScore,
  type CreateLearningInput,
  type UpdateLearningInput,
  type LearningQuery,
  type ContextResult,
  type LearningSearchResult
} from "@jamesaphoenix/tx-types"

// File learning types
export {
  type FileLearningId,
  type FileLearning,
  type CreateFileLearningInput
} from "@jamesaphoenix/tx-types"

// Message types
export {
  MESSAGE_STATUSES,
  type MessageStatus,
  type MessageId,
  type Message,
  type SendMessageInput,
  type InboxFilter,
  type MessageSerialized,
  serializeMessage,
} from "@jamesaphoenix/tx-types"

// Attempt types
export {
  ATTEMPT_OUTCOMES,
  type AttemptOutcome,
  type AttemptId,
  type Attempt,
  type CreateAttemptInput
} from "@jamesaphoenix/tx-types"

// Run types
export {
  RUN_STATUSES,
  type RunId,
  type RunStatus,
  type Run,
  type CreateRunInput,
  type UpdateRunInput
} from "@jamesaphoenix/tx-types"

export {
  SPEC_DISCOVERY_METHODS,
  SPEC_SCOPE_TYPES,
  SPEC_PHASES,
  type SpecDiscoveryMethod,
  type SpecScopeType,
  type SpecPhase,
  type DiscoverResult,
  type FciResult,
} from "@jamesaphoenix/tx-types"

// Decision types
export {
  DECISION_STATUSES,
  DECISION_SOURCES,
  type DecisionStatus,
  type DecisionSource,
  type DecisionId,
  type Decision,
  type DecisionSerialized,
} from "@jamesaphoenix/tx-types"

export interface SerializedDecision {
  id: string
  content: string
  question: string | null
  status: string
  source: string
  commitSha: string | null
  runId: string | null
  taskId: string | null
  docId: number | null
  invariantId: string | null
  reviewedBy: string | null
  reviewNote: string | null
  editedContent: string | null
  reviewedAt: string | null
  contentHash: string
  supersededBy: string | null
  syncedToDoc: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateDecisionData {
  content: string
  question?: string | null
  source?: "manual" | "diff" | "transcript" | "agent"
  taskId?: string | null
  docId?: number | null
  commitSha?: string | null
}

export interface DecisionListOptions {
  status?: string
  source?: string
  limit?: number
}

export interface RunHeartbeatData {
  stdoutBytes?: number
  stderrBytes?: number
  transcriptBytes?: number
  deltaBytes?: number
  checkAt?: string
  activityAt?: string
}

export interface RunHeartbeatResult {
  runId: string
  checkAt: string
  activityAt: string | null
  stdoutBytes: number
  stderrBytes: number
  transcriptBytes: number
  deltaBytes: number
}

export interface StalledRunsOptions {
  transcriptIdleSeconds?: number
  heartbeatLagSeconds?: number
}

export interface ReapStalledRunsOptions extends StalledRunsOptions {
  resetTask?: boolean
  dryRun?: boolean
}

export interface SerializedStalledRun {
  run: {
    id: string
    taskId: string | null
    agent: string
    startedAt: string
    endedAt: string | null
    status: string
    exitCode: number | null
    pid: number | null
    transcriptPath: string | null
    stderrPath: string | null
    stdoutPath: string | null
    contextInjected: string | null
    summary: string | null
    errorMessage: string | null
    metadata: Record<string, unknown>
  }
  reason: "transcript_idle" | "heartbeat_stale"
  transcriptIdleSeconds: number | null
  heartbeatLagSeconds: number | null
  lastActivityAt: string | null
  lastCheckAt: string | null
  stdoutBytes: number
  stderrBytes: number
  transcriptBytes: number
}

export interface SerializedReapedRun {
  id: string
  taskId: string | null
  pid: number | null
  reason: "transcript_idle" | "heartbeat_stale"
  transcriptIdleSeconds: number | null
  heartbeatLagSeconds: number | null
  processTerminated: boolean
  taskReset: boolean
}

export interface SerializedRun {
  id: string
  taskId: string | null
  agent: string
  startedAt: string
  endedAt: string | null
  status: string
  exitCode: number | null
  pid: number | null
  transcriptPath: string | null
  stderrPath: string | null
  stdoutPath: string | null
  contextInjected: string | null
  summary: string | null
  errorMessage: string | null
  metadata: Record<string, unknown>
}

export interface RunsListOptions {
  cursor?: string
  limit?: number
  agent?: string
  status?: string | string[]
  taskId?: string
}

export interface PaginatedRunsResult {
  runs: SerializedRun[]
  nextCursor: string | null
  hasMore: boolean
  total: number
}

export interface SerializedTraceMessage {
  role: "user" | "assistant" | "system"
  content: unknown
  type?: "tool_use" | "tool_result" | "text" | "thinking"
  toolName?: string
  timestamp?: string
}

export interface RunLogsResult {
  stdout: string | null
  stderr: string | null
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export interface RunDetailResult {
  run: SerializedRun
  messages: SerializedTraceMessage[]
  logs: RunLogsResult
}

export interface LogContentResult {
  content: string
  truncated: boolean
}

export interface TraceErrorsOptions {
  hours?: number
  limit?: number
}

export interface TraceErrorEntry {
  timestamp: string
  source: "run" | "span" | "event"
  runId: string | null
  taskId: string | null
  agent: string | null
  name: string
  error: string
  durationMs: number | null
}

// =============================================================================
// SDK-Specific Types
// =============================================================================

/**
 * Client configuration options.
 */
export interface TxClientConfig {
  /**
   * Base URL for the API server (for HTTP mode).
   * @example "http://localhost:3456"
   */
  apiUrl?: string

  /**
   * API key for authentication (optional).
   */
  apiKey?: string

  /**
   * Path to SQLite database (for direct mode).
   * If provided with apiUrl, direct mode takes precedence.
   * @example ".tx/tasks.db"
   */
  dbPath?: string

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number
}

/**
 * Paginated response for list operations.
 */
export interface PaginatedResponse<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
  total: number
}

/**
 * List options for paginated queries.
 */
export interface ListOptions {
  cursor?: string
  limit?: number
  status?: TaskStatus | TaskStatus[]
  search?: string
}

/**
 * Options for the ready tasks query.
 */
export interface ReadyOptions {
  limit?: number
  labels?: string[]
  excludeLabels?: string[]
}

/**
 * Result from completing a task.
 */
export interface CompleteResult {
  task: SerializedTaskWithDeps
  nowReady: SerializedTaskWithDeps[]
}

/**
 * Serialized task with dependencies (dates as ISO strings).
 */
export interface SerializedTaskWithDeps {
  id: string
  title: string
  description: string
  status: TaskStatus
  parentId: string | null
  score: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  assigneeType: "human" | "agent" | null
  assigneeId: string | null
  assignedAt: string | null
  assignedBy: string | null
  metadata: Record<string, unknown>
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
  groupContext: string | null
  effectiveGroupContext: string | null
  effectiveGroupContextSourceTaskId: string | null
  orchestrationStatus: "unclaimed" | "claimed" | "running" | "lease_expired" | "released" | null
  claimedBy: string | null
  claimExpiresAt: string | null
  failedAttempts: number
}

/**
 * Serialized learning (dates as ISO strings).
 */
export interface SerializedLearning {
  id: number
  content: string
  sourceType: LearningSourceType
  sourceRef: string | null
  createdAt: string
  keywords: string[]
  category: string | null
  usageCount: number
  lastUsedAt: string | null
  outcomeScore: number | null
  embedding: number[] | null
}

/**
 * Serialized learning with search score.
 */
export interface SerializedLearningWithScore extends SerializedLearning {
  relevanceScore: number
  bm25Score: number
  vectorScore: number
  recencyScore: number
  rrfScore: number
  bm25Rank: number
  vectorRank: number
  rerankerScore?: number
  expansionHops?: number
  expansionPath?: number[]
  sourceEdge?: string | null
  feedbackScore?: number
}

/**
 * Serialized file learning.
 */
export interface SerializedFileLearning {
  id: number
  filePattern: string
  note: string
  taskId: string | null
  createdAt: string
}

/**
 * Context result for a task.
 */
export interface SerializedContextResult {
  taskId: string
  taskTitle: string
  learnings: SerializedLearningWithScore[]
  searchQuery: string
  searchDuration: number
}

/**
 * Search options for learnings.
 */
export interface SearchLearningsOptions {
  query?: string
  limit?: number
  minScore?: number
  category?: string
}

/**
 * Create learning input.
 */
export interface CreateLearningData {
  content: string
  sourceType?: LearningSourceType
  sourceRef?: string
  category?: string
  keywords?: string[]
}

/**
 * Create file learning input.
 */
export interface CreateFileLearningData {
  filePattern: string
  note: string
  taskId?: string
}

// =============================================================================
// Message Types (SDK-specific)
// =============================================================================

/**
 * Serialized message for JSON output (dates as ISO strings).
 */
export interface SerializedMessage {
  id: number
  channel: string
  sender: string
  content: string
  status: string
  correlationId: string | null
  taskId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  ackedAt: string | null
  expiresAt: string | null
}

/**
 * Options for sending a message.
 */
export interface SendMessageData {
  channel: string
  content: string
  sender?: string
  taskId?: string
  ttlSeconds?: number
  correlationId?: string
  metadata?: Record<string, unknown>
}

/**
 * Options for reading an inbox.
 */
export interface InboxOptions {
  afterId?: number
  limit?: number
  sender?: string
  correlationId?: string
  includeAcked?: boolean
}

/**
 * Options for garbage collection.
 */
export interface GcOptions {
  ackedOlderThanHours?: number
}

/**
 * Result from garbage collection.
 */
export interface GcResult {
  expired: number
  acked: number
}

// =============================================================================
// Claim Types (SDK-specific)
// =============================================================================

/**
 * Serialized claim for JSON output (dates as ISO strings).
 */
export interface SerializedClaim {
  id: number
  taskId: string
  workerId: string
  claimedAt: string
  leaseExpiresAt: string
  renewedCount: number
  status: string
}

// =============================================================================
// Pin Types
// =============================================================================

/**
 * Serialized pin for JSON output (dates as ISO strings).
 */
export interface SerializedPin {
  id: string
  content: string
  createdAt: string
  updatedAt: string
}

// =============================================================================
// Memory Types (SDK-specific)
// =============================================================================

export interface SerializedMemoryDocument {
  id: string
  filePath: string
  rootDir: string
  title: string
  content: string
  frontmatter: string | null
  tags: string[]
  fileHash: string
  fileMtime: string
  embedding: null
  createdAt: string
  indexedAt: string
}

export interface SerializedMemoryDocumentWithScore extends SerializedMemoryDocument {
  relevanceScore: number
  recencyScore: number
  bm25Score: number
  vectorScore: number
  rrfScore: number
  bm25Rank: number
  vectorRank: number
  expansionHops?: number
}

export interface SerializedMemorySource {
  id: number
  rootDir: string
  label: string | null
  createdAt: string
}

export interface MemorySearchOptions {
  query: string
  limit?: number
  minScore?: number
  semantic?: boolean
  expand?: boolean
  tags?: string[]
  props?: Record<string, string>
}

export interface CreateMemoryDocumentData {
  title: string
  content?: string
  tags?: string[]
  properties?: Record<string, string>
  dir?: string
}

export interface MemoryIndexResult {
  indexed: number
  skipped: number
  removed: number
}

export interface MemoryIndexStatus {
  totalFiles: number
  indexed: number
  stale: number
  embedded: number
  links: number
  sources: number
}

export interface SerializedMemoryLink {
  id: number
  sourceDocId: string
  targetDocId: string | null
  targetRef: string
  linkType: string
  createdAt: string
}

// =============================================================================
// Sync Types (SDK-specific)
// =============================================================================

export interface SyncExportResult {
  eventCount: number
  streamId: string
  path: string
}

export interface SyncImportResult {
  importedEvents: number
  appliedEvents: number
  streamCount: number
}

export interface SyncStatusResult {
  dbTaskCount: number
  eventOpCount: number
  lastExport: string | null
  lastImport: string | null
  isDirty: boolean
  autoSyncEnabled: boolean
}

export interface SyncStreamInfoResult {
  streamId: string
  nextSeq: number
  lastSeq: number
  eventsDir: string
  configPath: string
  knownStreams: Array<{
    streamId: string
    lastSeq: number
    lastEventAt: string | null
  }>
}

export interface SyncHydrateResult {
  importedEvents: number
  appliedEvents: number
  streamCount: number
  rebuilt: boolean
}

// =============================================================================
// Doc Types (SDK-specific)
// =============================================================================

export interface SerializedDoc {
  id: number
  hash: string
  kind: string
  name: string
  title: string
  version: number
  status: string
  filePath: string
  parentDocId: number | null
  createdAt: string
  lockedAt: string | null
}

export interface SerializedDocLink {
  id: number
  fromDocId: number
  toDocId: number
  linkType: string
  createdAt: string
}

export interface DocGraphNode {
  id: string
  label: string
  kind: "overview" | "prd" | "design" | "task"
  status?: string
}

export interface DocGraphEdge {
  source: string
  target: string
  type: string
}

export interface DocGraph {
  nodes: DocGraphNode[]
  edges: DocGraphEdge[]
}

// =============================================================================
// Invariant Types (SDK-specific)
// =============================================================================

export interface SerializedInvariant {
  id: string
  rule: string
  enforcement: string
  docId: number
  subsystem: string | null
  status: string
  testRef: string | null
  lintRule: string | null
  promptRef: string | null
  createdAt: string
}

export interface SerializedInvariantCheck {
  id: number
  invariantId: string
  passed: boolean
  details: string | null
  durationMs: number | null
  checkedAt: string
}

// =============================================================================
// Spec Trace Types (SDK-specific)
// =============================================================================

export interface SpecScopeOptions {
  doc?: string
  subsystem?: string
}

export interface SerializedSpecTest {
  id: number
  invariantId: string
  testId: string
  testFile: string
  testName: string | null
  framework: string | null
  discovery: string
  createdAt: string
  updatedAt: string
}

export interface SerializedSpecGap {
  id: string
  rule: string
  subsystem: string | null
  docName: string
}

export interface SpecStatusResult {
  phase: "BUILD" | "HARDEN" | "COMPLETE"
  fci: number
  gaps: number
  total: number
  covered: number
  uncovered: number
  passing: number
  failing: number
  untested: number
  signedOff: boolean
  blockers: string[]
}

export interface SerializedTraceabilityMatrixLatestRun {
  passed: boolean | null
  runAt: string | null
}

export interface SerializedTraceabilityMatrixTest {
  specTestId: number
  testId: string
  testFile: string
  testName: string | null
  framework: string | null
  discovery: string
  latestRun: SerializedTraceabilityMatrixLatestRun
}

export interface SerializedTraceabilityMatrixEntry {
  invariantId: string
  rule: string
  subsystem: string | null
  tests: SerializedTraceabilityMatrixTest[]
}

export interface SerializedSpecSignoff {
  id: number
  scopeType: "doc" | "subsystem" | "global"
  scopeValue: string | null
  signedOffBy: string
  notes: string | null
  signedOffAt: string
}

export interface SpecBatchRunInput {
  testId: string
  passed: boolean
  durationMs?: number | null
  details?: string | null
}

export interface SpecBatchRunResult {
  received: number
  recorded: number
  unmatched: string[]
}

export type SpecBatchSource = "generic" | "vitest" | "pytest" | "go" | "junit"

// =============================================================================
// Cycle Types (SDK-specific)
// =============================================================================

export interface SerializedCycleRun {
  id: string
  cycle: number
  name: string
  description: string
  startedAt: string
  endedAt: string | null
  status: string
  rounds: number
  totalNewIssues: number
  existingIssues: number
  finalLoss: number
  converged: boolean
}

export interface SerializedCycleDetail {
  cycle: SerializedCycleRun
  roundMetrics: SerializedRoundMetric[]
  issues: SerializedCycleIssue[]
}

export interface SerializedRoundMetric {
  cycle: number
  round: number
  loss: number
  newIssues: number
  existingIssues: number
  duplicates: number
  high: number
  medium: number
  low: number
}

export interface SerializedCycleIssue {
  id: string
  title: string
  description: string
  severity: string
  issueType: string
  file: string
  line: number
  cycle: number
  round: number
}

// =============================================================================
// Stats Types (SDK-specific)
// =============================================================================

export interface StatsResult {
  tasks: number
  done: number
  ready: number
  learnings: number
  runsRunning?: number
  runsTotal?: number
}

// =============================================================================
// Guard Types (SDK-specific)
// =============================================================================

export interface SerializedGuard {
  id: number
  scope: string
  maxPending: number | null
  maxChildren: number | null
  maxDepth: number | null
  enforce: boolean
  createdAt: string
}

// =============================================================================
// Verify Types (SDK-specific)
// =============================================================================

export interface SerializedVerifyResult {
  taskId: string
  exitCode: number
  passed: boolean
  stdout: string
  stderr: string
  durationMs: number
  output?: Record<string, unknown>
  schemaValid?: boolean
}

// =============================================================================
// Reflect Types (SDK-specific)
// =============================================================================

export interface SerializedReflectResult {
  sessions: {
    total: number
    completed: number
    failed: number
    timeout: number
    avgDurationMinutes: number
  }
  throughput: {
    created: number
    completed: number
    net: number
    completionRate: number
  }
  proliferation: {
    avgCreatedPerSession: number
    maxCreatedPerSession: number
    maxDepth: number
    orphanChains: number
  }
  stuckTasks: Array<{
    id: string
    title: string
    failedAttempts: number
    lastError: string | null
  }>
  signals: Array<{
    type: string
    message: string
    severity: "info" | "warning" | "critical"
  }>
  analysis: string | null
}
