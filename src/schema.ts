// Plain TypeScript types for the bootstrap.
// Can be migrated to Effect Schema.Class later for runtime validation.

export const TASK_STATUSES = [
  "backlog", "ready", "planning", "active",
  "blocked", "review", "human_needs_to_review", "done"
] as const

export type TaskStatus = typeof TASK_STATUSES[number]

export type TaskId = string & { readonly _brand: unique symbol }

export interface Task {
  readonly id: TaskId
  readonly title: string
  readonly description: string
  readonly status: TaskStatus
  readonly parentId: TaskId | null
  readonly score: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly completedAt: Date | null
  readonly metadata: Record<string, unknown>
}

export interface TaskWithDeps extends Task {
  readonly blockedBy: TaskId[]
  readonly blocks: TaskId[]
  readonly children: TaskId[]
  readonly isReady: boolean
}

export interface TaskTree {
  readonly task: Task
  readonly children: readonly TaskTree[]
}

export interface TaskDependency {
  readonly blockerId: TaskId
  readonly blockedId: TaskId
  readonly createdAt: Date
}

export interface CreateTaskInput {
  readonly title: string
  readonly description?: string
  readonly parentId?: string | null
  readonly score?: number
  readonly metadata?: Record<string, unknown>
}

export interface UpdateTaskInput {
  readonly title?: string
  readonly description?: string
  readonly status?: TaskStatus
  readonly parentId?: string | null
  readonly score?: number
  readonly metadata?: Record<string, unknown>
}

export interface TaskFilter {
  readonly status?: TaskStatus | TaskStatus[]
  readonly parentId?: string | null
  readonly limit?: number
}

// Status transition validation
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog:                ["ready", "planning", "active", "blocked", "done"],
  ready:                  ["planning", "active", "blocked", "done"],
  planning:               ["ready", "active", "blocked", "done"],
  active:                 ["blocked", "review", "done"],
  blocked:                ["backlog", "ready", "planning", "active"],
  review:                 ["active", "human_needs_to_review", "done"],
  human_needs_to_review:  ["active", "review", "done"],
  done:                   ["backlog"]
}

export const isValidTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  VALID_TRANSITIONS[from]?.includes(to) ?? false

export const isValidStatus = (s: string): s is TaskStatus =>
  TASK_STATUSES.includes(s as TaskStatus)

// DB row type (snake_case from SQLite)
export interface TaskRow {
  id: string
  title: string
  description: string
  status: string
  parent_id: string | null
  score: number
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: string
}

export const rowToTask = (row: TaskRow): Task => ({
  id: row.id as TaskId,
  title: row.title,
  description: row.description,
  status: row.status as TaskStatus,
  parentId: row.parent_id as TaskId | null,
  score: row.score,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  completedAt: row.completed_at ? new Date(row.completed_at) : null,
  metadata: JSON.parse(row.metadata || "{}")
})

// DB row type for dependencies (snake_case from SQLite)
export interface DependencyRow {
  blocker_id: string
  blocked_id: string
  created_at: string
}

export const rowToDependency = (row: DependencyRow): TaskDependency => ({
  blockerId: row.blocker_id as TaskId,
  blockedId: row.blocked_id as TaskId,
  createdAt: new Date(row.created_at)
})
