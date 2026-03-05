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

// CLI-heavy integration suites run many subprocesses in parallel.
// Use a conservative default timeout unless explicitly overridden.
if (!process.env.CLI_TEST_TIMEOUT) {
  process.env.CLI_TEST_TIMEOUT = process.env.CI ? "120000" : "90000"
}

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
