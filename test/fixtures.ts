/**
 * Test fixtures - migrated to use @tx/test-utils
 *
 * This file provides backwards-compatible helpers while migrating
 * to the centralized @tx/test-utils package.
 */

import Database from "better-sqlite3"
import { Effect } from "effect"
import type { TaskId } from "../src/schema.js"
import type { TestDatabase } from "@tx/test-utils"
import {
  fixtureId as testUtilsFixtureId,
  createTestDatabase
} from "@tx/test-utils"

// Re-export fixtureId from @tx/test-utils
export const fixtureId = (name: string): TaskId => {
  return testUtilsFixtureId(name) as TaskId
}

// Pre-computed fixture IDs using the @tx/test-utils fixtureId function
export const FIXTURES = {
  TASK_AUTH:    fixtureId("auth"),
  TASK_LOGIN:   fixtureId("login"),
  TASK_JWT:     fixtureId("jwt"),
  TASK_BLOCKED: fixtureId("blocked"),
  TASK_DONE:    fixtureId("done"),
  TASK_ROOT:    fixtureId("root"),
} as const

/**
 * Create an in-memory test database with all migrations applied.
 * Uses @tx/test-utils internally.
 *
 * @deprecated Use createTestDatabase from @tx/test-utils directly for new tests
 */
export function createTestDb(): InstanceType<typeof Database> {
  // Synchronously create the test database
  // This is a compatibility shim - new tests should use createTestDatabase()
  const testDb = Effect.runSync(createTestDatabase())
  return testDb.db as InstanceType<typeof Database>
}

/**
 * Create an in-memory test database (async version).
 * Returns the TestDatabase interface from @tx/test-utils.
 */
export async function createTestDbAsync(): Promise<TestDatabase> {
  return Effect.runPromise(createTestDatabase())
}

/**
 * Seed the database with fixture tasks.
 * Works with both raw Database and TestDatabase interfaces.
 */
export function seedFixtures(db: InstanceType<typeof Database> | TestDatabase): void {
  const now = new Date().toISOString()

  // Determine if we have a TestDatabase or raw Database
  const rawDb = "db" in db ? db.db : db

  const insert = rawDb.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const insertDep = rawDb.prepare(
    `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
  )

  // Root task (no parent)
  insert.run(FIXTURES.TASK_ROOT, "Root project", "The root task", "backlog", null, 1000, now, now, null, "{}")

  // Auth task (parent: root)
  insert.run(FIXTURES.TASK_AUTH, "Implement auth", "Authentication system", "backlog", FIXTURES.TASK_ROOT, 800, now, now, null, "{}")

  // Login task (parent: auth, ready status)
  insert.run(FIXTURES.TASK_LOGIN, "Login page", "Build login UI", "ready", FIXTURES.TASK_AUTH, 600, now, now, null, "{}")

  // JWT task (parent: auth, ready status, no blockers)
  insert.run(FIXTURES.TASK_JWT, "JWT validation", "Validate JWT tokens", "ready", FIXTURES.TASK_AUTH, 700, now, now, null, "{}")

  // Blocked task (parent: auth, blocked by JWT and LOGIN)
  insert.run(FIXTURES.TASK_BLOCKED, "Integration tests", "Test everything", "backlog", FIXTURES.TASK_AUTH, 500, now, now, null, "{}")

  // Done task (parent: auth)
  insert.run(FIXTURES.TASK_DONE, "Setup project", "Initial setup", "done", FIXTURES.TASK_AUTH, 900, now, now, now, "{}")

  // Dependencies: TASK_BLOCKED is blocked by TASK_JWT and TASK_LOGIN
  insertDep.run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, now)
  insertDep.run(FIXTURES.TASK_LOGIN, FIXTURES.TASK_BLOCKED, now)
}
