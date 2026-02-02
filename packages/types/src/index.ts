/**
 * @tx/types - Shared TypeScript types for tx
 *
 * Zero runtime dependencies - pure TypeScript types only.
 * Works with any runtime (Node, Bun, Deno).
 *
 * @example
 * ```typescript
 * import { Task, TaskWithDeps, TaskId, TaskStatus } from "@tx/types";
 * import { Learning, LearningWithScore } from "@tx/types";
 * import { Attempt, Run } from "@tx/types";
 *
 * // Or import from specific modules:
 * import type { Task, TaskWithDeps } from "@tx/types/task";
 * import type { Learning } from "@tx/types/learning";
 * ```
 */

// Task types
export {
  TASK_STATUSES,
  VALID_TRANSITIONS,
  type TaskStatus,
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

// Learning types
export {
  LEARNING_SOURCE_TYPES,
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
} from "./learning.js";

// File learning types
export {
  type FileLearningId,
  type FileLearning,
  type CreateFileLearningInput,
  type FileLearningRow,
} from "./file-learning.js";

// Attempt types
export {
  ATTEMPT_OUTCOMES,
  type AttemptOutcome,
  type AttemptId,
  type Attempt,
  type CreateAttemptInput,
  type AttemptRow,
} from "./attempt.js";

// Run types
export {
  RUN_STATUSES,
  type RunId,
  type RunStatus,
  type Run,
  type CreateRunInput,
  type UpdateRunInput,
  type RunRow,
} from "./run.js";

// Anchor types
export {
  ANCHOR_TYPES,
  ANCHOR_STATUSES,
  INVALIDATION_SOURCES,
  type AnchorId,
  type AnchorType,
  type AnchorStatus,
  type Anchor,
  type CreateAnchorInput,
  type UpdateAnchorInput,
  type AnchorRow,
  type InvalidationSource,
  type InvalidationLog,
  type InvalidationLogRow,
} from "./anchor.js"

// Edge types
export {
  NODE_TYPES,
  EDGE_TYPES,
  type EdgeId,
  type NodeType,
  type EdgeType,
  type Edge,
  type CreateEdgeInput,
  type UpdateEdgeInput,
  type EdgeRow,
  type NeighborNode,
} from "./edge.js";

// Deduplication types
export {
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

// Candidate types (learning extraction from transcripts)
export {
  CANDIDATE_CONFIDENCES,
  CANDIDATE_CATEGORIES,
  CANDIDATE_STATUSES,
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
