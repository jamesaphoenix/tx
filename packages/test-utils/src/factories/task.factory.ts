/**
 * Task factory for creating test task data.
 *
 * @module @tx/test-utils/factories/task
 */

import type {
  Task,
  TaskId,
  TaskStatus
} from "@jamesaphoenix/tx-types"
import type { TestDatabase } from "../database/index.js"
import { fixtureId } from "../fixtures/index.js"

/**
 * Options for creating a test task.
 */
export interface CreateTaskOptions {
  /** Task ID (auto-generated if not provided) */
  id?: string
  /** Task title */
  title?: string
  /** Task description */
  description?: string
  /** Task status */
  status?: TaskStatus
  /** Parent task ID */
  parentId?: string | null
  /** Priority score */
  score?: number
  /** Task metadata */
  metadata?: Record<string, unknown>
  /** Creation timestamp */
  createdAt?: Date
  /** Completion timestamp (only if status is 'done') */
  completedAt?: Date | null
}

/**
 * Factory class for creating test tasks.
 *
 * Provides methods to create individual tasks or batches of tasks
 * with customizable properties.
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const factory = new TaskFactory(db)
 *
 * // Create single task
 * const task = factory.create({ title: 'Test Task' })
 *
 * // Create with dependencies
 * const parent = factory.create({ title: 'Parent' })
 * const child = factory.create({ title: 'Child', parentId: parent.id })
 *
 * // Create multiple tasks
 * const tasks = await factory.createMany(5, { status: 'backlog' })
 * ```
 */
export class TaskFactory {
  private counter = 0
  private readonly db: TestDatabase
  private readonly namespace: string

  constructor(db: TestDatabase, namespace = "task-factory") {
    this.db = db
    this.namespace = namespace
  }

  /**
   * Create a single test task.
   */
  create(options: CreateTaskOptions = {}): Task {
    this.counter++
    const now = new Date()

    const id = options.id ?? fixtureId(`${this.namespace}::task-${this.counter}`)
    const title = options.title ?? `Test Task ${this.counter}`
    const description = options.description ?? ""
    const status = options.status ?? "backlog"
    const parentId = options.parentId ?? null
    const score = options.score ?? 500
    const metadata = options.metadata ?? {}
    const createdAt = options.createdAt ?? now
    const completedAt = options.completedAt ?? (status === "done" ? now : null)

    this.db.run(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, metadata, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        description,
        status,
        parentId,
        score,
        JSON.stringify(metadata),
        createdAt.toISOString(),
        now.toISOString(),
        completedAt ? completedAt.toISOString() : null
      ]
    )

    return {
      id: id as TaskId,
      title,
      description,
      status,
      parentId: parentId as TaskId | null,
      score,
      metadata,
      createdAt,
      updatedAt: now,
      completedAt
    }
  }

  /**
   * Create multiple test tasks.
   */
  createMany(count: number, options: CreateTaskOptions = {}): Task[] {
    const tasks: Task[] = []
    for (let i = 0; i < count; i++) {
      tasks.push(this.create({
        ...options,
        title: options.title ? `${options.title} ${i + 1}` : undefined
      }))
    }
    return tasks
  }

  /**
   * Create a task with a specific status.
   */
  withStatus(status: TaskStatus, options: CreateTaskOptions = {}): Task {
    return this.create({ ...options, status })
  }

  /**
   * Create a completed task.
   */
  completed(options: CreateTaskOptions = {}): Task {
    return this.create({
      ...options,
      status: "done",
      completedAt: options.completedAt ?? new Date()
    })
  }

  /**
   * Create a task hierarchy (parent with children).
   */
  withChildren(
    parentOptions: CreateTaskOptions,
    childCount: number,
    childOptions: CreateTaskOptions = {}
  ): { parent: Task; children: Task[] } {
    const parent = this.create(parentOptions)
    const children = this.createMany(childCount, {
      ...childOptions,
      parentId: parent.id
    })
    return { parent, children }
  }

  /**
   * Reset the internal counter.
   */
  reset(): void {
    this.counter = 0
  }
}

/**
 * Create a single test task (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const task = createTestTask(db, { title: 'My Task' })
 * ```
 */
export const createTestTask = (
  db: TestDatabase,
  options: CreateTaskOptions = {}
): Task => {
  const factory = new TaskFactory(db)
  return factory.create(options)
}

/**
 * Create multiple test tasks (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const tasks = createTestTasks(db, 5, { status: 'backlog' })
 * ```
 */
export const createTestTasks = (
  db: TestDatabase,
  count: number,
  options: CreateTaskOptions = {}
): Task[] => {
  const factory = new TaskFactory(db)
  return factory.createMany(count, options)
}
