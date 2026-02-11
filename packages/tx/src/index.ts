/**
 * @jamesaphoenix/tx - Headless, Local Infra for AI Agents
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
 *
 * @example Custom Retriever
 * ```typescript
 * import { createTx, RetrieverService } from "@jamesaphoenix/tx";
 * import { Effect, Layer } from "effect";
 *
 * // Custom Pinecone retriever
 * const myRetriever = Layer.succeed(RetrieverService, {
 *   search: (query, options) => Effect.gen(function* () {
 *     const results = yield* pineconeQuery(query);
 *     return results.map(toLearningWithScore);
 *   }),
 *   isAvailable: () => Effect.succeed(true)
 * });
 *
 * const tx = createTx({
 *   retriever: myRetriever  // optional override
 * });
 * ```
 */

// Re-export everything from @jamesaphoenix/tx-core
export * from "@jamesaphoenix/tx-core";

// Export createTx and related types
export { createTx, type CreateTxOptions, type TxClient } from "./create-tx.js";

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
  RetrievalOptions,
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
} from "@jamesaphoenix/tx-types";

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
} from "@jamesaphoenix/tx-types";
