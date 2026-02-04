/**
 * Vitest Global Setup
 *
 * This file runs before all tests and provides:
 * - Singleton test database initialization
 * - Automatic reset between tests for isolation
 * - Proper cleanup after all tests complete
 *
 * Tests DO NOT need their own beforeAll/afterEach/afterAll for database setup.
 * Just import { getSharedTestLayer } from '@jamesaphoenix/tx-test-utils' and use it.
 */

import { beforeAll, afterEach, afterAll } from "vitest"
import { getSharedTestLayer, resetTestDb, closeTestDb } from "@jamesaphoenix/tx-test-utils"

// Initialize singleton DB before any tests run
beforeAll(async () => {
  await getSharedTestLayer()
})

// Reset DB between every test for isolation
afterEach(async () => {
  await resetTestDb()
})

// Close DB after all tests complete
afterAll(async () => {
  await closeTestDb()
})
