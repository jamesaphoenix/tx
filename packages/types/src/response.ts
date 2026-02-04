/**
 * Response types for tx
 *
 * Shared response schemas optimized for agent consumption.
 * All types use consistent camelCase naming and provide full context in every response.
 * Serialized types convert Date objects to ISO strings for JSON output.
 *
 * Design principles:
 * - Consistent field naming across CLI, MCP, API, and SDK
 * - Full context in every response (no bare Task, always TaskWithDeps)
 * - Serialized types ready for JSON.stringify without custom replacers
 * - Standard envelopes for lists, pagination, and actions
 *
 * Zero runtime dependencies - pure TypeScript types only.
 */

import type { TaskId, TaskWithDeps, TaskStatus } from "./task.js"
import type { Learning, LearningWithScore, LearningSourceType } from "./learning.js"
import type { FileLearning, FileLearningId } from "./file-learning.js"
import type { Run, RunStatus, RunId } from "./run.js"
import type { Attempt, AttemptOutcome, AttemptId } from "./attempt.js"
import type { EdgeType } from "./edge.js"

// =============================================================================
// SERIALIZED ENTITY TYPES
// =============================================================================
// These types mirror their domain counterparts but with Date fields as ISO strings.
// Use these for JSON responses across CLI, MCP, API, and SDK.

/**
 * TaskWithDeps serialized for JSON output.
 * All Date fields converted to ISO strings.
 * This is the REQUIRED return type for all external APIs (per Doctrine Rule 1).
 */
export interface TaskWithDepsSerialized {
  readonly id: TaskId
  readonly title: string
  readonly description: string
  readonly status: TaskStatus
  readonly parentId: TaskId | null
  readonly score: number
  readonly createdAt: string // ISO string
  readonly updatedAt: string // ISO string
  readonly completedAt: string | null // ISO string
  readonly metadata: Record<string, unknown>
  /** Task IDs that block this task */
  readonly blockedBy: readonly TaskId[]
  /** Task IDs this task blocks */
  readonly blocks: readonly TaskId[]
  /** Direct child task IDs */
  readonly children: readonly TaskId[]
  /** Whether this task can be worked on (status is workable AND all blockers are done) */
  readonly isReady: boolean
}

/**
 * Learning serialized for JSON output.
 * All Date fields converted to ISO strings.
 * Embedding as number array instead of Float32Array.
 */
export interface LearningSerialized {
  readonly id: number
  readonly content: string
  readonly sourceType: LearningSourceType
  readonly sourceRef: string | null
  readonly createdAt: string // ISO string
  readonly keywords: readonly string[]
  readonly category: string | null
  readonly usageCount: number
  readonly lastUsedAt: string | null // ISO string
  readonly outcomeScore: number | null
  /** Embedding vector as number array (null if not computed) */
  readonly embedding: readonly number[] | null
}

/**
 * LearningWithScore serialized for JSON output.
 * Extends LearningSerialized with relevance scoring fields.
 */
export interface LearningWithScoreSerialized extends LearningSerialized {
  /** Combined relevance score (0-1) */
  readonly relevanceScore: number
  /** BM25 text search score */
  readonly bm25Score: number
  /** Vector similarity score (0-1) */
  readonly vectorScore: number
  /** Recency score (0-1, higher for newer) */
  readonly recencyScore: number
  /** RRF (Reciprocal Rank Fusion) score from combining BM25 and vector rankings */
  readonly rrfScore: number
  /** Rank in BM25 results (1-indexed, 0 if not in BM25 results) */
  readonly bm25Rank: number
  /** Rank in vector similarity results (1-indexed, 0 if not in vector results) */
  readonly vectorRank: number
  /** LLM reranker score (0-1, optional - only present when reranking is applied) */
  readonly rerankerScore?: number
  /** Number of hops from seed (0 = direct match from RRF, 1+ = expanded via graph) */
  readonly expansionHops?: number
  /** Path of learning IDs from seed to this learning (only for expanded results) */
  readonly expansionPath?: readonly number[]
  /** Edge type that led to this learning (null for direct matches) */
  readonly sourceEdge?: EdgeType | null
  /** Feedback score from historical usage (0-1, 0.5 = neutral, optional) */
  readonly feedbackScore?: number
}

/**
 * FileLearning serialized for JSON output.
 */
export interface FileLearningsSerialized {
  readonly id: FileLearningId
  readonly filePattern: string
  readonly note: string
  readonly taskId: string | null
  readonly createdAt: string // ISO string
}

/**
 * Run serialized for JSON output.
 */
