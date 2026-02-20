// API client using Effect for type-safe fetching
import { Effect, Data } from "effect"

// Error types
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly message: string
  readonly status?: number
}> {}

// Response types
export interface TaskLabel {
  id: number
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

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
  labels?: TaskLabel[]
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
  logs?: {
    stdout: string | null
    stderr: string | null
    stdoutTruncated?: boolean
    stderrTruncated?: boolean
  }
}

export interface TaskDetailResponse {
  task: TaskWithDeps
  blockedByTasks: TaskWithDeps[]
  blocksTasks: TaskWithDeps[]
  childTasks: TaskWithDeps[]
}

export interface LabelsResponse {
  labels: TaskLabel[]
}

export interface AssignLabelResponse {
  success: boolean
  task: TaskWithDeps
  label?: TaskLabel
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

const fetchJsonFromFallbacks = <T>(urls: readonly string[], options?: { signal?: AbortSignal }): Effect.Effect<T, ApiError> =>
  Effect.tryPromise({
    try: async () => {
      let lastStatusText = "Not Found"
      let lastStatus = 404

      for (const url of urls) {
        const res = await fetch(url, { signal: options?.signal })
        if (res.ok) {
          return res.json() as Promise<T>
        }

        lastStatus = res.status
        lastStatusText = res.statusText
        if (res.status !== 404) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }
      }

      throw new Error(`HTTP ${lastStatus}: ${lastStatusText}`)
    },
    catch: (e) => new ApiError({ message: String(e) }),
  })

async function fetchWithFallback(
  urls: readonly string[],
  init: RequestInit
): Promise<Response> {
  let lastResponse: Response | null = null

  for (const url of urls) {
    const res = await fetch(url, init)
    if (res.ok || res.status !== 404) {
      return res
    }
    lastResponse = res
  }

  if (lastResponse) {
    return lastResponse
  }
  throw new Error("No endpoint URLs provided")
}

export const api = {
  getTasks: () => fetchJson<TasksResponse>("/api/tasks"),
  getReady: () => fetchJson<ReadyResponse>("/api/tasks/ready"),
  getTaskDetail: (id: string, options?: { signal?: AbortSignal }) => fetchJson<TaskDetailResponse>(`/api/tasks/${id}`, options),
  createTask: (payload: { title: string; description?: string; parentId?: string | null; status?: string; score?: number; metadata?: Record<string, unknown> }) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        return res.json() as Promise<TaskWithDeps>
      },
      catch: (e) => new ApiError({ message: String(e) }),
    }),
  updateTask: (id: string, payload: { title?: string; description?: string; status?: string; parentId?: string | null; score?: number; metadata?: Record<string, unknown> }) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        return res.json() as Promise<TaskWithDeps>
      },
      catch: (e) => new ApiError({ message: String(e) }),
    }),
  getLabels: () => fetchJsonFromFallbacks<LabelsResponse>(["/api/labels", "/api/task-labels"]),
  createLabel: (payload: { name: string; color?: string }) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetchWithFallback(["/api/labels", "/api/task-labels"], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        return res.json() as Promise<TaskLabel>
      },
      catch: (e) => new ApiError({ message: String(e) }),
    }),
  assignTaskLabel: (taskId: string, payload: { labelId?: number; name?: string; color?: string }) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetchWithFallback(
          [`/api/tasks/${taskId}/labels`, `/api/tasks/${taskId}/task-labels`],
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        return res.json() as Promise<AssignLabelResponse>
      },
      catch: (e) => new ApiError({ message: String(e) }),
    }),
  unassignTaskLabel: (taskId: string, labelId: number) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetchWithFallback(
          [
            `/api/tasks/${taskId}/labels/${labelId}`,
            `/api/tasks/${taskId}/task-labels/${labelId}`,
          ],
          {
            method: "DELETE",
          }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        return res.json() as Promise<AssignLabelResponse>
      },
      catch: (e) => new ApiError({ message: String(e) }),
    }),
  getRalph: () => fetchJson<RalphResponse>("/api/ralph"),
  getStats: () => fetchJson<StatsResponse>("/api/stats"),
  getRuns: () => fetchJson<RunsResponse>("/api/runs"),
  getRunDetail: (id: string) => fetchJson<RunDetailResponse>(`/api/runs/${id}`),
}

// Cycle types
export interface CycleRun {
  id: string
  cycle: number
  name: string
  description: string
  startedAt: string
  endedAt: string | null
  status: string
  rounds: number
  totalNewIssues: number
  existingIssues: number
  finalLoss: number
  converged: boolean
}

