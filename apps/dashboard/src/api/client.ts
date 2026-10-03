import type { SpecHealth } from "@jamesaphoenix/tx"
import type { TaskLinkedDocRef } from "@jamesaphoenix/tx/types"
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

export type TaskAssigneeType = "human" | "agent"
export type DashboardDefaultTaskView = "list" | "kanban"

export interface CycleSettings {
  cycleLengthDays: number
  cycleStartDay: string
  carryStatuses: string[]
  autoAddStatuses: string[]
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
  assigneeType: TaskAssigneeType | null
  assigneeId: string | null
  assignedAt: string | null
  assignedBy: string | null
  metadata: Record<string, unknown>
  labels?: TaskLabel[]
}

export interface DashboardSettings {
  dashboard: {
    defaultTaskAssigmentType: TaskAssigneeType
    defaultTaskView: DashboardDefaultTaskView
    cycles?: CycleSettings
  }
}

export interface DashboardSettingsPatch {
  dashboard?: {
    defaultTaskAssigmentType?: TaskAssigneeType
    defaultTaskView?: DashboardDefaultTaskView
    cycles?: CycleSettings
  }
}

export interface TaskMutationPayload {
  title?: string
  description?: string
  parentId?: string | null
  status?: string
  score?: number
  assigneeType?: TaskAssigneeType | null
  assigneeId?: string | null
  assignedAt?: string | null
  assignedBy?: string | null
  metadata?: Record<string, unknown>
}


export interface TaskWithDeps extends TaskRow {
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
  linkedDocs?: readonly TaskLinkedDocRef[]
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

export interface StatsResponse {
  tasks: number
  done: number
  ready: number
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

// Preserve safe, human-readable API errors instead of hiding validation failures.
const responseError = async (response: Response): Promise<ApiError> => {
  let message = `HTTP ${response.status}: ${response.statusText}`
  try {
    const body: unknown = await response.json()
    if (typeof body === "object" && body !== null) {
      const error = "error" in body ? body.error : "message" in body ? body.message : null
      if (typeof error === "string" && error.trim()) message = error
    }
  } catch { /* Non-JSON proxy errors retain the HTTP status. */ }
  return new ApiError({message, status: response.status})
}
const apiError = (error: unknown): ApiError => error instanceof ApiError ? error :
  new ApiError({message: error instanceof Error ? error.message : String(error)})

// Effect-based API functions
const fetchJson = <T>(url: string, options?: { signal?: AbortSignal }): Effect.Effect<T, ApiError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url, { signal: options?.signal })
      if (!res.ok) {
        throw await responseError(res)
      }
      return res.json() as Promise<T>
    },
    catch: apiError,
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
          throw await responseError(res)
        }
      }

      throw new Error(`HTTP ${lastStatus}: ${lastStatusText}`)
    },
    catch: apiError,
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
  createTask: (payload: TaskMutationPayload & { title: string }) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<TaskWithDeps>
      },
      catch: apiError,
    }),
  updateTask: (id: string, payload: TaskMutationPayload) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-tx-actor": "human",
          },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<TaskWithDeps>
      },
      catch: apiError,
    }),
  getSettings: () => fetchJson<DashboardSettings>("/api/settings"),
  updateSettings: (payload: DashboardSettingsPatch) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<DashboardSettings>
      },
      catch: apiError,
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
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<TaskLabel>
      },
      catch: apiError,
    }),
  updateLabel: (labelId: number, payload: { name?: string; color?: string }) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetchWithFallback(
          [`/api/labels/${labelId}`, `/api/task-labels/${labelId}`],
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        )
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<TaskLabel>
      },
      catch: apiError,
    }),
  deleteLabel: (labelId: number) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetchWithFallback(
          [`/api/labels/${labelId}`, `/api/task-labels/${labelId}`],
          {
            method: "DELETE",
          }
        )
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<{ success: boolean; id: number }>
      },
      catch: apiError,
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
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<AssignLabelResponse>
      },
      catch: apiError,
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
        if (!res.ok) throw await responseError(res)
        return res.json() as Promise<AssignLabelResponse>
      },
      catch: apiError,
    }),
  getStats: () => fetchJson<StatsResponse>("/api/stats"),
}

// Cycle types
export interface Cycle {
  id: string
  name: string
  startDate: string
  endDate: string
  status: "current" | "upcoming" | "completed"
  createdAt: string
  updatedAt: string
  taskCount: number
  completedCount: number
  inProgressCount: number
}

export interface CycleDetail extends Cycle {
  tasks: TaskWithDeps[]
}

// Doc types
export interface DocSerialized {
  id: number
  docId: string
  hash: string
  kind: "overview" | "prd" | "design" | "requirement" | "system_design" | "runbook" | "decision" | "plan"
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
  kind: "overview" | "prd" | "design" | "requirement" | "system_design" | "runbook" | "decision" | "plan" | "task"
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
  docId: string | null
  name: string
  version: number | null
  filePath: string
  yamlContent: string | null
  renderedContent: string | null
}

const appendDocVersion = (url: string, version?: number): string => {
  if (!version) return url
  const qs = new URLSearchParams({ version: String(version) })
  return `${url}?${qs.toString()}`
}

export const docSelectionKey = (doc: Pick<DocSerialized, "docId" | "version">): string =>
  `${doc.docId}:${doc.version}`

export interface DocHealthIssue {
  docId: string
  docName: string
  kind: string
  problems: string[]
}

export interface DocHealthResponse {
  total: number
  healthy: number
  issues: DocHealthIssue[]
}

