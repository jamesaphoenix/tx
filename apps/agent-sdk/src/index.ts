/**
 * @jamesaphoenix/tx-agent-sdk - TypeScript SDK for building custom agents with TX
 *
 * This SDK provides a simple, Promise-based API for task management.
 * It supports both HTTP API mode (using the TX API server) and direct
 * SQLite access (for local agents).
 *
 * @example
 * ```typescript
 * import { TxClient } from "@jamesaphoenix/tx-agent-sdk";
 *
 * // HTTP mode (recommended for distributed agents)
 * const tx = new TxClient({ apiUrl: "http://localhost:3456" });
 *
 * // Direct mode (for local agents, requires @tx/core)
 * const tx = new TxClient({ dbPath: ".tx/tasks.db" });
 *
 * // Get ready tasks
 * const ready = await tx.tasks.ready({ limit: 10 });
 * const task = ready[0];
 *
 * // Do the work...
 *
 * // Mark complete
 * const { task: completed, nowReady } = await tx.tasks.done(task.id);
 *
 * // Add learnings
 * await tx.learnings.add({ content: "Use pattern X for problem Y" });
 *
 * // Get context for a task
 * const context = await tx.context.forTask(task.id);
 * console.log(context.learnings);
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Client
// =============================================================================

export { TxClient } from "./client.js"

// =============================================================================
// Types
// =============================================================================

// SDK-specific types
export type {
  TxClientConfig,
  PaginatedResponse,
  ListOptions,
  ReadyOptions,
  CompleteResult,
  SerializedTaskWithDeps,
  SerializedLearning,
  SerializedLearningWithScore,
  SerializedFileLearning,
  SerializedContextResult,
  SearchLearningsOptions,
  CreateLearningData,
  CreateFileLearningData,
  RunHeartbeatData,
  RunHeartbeatResult,
  StalledRunsOptions,
  ReapStalledRunsOptions,
  SerializedStalledRun,
  SerializedReapedRun
} from "./types.js"

// Re-export common types from @tx/types for convenience
export {
  TASK_STATUSES,
  VALID_TRANSITIONS,
  LEARNING_SOURCE_TYPES,
  ATTEMPT_OUTCOMES,
  RUN_STATUSES
} from "./types.js"

export type {
  TaskStatus,
  TaskId,
  Task,
  TaskWithDeps,
  CreateTaskInput,
  UpdateTaskInput,
  LearningSourceType,
  LearningId,
  Learning,
  LearningWithScore,
  CreateLearningInput,
  ContextResult,
  FileLearning,
  CreateFileLearningInput,
  Run,
  CreateRunInput
} from "./types.js"

// =============================================================================
// Utilities
// =============================================================================

export {
  // Type guards & validation
  isValidTaskStatus,
  isValidTaskId,
  assertTaskId,
  InvalidTaskIdError,
  TASK_ID_PATTERN,
  // Task helpers
  filterByStatus,
  filterReady,
  sortByScore,
  getNextTask,
  // Date helpers
  parseDate,
  wasCompletedRecently,
  // URL helpers
  buildUrl,
  normalizeApiUrl,
  // Error handling
  TxError,
  parseApiError,
  // Retry logic
  withRetry,
  defaultShouldRetry,
  sleep
} from "./utils.js"

export type { RetryOptions } from "./utils.js"
