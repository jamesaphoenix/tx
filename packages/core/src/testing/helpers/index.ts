/**
 * Test helper utilities.
 *
 * @module @tx/test-utils/helpers
 */

// Effect test helpers
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
} from "./effect.js"

// Shared test layer for memory-efficient integration tests
export {
  createSharedTestLayer,
  type SharedTestLayer,
  type SharedTestLayerResult
} from "./shared-test-layer.js"

// SQLite database factory for tests
export {
  createSqliteDatabase,
  createMigratedSqliteDatabase
} from "./sqlite-factory.js"

// TODO: Implement temp file helpers
// export { createTempDir, writeTestTypeScriptFile, createTestSourceFiles } from './temp-files.js'
// export type { TempDir } from './temp-files.js'
