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

// Factories (to be implemented)
// export { createTestLearning, createTestLearnings, LearningFactory } from './factories/index.js'
// export { createTestTask, createTestTasks, TaskFactory } from './factories/index.js'
// export { createTestEdge, createEdgeBetweenLearnings, EdgeFactory } from './factories/index.js'
// export { createTestAnchor, AnchorFactory } from './factories/index.js'
// export { createTestCandidate, CandidateFactory } from './factories/index.js'

// LLM Cache (to be implemented)
// export { cachedLLMCall, withLLMCache, hashInput, configureLLMCache } from './llm-cache/index.js'
// export { getCacheStats, clearCache, formatCacheStats } from './llm-cache/index.js'

// Effect Helpers (to be implemented)
// export { runEffect, runEffectFail, runEffectEither, expectEffectSuccess, expectEffectFailure } from './helpers/index.js'

// Temp Files (to be implemented)
// export { createTempDir, writeTestTypeScriptFile, createTestSourceFiles } from './helpers/index.js'
// export type { TempDir } from './helpers/index.js'

// Mocks (to be implemented)
// export { createMockAnthropic, createMockAnthropicForExtraction } from './mocks/index.js'
// export { MockAstGrepService } from './mocks/index.js'
// export { MockFileSystem } from './mocks/index.js'

// Setup (to be implemented)
// export { default as vitestSetup } from './setup/index.js'
