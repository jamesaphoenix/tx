/**
 * Singleton test database for maximum memory efficiency.
 *
 * Instead of creating a new database per test or per describe block,
 * this module provides a single shared database instance for the entire test suite.
 *
 * Usage:
 * - Tests call `getSharedTestLayer()` to get the singleton
 * - Global `afterEach` in vitest.setup.ts calls `resetTestDb()` for isolation
 * - Global `afterAll` calls `closeTestDb()` for cleanup
 *
 * @module @tx/test-utils/singleton
 */

import { createSharedTestLayer, type SharedTestLayerResult } from "./helpers/shared-test-layer.js"

let instance: SharedTestLayerResult | null = null

/**
 * Get the singleton test database layer.
 * Creates it on first call, returns cached instance thereafter.
 *
 * @example
 * ```typescript
 * import { getSharedTestLayer } from '@jamesaphoenix/tx-test-utils'
 *
 * it("test", async () => {
 *   const { layer } = await getSharedTestLayer()
 *   const result = await Effect.runPromise(
 *     myEffect.pipe(Effect.provide(layer))
 *   )
 * })
 * ```
 */
export const getSharedTestLayer = async (): Promise<SharedTestLayerResult> => {
  if (!instance) {
    instance = await createSharedTestLayer()
  }
  return instance
}

/**
 * Reset all tables in the singleton DB.
 * Call in afterEach to ensure test isolation.
 * Safe to call even if DB hasn't been initialized.
 */
export const resetTestDb = async (): Promise<void> => {
  if (instance) {
    await instance.reset()
  }
}

/**
 * Close the singleton DB connection.
 * Call in global teardown or afterAll.
 * Resets the singleton so a new one can be created if needed.
 */
export const closeTestDb = async (): Promise<void> => {
  if (instance) {
    await instance.close()
    instance = null
  }
}

/**
 * Check if the singleton has been initialized.
 * Useful for debugging and conditional logic.
 */
export const isTestDbInitialized = (): boolean => {
  return instance !== null
}
