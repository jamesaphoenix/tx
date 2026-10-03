/**
 * @jamesaphoenix/tx-agent-sdk Types
 *
 * Re-exports all types from @tx/types for convenience.
 * SDK consumers can import types directly from the SDK.
 *
 * @example
 * ```typescript
 * import { TaskWithDeps, TaskStatus } from "@jamesaphoenix/tx-agent-sdk/types";
 * ```
 */

// Import types needed for local use in this file
import type {
  TaskStatus as _TaskStatus,
} from "@jamesaphoenix/tx/types"

// Re-export for consumers - using local aliases
export type TaskStatus = _TaskStatus

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
} from "@jamesaphoenix/tx/types"

export {
  SPEC_DISCOVERY_METHODS,
  SPEC_SCOPE_TYPES,
  SPEC_PHASES,
  type SpecDiscoveryMethod,
  type SpecScopeType,
  type SpecPhase,
  type DiscoverResult,
  type FciResult,
} from "@jamesaphoenix/tx/types"

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
   * Root containing shared .tx task state (for direct mode).
   * Used to resolve .tx/tasks.db when dbPath is omitted.
   */
  stateRoot?: string

  /**
   * Checkout containing specs, source files, and .tx/config.toml (for direct mode).
   * Derived spec state is isolated by this checkout.
   */
  contentRoot?: string

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
  linkedDocs: Array<{
    docId: string
    name: string
    title: string
    kind: string
    version: number
    status: "changing" | "locked"
    filePath: string
    linkType: "implements" | "references"
  }>
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
  ignoredEvents: number
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
  ignoredEvents: number
  streamCount: number
  rebuilt: boolean
}

// =============================================================================
// Doc Types (SDK-specific)
// =============================================================================

export interface SerializedDoc {
  id: number
  docId: string
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
  kind: "overview" | "prd" | "design" | "plan" | "task"
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
  sourceRefs?: string[]
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
// Stats Types (SDK-specific)
// =============================================================================

export interface StatsResult {
  tasks: number
  done: number
  ready: number
}