// Preserve typed HTTP errors at the Promise boundary. runPromise by itself
// wraps failures in FiberFailure, which hides the status from callers.
const runApi = async <T>(effect: Effect.Effect<T, ApiError>): Promise<T> => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (result._tag === "Left") throw result.left
  return result.right
}

// Promise-based wrappers for TanStack Query
export const fetchers = {
  specHealth: (): Promise<SpecHealth> => runApi(fetchJson<SpecHealth>("/api/spec/health")),
  tasks: () => runApi(api.getTasks()),
  allTasks: async (options?: {signal?: AbortSignal}): Promise<TasksResponse> => {
    const tasks = new Map<string, TaskWithDeps>()
    const cursors = new Set<string>()
    let cursor: string | null = null
    for (;;) {
      const params = new URLSearchParams({limit:"100"})
      if (cursor) params.set("cursor", cursor)
      const page = await runApi(fetchJson<PaginatedTasksResponse>(`/api/tasks?${params}`, options))
      for (const task of page.tasks) tasks.set(task.id, task)
      if (!page.hasMore) return {tasks:[...tasks.values()],summary:page.summary}
      if (typeof page.nextCursor !== "string" || !page.nextCursor) throw new Error("Task page is missing its next cursor")
      if (cursors.has(page.nextCursor)) throw new Error("Task pagination returned a repeated cursor")
      cursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
  },
  ready: () => runApi(api.getReady()),
  taskDetail: (id: string, options?: { signal?: AbortSignal }) => runApi(api.getTaskDetail(id, options)),
  createTask: (payload: TaskMutationPayload & { title: string }) =>
    runApi(api.createTask(payload)),
  updateTask: (id: string, payload: TaskMutationPayload) =>
    runApi(api.updateTask(id, payload)),
  settings: () => runApi(api.getSettings()),
  updateSettings: (payload: DashboardSettingsPatch) => runApi(api.updateSettings(payload)),
  labels: () => runApi(api.getLabels()),
  createLabel: (payload: { name: string; color?: string }) => runApi(api.createLabel(payload)),
  updateLabel: (labelId: number, payload: { name?: string; color?: string }) =>
    runApi(api.updateLabel(labelId, payload)),
  deleteLabel: (labelId: number) =>
    runApi(api.deleteLabel(labelId)),
  assignTaskLabel: (taskId: string, payload: { labelId?: number; name?: string; color?: string }) =>
    runApi(api.assignTaskLabel(taskId, payload)),
  unassignTaskLabel: (taskId: string, labelId: number) =>
    runApi(api.unassignTaskLabel(taskId, labelId)),
  stats: () => runApi(api.getStats()),
  listCycles: async (): Promise<Cycle[]> => {
    const res = await fetch("/api/cycles")
    if (!res.ok) throw await responseError(res)
    const data = await res.json()
    return data.cycles
  },
  createCycle: async (): Promise<Cycle> => {
    const res = await fetch("/api/cycles", { method: "POST" })
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  getCycle: async (id: string): Promise<CycleDetail> => {
    const res = await fetch(`/api/cycles/${id}`)
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  updateCycle: async (
    id: string,
    data: { name?: string; startDate?: string; endDate?: string }
  ): Promise<Cycle> => {
    const res = await fetch(`/api/cycles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  addTasksToCycle: async (cycleId: string, taskIds: string[]): Promise<void> => {
    const res = await fetch(`/api/cycles/${cycleId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds }),
    })
    if (!res.ok) throw await responseError(res)
  },
  removeTaskFromCycle: async (cycleId: string, taskId: string): Promise<void> => {
    const res = await fetch(`/api/cycles/${cycleId}/tasks/${taskId}`, {
      method: "DELETE",
    })
    if (!res.ok) throw await responseError(res)
  },
  completeCycle: async (id: string): Promise<{ completedCycle: Cycle; newCycle: Cycle; carriedTaskIds: string[] }> => {
    const res = await fetch(`/api/cycles/${id}/complete`, {
      method: "POST",
    })
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  docs: async (params?: { kind?: string; status?: string }): Promise<DocsListResponse> => {
    const qs = new URLSearchParams()
    if (params?.kind) qs.set("kind", params.kind)
    if (params?.status) qs.set("status", params.status)
    const url = qs.toString() ? `/api/docs?${qs}` : "/api/docs"
    const res = await fetch(url)
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  docDetail: async (docId: string, version?: number): Promise<DocSerialized> => {
    const res = await fetch(appendDocVersion(`/api/docs/by-id/${encodeURIComponent(docId)}`, version))
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  docRender: async (name?: string): Promise<DocRenderResponse> => {
    const res = await fetch("/api/docs/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name ?? null }),
    })
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  docSource: async (docId: string, version?: number): Promise<DocSourceResponse> => {
    const res = await fetch(appendDocVersion(`/api/docs/by-id/${encodeURIComponent(docId)}/source`, version))
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  docGraph: async (): Promise<DocGraphResponse> => {
    const res = await fetch("/api/docs/graph")
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  docHealth: async (): Promise<DocHealthResponse> => {
    const res = await fetch("/api/docs/health")
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  deleteDoc: async (docId: string, version?: number): Promise<{ success: boolean; docId: string | null; name: string; version: number | null }> => {
    const res = await fetch(appendDocVersion(`/api/docs/by-id/${encodeURIComponent(docId)}`, version), { method: "DELETE" })
    if (!res.ok) throw await responseError(res)
    return res.json()
  },
  deleteTask: async (id: string): Promise<void> => {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" })
    if (!res.ok) throw await responseError(res)
  },
}
