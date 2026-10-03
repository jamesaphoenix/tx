/**
 * @tx/test-utils - Test utilities, factories, fixtures, and helpers
 *
 * This package centralizes all test utilities across the tx monorepo.
 *
 * @example
 * ```typescript
 * import {
 *   createTestDatabase,
 *   createTestTask,
 *   fixtureId,
 *   runEffect
 * } from '@tx/test-utils'
 * ```
 *
 * @module @tx/test-utils
 */

// Fixtures - SHA256-based deterministic IDs
export {
  fixtureId,
  namespacedFixtureId,
  sequentialFixtureIds,
  contentFixtureId
} from "./fixtures/index.js"

// Database helpers
export {
  createTestDatabase,
  TestDatabaseService,
  TestDatabaseLive,
  createTestDatabaseLayer,
  wrapDbAsTestDatabase
} from "./database/index.js"
export type { TestDatabase } from "./database/index.js"

// Factories
export {
  // Task
  TaskFactory,
  createTestTask,
  createTestTasks,
  type CreateTaskOptions,
} from "./factories/index.js"

// Effect Helpers
export {
  runEffect,
  runEffectFail,
  runEffectEither,
  expectEffectSuccess,
  expectEffectFailure,
  mergeLayers,
  createTestContext,
  type RunEffectOptions,
  type EffectResult
} from "./helpers/index.js"

// Shared Test Layer - memory-efficient integration testing
export {
  createSharedTestLayer,
  type SharedTestLayer,
  type SharedTestLayerResult
} from "./helpers/index.js"

// SQLite database factory for tests
export {
  createSqliteDatabase,
  createMigratedSqliteDatabase
} from "./helpers/index.js"

// Singleton Test Database - ONE DB for entire test suite
export {
  getSharedTestLayer,
  resetTestDb,
  closeTestDb,
  isTestDbInitialized
} from "./singleton.js"
// TODO: Implement remaining mocks (tx-b28e5324)
// export { MockAstGrepService } from './mocks/index.js'
// export { MockFileSystem } from './mocks/index.js'

// Setup (to be implemented)
// export { default as vitestSetup } from './setup/index.js'

// Chaos Engineering Utilities
export {
  // Namespace export
  chaos,
  // Process failure simulation
  crashAfter,
  CrashSimulationError,
  type CrashAfterOptions,
  type CrashAfterResult,
  // State corruption
  corruptState,
  type CorruptStateOptions,
  type CorruptionType,
  // JSONL replay
  replayJSONL,
  type ReplayJSONLOptions,
  type ReplayJSONLResult,
  type SyncOperation,
  // Double completion testing
  doubleComplete,
  type DoubleCompleteOptions,
  type DoubleCompleteResult,
  // Partial write simulation
  partialWrite,
  type PartialWriteOptions,
  type PartialWriteResult,
  // Stress testing
  stressLoad,
  type StressLoadOptions,
  type StressLoadResult
} from "./chaos/index.js"
