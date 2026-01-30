import Database from "better-sqlite3"
import { createHash } from "crypto"
import type { TaskId } from "../src/schema.js"
import { MIGRATIONS } from "../src/services/migration-service.js"

// Deterministic SHA256-based IDs for reproducible tests (Rule 3)
export const fixtureId = (name: string): TaskId => {
  const hash = createHash("sha256")
    .update(`fixture:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}` as TaskId
}

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
 * Uses the centralized MIGRATIONS from migration-service.ts to avoid duplication.
 */
export function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")

  // Apply all migrations in order
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql)
  }

  return db
}

export function seedFixtures(db: InstanceType<typeof Database>): void {
  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const insertDep = db.prepare(
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
