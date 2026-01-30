/**
 * @tx/agent-sdk Types
 *
 * Re-exports all types from @tx/types for convenience.
 * SDK consumers can import types directly from the SDK.
 *
 * @example
 * ```typescript
 * import { TaskWithDeps, Learning, TaskStatus } from "@tx/agent-sdk/types";
 * ```
 */

// Import types needed for local use in this file
import type {
  TaskStatus as _TaskStatus,
  LearningSourceType as _LearningSourceType
} from "@tx/types"

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
} from "@tx/types"

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
} from "@tx/types"

// File learning types
export {
  type FileLearningId,
  type FileLearning,
  type CreateFileLearningInput
} from "@tx/types"

// Attempt types
export {
  ATTEMPT_OUTCOMES,
  type AttemptOutcome,
  type AttemptId,
  type Attempt,
  type CreateAttemptInput
} from "@tx/types"

// Run types
export {
  RUN_STATUSES,
  type RunId,
  type RunStatus,
  type Run,
  type CreateRunInput,
  type UpdateRunInput
} from "@tx/types"

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
  metadata: Record<string, unknown>
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
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
