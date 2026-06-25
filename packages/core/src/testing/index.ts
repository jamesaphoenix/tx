/**
 * @tx/test-utils - Test utilities, factories, fixtures, and helpers
 *
 * This package centralizes all test utilities across the tx monorepo.
 *
 * @example
 * ```typescript
 * import {
 *   createTestDatabase,
 *   createTestLearning,
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
  // Learning
  LearningFactory,
  createTestLearning,
  createTestLearnings,
  type CreateLearningOptions,
  // Edge
  EdgeFactory,
  createTestEdge,
  createEdgeBetweenLearnings,
  type CreateEdgeOptions,
  // Anchor
  AnchorFactory,
  createTestAnchor,
  type CreateAnchorOptions,
  // Candidate
  CandidateFactory,
  createTestCandidate,
  type CreateCandidateOptions,
  type LearningCandidate,
  type CandidateConfidence,
  type CandidateStatus
} from "./factories/index.js"

// LLM Cache - SHA256-based response caching
export {
  // Core functions
  hashInput,
  cachedLLMCall,
  withLLMCache,
  configureLLMCache,
  getCacheConfig,
  resetCacheConfig,
  // CLI utilities
  getCacheStats,
  clearCache,
  formatCacheStats,
  getCacheEntry,
  listCacheEntries
} from "./llm-cache/index.js"
export type {
  CacheEntry,
  CachedLLMCallOptions,
  WithLLMCacheOptions,
  CacheStats,
  ClearCacheOptions
} from "./llm-cache/index.js"

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

// Temp Files (to be implemented)
// export { createTempDir, writeTestTypeScriptFile, createTestSourceFiles } from './helpers/index.js'
// export type { TempDir } from './helpers/index.js'

// Mocks
export {
  createMockAnthropic,
  createMockAnthropicForExtraction,
  type MockMessage,
  type MockAnthropicCall,
  type MockAnthropicResponse,
  type MockAnthropicConfig,
  type MockAnthropicResult,
  createMockOpenAI,
  createMockOpenAIForExtraction,
  createMockOpenAIForExtractionRaw,
  type MockOpenAIMessage,
  type MockOpenAIChatCall,
  type MockOpenAIChatResponse,
  type MockOpenAIConfig,
  type MockOpenAIResult
} from "./mocks/index.js"
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
  // Worker heartbeat manipulation
  killHeartbeat,
  WorkerHeartbeatController,
  type KillHeartbeatOptions,
  // Race condition testing
  raceWorkers,
  type RaceWorkersOptions,
  type RaceWorkersResult,
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
  // Delayed claim testing
  delayedClaim,
  type DelayedClaimOptions,
  type DelayedClaimResult,
  // Stress testing
  stressLoad,
  type StressLoadOptions,
  type StressLoadResult
} from "./chaos/index.js"