export interface RunSerialized {
  readonly id: RunId
  readonly taskId: string | null
  readonly agent: string
  readonly startedAt: string // ISO string
  readonly endedAt: string | null // ISO string
  readonly status: RunStatus
  readonly exitCode: number | null
  readonly pid: number | null
  readonly transcriptPath: string | null
  readonly stderrPath: string | null
  readonly stdoutPath: string | null
  readonly contextInjected: string | null
  readonly summary: string | null
  readonly errorMessage: string | null
  readonly metadata: Record<string, unknown>
}

/**
 * Attempt serialized for JSON output.
 */
export interface AttemptSerialized {
  readonly id: AttemptId
  readonly taskId: TaskId
  readonly approach: string
  readonly outcome: AttemptOutcome
  readonly reason: string | null
  readonly createdAt: string // ISO string
}

// =============================================================================
// SERIALIZATION FUNCTIONS
// =============================================================================
// Pure functions to convert domain types to serialized types.
// Use these across CLI, MCP, API, and SDK for consistent JSON output.

/**
 * Serialize a TaskWithDeps for JSON output.
 * Converts Date objects to ISO strings.
 */
export const serializeTask = (task: TaskWithDeps): TaskWithDepsSerialized => ({
  id: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  parentId: task.parentId,
  score: task.score,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  completedAt: task.completedAt?.toISOString() ?? null,
  metadata: task.metadata,
  blockedBy: task.blockedBy,
  blocks: task.blocks,
  children: task.children,
  isReady: task.isReady,
})

/**
 * Serialize a Learning for JSON output.
 * Converts Date objects to ISO strings and Float32Array to number array.
 */
export const serializeLearning = (learning: Learning): LearningSerialized => ({
  id: learning.id,
  content: learning.content,
  sourceType: learning.sourceType,
  sourceRef: learning.sourceRef,
  createdAt: learning.createdAt.toISOString(),
  keywords: learning.keywords,
  category: learning.category,
  usageCount: learning.usageCount,
  lastUsedAt: learning.lastUsedAt?.toISOString() ?? null,
  outcomeScore: learning.outcomeScore,
  embedding: learning.embedding ? Array.from(learning.embedding) : null,
})

/**
 * Serialize a LearningWithScore for JSON output.
 * Extends serializeLearning with score fields.
 */
export const serializeLearningWithScore = (learning: LearningWithScore): LearningWithScoreSerialized => ({
  ...serializeLearning(learning),
  relevanceScore: learning.relevanceScore,
  bm25Score: learning.bm25Score,
  vectorScore: learning.vectorScore,
  recencyScore: learning.recencyScore,
  rrfScore: learning.rrfScore,
  bm25Rank: learning.bm25Rank,
  vectorRank: learning.vectorRank,
  rerankerScore: learning.rerankerScore,
  expansionHops: learning.expansionHops,
  expansionPath: learning.expansionPath,
  sourceEdge: learning.sourceEdge,
  feedbackScore: learning.feedbackScore,
})

/**
 * Serialize a FileLearning for JSON output.
 */
export const serializeFileLearning = (learning: FileLearning): FileLearningsSerialized => ({
  id: learning.id,
  filePattern: learning.filePattern,
  note: learning.note,
  taskId: learning.taskId,
  createdAt: learning.createdAt.toISOString(),
})

/**
 * Serialize a Run for JSON output.
 */
export const serializeRun = (run: Run): RunSerialized => ({
  id: run.id,
  taskId: run.taskId,
  agent: run.agent,
  startedAt: run.startedAt.toISOString(),
  endedAt: run.endedAt?.toISOString() ?? null,
  status: run.status,
  exitCode: run.exitCode,
  pid: run.pid,
  transcriptPath: run.transcriptPath,
  stderrPath: run.stderrPath,
  stdoutPath: run.stdoutPath,
  contextInjected: run.contextInjected,
  summary: run.summary,
  errorMessage: run.errorMessage,
  metadata: run.metadata,
})

/**
 * Serialize an Attempt for JSON output.
 */
export const serializeAttempt = (attempt: Attempt): AttemptSerialized => ({
  id: attempt.id,
  taskId: attempt.taskId,
  approach: attempt.approach,
  outcome: attempt.outcome,
  reason: attempt.reason,
  createdAt: attempt.createdAt.toISOString(),
})

// =============================================================================
// RESPONSE ENVELOPES
// =============================================================================
// Standard response wrappers used across all interfaces.

/**
 * Standard list response with count.
 * Use for simple lists without pagination.
 */
export interface ListResponse<T> {
  readonly items: readonly T[]
  readonly count: number
}

/**
 * Paginated response with cursor-based pagination.
 * Use for large lists that need pagination.
 */
