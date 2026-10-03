/**
 * Tests for entity factories.
 *
 * Verifies that all factories correctly create test data with
 * proper defaults and customizable options.
 */

import { Effect } from "effect"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { TestDatabase } from "../database/index.js"
import { createTestDatabase } from "../database/index.js"
import {
  TaskFactory,
  createTestTask,
  createTestTasks,
  fixtureId
} from "./index.js"

describe("TaskFactory", () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
  })

  afterEach(async () => {
    await Effect.runPromise(db.close())
  })

  it("should create a task with default values", () => {
    const task = createTestTask(db)

    expect(task.id).toMatch(/^tx-[a-f0-9]{8}$/)
    expect(task.title).toMatch(/^Test Task \d+$/)
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(500)
    expect(task.description).toBe("")
    expect(task.parentId).toBeNull()
    expect(task.createdAt).toBeInstanceOf(Date)
  })

  it("should create a task with custom values", () => {
    const task = createTestTask(db, {
      id: "tx-custom01",
      title: "Custom Task",
      description: "A custom description",
      status: "active",
      score: 800
    })

    expect(task.id).toBe("tx-custom01")
    expect(task.title).toBe("Custom Task")
    expect(task.description).toBe("A custom description")
    expect(task.status).toBe("active")
    expect(task.score).toBe(800)
  })

  it("should create multiple tasks", () => {
    const tasks = createTestTasks(db, 5)

    expect(tasks).toHaveLength(5)
    const ids = tasks.map((t) => t.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(5) // All IDs should be unique
  })

  it("should create task hierarchy with children", () => {
    const factory = new TaskFactory(db)
    const { parent, children } = factory.withChildren(
      { title: "Parent Task" },
      3,
      { status: "backlog" }
    )

    expect(parent.title).toBe("Parent Task")
    expect(children).toHaveLength(3)
    children.forEach((child) => {
      expect(child.parentId).toBe(parent.id)
    })
  })

  it("should create completed task with completedAt timestamp", () => {
    const factory = new TaskFactory(db)
    const task = factory.completed({ title: "Done Task" })

    expect(task.status).toBe("done")
    expect(task.completedAt).toBeInstanceOf(Date)
  })

  it("should persist task to database", () => {
    const task = createTestTask(db, { title: "Persisted Task" })

    const rows = db.query<{ id: string; title: string }>(
      "SELECT id, title FROM tasks WHERE id = ?",
      [task.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Persisted Task")
  })
})

describe("fixtureId", () => {
  it("should generate deterministic IDs", () => {
    const id1 = fixtureId("test-fixture")
    const id2 = fixtureId("test-fixture")

    expect(id1).toBe(id2)
    expect(id1).toMatch(/^tx-[a-f0-9]{8}$/)
  })

  it("should generate different IDs for different inputs", () => {
    const id1 = fixtureId("fixture-a")
    const id2 = fixtureId("fixture-b")

    expect(id1).not.toBe(id2)
  })
})
