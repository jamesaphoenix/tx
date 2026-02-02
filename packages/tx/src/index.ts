/**
 * @jamesaphoenix/tx - TanStack for AI agents
 *
 * Headless primitives for memory, tasks, and orchestration.
 *
 * @example
 * ```typescript
 * import { TaskService, LearningService, makeAppLayer } from "@jamesaphoenix/tx";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const tasks = yield* TaskService;
 *   const ready = yield* tasks.getReady({ limit: 5 });
 *   return ready;
 * });
 * ```
 */

// Re-export everything from @tx/core
export * from "@tx/core";

// Re-export types (explicit for better tree-shaking)
export type {
  // Task types
  TaskStatus,
  TaskId,
  Task,
  TaskWithDeps,
  TaskTree,
  TaskDependency,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  // Learning types
  LearningSourceType,
  LearningId,
  Learning,
  LearningWithScore,
  CreateLearningInput,
  UpdateLearningInput,
  LearningQuery,
  ContextOptions,
  ContextResult,
  // Attempt types
  AttemptOutcome,
  AttemptId,
  Attempt,
  CreateAttemptInput,
  // Run types
  RunId,
  RunStatus,
  Run,
  CreateRunInput,
  UpdateRunInput,
  // Anchor types
  AnchorId,
  AnchorType,
  AnchorStatus,
  Anchor,
  CreateAnchorInput,
  // Edge types
  EdgeId,
  NodeType,
  EdgeType,
  Edge,
  CreateEdgeInput,
} from "@tx/types";

// Re-export constants from types
export {
  TASK_STATUSES,
  VALID_TRANSITIONS,
  LEARNING_SOURCE_TYPES,
  ATTEMPT_OUTCOMES,
  RUN_STATUSES,
  ANCHOR_TYPES,
  ANCHOR_STATUSES,
  NODE_TYPES,
  EDGE_TYPES,
} from "@tx/types";