export interface PaginatedResponse<T> {
  readonly items: readonly T[]
  /** Total count of items matching the filter (not just this page) */
  readonly total: number
  /** Cursor for next page, null if no more pages */
  readonly nextCursor: string | null
  /** Whether there are more items after this page */
  readonly hasMore: boolean
}

/**
 * Standard action response for mutations.
 * Use for create, update, delete operations.
 */
export interface ActionResponse<T = void> {
  readonly success: boolean
  /** The affected resource (for create/update) */
  readonly data?: T
  /** Human-readable message describing the action */
  readonly message?: string
}

/**
 * Error response with structured error info.
 * Use for all error responses.
 */
export interface ErrorResponse {
  readonly error: {
    /** Error code (e.g., "NOT_FOUND", "VALIDATION_ERROR") */
    readonly code: string
    /** Human-readable error message */
    readonly message: string
    /** Additional error details */
    readonly details?: Record<string, unknown>
  }
}

// =============================================================================
// TASK RESPONSE TYPES
// =============================================================================
// Standard task response shapes used across CLI, MCP, API, and SDK.

/**
 * Response for listing ready tasks.
 */
export interface TaskReadyResponse {
  readonly tasks: readonly TaskWithDepsSerialized[]
  readonly count: number
}

/**
 * Response for listing tasks with pagination.
 */
export interface TaskListResponse extends PaginatedResponse<TaskWithDepsSerialized> {
  // Alias for clarity: items contains tasks
  readonly tasks: readonly TaskWithDepsSerialized[]
}

/**
 * Response for getting a single task with full details.
 * Includes related tasks for full context.
 */
export interface TaskDetailResponse {
  readonly task: TaskWithDepsSerialized
  /** Tasks that block this task (full details, not just IDs) */
  readonly blockedByTasks: readonly TaskWithDepsSerialized[]
  /** Tasks that this task blocks (full details, not just IDs) */
  readonly blocksTasks: readonly TaskWithDepsSerialized[]
  /** Child tasks (full details, not just IDs) */
  readonly childTasks: readonly TaskWithDepsSerialized[]
}

/**
 * Response for completing a task.
 * Includes list of tasks that became ready as a result.
 */
export interface TaskCompletionResponse {
  /** The completed task */
  readonly task: TaskWithDepsSerialized
  /** Tasks that became ready after this completion */
  readonly nowReady: readonly TaskWithDepsSerialized[]
}

/**
 * Response for task tree/hierarchy queries.
 */
export interface TaskTreeResponse {
  readonly tasks: readonly TaskWithDepsSerialized[]
  /** Root task ID */
  readonly rootId: TaskId
}

// =============================================================================
// LEARNING RESPONSE TYPES
// =============================================================================
// Standard learning response shapes.

/**
 * Response for searching learnings.
 */
export interface LearningSearchResponse {
  readonly learnings: readonly LearningWithScoreSerialized[]
  readonly query: string
  readonly count: number
}

/**
 * Response for getting contextual learnings for a task.
 */
export interface ContextResponse {
  readonly taskId: string
  readonly taskTitle: string
  readonly learnings: readonly LearningWithScoreSerialized[]
  readonly searchQuery: string
  /** Search duration in milliseconds */
  readonly searchDuration: number
  /** Graph expansion statistics (only present when useGraph=true) */
  readonly graphExpansion?: {
    readonly enabled: boolean
    readonly seedCount: number
    readonly expandedCount: number
    readonly maxDepthReached: number
  }
}

/**
 * Response for file learnings.
 */
export interface FileLearningListResponse {
  readonly learnings: readonly FileLearningsSerialized[]
  readonly count: number
  /** File path used for matching (if provided) */
  readonly matchedPath?: string
}

// =============================================================================
// RUN RESPONSE TYPES
// =============================================================================
// Standard run response shapes.

/**
 * Response for listing runs.
 */
export interface RunListResponse {
  readonly runs: readonly RunSerialized[]
  readonly count: number
}

/**
 * Response for getting a single run with details.
 */
export interface RunDetailResponse {
  readonly run: RunSerialized
  /** Associated task (if any) */
  readonly task?: TaskWithDepsSerialized
  /** Attempts made during this run */
  readonly attempts: readonly AttemptSerialized[]
}

// =============================================================================
// SYNC RESPONSE TYPES
// =============================================================================
// Standard sync operation response shapes.

/**
 * Response for sync export operation.
 */
export interface SyncExportResponse {
  readonly success: boolean
  readonly outputPath: string
  readonly taskCount: number
  readonly learningCount: number
}

/**
 * Response for sync import operation.
 */
export interface SyncImportResponse {
  readonly success: boolean
  readonly inputPath: string
  readonly tasksImported: number
  readonly learningsImported: number
  readonly conflicts: number
}
