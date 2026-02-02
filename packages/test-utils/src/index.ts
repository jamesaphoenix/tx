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
  createTestDatabaseLayer
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
  type MockAnthropicResult
} from "./mocks/index.js"
// TODO: Implement remaining mocks (tx-b28e5324)
// export { MockAstGrepService } from './mocks/index.js'
// export { MockFileSystem } from './mocks/index.js'

// Setup (to be implemented)
// export { default as vitestSetup } from './setup/index.js'
