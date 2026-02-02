/**
 * Entity factories for creating test data.
 *
 * Provides factory classes and convenience functions for creating
 * test instances of all core tx entities with deterministic fixture IDs.
 *
 * @module @tx/test-utils/factories
 */

// Task factory
export {
  TaskFactory,
  createTestTask,
  createTestTasks,
  type CreateTaskOptions
} from "./task.factory.js"

// Learning factory
export {
  LearningFactory,
  createTestLearning,
  createTestLearnings,
  type CreateLearningOptions
} from "./learning.factory.js"

// Edge factory
export {
  EdgeFactory,
  createTestEdge,
  createEdgeBetweenLearnings,
  type CreateEdgeOptions
} from "./edge.factory.js"

// Anchor factory
export {
  AnchorFactory,
  createTestAnchor,
  type CreateAnchorOptions
} from "./anchor.factory.js"

// Candidate factory
export {
  CandidateFactory,
  createTestCandidate,
  type CreateCandidateOptions,
  type LearningCandidate,
  type CandidateConfidence,
  type CandidateStatus
} from "./candidate.factory.js"

// Re-export fixture ID utilities for convenience
export {
  fixtureId,
  namespacedFixtureId,
  sequentialFixtureIds,
  contentFixtureId
} from "../fixtures/index.js"
