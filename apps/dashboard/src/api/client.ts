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
  parent_id: string | null
  score: number
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: string
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
  task_id: string | null
  agent: string
  started_at: string
  ended_at: string | null
  status: string
  exit_code: number | null
  transcript_path: string | null
  summary: string | null
  error_message: string | null
  taskTitle?: string | null
}

export interface RunsResponse {
  runs: Run[]
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

// Effect-based API functions
const fetchJson = <T>(url: string): Effect.Effect<T, ApiError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url)
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
  getRalph: () => fetchJson<RalphResponse>("/api/ralph"),
  getStats: () => fetchJson<StatsResponse>("/api/stats"),
  getRuns: () => fetchJson<RunsResponse>("/api/runs"),
  getRunDetail: (id: string) => fetchJson<RunDetailResponse>(`/api/runs/${id}`),
}

// Promise-based wrappers for TanStack Query
export const fetchers = {
  tasks: () => Effect.runPromise(api.getTasks()),
  ready: () => Effect.runPromise(api.getReady()),
  ralph: () => Effect.runPromise(api.getRalph()),
  stats: () => Effect.runPromise(api.getStats()),
  runs: () => Effect.runPromise(api.getRuns()),
  runDetail: (id: string) => Effect.runPromise(api.getRunDetail(id)),
}