export interface RoundMetric {
  cycle: number
  round: number
  loss: number
  newIssues: number
  existingIssues: number
  duplicates: number
  high: number
  medium: number
  low: number
}

export interface CycleIssue {
  id: string
  title: string
  description: string
  severity: string
  issueType: string
  file: string
  line: number
  cycle: number
  round: number
}

export interface CyclesResponse {
  cycles: CycleRun[]
}

export interface CycleDetailResponse {
  cycle: CycleRun
  roundMetrics: RoundMetric[]
  issues: CycleIssue[]
}

// Doc types
export interface DocSerialized {
  id: number
  hash: string
  kind: "overview" | "prd" | "design"
  name: string
  title: string
  version: number
  status: "changing" | "locked"
  filePath: string
  parentDocId: number | null
  createdAt: string
  lockedAt: string | null
}

export interface DocGraphNode {
  id: string
  label: string
  kind: "overview" | "prd" | "design" | "task"
  status?: string
}

export interface DocGraphEdge {
  source: string
  target: string
  type: string
}

export interface DocsListResponse {
  docs: DocSerialized[]
}

export interface DocGraphResponse {
  nodes: DocGraphNode[]
  edges: DocGraphEdge[]
}

export interface DocRenderResponse {
  rendered: string[]
}

export interface DocSourceResponse {
  name: string
  filePath: string
  yamlContent: string | null
  renderedContent: string | null
}

// Promise-based wrappers for TanStack Query
export const fetchers = {
  tasks: () => Effect.runPromise(api.getTasks()),
  ready: () => Effect.runPromise(api.getReady()),
  taskDetail: (id: string, options?: { signal?: AbortSignal }) => Effect.runPromise(api.getTaskDetail(id, options)),
  createTask: (payload: { title: string; description?: string; parentId?: string | null; status?: string; score?: number; metadata?: Record<string, unknown> }) =>
    Effect.runPromise(api.createTask(payload)),
  updateTask: (id: string, payload: { title?: string; description?: string; status?: string; parentId?: string | null; score?: number; metadata?: Record<string, unknown> }) =>
    Effect.runPromise(api.updateTask(id, payload)),
  labels: () => Effect.runPromise(api.getLabels()),
  createLabel: (payload: { name: string; color?: string }) => Effect.runPromise(api.createLabel(payload)),
  assignTaskLabel: (taskId: string, payload: { labelId?: number; name?: string; color?: string }) =>
    Effect.runPromise(api.assignTaskLabel(taskId, payload)),
  unassignTaskLabel: (taskId: string, labelId: number) =>
    Effect.runPromise(api.unassignTaskLabel(taskId, labelId)),
  ralph: () => Effect.runPromise(api.getRalph()),
  stats: () => Effect.runPromise(api.getStats()),
  runs: () => Effect.runPromise(api.getRuns()),
  runDetail: (id: string) => Effect.runPromise(api.getRunDetail(id)),
  cycles: async (): Promise<CyclesResponse> => {
    const res = await fetch("/api/cycles")
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  cycleDetail: async (id: string): Promise<CycleDetailResponse> => {
    const res = await fetch(`/api/cycles/${id}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  docs: async (params?: { kind?: string; status?: string }): Promise<DocsListResponse> => {
    const qs = new URLSearchParams()
    if (params?.kind) qs.set("kind", params.kind)
    if (params?.status) qs.set("status", params.status)
    const url = qs.toString() ? `/api/docs?${qs}` : "/api/docs"
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  docDetail: async (name: string): Promise<DocSerialized> => {
    const res = await fetch(`/api/docs/${encodeURIComponent(name)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  docRender: async (name?: string): Promise<DocRenderResponse> => {
    const res = await fetch("/api/docs/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name ?? null }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  docSource: async (name: string): Promise<DocSourceResponse> => {
    const res = await fetch(`/api/docs/${encodeURIComponent(name)}/source`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  docGraph: async (): Promise<DocGraphResponse> => {
    const res = await fetch("/api/docs/graph")
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  deleteDoc: async (name: string): Promise<{ success: boolean; name: string }> => {
    const res = await fetch(`/api/docs/${encodeURIComponent(name)}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  deleteCycle: async (id: string): Promise<{ success: boolean; id: string; deletedIssues: number }> => {
    const res = await fetch(`/api/cycles/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  deleteIssues: async (issueIds: string[]): Promise<{ success: boolean; deletedCount: number }> => {
    const res = await fetch("/api/cycles/issues/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueIds }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  deleteTask: async (id: string): Promise<void> => {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
}
