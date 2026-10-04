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

// Re-export fixture ID utilities for convenience
export {
  fixtureId,
  namespacedFixtureId,
  sequentialFixtureIds,
  contentFixtureId
} from "../fixtures/index.js"
