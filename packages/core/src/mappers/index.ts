/**
 * @tx/core/mappers - Row to domain object conversion utilities
 */

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
  RUN_STATUSES
} from "./run.js"

// Anchor mappers
export {
  rowToAnchor,
  type AnchorRow
} from "./anchor.js"

// Edge mappers
export {
  rowToEdge,
  type EdgeRow
} from "./edge.js"
