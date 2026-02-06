// API client using Effect for type-safe fetching
import { Effect, Data } from "effect"

// Error types
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly message: string
  readonly status?: number
}> {}

// Response types
export interface TaskRow {
  id: string
  title: string
  description: string
  status: string
  parentId: string | null
  score: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  metadata: Record<string, unknown>
}

export interface TaskWithDeps extends TaskRow {
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
}

export interface TasksResponse {
  tasks: TaskWithDeps[]
  summary: {
    total: number
    byStatus: Record<string, number>
  }
}

export interface PaginatedTasksResponse {
  tasks: TaskWithDeps[]
  nextCursor: string | null
  hasMore: boolean
  total: number
  summary: {
    total: number
    byStatus: Record<string, number>
  }
}

export interface ReadyResponse {
  tasks: TaskWithDeps[]
}

export interface RalphActivity {
  timestamp: string
  iteration: number
  task: string
  taskTitle: string
  agent: string
  status: "started" | "completed" | "failed"
}

export interface RalphResponse {
  running: boolean
  pid: number | null
  currentIteration: number
  currentTask: string | null
  recentActivity: RalphActivity[]
}

export interface StatsResponse {
  tasks: number
  done: number
  ready: number
  learnings: number
  runsRunning?: number
  runsTotal?: number
}

// Run types
export interface Run {
  id: string
  taskId: string | null
  agent: string
  startedAt: string
  endedAt: string | null
  status: string
  exitCode: number | null
  pid: number | null
  transcriptPath: string | null
  summary: string | null
  errorMessage: string | null
  taskTitle?: string | null
}

export interface RunsResponse {
  runs: Run[]
}

export interface PaginatedRunsResponse {
  runs: Run[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string | unknown
  type?: "tool_use" | "tool_result" | "text"
  tool_name?: string
  timestamp?: string
}

export interface RunDetailResponse {
  run: Run
  messages: ChatMessage[]
}

export interface TaskDetailResponse {
  task: TaskWithDeps
  blockedByTasks: TaskWithDeps[]
  blocksTasks: TaskWithDeps[]
  childTasks: TaskWithDeps[]
}

// Effect-based API functions
const fetchJson = <T>(url: string, options?: { signal?: AbortSignal }): Effect.Effect<T, ApiError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url, { signal: options?.signal })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      return res.json() as Promise<T>
    },
    catch: (e) => new ApiError({ message: String(e) }),
  })

export const api = {
  getTasks: () => fetchJson<TasksResponse>("/api/tasks"),
  getReady: () => fetchJson<ReadyResponse>("/api/tasks/ready"),
  getTaskDetail: (id: string, options?: { signal?: AbortSignal }) => fetchJson<TaskDetailResponse>(`/api/tasks/${id}`, options),
  getRalph: () => fetchJson<RalphResponse>("/api/ralph"),
  getStats: () => fetchJson<StatsResponse>("/api/stats"),
  getRuns: () => fetchJson<RunsResponse>("/api/runs"),
  getRunDetail: (id: string) => fetchJson<RunDetailResponse>(`/api/runs/${id}`),
}

// Promise-based wrappers for TanStack Query
export const fetchers = {
  tasks: () => Effect.runPromise(api.getTasks()),
  ready: () => Effect.runPromise(api.getReady()),
  taskDetail: (id: string, options?: { signal?: AbortSignal }) => Effect.runPromise(api.getTaskDetail(id, options)),
  ralph: () => Effect.runPromise(api.getRalph()),
  stats: () => Effect.runPromise(api.getStats()),
  runs: () => Effect.runPromise(api.getRuns()),
  runDetail: (id: string) => Effect.runPromise(api.getRunDetail(id)),
}
