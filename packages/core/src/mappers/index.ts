/**
 * @tx/core/mappers - Row to domain object conversion utilities
 */

// Shared utilities
export { parseDate } from "./parse-date.js"

// Task mappers
export {
  rowToTask,
  rowToDependency,
  isValidStatus,
  isValidTransition,
  TASK_STATUSES,
  VALID_TRANSITIONS,
  type TaskRow,
  type DependencyRow
} from "./task.js"

// Learning mappers
export {
  rowToLearning,
  rowToLearningWithoutEmbedding,
  isValidSourceType,
  float32ArrayToBuffer,
  LEARNING_SOURCE_TYPES,
  type LearningRow
} from "./learning.js"

// File learning mappers
export {
  rowToFileLearning,
  matchesPattern,
  type FileLearningRow
} from "./file-learning.js"

// Attempt mappers
export {
  rowToAttempt,
  isValidOutcome,
  ATTEMPT_OUTCOMES,
  type AttemptRow
} from "./attempt.js"

// Run mappers
export {
  rowToRun,
  generateRunId,
  serializeRun,
  isValidRunStatus,
  RUN_STATUSES
} from "./run.js"

// Anchor mappers
export {
  rowToAnchor,
  rowToInvalidationLog,
  isValidAnchorType,
  isValidAnchorStatus,
  isValidInvalidationSource,
  type AnchorRow
} from "./anchor.js"

// Edge mappers
export {
  rowToEdge,
  isValidEdgeType,
  isValidNodeType,
  type EdgeRow
} from "./edge.js"

// Deduplication mappers
export {
  normalizeContent,
  hashContent,
  rowToProcessedHash,
  serializeProcessedHash,
  rowToFileProgress,
  serializeFileProgress
} from "./deduplication.js"

// Candidate mappers
export {
  rowToCandidate,
  isValidConfidence,
  isValidStatus as isValidCandidateStatus,
  isValidCategory,
  CANDIDATE_CONFIDENCES,
  CANDIDATE_CATEGORIES,
  CANDIDATE_STATUSES,
  type CandidateRow
} from "./candidate.js"

// TrackedProject mappers
export {
  rowToTrackedProject,
  isValidTrackedSourceType,
  SOURCE_TYPES,
  type TrackedProjectRow
} from "./tracked-project.js"

// Worker mappers
export {
  rowToWorker,
  isValidWorkerStatus,
  WORKER_STATUSES,
  type WorkerRow
} from "./worker.js"

// Claim mappers
export {
  rowToClaim,
  isValidClaimStatus,
  CLAIM_STATUSES,
  type ClaimRow
} from "./claim.js"

// OrchestratorState mappers
export {
  rowToOrchestratorState,
  isValidOrchestratorStatus,
  ORCHESTRATOR_STATUSES,
  type OrchestratorStateRow
} from "./orchestrator-state.js"
