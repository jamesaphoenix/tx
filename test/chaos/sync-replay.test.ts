/**
 * Chaos Engineering: JSONL Sync Replay and Conflict Tests
 *
 * Tests deterministic JSONL replay, conflict resolution, and
 * data consistency during sync operations.
 *
 * Per DD-007: Uses real in-memory SQLite and SHA256-based fixture IDs.
 *
 * @module test/chaos/sync-replay
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import type { TaskId } from "@jamesaphoenix/tx-types"
import {
  createTestDatabase,
  fixtureId,
  chaos,
  type TestDatabase,
  type SyncOperation
} from "@jamesaphoenix/tx-test-utils"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const FIXTURES = {
  TASK_1: fixtureId("chaos-sync-task-1") as TaskId,
  TASK_2: fixtureId("chaos-sync-task-2") as TaskId,
  TASK_3: fixtureId("chaos-sync-task-3") as TaskId,
  TASK_BLOCKER: fixtureId("chaos-sync-blocker") as TaskId,
  TASK_BLOCKED: fixtureId("chaos-sync-blocked") as TaskId
} as const

// =============================================================================
// INVARIANT: JSONL replay is deterministic
// =============================================================================

describe("Chaos: JSONL Replay Determinism", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  describe("Basic task upsert replay", () => {
    it("replays single task upsert correctly", () => {
      const jsonl = `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Task 1","status":"backlog","score":500,"description":"","parentId":null,"metadata":{}}}`

      const result = chaos.replayJSONL({ db, content: jsonl })

      expect(result.opsReplayed).toBe(1)
      expect(result.tasksCreated).toBe(1)
      expect(result.errors).toHaveLength(0)

      const task = db.query<{ id: string; title: string }>(
        "SELECT id, title FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(task.id).toBe(FIXTURES.TASK_1)
      expect(task.title).toBe("Task 1")
    })

    it("replays multiple task upserts correctly", () => {
      const jsonl = [
        `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Task 1","status":"backlog","score":500,"description":"","parentId":null,"metadata":{}}}`,
        `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_2}","data":{"title":"Task 2","status":"ready","score":600,"description":"","parentId":null,"metadata":{}}}`,
        `{"v":1,"op":"upsert","ts":"2024-01-03T00:00:00Z","id":"${FIXTURES.TASK_3}","data":{"title":"Task 3","status":"active","score":700,"description":"","parentId":null,"metadata":{}}}`
      ].join("\n")

      const result = chaos.replayJSONL({ db, content: jsonl })

      expect(result.opsReplayed).toBe(3)
      expect(result.tasksCreated).toBe(3)

      const tasks = db.query<{ id: string }>("SELECT id FROM tasks ORDER BY id")
      expect(tasks.length).toBe(3)
    })
  })

  describe("Task update replay", () => {
    it("updates existing task when replayed", () => {
      // Create initial task
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 100, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', '{}')`,
        [FIXTURES.TASK_1, "Original Title"]
      )

      // Replay with update
      const jsonl = `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Updated Title","status":"active","score":200,"description":"Updated desc","parentId":null,"metadata":{}}}`

      const result = chaos.replayJSONL({ db, content: jsonl })

      expect(result.tasksUpdated).toBe(1)
      expect(result.tasksCreated).toBe(0)

      const task = db.query<{ title: string; status: string; score: number }>(
        "SELECT title, status, score FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(task.title).toBe("Updated Title")
      expect(task.status).toBe("active")
      expect(task.score).toBe(200)
    })

    it("respects timestamp ordering for same task updates", () => {
      const jsonl = [
        // Later timestamp first in file
        `{"v":1,"op":"upsert","ts":"2024-01-03T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Latest","status":"done","score":999,"description":"","parentId":null,"metadata":{}}}`,
        // Earlier timestamp second
        `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Earliest","status":"backlog","score":100,"description":"","parentId":null,"metadata":{}}}`,
        // Middle timestamp third
        `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Middle","status":"active","score":500,"description":"","parentId":null,"metadata":{}}}`
      ].join("\n")

      const result = chaos.replayJSONL({ db, content: jsonl })

      expect(result.opsReplayed).toBe(3)

      // Final state should reflect latest timestamp
      const task = db.query<{ title: string; status: string }>(
        "SELECT title, status FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )[0]

      expect(task.title).toBe("Latest")
      expect(task.status).toBe("done")
    })
  })

  describe("Dependency replay", () => {
    it("replays dependency addition correctly", () => {
      // Create tasks first
      const now = new Date().toISOString()
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'active', 500, ?, ?, '{}')`,
        [FIXTURES.TASK_BLOCKER, "Blocker Task", now, now]
      )
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 400, ?, ?, '{}')`,
        [FIXTURES.TASK_BLOCKED, "Blocked Task", now, now]
      )

      const jsonl = `{"v":1,"op":"dep_add","ts":"2024-01-01T00:00:00Z","blockerId":"${FIXTURES.TASK_BLOCKER}","blockedId":"${FIXTURES.TASK_BLOCKED}"}`

      const result = chaos.replayJSONL({ db, content: jsonl })

      expect(result.depsAdded).toBe(1)

      const dep = db.query<{ blocker_id: string; blocked_id: string }>(
        "SELECT blocker_id, blocked_id FROM task_dependencies"
      )[0]

      expect(dep.blocker_id).toBe(FIXTURES.TASK_BLOCKER)
      expect(dep.blocked_id).toBe(FIXTURES.TASK_BLOCKED)
    })
  })

  describe("Delete operations replay", () => {
    it("replays task deletion correctly", () => {
      // Create task first
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 100, datetime('now'), datetime('now'), '{}')`,
        [FIXTURES.TASK_1, "To Delete"]
      )

      const jsonl = `{"v":1,"op":"delete","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_1}"}`

      const result = chaos.replayJSONL({ db, content: jsonl })

      expect(result.tasksDeleted).toBe(1)

      const task = db.query<{ id: string }>(
        "SELECT id FROM tasks WHERE id = ?",
        [FIXTURES.TASK_1]
      )
      expect(task.length).toBe(0)
    })
  })

  describe("Clear before replay", () => {
    it("clears existing data when clearFirst is true", () => {
      // Create existing task
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 100, datetime('now'), datetime('now'), '{}')`,
        [FIXTURES.TASK_1, "Existing Task"]
      )

      const jsonl = `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_2}","data":{"title":"New Task","status":"backlog","score":500,"description":"","parentId":null,"metadata":{}}}`

      chaos.replayJSONL({ db, content: jsonl, clearFirst: true })

      const tasks = db.query<{ id: string }>("SELECT id FROM tasks")
      expect(tasks.length).toBe(1)
      expect(tasks[0].id).toBe(FIXTURES.TASK_2)
    })
  })

  describe("Error handling", () => {
    it("handles invalid JSON lines gracefully", () => {
      const jsonl = [
        `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Valid Task","status":"backlog","score":500,"description":"","parentId":null,"metadata":{}}}`,
        "not valid json at all",
        `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_2}","data":{"title":"Another Valid Task","status":"backlog","score":600,"description":"","parentId":null,"metadata":{}}}`
      ].join("\n")

      const result = chaos.replayJSONL({ db, content: jsonl })

      expect(result.errors.length).toBe(1)
      expect(result.tasksCreated).toBe(2) // Both valid tasks created
    })
  })
})

// =============================================================================
// INVARIANT: Replay produces identical state
// =============================================================================

describe("Chaos: Replay State Consistency", () => {
  it("multiple replays of same JSONL produce identical state", async () => {
    const jsonl = [
      `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Task 1","status":"backlog","score":500,"description":"Desc 1","parentId":null,"metadata":{"key":"value"}}}`,
      `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_2}","data":{"title":"Task 2","status":"ready","score":600,"description":"Desc 2","parentId":"${FIXTURES.TASK_1}","metadata":{}}}`,
      `{"v":1,"op":"dep_add","ts":"2024-01-03T00:00:00Z","blockerId":"${FIXTURES.TASK_1}","blockedId":"${FIXTURES.TASK_2}"}`
    ].join("\n")

    const states: Array<{
      tasks: Array<{ id: string; title: string; score: number }>
      deps: Array<{ blocker_id: string; blocked_id: string }>
    }> = []

    // Run replay 3 times on fresh databases
    for (let i = 0; i < 3; i++) {
      const db = await Effect.runPromise(createTestDatabase())

      // Create parent task for TASK_2's parentId reference
      db.run(
        `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
         VALUES (?, ?, '', 'backlog', 1000, '2023-12-31T00:00:00Z', '2023-12-31T00:00:00Z', '{}')`,
        [FIXTURES.TASK_1, "Pre-existing Parent"]
      )

      chaos.replayJSONL({ db, content: jsonl })

      states.push({
        tasks: db.query<{ id: string; title: string; score: number }>(
          "SELECT id, title, score FROM tasks ORDER BY id"
        ),
        deps: db.query<{ blocker_id: string; blocked_id: string }>(
          "SELECT blocker_id, blocked_id FROM task_dependencies"
        )
      })
    }

    // All states should be identical
    for (let i = 1; i < states.length; i++) {
      expect(states[i].tasks).toEqual(states[0].tasks)
      expect(states[i].deps).toEqual(states[0].deps)
    }
  })
})

// =============================================================================
// INVARIANT: Complex operation sequences
// =============================================================================

describe("Chaos: Complex Operation Sequences", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("handles create-update-delete sequence correctly", () => {
    const jsonl = [
      // Create
      `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Created","status":"backlog","score":100,"description":"","parentId":null,"metadata":{}}}`,
      // Update
      `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Updated","status":"active","score":200,"description":"","parentId":null,"metadata":{}}}`,
      // Delete
      `{"v":1,"op":"delete","ts":"2024-01-03T00:00:00Z","id":"${FIXTURES.TASK_1}"}`
    ].join("\n")

    const result = chaos.replayJSONL({ db, content: jsonl })

    expect(result.opsReplayed).toBe(3)
    expect(result.tasksCreated).toBe(1)
    expect(result.tasksUpdated).toBe(1)
    expect(result.tasksDeleted).toBe(1)

    // Task should be deleted
    const task = db.query<{ id: string }>(
      "SELECT id FROM tasks WHERE id = ?",
      [FIXTURES.TASK_1]
    )
    expect(task.length).toBe(0)
  })

  it("handles dependency add-remove sequence correctly", () => {
    // Create tasks first
    const now = new Date().toISOString()
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'active', 500, ?, ?, '{}')`,
      [FIXTURES.TASK_BLOCKER, "Blocker", now, now]
    )
    db.run(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, '', 'backlog', 400, ?, ?, '{}')`,
      [FIXTURES.TASK_BLOCKED, "Blocked", now, now]
    )

    const jsonl = [
      // Add dependency
      `{"v":1,"op":"dep_add","ts":"2024-01-01T00:00:00Z","blockerId":"${FIXTURES.TASK_BLOCKER}","blockedId":"${FIXTURES.TASK_BLOCKED}"}`,
      // Remove dependency
      `{"v":1,"op":"dep_remove","ts":"2024-01-02T00:00:00Z","blockerId":"${FIXTURES.TASK_BLOCKER}","blockedId":"${FIXTURES.TASK_BLOCKED}"}`
    ].join("\n")

    const result = chaos.replayJSONL({ db, content: jsonl })

    expect(result.depsAdded).toBe(1)
    expect(result.depsRemoved).toBe(1)

    // Dependency should be removed
    const deps = db.query<{ blocker_id: string }>(
      "SELECT blocker_id FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?",
      [FIXTURES.TASK_BLOCKER, FIXTURES.TASK_BLOCKED]
    )
    expect(deps.length).toBe(0)
  })

  it("handles interleaved operations on multiple tasks", () => {
    const jsonl = [
      // Create Task 1
      `{"v":1,"op":"upsert","ts":"2024-01-01T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Task 1 v1","status":"backlog","score":100,"description":"","parentId":null,"metadata":{}}}`,
      // Create Task 2
      `{"v":1,"op":"upsert","ts":"2024-01-01T01:00:00Z","id":"${FIXTURES.TASK_2}","data":{"title":"Task 2 v1","status":"backlog","score":200,"description":"","parentId":null,"metadata":{}}}`,
      // Update Task 1
      `{"v":1,"op":"upsert","ts":"2024-01-02T00:00:00Z","id":"${FIXTURES.TASK_1}","data":{"title":"Task 1 v2","status":"active","score":150,"description":"","parentId":null,"metadata":{}}}`,
      // Create Task 3
      `{"v":1,"op":"upsert","ts":"2024-01-02T01:00:00Z","id":"${FIXTURES.TASK_3}","data":{"title":"Task 3 v1","status":"ready","score":300,"description":"","parentId":null,"metadata":{}}}`,
      // Update Task 2
      `{"v":1,"op":"upsert","ts":"2024-01-03T00:00:00Z","id":"${FIXTURES.TASK_2}","data":{"title":"Task 2 v2","status":"done","score":250,"description":"","parentId":null,"metadata":{}}}`,
      // Delete Task 1
      `{"v":1,"op":"delete","ts":"2024-01-04T00:00:00Z","id":"${FIXTURES.TASK_1}"}`
    ].join("\n")

    const result = chaos.replayJSONL({ db, content: jsonl })

    expect(result.opsReplayed).toBe(6)

    // Verify final state
    const tasks = db.query<{ id: string; title: string; status: string }>(
      "SELECT id, title, status FROM tasks ORDER BY id"
    )

    expect(tasks.length).toBe(2) // Task 1 deleted, 2 and 3 remain
    expect(tasks.find(t => t.id === FIXTURES.TASK_1)).toBeUndefined()
    expect(tasks.find(t => t.id === FIXTURES.TASK_2)?.title).toBe("Task 2 v2")
    expect(tasks.find(t => t.id === FIXTURES.TASK_3)?.title).toBe("Task 3 v1")
  })
})

// =============================================================================
// INVARIANT: Array-based operation replay
// =============================================================================

describe("Chaos: Array-based JSONL Operations", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  it("accepts operations as array instead of string", () => {
    const operations: SyncOperation[] = [
      {
        v: 1,
        op: "upsert",
        ts: "2024-01-01T00:00:00Z",
        id: FIXTURES.TASK_1,
        data: {
          title: "Array Task",
          status: "backlog",
          score: 500,
          parentId: null,
          metadata: {}
        }
      }
    ]

    const result = chaos.replayJSONL({ db, content: operations })

    expect(result.tasksCreated).toBe(1)

    const task = db.query<{ title: string }>(
      "SELECT title FROM tasks WHERE id = ?",
      [FIXTURES.TASK_1]
    )[0]

    expect(task.title).toBe("Array Task")
  })
})
