/**
 * @jamesaphoenix/tx-agent-sdk Client
 *
 * TxClient provides a unified interface for task management,
 * supporting both HTTP API mode and direct SQLite access.
 *
 * @example
 * ```typescript
 * // HTTP mode (recommended for remote/distributed agents)
 * const tx = new TxClient({ apiUrl: 'http://localhost:3456' })
 *
 * // Direct mode (for local agents, requires @tx/core)
 * const tx = new TxClient({ dbPath: '.tx/tasks.db' })
 *
 * // Usage
 * const ready = await tx.tasks.ready({ limit: 10 })
 * const task = ready[0]
 * await tx.tasks.done(task.id)
 * ```
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type {
  TxClientConfig,
  ListOptions,
  ReadyOptions,
  SerializedTaskWithDeps,
  SerializedLearning,
  SerializedLearningWithScore,
  SerializedFileLearning,
  SerializedContextResult,
  CompleteResult,
  SearchLearningsOptions,
  CreateLearningData,
  CreateFileLearningData,
  PaginatedResponse,
  TaskStatus,
  SerializedMessage,
  SendMessageData,
  InboxOptions,
  GcOptions,
  GcResult,
  SerializedClaim,
  RunHeartbeatData,
  RunHeartbeatResult,
  StalledRunsOptions,
  ReapStalledRunsOptions,
  SerializedStalledRun,
  SerializedReapedRun,
  SerializedRun,
  RunsListOptions,
  PaginatedRunsResult,
  SerializedTraceMessage,
  RunDetailResult,
  LogContentResult,
  TraceErrorsOptions,
  TraceErrorEntry,
  SerializedPin,
  SerializedMemoryDocument,
  SerializedMemoryDocumentWithScore,
  SerializedMemorySource,
  MemorySearchOptions,
  CreateMemoryDocumentData,
  MemoryIndexResult,
  MemoryIndexStatus,
  SerializedMemoryLink,
  SyncExportResult,
  SyncImportResult,
  SyncStatusResult,
  SyncStreamInfoResult,
  SyncHydrateResult,
  SerializedDoc,
  SerializedDocLink,
  SerializedInvariant,
  SerializedInvariantCheck,
  DiscoverResult,
  FciResult,
  SpecScopeOptions,
  SerializedSpecTest,
  SerializedSpecGap,
  SpecStatusResult,
  SerializedTraceabilityMatrixEntry,
  SerializedSpecSignoff,
  SpecBatchRunInput,
  SpecBatchRunResult,
  SpecBatchSource,
  SerializedCycleRun,
  SerializedCycleDetail,
  DocGraph,
  StatsResult,
  SerializedGuard,
  SerializedVerifyResult,
  SerializedReflectResult,
} from "./types.js"
import { buildUrl, normalizeApiUrl, parseApiError, TxError } from "./utils.js"

const MAX_RUN_LOG_CHARS = 200_000

type ParsedRunCursor = {
  startedAt: string
  id: string
}

const parseRunCursor = (cursor: string): ParsedRunCursor | null => {
  const colonIndex = cursor.lastIndexOf(":")
  if (colonIndex === -1) return null
  return {
    startedAt: cursor.slice(0, colonIndex),
    id: cursor.slice(colonIndex + 1),
  }
}

const buildRunCursor = (run: { startedAt: string; id: string }): string =>
  `${run.startedAt}:${run.id}`

// =============================================================================
// Transport Interface
// =============================================================================

/**
 * Abstract transport layer for making requests.
 * Allows both HTTP and direct SQLite implementations.
 */
interface Transport {
  // Tasks
  listTasks(options: ListOptions): Promise<PaginatedResponse<SerializedTaskWithDeps>>
  getTask(id: string): Promise<SerializedTaskWithDeps>
  createTask(data: {
    title: string
    description?: string
    parentId?: string
    score?: number
    assigneeType?: "human" | "agent" | null
    assigneeId?: string | null
    assignedAt?: string | Date | null
    assignedBy?: string | null
    metadata?: Record<string, unknown>
  }): Promise<SerializedTaskWithDeps>
  updateTask(id: string, data: {
    title?: string
    description?: string
    status?: TaskStatus
    parentId?: string | null
    score?: number
    assigneeType?: "human" | "agent" | null
    assigneeId?: string | null
    assignedAt?: string | Date | null
    assignedBy?: string | null
    metadata?: Record<string, unknown>
  }): Promise<SerializedTaskWithDeps>
  setTaskGroupContext(id: string, context: string): Promise<SerializedTaskWithDeps>
  clearTaskGroupContext(id: string): Promise<SerializedTaskWithDeps>
  deleteTask(id: string, options?: { cascade?: boolean }): Promise<void>
  completeTask(id: string): Promise<CompleteResult>
  readyTasks(options: ReadyOptions): Promise<SerializedTaskWithDeps[]>
  blockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps>
  unblockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps>
  getTaskTree(id: string): Promise<SerializedTaskWithDeps[]>

  // Learnings
  searchLearnings(options: SearchLearningsOptions): Promise<SerializedLearningWithScore[]>
  getLearning(id: number): Promise<SerializedLearning>
  createLearning(data: CreateLearningData): Promise<SerializedLearning>
  recordHelpful(id: number, score?: number): Promise<void>

  // File Learnings
  listFileLearnings(path?: string): Promise<SerializedFileLearning[]>
  createFileLearning(data: CreateFileLearningData): Promise<SerializedFileLearning>

  // Context
  getContext(taskId: string): Promise<SerializedContextResult>

  // Messages
  sendMessage(data: SendMessageData): Promise<SerializedMessage>
  inbox(channel: string, options?: InboxOptions): Promise<SerializedMessage[]>
  ackMessage(id: number): Promise<SerializedMessage>
  ackAllMessages(channel: string): Promise<{ channel: string; ackedCount: number }>
  pendingCount(channel: string): Promise<number>
  gcMessages(options?: GcOptions): Promise<GcResult>

  // Claims
  claimTask(taskId: string, workerId: string, leaseDurationMinutes?: number): Promise<SerializedClaim>
  releaseClaim(taskId: string, workerId: string): Promise<void>
  renewClaim(taskId: string, workerId: string): Promise<SerializedClaim>
  getActiveClaim(taskId: string): Promise<SerializedClaim | null>

  // Runs / heartbeat primitives
  listRuns(options?: RunsListOptions): Promise<PaginatedRunsResult>
  getRun(id: string): Promise<RunDetailResult>
  getRunTranscript(id: string): Promise<SerializedTraceMessage[]>
  getRunStderr(id: string, options?: { tail?: number }): Promise<LogContentResult>
  getRunErrors(options?: TraceErrorsOptions): Promise<TraceErrorEntry[]>
  runHeartbeat(runId: string, data?: RunHeartbeatData): Promise<RunHeartbeatResult>
  listStalledRuns(options?: StalledRunsOptions): Promise<SerializedStalledRun[]>
  reapStalledRuns(options?: ReapStalledRunsOptions): Promise<SerializedReapedRun[]>

  // Pins
  setPin(id: string, content: string): Promise<SerializedPin>
  getPin(id: string): Promise<SerializedPin | null>
  listPins(): Promise<SerializedPin[]>
  removePin(id: string): Promise<{ deleted: boolean }>
  syncPins(): Promise<{ synced: string[] }>
  getPinTargets(): Promise<string[]>
  setPinTargets(files: string[]): Promise<string[]>

  // Memory
  memorySourceAdd(dir: string, label?: string): Promise<SerializedMemorySource>
  memorySourceRemove(dir: string): Promise<void>
  memorySourceList(): Promise<SerializedMemorySource[]>
  memoryDocumentCreate(data: CreateMemoryDocumentData): Promise<SerializedMemoryDocument>
  memoryDocumentGet(id: string): Promise<SerializedMemoryDocument>
  memoryDocumentList(options?: { source?: string; tags?: string[] }): Promise<SerializedMemoryDocument[]>
  memorySearch(options: MemorySearchOptions): Promise<SerializedMemoryDocumentWithScore[]>
  memoryIndex(options?: { incremental?: boolean }): Promise<MemoryIndexResult>
  memoryIndexStatus(): Promise<MemoryIndexStatus>
  memoryTagAdd(id: string, tags: string[]): Promise<void>
  memoryTagRemove(id: string, tags: string[]): Promise<void>
  memoryRelate(id: string, target: string): Promise<void>
  memoryPropertySet(id: string, key: string, value: string): Promise<void>
  memoryPropertyRemove(id: string, key: string): Promise<void>
  memoryProperties(id: string): Promise<Record<string, string>>
  memoryLinks(id: string): Promise<SerializedMemoryLink[]>
  memoryBacklinks(id: string): Promise<SerializedMemoryLink[]>
  memoryLinkCreate(sourceId: string, targetRef: string): Promise<void>

  // Sync
  syncExport(): Promise<SyncExportResult>
  syncImport(): Promise<SyncImportResult>
  syncStatus(): Promise<SyncStatusResult>
  syncStream(): Promise<SyncStreamInfoResult>
  syncHydrate(): Promise<SyncHydrateResult>

  // Docs
  docsList(options?: { kind?: string; status?: string }): Promise<SerializedDoc[]>
  docsGet(name: string): Promise<SerializedDoc>
  docsCreate(data: { kind: string; name: string; title: string; yamlContent: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc>
  docsUpdate(name: string, yamlContent: string): Promise<SerializedDoc>
  docsDelete(name: string): Promise<void>
  docsLock(name: string): Promise<SerializedDoc>
  docsLink(fromName: string, toName: string, linkType?: string): Promise<SerializedDocLink>
  docsRender(name?: string): Promise<string[]>

  // Invariants
  invariantsList(options?: { subsystem?: string; enforcement?: string }): Promise<SerializedInvariant[]>
  invariantsGet(id: string): Promise<SerializedInvariant>
  invariantsRecord(id: string, passed: boolean, details?: string, durationMs?: number): Promise<SerializedInvariantCheck>

  // Spec traceability
  specDiscover(options?: { doc?: string; patterns?: string[] }): Promise<DiscoverResult>
  specLink(invariantId: string, file: string, name?: string, framework?: string): Promise<SerializedSpecTest>
  specUnlink(invariantId: string, testId: string): Promise<{ removed: boolean }>
  specTests(invariantId: string): Promise<SerializedSpecTest[]>
  specInvariantsForTest(testId: string): Promise<string[]>
  specGaps(options?: SpecScopeOptions): Promise<SerializedSpecGap[]>
  specFci(options?: SpecScopeOptions): Promise<FciResult>
  specMatrix(options?: SpecScopeOptions): Promise<SerializedTraceabilityMatrixEntry[]>
  specStatus(options?: SpecScopeOptions): Promise<SpecStatusResult>
  specRun(testId: string, passed: boolean, options?: { durationMs?: number | null; details?: string | null; runAt?: string }): Promise<SpecBatchRunResult>
  specBatch(data: { results?: SpecBatchRunInput[]; raw?: string; from?: SpecBatchSource; runAt?: string }): Promise<SpecBatchRunResult>
  specComplete(options: { doc?: string; subsystem?: string; signedOffBy: string; notes?: string }): Promise<SerializedSpecSignoff>

  // Cycles
  cyclesList(): Promise<SerializedCycleRun[]>
  cyclesGet(id: string): Promise<SerializedCycleDetail>
  cyclesDelete(id: string): Promise<void>
  cyclesDeleteIssues(issueIds: string[]): Promise<{ success: boolean; deletedCount: number }>

  // Docs (additional)
  docsGraph(): Promise<DocGraph>

  // Guards
  guardSet(options: { scope?: string; maxPending?: number; maxChildren?: number; maxDepth?: number; enforce?: boolean }): Promise<SerializedGuard>
  guardShow(): Promise<SerializedGuard[]>
  guardClear(scope?: string): Promise<{ cleared: boolean }>
  guardCheck(parentId?: string): Promise<{ passed: boolean; warnings: string[] }>

  // Verify
  verifySet(taskId: string, cmd: string, schema?: string): Promise<{ message: string }>
  verifyShow(taskId: string): Promise<{ cmd: string | null; schema: string | null }>
  verifyRun(taskId: string, options?: { timeout?: number }): Promise<SerializedVerifyResult>
  verifyClear(taskId: string): Promise<{ message: string }>

  // Reflect
  reflect(options?: { sessions?: number; hours?: number; analyze?: boolean }): Promise<SerializedReflectResult>

  // Stats
  getStats(): Promise<StatsResult>
}

// =============================================================================
// HTTP Transport
// =============================================================================

/**
 * HTTP transport using the TX API server.
 */
class HttpTransport implements Transport {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly timeout: number

  constructor(config: TxClientConfig) {
    if (!config.apiUrl) {
      throw new TxError("apiUrl is required for HTTP transport", "CONFIG_ERROR")
    }
    this.baseUrl = normalizeApiUrl(config.apiUrl)
    this.apiKey = config.apiKey
    this.timeout = config.timeout ?? 30000
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>
      body?: unknown
    }
  ): Promise<T> {
    const url = options?.params
      ? buildUrl(this.baseUrl, path, options.params)
      : `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-tx-actor": "agent"
    }

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      })

      if (!response.ok) {
        return Promise.reject(await parseApiError(response))
      }

      return await response.json() as T
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // Tasks
  async listTasks(options: ListOptions): Promise<PaginatedResponse<SerializedTaskWithDeps>> {
    const status = Array.isArray(options.status)
      ? options.status.join(",")
      : options.status

    const result = await this.request<{
      tasks: SerializedTaskWithDeps[]
      nextCursor: string | null
      hasMore: boolean
      total: number
    }>("GET", "/api/tasks", {
      params: {
        cursor: options.cursor,
        limit: options.limit,
        status,
        search: options.search
      }
    })

    return {
      items: result.tasks,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      total: result.total
    }
  }

  async getTask(id: string): Promise<SerializedTaskWithDeps> {
    const result = await this.request<{ task: SerializedTaskWithDeps }>(
      "GET",
      `/api/tasks/${id}`
    )
    return result.task
  }

  async createTask(data: {
    title: string
    description?: string
    parentId?: string
    score?: number
    assigneeType?: "human" | "agent" | null
    assigneeId?: string | null
    assignedAt?: string | Date | null
    assignedBy?: string | null
    metadata?: Record<string, unknown>
  }): Promise<SerializedTaskWithDeps> {
    return await this.request<SerializedTaskWithDeps>("POST", "/api/tasks", {
      body: data
    })
  }

  async updateTask(
    id: string,
    data: {
      title?: string
      description?: string
      status?: TaskStatus
      parentId?: string | null
      score?: number
      assigneeType?: "human" | "agent" | null
      assigneeId?: string | null
      assignedAt?: string | Date | null
      assignedBy?: string | null
      metadata?: Record<string, unknown>
    }
  ): Promise<SerializedTaskWithDeps> {
    return await this.request<SerializedTaskWithDeps>(
      "PATCH",
      `/api/tasks/${id}`,
      { body: data }
    )
  }

  async setTaskGroupContext(id: string, context: string): Promise<SerializedTaskWithDeps> {
    return await this.request<SerializedTaskWithDeps>(
      "PUT",
      `/api/tasks/${id}/group-context`,
      { body: { context } }
    )
  }

  async clearTaskGroupContext(id: string): Promise<SerializedTaskWithDeps> {
    return await this.request<SerializedTaskWithDeps>(
      "DELETE",
      `/api/tasks/${id}/group-context`
    )
  }

  async deleteTask(id: string, options?: { cascade?: boolean }): Promise<void> {
    const query = options?.cascade ? "?cascade=true" : ""
    await this.request<{ success: boolean }>("DELETE", `/api/tasks/${id}${query}`)
  }

  async completeTask(id: string): Promise<CompleteResult> {
    return await this.request<CompleteResult>("POST", `/api/tasks/${id}/done`)
  }

  async readyTasks(options: ReadyOptions): Promise<SerializedTaskWithDeps[]> {
    const result = await this.request<{ tasks: SerializedTaskWithDeps[] }>(
      "GET",
      "/api/tasks/ready",
      { params: {
        limit: options.limit,
        labels: options.labels?.join(","),
        excludeLabels: options.excludeLabels?.join(","),
      } }
    )
    return result.tasks
  }

  async blockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    return await this.request<SerializedTaskWithDeps>(
      "POST",
      `/api/tasks/${id}/block`,
      { body: { blockerId } }
    )
  }

  async unblockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    return await this.request<SerializedTaskWithDeps>(
      "DELETE",
      `/api/tasks/${id}/block/${blockerId}`
    )
  }

  async getTaskTree(id: string): Promise<SerializedTaskWithDeps[]> {
    const result = await this.request<{ tasks: SerializedTaskWithDeps[] }>(
      "GET",
      `/api/tasks/${id}/tree`
    )
    return result.tasks
  }

  // Learnings
  async searchLearnings(options: SearchLearningsOptions): Promise<SerializedLearningWithScore[]> {
    const result = await this.request<{ learnings: SerializedLearningWithScore[] }>(
      "GET",
      "/api/learnings",
      {
        params: {
          query: options.query,
          limit: options.limit,
          minScore: options.minScore,
          category: options.category
        }
      }
    )
    return result.learnings
  }

  async getLearning(id: number): Promise<SerializedLearning> {
    return await this.request<SerializedLearning>("GET", `/api/learnings/${id}`)
  }

  async createLearning(data: CreateLearningData): Promise<SerializedLearning> {
    return await this.request<SerializedLearning>("POST", "/api/learnings", {
      body: data
    })
  }

  async recordHelpful(id: number, score = 1.0): Promise<void> {
    await this.request<{ success: boolean }>(
      "POST",
      `/api/learnings/${id}/helpful`,
      { body: { score } }
    )
  }

  // File Learnings
  async listFileLearnings(path?: string): Promise<SerializedFileLearning[]> {
    const result = await this.request<{ learnings: SerializedFileLearning[] }>(
      "GET",
      "/api/file-learnings",
      { params: path ? { path } : undefined }
    )
    return result.learnings
  }

  async createFileLearning(data: CreateFileLearningData): Promise<SerializedFileLearning> {
    return await this.request<SerializedFileLearning>(
      "POST",
      "/api/file-learnings",
      { body: data }
    )
  }

  // Context
  async getContext(taskId: string): Promise<SerializedContextResult> {
    return await this.request<SerializedContextResult>(
      "GET",
      `/api/context/${taskId}`
    )
  }

  // Messages
  async sendMessage(data: SendMessageData): Promise<SerializedMessage> {
    return await this.request<SerializedMessage>("POST", "/api/messages", {
      body: data
    })
  }

  async inbox(channel: string, options?: InboxOptions): Promise<SerializedMessage[]> {
    const result = await this.request<{ messages: SerializedMessage[] }>(
      "GET",
      `/api/messages/inbox/${encodeURIComponent(channel)}`,
      {
        params: {
          afterId: options?.afterId,
          limit: options?.limit,
          sender: options?.sender,
          correlationId: options?.correlationId,
          includeAcked: options?.includeAcked ? "true" : undefined
        }
      }
    )
    return result.messages
  }

  async ackMessage(id: number): Promise<SerializedMessage> {
    const result = await this.request<{ message: SerializedMessage }>(
      "POST",
      `/api/messages/${id}/ack`
    )
    return result.message
  }

  async ackAllMessages(channel: string): Promise<{ channel: string; ackedCount: number }> {
    return await this.request<{ channel: string; ackedCount: number }>(
      "POST",
      `/api/messages/inbox/${encodeURIComponent(channel)}/ack`
    )
  }

  async pendingCount(channel: string): Promise<number> {
    const result = await this.request<{ count: number }>(
      "GET",
      `/api/messages/inbox/${encodeURIComponent(channel)}/count`
    )
    return result.count
  }

  async gcMessages(options?: GcOptions): Promise<GcResult> {
    return await this.request<GcResult>("POST", "/api/messages/gc", {
      body: options ?? {}
    })
  }

  // Claims
  async claimTask(taskId: string, workerId: string, leaseDurationMinutes?: number): Promise<SerializedClaim> {
    return await this.request<SerializedClaim>(
      "POST",
      `/api/tasks/${taskId}/claim`,
      { body: { workerId, leaseDurationMinutes } }
    )
  }

  async releaseClaim(taskId: string, workerId: string): Promise<void> {
    await this.request<{ success: boolean }>(
      "DELETE",
      `/api/tasks/${taskId}/claim`,
      { body: { workerId } }
    )
  }

  async renewClaim(taskId: string, workerId: string): Promise<SerializedClaim> {
    return await this.request<SerializedClaim>(
      "POST",
      `/api/tasks/${taskId}/claim/renew`,
      { body: { workerId } }
    )
  }

  async getActiveClaim(taskId: string): Promise<SerializedClaim | null> {
    const result = await this.request<{ claim: SerializedClaim | null }>(
      "GET",
      `/api/tasks/${taskId}/claim`
    )
    return result.claim
  }

  async listRuns(options: RunsListOptions = {}): Promise<PaginatedRunsResult> {
    const params: Record<string, string | number | undefined> = {
      cursor: options.cursor,
      limit: options.limit,
      agent: options.agent,
      status: Array.isArray(options.status) ? options.status.join(",") : options.status,
      taskId: options.taskId,
    }
    return await this.request<PaginatedRunsResult>("GET", "/api/runs", { params })
  }

  async getRun(id: string): Promise<RunDetailResult> {
    const result = await this.request<{
      run: SerializedRun
      messages: Array<{
        role: "user" | "assistant" | "system"
        content: unknown
        type?: "tool_use" | "tool_result" | "text" | "thinking"
        tool_name?: string
        timestamp?: string
      }>
      logs: RunDetailResult["logs"]
    }>("GET", `/api/runs/${encodeURIComponent(id)}`)

    return {
      run: result.run,
      messages: result.messages.map((message) => ({
        role: message.role,
        content: message.content,
        type: message.type,
        toolName: message.tool_name,
        timestamp: message.timestamp,
      })),
      logs: result.logs,
    }
  }

  async getRunTranscript(id: string): Promise<SerializedTraceMessage[]> {
    const result = await this.getRun(id)
    return result.messages
  }

  async getRunStderr(id: string, options?: { tail?: number }): Promise<LogContentResult> {
    const params: Record<string, number | undefined> = { tail: options?.tail }
    return await this.request<LogContentResult>("GET", `/api/runs/${encodeURIComponent(id)}/stderr`, { params })
  }

  async getRunErrors(options: TraceErrorsOptions = {}): Promise<TraceErrorEntry[]> {
    const result = await this.request<{ errors: TraceErrorEntry[] }>("GET", "/api/runs/errors", {
      params: {
        hours: options.hours,
        limit: options.limit,
      },
    })
    return result.errors
  }

  async runHeartbeat(runId: string, data: RunHeartbeatData = {}): Promise<RunHeartbeatResult> {
    return await this.request<RunHeartbeatResult>(
      "POST",
      `/api/runs/${runId}/heartbeat`,
      { body: data }
    )
  }

  async listStalledRuns(options: StalledRunsOptions = {}): Promise<SerializedStalledRun[]> {
    const result = await this.request<{ runs: SerializedStalledRun[] }>(
      "GET",
      "/api/runs/stalled",
      {
        params: {
          transcriptIdleSeconds: options.transcriptIdleSeconds,
          heartbeatLagSeconds: options.heartbeatLagSeconds,
        },
      }
    )
    return result.runs
  }

  async reapStalledRuns(options: ReapStalledRunsOptions = {}): Promise<SerializedReapedRun[]> {
    const result = await this.request<{ runs: SerializedReapedRun[] }>(
      "POST",
      "/api/runs/stalled/reap",
      { body: options }
    )
    return result.runs
  }

  // Pins
  async setPin(id: string, content: string): Promise<SerializedPin> {
    return await this.request<SerializedPin>("POST", `/api/pins/${id}`, { body: { content } })
  }

  async getPin(id: string): Promise<SerializedPin | null> {
    try {
      return await this.request<SerializedPin>("GET", `/api/pins/${id}`)
    } catch (e) {
      if (e instanceof TxError && e.statusCode === 404) return null
      return Promise.reject(e)
    }
  }

  async listPins(): Promise<SerializedPin[]> {
    const result = await this.request<{ pins: SerializedPin[] }>("GET", "/api/pins")
    return result.pins
  }

  async removePin(id: string): Promise<{ deleted: boolean }> {
    try {
      return await this.request<{ deleted: boolean }>("DELETE", `/api/pins/${id}`)
    } catch (e) {
      if (e instanceof TxError && e.statusCode === 404) return { deleted: false }
      return Promise.reject(e)
    }
  }

  async syncPins(): Promise<{ synced: string[] }> {
    return await this.request<{ synced: string[] }>("POST", "/api/pins/sync")
  }

  async getPinTargets(): Promise<string[]> {
    const result = await this.request<{ files: string[] }>("GET", "/api/pins/targets")
    return result.files
  }

  async setPinTargets(files: string[]): Promise<string[]> {
    const result = await this.request<{ files: string[] }>("PUT", "/api/pins/targets", { body: { files } })
    return result.files
  }

  // Memory
  async memorySourceAdd(dir: string, label?: string): Promise<SerializedMemorySource> {
    return await this.request<SerializedMemorySource>("POST", "/api/memory/sources", { body: { dir, label } })
  }

  async memorySourceRemove(dir: string): Promise<void> {
    await this.request("DELETE", "/api/memory/sources", { body: { dir } })
  }

  async memorySourceList(): Promise<SerializedMemorySource[]> {
    const r = await this.request<{ sources: SerializedMemorySource[] }>("GET", "/api/memory/sources")
    return r.sources
  }

  async memoryDocumentCreate(data: CreateMemoryDocumentData): Promise<SerializedMemoryDocument> {
    return await this.request<SerializedMemoryDocument>("POST", "/api/memory/documents", { body: data })
  }

  async memoryDocumentGet(id: string): Promise<SerializedMemoryDocument> {
    return await this.request<SerializedMemoryDocument>("GET", `/api/memory/documents/${id}`)
  }

  async memoryDocumentList(options?: { source?: string; tags?: string[] }): Promise<SerializedMemoryDocument[]> {
    const params: Record<string, string | undefined> = {}
    if (options?.source) params.source = options.source
    if (options?.tags?.length) params.tags = options.tags.join(",")
    const r = await this.request<{ documents: SerializedMemoryDocument[] }>("GET", "/api/memory/documents", { params })
    return r.documents
  }

  async memorySearch(options: MemorySearchOptions): Promise<SerializedMemoryDocumentWithScore[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      query: options.query,
      limit: options.limit,
      minScore: options.minScore,
      semantic: options.semantic !== undefined ? String(options.semantic) : undefined,
      expand: options.expand !== undefined ? String(options.expand) : undefined,
      tags: options.tags?.join(","),
      props: options.props ? Object.entries(options.props).map(([k, v]) => `${k}=${v}`).join(",") : undefined,
    }
    const r = await this.request<{ results: SerializedMemoryDocumentWithScore[] }>("GET", "/api/memory/search", { params })
    return r.results
  }

  async memoryIndex(options?: { incremental?: boolean }): Promise<MemoryIndexResult> {
    return await this.request<MemoryIndexResult>("POST", "/api/memory/index", { body: options ?? {} })
  }

  async memoryIndexStatus(): Promise<MemoryIndexStatus> {
    return await this.request<MemoryIndexStatus>("GET", "/api/memory/index/status")
  }

  async memoryTagAdd(id: string, tags: string[]): Promise<void> {
    await this.request("POST", `/api/memory/documents/${id}/tags`, { body: { tags } })
  }

  async memoryTagRemove(id: string, tags: string[]): Promise<void> {
    await this.request("DELETE", `/api/memory/documents/${id}/tags`, { body: { tags } })
  }

  async memoryRelate(id: string, target: string): Promise<void> {
    await this.request("POST", `/api/memory/documents/${id}/relate`, { body: { target } })
  }

  async memoryPropertySet(id: string, key: string, value: string): Promise<void> {
    await this.request("PUT", `/api/memory/documents/${id}/props/${key}`, { body: { value } })
  }

  async memoryPropertyRemove(id: string, key: string): Promise<void> {
    await this.request("DELETE", `/api/memory/documents/${id}/props/${key}`)
  }

  async memoryProperties(id: string): Promise<Record<string, string>> {
    const r = await this.request<{ properties: Array<{ key: string; value: string }> }>("GET", `/api/memory/documents/${id}/props`)
    const result: Record<string, string> = {}
    for (const p of r.properties) result[p.key] = p.value
    return result
  }

  async memoryLinks(id: string): Promise<SerializedMemoryLink[]> {
    const r = await this.request<{ links: SerializedMemoryLink[] }>("GET", `/api/memory/documents/${id}/links`)
    return r.links
  }

  async memoryBacklinks(id: string): Promise<SerializedMemoryLink[]> {
    const r = await this.request<{ links: SerializedMemoryLink[] }>("GET", `/api/memory/documents/${id}/backlinks`)
    return r.links
  }

  async memoryLinkCreate(sourceId: string, targetRef: string): Promise<void> {
    await this.request("POST", "/api/memory/links", { body: { sourceId, targetRef } })
  }

  // Sync
  async syncExport(): Promise<SyncExportResult> {
    return await this.request<SyncExportResult>("POST", "/api/sync/export")
  }

  async syncImport(): Promise<SyncImportResult> {
    return await this.request<SyncImportResult>("POST", "/api/sync/import")
  }

  async syncStatus(): Promise<SyncStatusResult> {
    return await this.request<SyncStatusResult>("GET", "/api/sync/status")
  }

  async syncStream(): Promise<SyncStreamInfoResult> {
    return await this.request<SyncStreamInfoResult>("GET", "/api/sync/stream")
  }

  async syncHydrate(): Promise<SyncHydrateResult> {
    return await this.request<SyncHydrateResult>("POST", "/api/sync/hydrate")
  }

  // Docs
  async docsList(options?: { kind?: string; status?: string }): Promise<SerializedDoc[]> {
    const r = await this.request<{ docs: SerializedDoc[] }>("GET", "/api/docs", { params: options })
    return r.docs
  }

  async docsGet(name: string): Promise<SerializedDoc> {
    return await this.request<SerializedDoc>("GET", `/api/docs/${encodeURIComponent(name)}`)
  }

  async docsCreate(data: { kind: string; name: string; title: string; yamlContent: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc> {
    return await this.request<SerializedDoc>("POST", "/api/docs", { body: data })
  }

  async docsUpdate(name: string, yamlContent: string): Promise<SerializedDoc> {
    return await this.request<SerializedDoc>("PATCH", `/api/docs/${encodeURIComponent(name)}`, { body: { yamlContent } })
  }

  async docsDelete(name: string): Promise<void> {
    await this.request("DELETE", `/api/docs/${encodeURIComponent(name)}`)
  }

  async docsLock(name: string): Promise<SerializedDoc> {
    return await this.request<SerializedDoc>("POST", `/api/docs/${encodeURIComponent(name)}/lock`)
  }

  async docsLink(fromName: string, toName: string, linkType?: string): Promise<SerializedDocLink> {
    return await this.request<SerializedDocLink>("POST", "/api/docs/link", { body: { fromName, toName, linkType } })
  }

  async docsRender(name?: string): Promise<string[]> {
    const params: Record<string, string | undefined> = {}
    if (name) params.name = name
    const r = await this.request<{ rendered: string[] }>("POST", "/api/docs/render", { body: { name } })
    return r.rendered
  }

  // Invariants
  async invariantsList(options?: { subsystem?: string; enforcement?: string }): Promise<SerializedInvariant[]> {
    const r = await this.request<{ invariants: SerializedInvariant[] }>("GET", "/api/invariants", { params: options })
    return r.invariants
  }

  async invariantsGet(id: string): Promise<SerializedInvariant> {
    return await this.request<SerializedInvariant>("GET", `/api/invariants/${encodeURIComponent(id)}`)
  }

  async invariantsRecord(id: string, passed: boolean, details?: string, durationMs?: number): Promise<SerializedInvariantCheck> {
    return await this.request<SerializedInvariantCheck>(
      "POST",
      `/api/invariants/${encodeURIComponent(id)}/check`,
      { body: { passed, details, durationMs } }
    )
  }

  async specDiscover(options?: { doc?: string; patterns?: string[] }): Promise<DiscoverResult> {
    return await this.request<DiscoverResult>("POST", "/api/spec/discover", { body: options ?? {} })
  }

  async specLink(invariantId: string, file: string, name?: string, framework?: string): Promise<SerializedSpecTest> {
    return await this.request<SerializedSpecTest>("POST", "/api/spec/link", {
      body: { invariantId, file, name, framework },
    })
  }

  async specUnlink(invariantId: string, testId: string): Promise<{ removed: boolean }> {
    return await this.request<{ removed: boolean }>("POST", "/api/spec/unlink", {
      body: { invariantId, testId },
    })
  }

  async specTests(invariantId: string): Promise<SerializedSpecTest[]> {
    const result = await this.request<{ tests: SerializedSpecTest[] }>("GET", `/api/spec/tests/${encodeURIComponent(invariantId)}`)
    return result.tests
  }

  async specInvariantsForTest(testId: string): Promise<string[]> {
    const result = await this.request<{ testId: string; invariants: string[] }>("GET", "/api/spec/invariants", {
      params: { testId },
    })
    return result.invariants
  }

  async specGaps(options?: SpecScopeOptions): Promise<SerializedSpecGap[]> {
    const params = options
      ? { doc: options.doc, subsystem: options.subsystem }
      : undefined
    const result = await this.request<{ gaps: SerializedSpecGap[] }>("GET", "/api/spec/gaps", { params })
    return result.gaps
  }

  async specFci(options?: SpecScopeOptions): Promise<FciResult> {
    const params = options
      ? { doc: options.doc, subsystem: options.subsystem }
      : undefined
    return await this.request<FciResult>("GET", "/api/spec/fci", { params })
  }

  async specMatrix(options?: SpecScopeOptions): Promise<SerializedTraceabilityMatrixEntry[]> {
    const params = options
      ? { doc: options.doc, subsystem: options.subsystem }
      : undefined
    const result = await this.request<{ matrix: SerializedTraceabilityMatrixEntry[] }>("GET", "/api/spec/matrix", { params })
    return result.matrix
  }

  async specStatus(options?: SpecScopeOptions): Promise<SpecStatusResult> {
    const params = options
      ? { doc: options.doc, subsystem: options.subsystem }
      : undefined
    return await this.request<SpecStatusResult>("GET", "/api/spec/status", { params })
  }

  async specRun(testId: string, passed: boolean, options?: { durationMs?: number | null; details?: string | null; runAt?: string }): Promise<SpecBatchRunResult> {
    return await this.request<SpecBatchRunResult>("POST", "/api/spec/run", {
      body: {
        testId,
        passed,
        durationMs: options?.durationMs ?? undefined,
        details: options?.details ?? undefined,
        runAt: options?.runAt,
      },
    })
  }

  async specBatch(data: { results?: SpecBatchRunInput[]; raw?: string; from?: SpecBatchSource; runAt?: string }): Promise<SpecBatchRunResult> {
    return await this.request<SpecBatchRunResult>("POST", "/api/spec/batch", { body: data })
  }

  async specComplete(options: { doc?: string; subsystem?: string; signedOffBy: string; notes?: string }): Promise<SerializedSpecSignoff> {
    return await this.request<SerializedSpecSignoff>("POST", "/api/spec/complete", { body: options })
  }

  // Cycles
  async cyclesList(): Promise<SerializedCycleRun[]> {
    const r = await this.request<{ cycles: SerializedCycleRun[] }>("GET", "/api/cycles")
    return r.cycles
  }

  async cyclesGet(id: string): Promise<SerializedCycleDetail> {
    return await this.request<SerializedCycleDetail>("GET", `/api/cycles/${encodeURIComponent(id)}`)
  }

  async cyclesDelete(id: string): Promise<void> {
    await this.request("DELETE", `/api/cycles/${encodeURIComponent(id)}`)
  }

  async cyclesDeleteIssues(issueIds: string[]): Promise<{ success: boolean; deletedCount: number }> {
    return await this.request<{ success: boolean; deletedCount: number }>("POST", "/api/cycles/issues/delete", { body: { issueIds } })
  }

  async docsGraph(): Promise<DocGraph> {
    return await this.request<DocGraph>("GET", "/api/docs/graph")
  }

  // Guards
  async guardSet(options: { scope?: string; maxPending?: number; maxChildren?: number; maxDepth?: number; enforce?: boolean }): Promise<SerializedGuard> {
    return await this.request<SerializedGuard>("POST", "/api/guards", { body: options })
  }
  async guardShow(): Promise<SerializedGuard[]> {
    const result = await this.request<{ guards: SerializedGuard[] }>("GET", "/api/guards")
    return result.guards
  }
  async guardClear(scope?: string): Promise<{ cleared: boolean }> {
    return await this.request<{ cleared: boolean }>("DELETE", "/api/guards", { params: { scope } })
  }
  async guardCheck(parentId?: string): Promise<{ passed: boolean; warnings: string[] }> {
    return await this.request<{ passed: boolean; warnings: string[] }>("GET", "/api/guards/check", { params: { parentId } })
  }

  // Verify
  async verifySet(taskId: string, cmd: string, schema?: string): Promise<{ message: string }> {
    return await this.request<{ message: string }>("PUT", `/api/tasks/${taskId}/verify`, { body: { cmd, schema } })
  }
  async verifyShow(taskId: string): Promise<{ cmd: string | null; schema: string | null }> {
    return await this.request<{ cmd: string | null; schema: string | null }>("GET", `/api/tasks/${taskId}/verify`)
  }
  async verifyRun(taskId: string, options?: { timeout?: number }): Promise<SerializedVerifyResult> {
    return await this.request<SerializedVerifyResult>("POST", `/api/tasks/${taskId}/verify/run`, { params: { timeout: options?.timeout } })
  }
  async verifyClear(taskId: string): Promise<{ message: string }> {
    return await this.request<{ message: string }>("DELETE", `/api/tasks/${taskId}/verify`)
  }

  // Reflect
  async reflect(options?: { sessions?: number; hours?: number; analyze?: boolean }): Promise<SerializedReflectResult> {
    return await this.request<SerializedReflectResult>("GET", "/api/reflect", {
      params: { sessions: options?.sessions, hours: options?.hours, analyze: options?.analyze },
    })
  }

  // Stats
  async getStats(): Promise<StatsResult> {
    return await this.request<StatsResult>("GET", "/api/stats")
  }
}

// =============================================================================
// Direct Transport (Optional - requires @tx/core)
// =============================================================================

/**
 * Module-level cache for ManagedRuntime instances.
 * Keyed by dbPath to ensure singleton per database.
 * This prevents DOCTRINE RULE 8 violations - multiple clients
 * using the same dbPath share the same runtime/layer.
 */
const runtimeCache = new Map<string, { runtime: any; refCount: number; core: any; Effect: any }>()

/**
 * Module-level map of in-flight initialization Promises.
 * Prevents TOCTOU race: when multiple DirectTransport instances
 * call ensureRuntime() concurrently for the same dbPath, the first
 * caller creates the Promise and all others await it.
 */
const pendingInit = new Map<string, Promise<{ runtime: any; core: any; Effect: any }>>()

/**
 * Direct SQLite transport using @tx/core.
 * Only available when @tx/core is installed and running on Bun runtime.
 */
class DirectTransport implements Transport {

  private runtime: any
  private dbPath: string

  constructor(config: TxClientConfig) {
    if (!config.dbPath) {
      throw new TxError("dbPath is required for direct transport", "CONFIG_ERROR")
    }
    this.dbPath = config.dbPath
  }

  private async ensureRuntime(): Promise<void> {
    if (this.runtime) return

    // Check if we already have a cached runtime for this dbPath
    const cached = runtimeCache.get(this.dbPath)
    if (cached) {
      cached.refCount++
      this.runtime = cached.runtime
      ;(this as any).Effect = cached.Effect
      ;(this as any).core = cached.core
      return
    }

    // Check if another call is already initializing this dbPath.
    // This prevents the TOCTOU race where concurrent ensureRuntime()
    // calls both miss the cache, both do async imports, and both
    // create separate runtimes — orphaning the first one.
    const pending = pendingInit.get(this.dbPath)
    if (pending) {
      const result = await pending
      // After the pending init resolves, the cache entry exists.
      // Increment refCount for this new consumer.
      const nowCached = runtimeCache.get(this.dbPath)
      if (nowCached) {
        nowCached.refCount++
      }
      this.runtime = result.runtime
      ;(this as any).Effect = result.Effect
      ;(this as any).core = result.core
      return
    }

    // We are the first caller — create the initialization Promise
    // and store it so concurrent callers coalesce on it.
    const initPromise = this.initRuntime()
    pendingInit.set(this.dbPath, initPromise)

    try {
      const result = await initPromise
      this.runtime = result.runtime
      ;(this as any).Effect = result.Effect
      ;(this as any).core = result.core
    } finally {
      pendingInit.delete(this.dbPath)
    }
  }

  /**
   * Perform the actual runtime initialization. Separated from ensureRuntime()
   * so the Promise can be stored in pendingInit for deduplication.
   */
  private async initRuntime(): Promise<{ runtime: any; core: any; Effect: any }> {
    try {
      // Dynamic import to make @tx/core optional
      const core = await import("@jamesaphoenix/tx-core")
      const { Effect, ManagedRuntime } = await import("effect")

      const layer = core.makeAppLayer(this.dbPath)
      const runtime = ManagedRuntime.make(layer)

      // Cache the runtime for reuse by other clients
      runtimeCache.set(this.dbPath, { runtime, refCount: 1, core, Effect })

      return { runtime, core, Effect }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new TxError(
        `Direct mode requires @tx/core and effect packages. Install them or use apiUrl for HTTP mode. Original error: ${detail}`,
        "MISSING_DEPENDENCY",
        undefined,
        undefined,
        { cause: e }
      )
    }
  }

   
  private async run<T>(effect: any): Promise<T> {
    await this.ensureRuntime()
    return this.runtime.runPromise(effect)
  }

   
  private serializeTask(task: any): SerializedTaskWithDeps {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      parentId: task.parentId,
      score: task.score,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
      completedAt: task.completedAt instanceof Date ? task.completedAt.toISOString() : (task.completedAt ?? null),
      assigneeType: task.assigneeType ?? null,
      assigneeId: task.assigneeId ?? null,
      assignedAt:
        task.assignedAt instanceof Date
          ? task.assignedAt.toISOString()
          : (task.assignedAt ?? null),
      assignedBy: task.assignedBy ?? null,
      metadata: task.metadata,
      blockedBy: task.blockedBy,
      blocks: task.blocks,
      children: task.children,
      isReady: task.isReady,
      groupContext: task.groupContext ?? null,
      effectiveGroupContext: task.effectiveGroupContext ?? null,
      effectiveGroupContextSourceTaskId: task.effectiveGroupContextSourceTaskId ?? null
    }
  }

   
  private serializeLearning(learning: any): SerializedLearning {
    return {
      id: learning.id,
      content: learning.content,
      sourceType: learning.sourceType,
      sourceRef: learning.sourceRef,
      createdAt: learning.createdAt instanceof Date ? learning.createdAt.toISOString() : learning.createdAt,
      keywords: learning.keywords,
      category: learning.category,
      usageCount: learning.usageCount,
      lastUsedAt: learning.lastUsedAt instanceof Date ? learning.lastUsedAt.toISOString() : (learning.lastUsedAt ?? null),
      outcomeScore: learning.outcomeScore,
      embedding: null,
    }
  }


  private serializeLearningWithScore(learning: any): SerializedLearningWithScore {
    return {
      ...this.serializeLearning(learning),
      relevanceScore: learning.relevanceScore ?? 0,
      bm25Score: learning.bm25Score ?? 0,
      vectorScore: learning.vectorScore ?? 0,
      recencyScore: learning.recencyScore ?? 0,
      rrfScore: learning.rrfScore ?? 0,
      bm25Rank: learning.bm25Rank ?? 0,
      vectorRank: learning.vectorRank ?? 0,
      rerankerScore: learning.rerankerScore,
      ...(learning.expansionHops !== undefined ? { expansionHops: learning.expansionHops } : {}),
      ...(learning.expansionPath !== undefined ? { expansionPath: learning.expansionPath } : {}),
      ...(learning.sourceEdge !== undefined ? { sourceEdge: learning.sourceEdge } : {}),
      ...(learning.feedbackScore !== undefined ? { feedbackScore: learning.feedbackScore } : {}),
    }
  }

   
  private serializeFileLearning(learning: any): SerializedFileLearning {
    return {
      id: learning.id,
      filePattern: learning.filePattern,
      note: learning.note,
      taskId: learning.taskId,
      createdAt: learning.createdAt instanceof Date ? learning.createdAt.toISOString() : learning.createdAt
    }
  }

  private serializeRun(run: any): SerializedRun {
    return {
      id: run.id,
      taskId: run.taskId,
      agent: run.agent,
      startedAt: run.startedAt instanceof Date ? run.startedAt.toISOString() : run.startedAt,
      endedAt: run.endedAt instanceof Date ? run.endedAt.toISOString() : run.endedAt ?? null,
      status: run.status,
      exitCode: run.exitCode,
      pid: run.pid,
      transcriptPath: run.transcriptPath,
      stderrPath: run.stderrPath,
      stdoutPath: run.stdoutPath,
      contextInjected: run.contextInjected,
      summary: run.summary,
      errorMessage: run.errorMessage,
      metadata: run.metadata ?? {},
    }
  }

  private serializeTraceMessage(message: {
    role: "user" | "assistant" | "system"
    content: unknown
    type?: "tool_use" | "tool_result" | "text" | "thinking"
    tool_name?: string
    toolName?: string
    timestamp?: string
  }): SerializedTraceMessage {
    return {
      role: message.role,
      content: message.content,
      type: message.type,
      toolName: message.toolName ?? message.tool_name,
      timestamp: message.timestamp,
    }
  }

  private serializeSpecTest(test: any): SerializedSpecTest {
    return {
      id: test.id,
      invariantId: test.invariantId,
      testId: test.testId,
      testFile: test.testFile,
      testName: test.testName ?? null,
      framework: test.framework ?? null,
      discovery: test.discovery,
      createdAt: test.createdAt instanceof Date ? test.createdAt.toISOString() : test.createdAt,
      updatedAt: test.updatedAt instanceof Date ? test.updatedAt.toISOString() : test.updatedAt,
    }
  }

  private serializeSpecGap(gap: any): SerializedSpecGap {
    return {
      id: gap.id,
      rule: gap.rule,
      subsystem: gap.subsystem ?? null,
      docName: gap.docName,
    }
  }

  private serializeSpecMatrixEntry(entry: any): SerializedTraceabilityMatrixEntry {
    return {
      invariantId: entry.invariantId,
      rule: entry.rule,
      subsystem: entry.subsystem ?? null,
      tests: (entry.tests ?? []).map((test: any) => ({
        specTestId: test.specTestId,
        testId: test.testId,
        testFile: test.testFile,
        testName: test.testName ?? null,
        framework: test.framework ?? null,
        discovery: test.discovery,
        latestRun: {
          passed: test.latestRun?.passed ?? null,
          runAt: test.latestRun?.runAt instanceof Date
            ? test.latestRun.runAt.toISOString()
            : test.latestRun?.runAt ?? null,
        },
      })),
    }
  }

  private serializeSpecSignoff(signoff: any): SerializedSpecSignoff {
    return {
      id: signoff.id,
      scopeType: signoff.scopeType,
      scopeValue: signoff.scopeValue ?? null,
      signedOffBy: signoff.signedOffBy,
      notes: signoff.notes ?? null,
      signedOffAt: signoff.signedOffAt instanceof Date ? signoff.signedOffAt.toISOString() : signoff.signedOffAt,
    }
  }

  private getTxDir(): string {
    const parent = dirname(resolve(this.dbPath))
    const normalizedParent = parent.replace(/\\/g, "/")
    if (normalizedParent.endsWith("/.tx")) {
      return parent
    }
    return resolve(process.cwd(), ".tx")
  }

  private resolveRunPath(filePath: string): string {
    return filePath.startsWith("/") ? filePath : resolve(this.getTxDir(), filePath)
  }

  private readOptionalRunLog(
    filePath: string | null,
    options?: { tailLines?: number; trimToDashboard?: boolean }
  ): { content: string | null; truncated: boolean } {
    if (!filePath) {
      return { content: null, truncated: false }
    }

    const resolvedPath = this.resolveRunPath(filePath)
    if (!existsSync(resolvedPath)) {
      return { content: null, truncated: false }
    }

    try {
      let content = readFileSync(resolvedPath, "utf8")
      let truncated = false

      if ((options?.tailLines ?? 0) > 0) {
        const lines = content.split("\n")
        if (lines.length > 0 && lines[lines.length - 1] === "") {
          lines.pop()
        }
        if (lines.length > (options?.tailLines ?? 0)) {
          content = lines.slice(-(options?.tailLines ?? 0)).join("\n")
          truncated = true
        }
      }

      if (options?.trimToDashboard && content.length > MAX_RUN_LOG_CHARS) {
        content = content.slice(-MAX_RUN_LOG_CHARS)
        truncated = true
      }

      return { content, truncated }
    } catch {
      return { content: null, truncated: false }
    }
  }

  private parseClaudeTranscriptLines(lines: readonly string[]): SerializedTraceMessage[] {
    const messages: SerializedTraceMessage[] = []
    const seenUuids = new Set<string>()
    const toolNameById = new Map<string, string>()

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          type?: string
          timestamp?: string
          uuid?: string
          message?: {
            role?: string
            content?: unknown
          }
        }

        const uuid = typeof entry.uuid === "string" ? entry.uuid : undefined
        if (uuid && seenUuids.has(uuid)) continue
        if (uuid) seenUuids.add(uuid)

        const timestamp = entry.timestamp

        if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
          for (const block of entry.message.content) {
            if (typeof block !== "object" || block === null) continue
            const typedBlock = block as {
              type?: string
              text?: string
              thinking?: string
              id?: string
              name?: string
              input?: Record<string, unknown>
            }

            if (typedBlock.type === "text" && typeof typedBlock.text === "string" && typedBlock.text.trim().length > 0) {
              messages.push({
                role: "assistant",
                content: typedBlock.text,
                type: "text",
                timestamp,
              })
            }

            if (typedBlock.type === "tool_use" && typeof typedBlock.name === "string") {
              if (typedBlock.id) {
                toolNameById.set(typedBlock.id, typedBlock.name)
              }
              messages.push({
                role: "assistant",
                content: typedBlock.input ?? {},
                type: "tool_use",
                toolName: typedBlock.name,
                timestamp,
              })
            }
          }
          continue
        }

        if (entry.type === "user") {
          const content = entry.message?.content
          if (typeof content === "string" && content.trim().length > 0) {
            messages.push({
              role: "user",
              content,
              timestamp,
            })
            continue
          }

          if (Array.isArray(content)) {
            for (const item of content) {
              if (typeof item !== "object" || item === null) continue
              const typedItem = item as {
                type?: string
                tool_use_id?: string
                content?: unknown
              }
              if (typedItem.type !== "tool_result") continue

              let resultContent = ""
              if (typeof typedItem.content === "string") {
                resultContent = typedItem.content
              } else if (Array.isArray(typedItem.content)) {
                resultContent = typedItem.content
                  .filter(
                    (block): block is { type?: string; text?: string } =>
                      typeof block === "object" && block !== null
                  )
                  .filter((block) => block.type === "text" && typeof block.text === "string")
                  .map((block) => block.text ?? "")
                  .join("\n")
              }

              messages.push({
                role: "user",
                content: resultContent,
                type: "tool_result",
                toolName: typedItem.tool_use_id ? toolNameById.get(typedItem.tool_use_id) : undefined,
                timestamp,
              })
            }
          }
        }
      } catch {
        // Ignore malformed transcript lines.
      }
    }

    return messages
  }

  private readTranscriptMessages(run: { transcriptPath: string | null; agent: string }): SerializedTraceMessage[] {
    if (!run.transcriptPath) return []

    const resolvedPath = this.resolveRunPath(run.transcriptPath)
    if (!existsSync(resolvedPath)) return []

    try {
      const lines = readFileSync(resolvedPath, "utf8").split("\n").filter((line) => line.trim().length > 0)
      const detailed = this.parseClaudeTranscriptLines(lines)
      if (detailed.length > 0) {
        return detailed
      }

      const adapter = (this as any).core.getAdapter(run.agent)
      return adapter.parseMessages(lines).map((message: { role: "user" | "assistant"; content: string; timestamp: string }) =>
        this.serializeTraceMessage(message)
      )
    } catch {
      return []
    }
  }

  // Tasks
  async listTasks(options: ListOptions): Promise<PaginatedResponse<SerializedTaskWithDeps>> {
    await this.ensureRuntime()

    const Effect = (this as any).Effect

    const core = (this as any).core

    const limit = options.limit ?? 20

    // Parse cursor string "score:id" into TaskCursor object
    let cursor: { score: number; id: string } | undefined
    if (options.cursor) {
      const colonIdx = options.cursor.indexOf(":")
      if (colonIdx > 0) {
        cursor = {
          score: Number(options.cursor.slice(0, colonIdx)),
          id: options.cursor.slice(colonIdx + 1)
        }
      }
    }

    // Build filter - push all filtering, sorting, and pagination to the database layer
    const filter: Record<string, unknown> = {
      // Fetch limit + 1 to detect hasMore
      limit: limit + 1,
    }

    // Pass status filter (single or array) directly to SQL
    if (options.status) {
      filter.status = options.status
    }

    if (options.search) {
      filter.search = options.search
    }

    if (cursor) {
      filter.cursor = cursor
    }

    // Fetch paginated tasks from database (sorted by score DESC, id ASC via SQL)
    const tasks = await this.run<any[]>(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        return yield* taskService.listWithDeps(filter)
      })
    )

    const hasMore = tasks.length > limit
    const resultTasks = hasMore ? tasks.slice(0, limit) : tasks

    // Get total count with same filters (excluding cursor/limit)
    const countFilter: Record<string, unknown> = {}
    if (options.status) {
      countFilter.status = options.status
    }
    if (options.search) {
      countFilter.search = options.search
    }

    const total = await this.run<number>(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        return yield* taskService.count(countFilter)
      })
    )

    return {
      items: resultTasks.map((t: unknown) => this.serializeTask(t)),
      nextCursor: hasMore && resultTasks.length > 0
        ? `${resultTasks[resultTasks.length - 1].score}:${resultTasks[resultTasks.length - 1].id}`
        : null,
      hasMore,
      total
    }
  }

  async getTask(id: string): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        return yield* taskService.getWithDeps(id)
      })
    )

    return this.serializeTask(task)
  }

  async createTask(data: {
    title: string
    description?: string
    parentId?: string
    score?: number
    assigneeType?: "human" | "agent" | null
    assigneeId?: string | null
    assignedAt?: string | Date | null
    assignedBy?: string | null
    metadata?: Record<string, unknown>
  }): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        const created = yield* taskService.create(data)
        return yield* taskService.getWithDeps(created.id)
      })
    )

    return this.serializeTask(task)
  }

  async updateTask(
    id: string,
    data: {
      title?: string
      description?: string
      status?: TaskStatus
      parentId?: string | null
      score?: number
      assigneeType?: "human" | "agent" | null
      assigneeId?: string | null
      assignedAt?: string | Date | null
      assignedBy?: string | null
      metadata?: Record<string, unknown>
    }
  ): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        yield* taskService.update(id, data, { actor: "agent" })
        return yield* taskService.getWithDeps(id)
      })
    )

    return this.serializeTask(task)
  }

  async setTaskGroupContext(id: string, context: string): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()

    const Effect = (this as any).Effect
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        return yield* taskService.setGroupContext(id, context)
      })
    )

    return this.serializeTask(task)
  }

  async clearTaskGroupContext(id: string): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()

    const Effect = (this as any).Effect
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        return yield* taskService.clearGroupContext(id)
      })
    )

    return this.serializeTask(task)
  }

  async deleteTask(id: string, options?: { cascade?: boolean }): Promise<void> {
    await this.ensureRuntime()

    const Effect = (this as any).Effect

    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        yield* taskService.remove(id, options)
      })
    )
  }

  async completeTask(id: string): Promise<CompleteResult> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core
    const self = this

    const result = await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        const readyService = yield* core.ReadyService

        // Get tasks blocked by this one
        const blocking = yield* readyService.getBlocking(id)

        // Mark as done
        yield* taskService.update(id, { status: "done" }, { actor: "agent" })

        // Get updated task
        const task = yield* taskService.getWithDeps(id)

        // Find newly ready tasks
        const candidateIds = blocking
           
          .filter((t: any) => ["backlog", "ready", "planning"].includes(t.status))
           
          .map((t: any) => t.id)
        const candidates = yield* taskService.getWithDepsBatch(candidateIds)
         
        const nowReady = candidates.filter((t: any) => t.isReady)

        return { task, nowReady }
      })
    )

     
    const typedResult = result as { task: any; nowReady: any[] }
    return {
      task: self.serializeTask(typedResult.task),
      nowReady: typedResult.nowReady.map((t) => self.serializeTask(t))
    }
  }

  async readyTasks(options: ReadyOptions): Promise<SerializedTaskWithDeps[]> {
    await this.ensureRuntime()

    const Effect = (this as any).Effect

    const core = (this as any).core

    const labels = options.labels?.length ? options.labels : undefined
    const excludeLabels = options.excludeLabels?.length ? options.excludeLabels : undefined

    const tasks = await this.run(
      Effect.gen(function* () {
        const readyService = yield* core.ReadyService
        return yield* readyService.getReady(options.limit ?? 100, {
          labels,
          excludeLabels,
        })
      })
    )


    return (tasks as any[]).map(t => this.serializeTask(t))
  }

  async blockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const depService = yield* core.DependencyService
        const taskService = yield* core.TaskService
        yield* depService.addBlocker(id, blockerId)
        return yield* taskService.getWithDeps(id)
      })
    )

    return this.serializeTask(task)
  }

  async unblockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const depService = yield* core.DependencyService
        const taskService = yield* core.TaskService
        yield* depService.removeBlocker(id, blockerId)
        return yield* taskService.getWithDeps(id)
      })
    )

    return this.serializeTask(task)
  }

  async getTaskTree(id: string): Promise<SerializedTaskWithDeps[]> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const tasks = await this.run(
      Effect.gen(function* () {
        const hierarchyService = yield* core.HierarchyService
        const taskService = yield* core.TaskService

        const tree = yield* hierarchyService.getTree(id)

        // Flatten tree
         
        const flattenTree = (node: any): string[] => {
          const ids: string[] = [node.task.id]
          for (const child of node.children) {
            ids.push(...flattenTree(child))
          }
          return ids
        }

        const allIds = flattenTree(tree)
        return yield* taskService.getWithDepsBatch(allIds)
      })
    )

     
    return (tasks as any[]).map(t => this.serializeTask(t))
  }

  // Learnings
  async searchLearnings(options: SearchLearningsOptions): Promise<SerializedLearningWithScore[]> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const learnings = await this.run(
      Effect.gen(function* () {
        const learningService = yield* core.LearningService
        if (!options.query) {
          return yield* learningService.getRecent(options.limit ?? 10)
        }
        return yield* learningService.search({
          query: options.query,
          limit: options.limit ?? 10,
          minScore: options.minScore,
          category: options.category
        })
      })
    )

     
    return (learnings as any[]).map(l => this.serializeLearningWithScore(l))
  }

  async getLearning(id: number): Promise<SerializedLearning> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const learning = await this.run(
      Effect.gen(function* () {
        const learningService = yield* core.LearningService
        return yield* learningService.get(id)
      })
    )

    return this.serializeLearning(learning)
  }

  async createLearning(data: CreateLearningData): Promise<SerializedLearning> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const learning = await this.run(
      Effect.gen(function* () {
        const learningService = yield* core.LearningService
        return yield* learningService.create({
          content: data.content,
          sourceType: data.sourceType ?? "manual",
          sourceRef: data.sourceRef,
          category: data.category,
          keywords: data.keywords
        })
      })
    )

    return this.serializeLearning(learning)
  }

  async recordHelpful(id: number, score = 1.0): Promise<void> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const learningService = yield* core.LearningService
        yield* learningService.updateOutcome(id, score)
      })
    )
  }

  // File Learnings
  async listFileLearnings(path?: string): Promise<SerializedFileLearning[]> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const learnings = await this.run(
      Effect.gen(function* () {
        const fileLearningService = yield* core.FileLearningService
        if (path) {
          return yield* fileLearningService.recall(path)
        }
        return yield* fileLearningService.getAll()
      })
    )

     
    return (learnings as any[]).map(l => this.serializeFileLearning(l))
  }

  async createFileLearning(data: CreateFileLearningData): Promise<SerializedFileLearning> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const learning = await this.run(
      Effect.gen(function* () {
        const fileLearningService = yield* core.FileLearningService
        return yield* fileLearningService.create(data)
      })
    )

    return this.serializeFileLearning(learning)
  }

  // Context
  async getContext(taskId: string): Promise<SerializedContextResult> {
    await this.ensureRuntime()

    const Effect = (this as any).Effect

    const core = (this as any).core
    const self = this

    const result = await this.run(
      Effect.gen(function* () {
        const learningService = yield* core.LearningService
        return yield* learningService.getContextForTask(taskId)
      })
    )

    return {

      taskId: (result as any).taskId,

      taskTitle: (result as any).taskTitle,

      learnings: (result as any).learnings.map((l: any) => self.serializeLearningWithScore(l)),

      searchQuery: (result as any).searchQuery,

      searchDuration: (result as any).searchDuration
    }
  }

  // Messages
  private serializeMessage(msg: any): SerializedMessage {
    return {
      id: msg.id,
      channel: msg.channel,
      sender: msg.sender,
      content: msg.content,
      status: msg.status,
      correlationId: msg.correlationId,
      taskId: msg.taskId,
      metadata: msg.metadata ?? {},
      createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
      ackedAt: msg.ackedAt instanceof Date ? msg.ackedAt.toISOString() : msg.ackedAt ?? null,
      expiresAt: msg.expiresAt instanceof Date ? msg.expiresAt.toISOString() : msg.expiresAt ?? null,
    }
  }

  private serializeClaim(claim: any): SerializedClaim {
    return {
      id: claim.id,
      taskId: claim.taskId,
      workerId: claim.workerId,
      claimedAt: claim.claimedAt instanceof Date ? claim.claimedAt.toISOString() : (claim.claimedAt ?? null),
      leaseExpiresAt: claim.leaseExpiresAt instanceof Date ? claim.leaseExpiresAt.toISOString() : (claim.leaseExpiresAt ?? null),
      renewedCount: claim.renewedCount,
      status: claim.status,
    }
  }

  async sendMessage(data: SendMessageData): Promise<SerializedMessage> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const msg = await this.run(
      Effect.gen(function* () {
        const messageService = yield* core.MessageService
        return yield* messageService.send({
          channel: data.channel,
          content: data.content,
          sender: data.sender ?? "sdk",
          taskId: data.taskId ?? null,
          correlationId: data.correlationId ?? null,
          metadata: data.metadata,
          ttlSeconds: data.ttlSeconds,
        })
      })
    )

    return this.serializeMessage(msg)
  }

  async inbox(channel: string, options?: InboxOptions): Promise<SerializedMessage[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const messages = await this.run(
      Effect.gen(function* () {
        const messageService = yield* core.MessageService
        return yield* messageService.inbox({
          channel,
          afterId: options?.afterId,
          limit: options?.limit,
          sender: options?.sender,
          correlationId: options?.correlationId,
          includeAcked: options?.includeAcked,
        })
      })
    )

    return (messages as any[]).map(m => this.serializeMessage(m))
  }

  async ackMessage(id: number): Promise<SerializedMessage> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const msg = await this.run(
      Effect.gen(function* () {
        const messageService = yield* core.MessageService
        return yield* messageService.ack(id)
      })
    )

    return this.serializeMessage(msg)
  }

  async ackAllMessages(channel: string): Promise<{ channel: string; ackedCount: number }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const ackedCount = await this.run<number>(
      Effect.gen(function* () {
        const messageService = yield* core.MessageService
        return yield* messageService.ackAll(channel)
      })
    )

    return { channel, ackedCount }
  }

  async pendingCount(channel: string): Promise<number> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<number>(
      Effect.gen(function* () {
        const messageService = yield* core.MessageService
        return yield* messageService.pending(channel)
      })
    )
  }

  async gcMessages(options?: GcOptions): Promise<GcResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<GcResult>(
      Effect.gen(function* () {
        const messageService = yield* core.MessageService
        return yield* messageService.gc(options)
      })
    )
  }

  // Claims
  async claimTask(taskId: string, workerId: string, leaseDurationMinutes?: number): Promise<SerializedClaim> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const claim = await this.run(
      Effect.gen(function* () {
        const claimService = yield* core.ClaimService
        return yield* claimService.claim(taskId, workerId, leaseDurationMinutes)
      })
    )

    return this.serializeClaim(claim)
  }

  async releaseClaim(taskId: string, workerId: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const claimService = yield* core.ClaimService
        yield* claimService.release(taskId, workerId)
      })
    )
  }

  async renewClaim(taskId: string, workerId: string): Promise<SerializedClaim> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const claim = await this.run(
      Effect.gen(function* () {
        const claimService = yield* core.ClaimService
        return yield* claimService.renew(taskId, workerId)
      })
    )

    return this.serializeClaim(claim)
  }

  async getActiveClaim(taskId: string): Promise<SerializedClaim | null> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const claim = await this.run(
      Effect.gen(function* () {
        const claimService = yield* core.ClaimService
        return yield* claimService.getActiveClaim(taskId)
      })
    )

    return claim ? this.serializeClaim(claim) : null
  }

  async listRuns(options: RunsListOptions = {}): Promise<PaginatedRunsResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const runs = await this.run<any[]>(
      Effect.gen(function* () {
        const runRepo = yield* core.RunRepository
        if (options.taskId) {
          return yield* runRepo.findByTaskId(options.taskId)
        }
        if (options.status && !Array.isArray(options.status)) {
          return yield* runRepo.findByStatus(options.status)
        }
        return yield* runRepo.findRecent(1000)
      })
    )

    let filtered = [...runs]
    if (options.agent) {
      filtered = filtered.filter((run) => run.agent === options.agent)
    }

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status]
      filtered = filtered.filter((run) => statuses.includes(run.status))
    }

    filtered.sort((a, b) => {
      const aTime = new Date(a.startedAt).getTime()
      const bTime = new Date(b.startedAt).getTime()
      if (aTime !== bTime) return bTime - aTime
      return a.id.localeCompare(b.id)
    })

    const limit = options.limit ?? 20
    let startIndex = 0
    if (options.cursor) {
      const cursor = parseRunCursor(options.cursor)
      if (cursor) {
        const cursorTime = new Date(cursor.startedAt).getTime()
        startIndex = filtered.findIndex((run) => {
          const runTime = new Date(run.startedAt).getTime()
          return runTime < cursorTime || (runTime === cursorTime && run.id > cursor.id)
        })
        if (startIndex === -1) {
          startIndex = filtered.length
        }
      }
    }

    const total = filtered.length
    const paginated = filtered.slice(startIndex, startIndex + limit + 1)
    const hasMore = paginated.length > limit
    const resultRuns = hasMore ? paginated.slice(0, limit) : paginated
    const serialized = resultRuns.map((run) => this.serializeRun(run))

    return {
      runs: serialized,
      nextCursor: hasMore && serialized.length > 0 ? buildRunCursor(serialized[serialized.length - 1]!) : null,
      hasMore,
      total,
    }
  }

  async getRun(id: string): Promise<RunDetailResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const run = await this.run<any | null>(
      Effect.gen(function* () {
        const runRepo = yield* core.RunRepository
        return yield* runRepo.findById(id)
      })
    )

    if (!run) {
      throw new TxError(`Run not found: ${id}`, "NOT_FOUND", 404)
    }

    const stdoutLog = this.readOptionalRunLog(run.stdoutPath, { trimToDashboard: true })
    const stderrLog = this.readOptionalRunLog(run.stderrPath, { trimToDashboard: true })

    return {
      run: this.serializeRun(run),
      messages: this.readTranscriptMessages(run),
      logs: {
        stdout: stdoutLog.content,
        stderr: stderrLog.content,
        stdoutTruncated: stdoutLog.truncated,
        stderrTruncated: stderrLog.truncated,
      },
    }
  }

  async getRunTranscript(id: string): Promise<SerializedTraceMessage[]> {
    const result = await this.getRun(id)
    return result.messages
  }

  async getRunStderr(id: string, options?: { tail?: number }): Promise<LogContentResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const run = await this.run<any | null>(
      Effect.gen(function* () {
        const runRepo = yield* core.RunRepository
        return yield* runRepo.findById(id)
      })
    )

    if (!run) {
      throw new TxError(`Run not found: ${id}`, "NOT_FOUND", 404)
    }

    const stderrLog = this.readOptionalRunLog(run.stderrPath, { tailLines: options?.tail })
    return {
      content: stderrLog.content ?? "",
      truncated: stderrLog.truncated,
    }
  }

  async getRunErrors(options: TraceErrorsOptions = {}): Promise<TraceErrorEntry[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<TraceErrorEntry[]>(
      Effect.gen(function* () {
        const db = yield* core.SqliteClient
        const limit = options.limit ?? 20
        const hours = options.hours ?? 24
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
        const errors: TraceErrorEntry[] = []

        const failedRuns = db.prepare(`
          SELECT id, task_id, agent, ended_at, error_message
          FROM runs
          WHERE status = ? AND ended_at >= ?
          ORDER BY ended_at DESC
          LIMIT ?
        `).all("failed", cutoff, limit) as Array<{
          id: string
          task_id: string | null
          agent: string | null
          ended_at: string | null
          error_message: string | null
        }>

        for (const run of failedRuns) {
          errors.push({
            timestamp: run.ended_at ?? new Date().toISOString(),
            source: "run",
            runId: run.id,
            taskId: run.task_id,
            agent: run.agent,
            name: "Run failed",
            error: run.error_message ?? "Unknown error",
            durationMs: null,
          })
        }

        const errorSpans = db.prepare(`
          SELECT timestamp, run_id, task_id, agent, content, metadata, duration_ms
          FROM events
          WHERE event_type = ?
            AND json_extract(metadata, '$.status') = ?
            AND timestamp >= ?
          ORDER BY timestamp DESC
          LIMIT ?
        `).all("span", "error", cutoff, limit) as Array<{
          timestamp: string
          run_id: string | null
          task_id: string | null
          agent: string | null
          content: string | null
          metadata: string
          duration_ms: number | null
        }>

        for (const span of errorSpans) {
          let errorMessage = "Unknown error"
          try {
            const metadata = JSON.parse(span.metadata) as { error?: unknown }
            if (metadata.error !== undefined) {
              errorMessage = String(metadata.error)
            }
          } catch {
            // Ignore malformed metadata.
          }

          errors.push({
            timestamp: span.timestamp,
            source: "span",
            runId: span.run_id,
            taskId: span.task_id,
            agent: span.agent,
            name: span.content ?? "Unknown span",
            error: errorMessage,
            durationMs: span.duration_ms,
          })
        }

        const errorEvents = db.prepare(`
          SELECT timestamp, run_id, task_id, agent, content, duration_ms
          FROM events
          WHERE event_type = ? AND timestamp >= ?
          ORDER BY timestamp DESC
          LIMIT ?
        `).all("error", cutoff, limit) as Array<{
          timestamp: string
          run_id: string | null
          task_id: string | null
          agent: string | null
          content: string | null
          duration_ms: number | null
        }>

        for (const event of errorEvents) {
          errors.push({
            timestamp: event.timestamp,
            source: "event",
            runId: event.run_id,
            taskId: event.task_id,
            agent: event.agent,
            name: "Error event",
            error: event.content ?? "Unknown error",
            durationMs: event.duration_ms,
          })
        }

        errors.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        return errors.slice(0, limit)
      })
    )
  }

  async runHeartbeat(runId: string, data: RunHeartbeatData = {}): Promise<RunHeartbeatResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const parseIsoDate = (value: string | undefined, field: string): Date | undefined => {
      if (!value) return undefined
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) {
        throw new TxError(`Invalid ${field}: must be an ISO timestamp`, "VALIDATION_ERROR")
      }
      return parsed
    }

    const checkAt = parseIsoDate(data.checkAt, "checkAt")
    const activityAt = parseIsoDate(data.activityAt, "activityAt")

    return await this.run<RunHeartbeatResult>(
      Effect.gen(function* () {
        const heartbeatService = yield* core.RunHeartbeatService
        yield* heartbeatService.heartbeat({
          runId,
          checkAt,
          activityAt,
          stdoutBytes: data.stdoutBytes ?? 0,
          stderrBytes: data.stderrBytes ?? 0,
          transcriptBytes: data.transcriptBytes ?? 0,
          deltaBytes: data.deltaBytes,
        })

        return {
          runId,
          checkAt: (checkAt ?? new Date()).toISOString(),
          activityAt: activityAt?.toISOString() ?? null,
          stdoutBytes: data.stdoutBytes ?? 0,
          stderrBytes: data.stderrBytes ?? 0,
          transcriptBytes: data.transcriptBytes ?? 0,
          deltaBytes: data.deltaBytes ?? 0,
        }
      })
    )
  }

  async listStalledRuns(options: StalledRunsOptions = {}): Promise<SerializedStalledRun[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    return await this.run<SerializedStalledRun[]>(
      Effect.gen(function* () {
        const heartbeatService = yield* core.RunHeartbeatService
        const rows = yield* heartbeatService.listStalled({
          transcriptIdleSeconds: options.transcriptIdleSeconds ?? 300,
          heartbeatLagSeconds: options.heartbeatLagSeconds,
        })

        return rows.map((row: any) => ({
          run: self.serializeRun(row.run),
          reason: row.reason,
          transcriptIdleSeconds: row.transcriptIdleSeconds,
          heartbeatLagSeconds: row.heartbeatLagSeconds,
          lastActivityAt: row.lastActivityAt instanceof Date ? row.lastActivityAt.toISOString() : row.lastActivityAt ?? null,
          lastCheckAt: row.lastCheckAt instanceof Date ? row.lastCheckAt.toISOString() : row.lastCheckAt ?? null,
          stdoutBytes: row.stdoutBytes,
          stderrBytes: row.stderrBytes,
          transcriptBytes: row.transcriptBytes,
        }))
      })
    )
  }

  async reapStalledRuns(options: ReapStalledRunsOptions = {}): Promise<SerializedReapedRun[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedReapedRun[]>(
      Effect.gen(function* () {
        const heartbeatService = yield* core.RunHeartbeatService
        const rows = yield* heartbeatService.reapStalled({
          transcriptIdleSeconds: options.transcriptIdleSeconds ?? 300,
          heartbeatLagSeconds: options.heartbeatLagSeconds,
          resetTask: options.resetTask,
          dryRun: options.dryRun,
        })

        return rows.map((row: any) => ({
          id: row.id,
          taskId: row.taskId,
          pid: row.pid,
          reason: row.reason,
          transcriptIdleSeconds: row.transcriptIdleSeconds,
          heartbeatLagSeconds: row.heartbeatLagSeconds,
          processTerminated: row.processTerminated,
          taskReset: row.taskReset,
        }))
      })
    )
  }

  // Pins
  async setPin(id: string, content: string): Promise<SerializedPin> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedPin>(
      Effect.gen(function* () {
        const pinService = yield* core.PinService
        const pin = yield* pinService.set(id, content)
        return {
          id: pin.id,
          content: pin.content,
          createdAt: pin.createdAt instanceof Date ? pin.createdAt.toISOString() : pin.createdAt,
          updatedAt: pin.updatedAt instanceof Date ? pin.updatedAt.toISOString() : pin.updatedAt,
        }
      })
    )
  }

  async getPin(id: string): Promise<SerializedPin | null> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedPin | null>(
      Effect.gen(function* () {
        const pinService = yield* core.PinService
        const pin = yield* pinService.get(id)
        if (!pin) return null
        return {
          id: pin.id,
          content: pin.content,
          createdAt: pin.createdAt instanceof Date ? pin.createdAt.toISOString() : pin.createdAt,
          updatedAt: pin.updatedAt instanceof Date ? pin.updatedAt.toISOString() : pin.updatedAt,
        }
      })
    )
  }

  async listPins(): Promise<SerializedPin[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedPin[]>(
      Effect.gen(function* () {
        const pinService = yield* core.PinService
        const pins = yield* pinService.list()
        return (pins as any[]).map((p: any) => ({
          id: p.id,
          content: p.content,
          createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
          updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
        }))
      })
    )
  }

  async removePin(id: string): Promise<{ deleted: boolean }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<{ deleted: boolean }>(
      Effect.gen(function* () {
        const pinService = yield* core.PinService
        const deleted = yield* pinService.remove(id)
        return { deleted }
      })
    )
  }

  async syncPins(): Promise<{ synced: string[] }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<{ synced: string[] }>(
      Effect.gen(function* () {
        const pinService = yield* core.PinService
        const result = yield* pinService.sync()
        return { synced: [...result.synced] }
      })
    )
  }

  async getPinTargets(): Promise<string[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<string[]>(
      Effect.gen(function* () {
        const pinService = yield* core.PinService
        const files = yield* pinService.getTargetFiles()
        return [...files]
      })
    )
  }

  async setPinTargets(files: string[]): Promise<string[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<string[]>(
      Effect.gen(function* () {
        const pinService = yield* core.PinService
        yield* pinService.setTargetFiles(files)
        const result = yield* pinService.getTargetFiles()
        return [...result]
      })
    )
  }

  // Memory
  private serializeMemoryDocument(doc: any): SerializedMemoryDocument {
    return {
      id: doc.id,
      filePath: doc.filePath,
      rootDir: doc.rootDir,
      title: doc.title,
      content: doc.content,
      frontmatter: doc.frontmatter ?? null,
      tags: doc.tags ?? [],
      fileHash: doc.fileHash,
      fileMtime: doc.fileMtime ?? "",
      embedding: null,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      indexedAt: doc.indexedAt instanceof Date ? doc.indexedAt.toISOString() : doc.indexedAt,
    }
  }

  private serializeMemoryDocumentWithScore(doc: any): SerializedMemoryDocumentWithScore {
    return {
      ...this.serializeMemoryDocument(doc),
      relevanceScore: doc.relevanceScore ?? 0,
      recencyScore: doc.recencyScore ?? 0,
      bm25Score: doc.bm25Score ?? 0,
      vectorScore: doc.vectorScore ?? 0,
      rrfScore: doc.rrfScore ?? 0,
      bm25Rank: doc.bm25Rank ?? 0,
      vectorRank: doc.vectorRank ?? 0,
      ...(doc.expansionHops !== undefined ? { expansionHops: doc.expansionHops } : {}),
    }
  }

  private serializeMemoryLink(link: any): SerializedMemoryLink {
    return {
      id: link.id,
      sourceDocId: link.sourceDocId,
      targetDocId: link.targetDocId ?? null,
      targetRef: link.targetRef,
      linkType: link.linkType,
      createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : link.createdAt,
    }
  }

  private serializeDoc(doc: any): SerializedDoc {
    return {
      id: doc.id,
      hash: doc.hash,
      kind: doc.kind,
      name: doc.name,
      title: doc.title,
      version: doc.version,
      status: doc.status,
      filePath: doc.filePath,
      parentDocId: doc.parentDocId ?? null,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      lockedAt: doc.lockedAt instanceof Date ? doc.lockedAt.toISOString() : doc.lockedAt ?? null,
    }
  }

  private serializeInvariant(inv: any): SerializedInvariant {
    return {
      id: inv.id,
      rule: inv.rule,
      enforcement: inv.enforcement,
      docId: inv.docId,
      subsystem: inv.subsystem ?? null,
      status: inv.status,
      testRef: inv.testRef ?? null,
      lintRule: inv.lintRule ?? null,
      promptRef: inv.promptRef ?? null,
      createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt,
    }
  }

  async memorySourceAdd(dir: string, label?: string): Promise<SerializedMemorySource> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedMemorySource>(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        const source = yield* memoryService.addSource(dir, label)
        return {
          id: source.id,
          rootDir: source.rootDir,
          label: source.label ?? null,
          createdAt: source.createdAt instanceof Date ? source.createdAt.toISOString() : source.createdAt,
        }
      })
    )
  }

  async memorySourceRemove(dir: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        yield* memoryService.removeSource(dir)
      })
    )
  }

  async memorySourceList(): Promise<SerializedMemorySource[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    const sources = await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        return yield* memoryService.listSources()
      })
    )

    return (sources as any[]).map((s: any) => ({
      id: s.id,
      rootDir: s.rootDir,
      label: s.label ?? null,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    }))
  }

  async memoryDocumentCreate(data: CreateMemoryDocumentData): Promise<SerializedMemoryDocument> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        return yield* memoryService.createDocument({
          title: data.title,
          content: data.content,
          tags: data.tags,
          properties: data.properties,
          dir: data.dir,
        })
      })
    )

    return self.serializeMemoryDocument(doc)
  }

  async memoryDocumentGet(id: string): Promise<SerializedMemoryDocument> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        return yield* memoryService.getDocument(id)
      })
    )

    return self.serializeMemoryDocument(doc)
  }

  async memoryDocumentList(options?: { source?: string; tags?: string[] }): Promise<SerializedMemoryDocument[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const docs = await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        return yield* memoryService.listDocuments(options)
      })
    )

    return (docs as any[]).map((d: any) => self.serializeMemoryDocument(d))
  }

  async memorySearch(options: MemorySearchOptions): Promise<SerializedMemoryDocumentWithScore[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const results = await this.run(
      Effect.gen(function* () {
        const retriever = yield* core.MemoryRetrieverService
        return yield* retriever.search(options.query, {
          limit: options.limit,
          minScore: options.minScore,
          semantic: options.semantic,
          expand: options.expand,
          tags: options.tags,
          props: options.props ? Object.entries(options.props).map(([k, v]) => `${k}=${v}`) : undefined,
        })
      })
    )

    return (results as any[]).map((r: any) => self.serializeMemoryDocumentWithScore(r))
  }

  async memoryIndex(options?: { incremental?: boolean }): Promise<MemoryIndexResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<MemoryIndexResult>(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        const result = yield* memoryService.index(options)
        return {
          indexed: result.indexed,
          skipped: result.skipped,
          removed: (result as any).removed ?? 0,
        }
      })
    )
  }

  async memoryIndexStatus(): Promise<MemoryIndexStatus> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<MemoryIndexStatus>(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        const status = yield* memoryService.indexStatus()
        return {
          totalFiles: status.totalFiles,
          indexed: status.indexed,
          stale: status.stale,
          embedded: status.embedded,
          links: status.links,
          sources: status.sources,
        }
      })
    )
  }

  async memoryTagAdd(id: string, tags: string[]): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        yield* memoryService.updateFrontmatter(id, { addTags: tags })
      })
    )
  }

  async memoryTagRemove(id: string, tags: string[]): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        yield* memoryService.updateFrontmatter(id, { removeTags: tags })
      })
    )
  }

  async memoryRelate(id: string, target: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        yield* memoryService.updateFrontmatter(id, { addRelated: [target] })
      })
    )
  }

  async memoryPropertySet(id: string, key: string, value: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        yield* memoryService.setProperty(id, key, value)
      })
    )
  }

  async memoryPropertyRemove(id: string, key: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        yield* memoryService.removeProperty(id, key)
      })
    )
  }

  async memoryProperties(id: string): Promise<Record<string, string>> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<Record<string, string>>(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        const props = yield* memoryService.getProperties(id)
        const result: Record<string, string> = {}
        for (const p of props as any[]) {
          result[p.key] = p.value
        }
        return result
      })
    )
  }

  async memoryLinks(id: string): Promise<SerializedMemoryLink[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const links = await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        return yield* memoryService.getLinks(id)
      })
    )

    return (links as any[]).map((l: any) => self.serializeMemoryLink(l))
  }

  async memoryBacklinks(id: string): Promise<SerializedMemoryLink[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const links = await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        return yield* memoryService.getBacklinks(id)
      })
    )

    return (links as any[]).map((l: any) => self.serializeMemoryLink(l))
  }

  async memoryLinkCreate(sourceId: string, targetRef: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const memoryService = yield* core.MemoryService
        yield* memoryService.addLink(sourceId, targetRef)
      })
    )
  }

  // Sync
  async syncExport(): Promise<SyncExportResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SyncExportResult>(
      Effect.gen(function* () {
        const syncService = yield* core.SyncService
        const result = yield* syncService.export()
        return {
          eventCount: result.eventCount,
          streamId: result.streamId,
          path: result.path,
        }
      })
    )
  }

  async syncImport(): Promise<SyncImportResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SyncImportResult>(
      Effect.gen(function* () {
        const syncService = yield* core.SyncService
        const result = yield* syncService.import()
        return {
          importedEvents: result.importedEvents,
          appliedEvents: result.appliedEvents,
          streamCount: result.streamCount,
        }
      })
    )
  }

  async syncStatus(): Promise<SyncStatusResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SyncStatusResult>(
      Effect.gen(function* () {
        const syncService = yield* core.SyncService
        const status = yield* syncService.status()
        return {
          dbTaskCount: status.dbTaskCount,
          eventOpCount: status.eventOpCount,
          lastExport: status.lastExport instanceof Date ? status.lastExport.toISOString() : status.lastExport ?? null,
          lastImport: status.lastImport instanceof Date ? status.lastImport.toISOString() : status.lastImport ?? null,
          isDirty: status.isDirty,
          autoSyncEnabled: status.autoSyncEnabled,
        }
      })
    )
  }

  async syncStream(): Promise<SyncStreamInfoResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SyncStreamInfoResult>(
      Effect.gen(function* () {
        const syncService = yield* core.SyncService
        const result = yield* syncService.stream()
        return {
          streamId: result.streamId,
          nextSeq: result.nextSeq,
          lastSeq: result.lastSeq,
          eventsDir: result.eventsDir,
          configPath: result.configPath,
          knownStreams: result.knownStreams,
        }
      })
    )
  }

  async syncHydrate(): Promise<SyncHydrateResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SyncHydrateResult>(
      Effect.gen(function* () {
        const syncService = yield* core.SyncService
        return yield* syncService.hydrate()
      })
    )
  }

  // Docs
  async docsList(options?: { kind?: string; status?: string }): Promise<SerializedDoc[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const docs = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.list(options)
      })
    )

    return (docs as any[]).map((d: any) => self.serializeDoc(d))
  }

  async docsGet(name: string): Promise<SerializedDoc> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.get(name)
      })
    )

    return self.serializeDoc(doc)
  }

  async docsCreate(data: { kind: string; name: string; title: string; yamlContent: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.create(data as any)
      })
    )

    return self.serializeDoc(doc)
  }

  async docsUpdate(name: string, yamlContent: string): Promise<SerializedDoc> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.update(name, yamlContent)
      })
    )

    return self.serializeDoc(doc)
  }

  async docsDelete(name: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        yield* docService.remove(name)
      })
    )
  }

  async docsLock(name: string): Promise<SerializedDoc> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.lock(name)
      })
    )

    return self.serializeDoc(doc)
  }

  async docsLink(fromName: string, toName: string, linkType?: string): Promise<SerializedDocLink> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedDocLink>(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        const link = yield* docService.linkDocs(fromName, toName, linkType as any)
        return {
          id: link.id,
          fromDocId: link.fromDocId,
          toDocId: link.toDocId,
          linkType: link.linkType,
          createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : link.createdAt,
        }
      })
    )
  }

  async docsRender(name?: string): Promise<string[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<string[]>(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.render(name)
      })
    )
  }

  // Invariants
  async invariantsList(options?: { subsystem?: string; enforcement?: string }): Promise<SerializedInvariant[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const invariants = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.listInvariants(options)
      })
    )

    return (invariants as any[]).map((inv: any) => self.serializeInvariant(inv))
  }

  async invariantsGet(id: string): Promise<SerializedInvariant> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    // DocService doesn't have a direct getInvariant(id) method,
    // so we list all and filter by id.
    const invariants = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.listInvariants()
      })
    )

    const found = (invariants as any[]).find((inv: any) => inv.id === id)
    if (!found) {
      throw new TxError(`Invariant not found: ${id}`, "NOT_FOUND", 404)
    }

    return self.serializeInvariant(found)
  }

  async invariantsRecord(id: string, passed: boolean, details?: string, durationMs?: number): Promise<SerializedInvariantCheck> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedInvariantCheck>(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        const check = yield* docService.recordInvariantCheck(id, passed, details ?? null, durationMs ?? null)
        return {
          id: check.id,
          invariantId: check.invariantId,
          passed: check.passed,
          details: check.details ?? null,
          durationMs: check.durationMs ?? null,
          checkedAt: check.checkedAt instanceof Date ? check.checkedAt.toISOString() : check.checkedAt,
        }
      })
    )
  }

  // Spec traceability
  async specDiscover(options?: { doc?: string; patterns?: string[] }): Promise<DiscoverResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<DiscoverResult>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        return yield* specService.discover(options)
      })
    )
  }

  async specLink(invariantId: string, file: string, name?: string, framework?: string): Promise<SerializedSpecTest> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    return await this.run<SerializedSpecTest>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        const linked = yield* specService.link(invariantId, file, name, framework ?? null)
        return self.serializeSpecTest(linked)
      })
    )
  }

  async specUnlink(invariantId: string, testId: string): Promise<{ removed: boolean }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<{ removed: boolean }>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        const removed = yield* specService.unlink(invariantId, testId)
        return { removed }
      })
    )
  }

  async specTests(invariantId: string): Promise<SerializedSpecTest[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    return await this.run<SerializedSpecTest[]>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        const tests = yield* specService.testsForInvariant(invariantId)
        return tests.map((test: any) => self.serializeSpecTest(test))
      })
    )
  }

  async specInvariantsForTest(testId: string): Promise<string[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<string[]>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        const invariants = yield* specService.invariantsForTest(testId)
        return [...invariants]
      })
    )
  }

  async specGaps(options?: SpecScopeOptions): Promise<SerializedSpecGap[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    return await this.run<SerializedSpecGap[]>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        const gaps = yield* specService.uncoveredInvariants(options)
        return gaps.map((gap: any) => self.serializeSpecGap(gap))
      })
    )
  }

  async specFci(options?: SpecScopeOptions): Promise<FciResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<FciResult>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        return yield* specService.fci(options)
      })
    )
  }

  async specMatrix(options?: SpecScopeOptions): Promise<SerializedTraceabilityMatrixEntry[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    return await this.run<SerializedTraceabilityMatrixEntry[]>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        const matrix = yield* specService.matrix(options)
        return matrix.map((entry: any) => self.serializeSpecMatrixEntry(entry))
      })
    )
  }

  async specStatus(options?: SpecScopeOptions): Promise<SpecStatusResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SpecStatusResult>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        return yield* specService.status(options)
      })
    )
  }

  async specRun(testId: string, passed: boolean, options?: { durationMs?: number | null; details?: string | null; runAt?: string }): Promise<SpecBatchRunResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SpecBatchRunResult>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        return yield* specService.recordRun(testId, passed, options)
      })
    )
  }

  async specBatch(data: { results?: SpecBatchRunInput[]; raw?: string; from?: SpecBatchSource; runAt?: string }): Promise<SpecBatchRunResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    if (data.raw && data.results && data.results.length > 0) {
      throw new TxError(
        "Provide either raw batch input or parsed results, not both",
        "VALIDATION_ERROR",
        400
      )
    }

    const rows = data.raw
      ? core.parseBatchRunInput(data.raw, data.from ?? "generic")
      : (data.results ?? [])

    return await this.run<SpecBatchRunResult>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        return yield* specService.recordBatchRun(rows, { runAt: data.runAt })
      })
    )
  }

  async specComplete(options: { doc?: string; subsystem?: string; signedOffBy: string; notes?: string }): Promise<SerializedSpecSignoff> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    return await this.run<SerializedSpecSignoff>(
      Effect.gen(function* () {
        const specService = yield* core.SpecTraceService
        const signoff = yield* specService.complete(
          { doc: options.doc, subsystem: options.subsystem },
          options.signedOffBy,
          options.notes
        )
        return self.serializeSpecSignoff(signoff)
      })
    )
  }

  // Cycles
  // Cycle data is stored in the runs table with metadata.type === "cycle".
  // We query via raw SQL since there's no dedicated CycleRepository.
  async cyclesList(): Promise<SerializedCycleRun[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedCycleRun[]>(
      Effect.gen(function* () {
        const db = yield* core.SqliteClient
        const rows = db.prepare(
          `SELECT r.id, r.started_at, r.ended_at, r.status, r.metadata
           FROM runs r
           WHERE r.agent = 'cycle-scanner'
           ORDER BY r.started_at DESC`
        ).all() as any[]

        return rows.map((row: any) => {
          const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {})
          return {
            id: row.id,
            cycle: meta.cycle ?? 0,
            name: meta.name ?? "",
            description: meta.description ?? "",
            startedAt: row.started_at,
            endedAt: row.ended_at ?? null,
            status: row.status,
            rounds: meta.rounds ?? 0,
            totalNewIssues: meta.totalNewIssues ?? 0,
            existingIssues: meta.existingIssues ?? 0,
            finalLoss: meta.finalLoss ?? 0,
            converged: meta.converged ?? false,
          }
        })
      })
    )
  }

  async cyclesGet(id: string): Promise<SerializedCycleDetail> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedCycleDetail>(
      Effect.gen(function* () {
        const db = yield* core.SqliteClient

        // Get the cycle run
        const row = db.prepare(
          `SELECT r.id, r.started_at, r.ended_at, r.status, r.metadata
           FROM runs r WHERE r.id = ?`
        ).get(id) as any

        if (!row) {
          return yield* Effect.fail(new Error(`Cycle not found: ${id}`))
        }

        const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {})
        const cycle: SerializedCycleRun = {
          id: row.id,
          cycle: meta.cycle ?? 0,
          name: meta.name ?? "",
          description: meta.description ?? "",
          startedAt: row.started_at,
          endedAt: row.ended_at ?? null,
          status: row.status,
          rounds: meta.rounds ?? 0,
          totalNewIssues: meta.totalNewIssues ?? 0,
          existingIssues: meta.existingIssues ?? 0,
          finalLoss: meta.finalLoss ?? 0,
          converged: meta.converged ?? false,
        }

        // Get round metrics from events table (matches REST handler)
        const metricRows = db.prepare(
          `SELECT metadata FROM events
           WHERE run_id = ? AND event_type = 'metric' AND content = 'cycle.round.loss'
           ORDER BY timestamp ASC`
        ).all(id) as any[]

        const roundMetrics = metricRows.map((row: any) => {
          const m = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {})
          return {
            cycle: m.cycle ?? 0,
            round: m.round ?? 0,
            loss: m.loss ?? 0,
            newIssues: m.newIssues ?? 0,
            existingIssues: m.existingIssues ?? 0,
            duplicates: m.duplicates ?? 0,
            high: m.high ?? 0,
            medium: m.medium ?? 0,
            low: m.low ?? 0,
          }
        })

        // Get issues: tasks created by this cycle (matches REST handler)
        const issueRows = db.prepare(
          `SELECT id, title, description, metadata FROM tasks
           WHERE json_extract(metadata, '$.foundByScan') = 1
             AND json_extract(metadata, '$.cycleId') = ?
           ORDER BY json_extract(metadata, '$.round') ASC,
                    CASE json_extract(metadata, '$.severity')
                      WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3
                    END ASC`
        ).all(id) as any[]

        const issues = issueRows.map((ir: any) => {
          const issueMeta = typeof ir.metadata === "string" ? JSON.parse(ir.metadata) : (ir.metadata ?? {})
          return {
            id: ir.id,
            title: ir.title ?? "",
            description: ir.description ?? "",
            severity: issueMeta.severity ?? "low",
            issueType: issueMeta.issueType ?? "",
            file: issueMeta.file ?? "",
            line: issueMeta.line ?? 0,
            cycle: issueMeta.cycle ?? 0,
            round: issueMeta.round ?? 0,
          }
        })

        return { cycle, roundMetrics, issues }
      })
    )
  }

  async cyclesDelete(id: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const db = yield* core.SqliteClient
        // Delete associated issues (tasks created by this cycle)
        db.prepare(`DELETE FROM tasks WHERE json_extract(metadata, '$.cycleId') = ?`).run(id)
        // Delete associated events, then the run itself
        db.prepare("DELETE FROM events WHERE run_id = ?").run(id)
        db.prepare("DELETE FROM runs WHERE id = ?").run(id)
      })
    )
  }

  async cyclesDeleteIssues(issueIds: string[]): Promise<{ success: boolean; deletedCount: number }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<{ success: boolean; deletedCount: number }>(
      Effect.gen(function* () {
        const db = yield* core.SqliteClient
        if (issueIds.length === 0) {
          return { success: true, deletedCount: 0 }
        }
        const placeholders = issueIds.map(() => "?").join(",")
        const result = db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...issueIds)
        return { success: true, deletedCount: result.changes }
      })
    )
  }

  async docsGraph(): Promise<DocGraph> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<DocGraph>(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        const graph = yield* docService.getGraph()
        return graph
      })
    )
  }

  // Guards
  async guardSet(options: { scope?: string; maxPending?: number; maxChildren?: number; maxDepth?: number; enforce?: boolean }): Promise<SerializedGuard> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<SerializedGuard>(
      Effect.gen(function* () {
        const svc = yield* core.GuardService
        const guard = yield* svc.set(options)
        return {
          id: guard.id,
          scope: guard.scope,
          maxPending: guard.maxPending ?? null,
          maxChildren: guard.maxChildren ?? null,
          maxDepth: guard.maxDepth ?? null,
          enforce: Boolean(guard.enforce),
          createdAt: guard.createdAt instanceof Date ? guard.createdAt.toISOString() : String(guard.createdAt),
        }
      })
    )
  }
  async guardShow(): Promise<SerializedGuard[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<SerializedGuard[]>(
      Effect.gen(function* () {
        const svc = yield* core.GuardService
        const guards = yield* svc.show()
        return guards.map((g: any) => ({
          id: g.id,
          scope: g.scope,
          maxPending: g.maxPending ?? null,
          maxChildren: g.maxChildren ?? null,
          maxDepth: g.maxDepth ?? null,
          enforce: Boolean(g.enforce),
          createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : String(g.createdAt ?? ""),
        }))
      })
    )
  }
  async guardClear(scope?: string): Promise<{ cleared: boolean }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<{ cleared: boolean }>(
      Effect.gen(function* () {
        const svc = yield* core.GuardService
        const cleared = yield* svc.clear(scope)
        return { cleared }
      })
    )
  }
  async guardCheck(parentId?: string): Promise<{ passed: boolean; warnings: string[] }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<{ passed: boolean; warnings: string[] }>(
      Effect.gen(function* () {
        const svc = yield* core.GuardService
        const result = yield* svc.check(parentId)
        return { passed: result.passed, warnings: [...result.warnings] }
      })
    )
  }

  // Verify
  async verifySet(taskId: string, cmd: string, schema?: string): Promise<{ message: string }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<{ message: string }>(
      Effect.gen(function* () {
        const svc = yield* core.VerifyService
        yield* svc.set(taskId, cmd, schema)
        return { message: `Verify command set for task ${taskId}` }
      })
    )
  }
  async verifyShow(taskId: string): Promise<{ cmd: string | null; schema: string | null }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<{ cmd: string | null; schema: string | null }>(
      Effect.gen(function* () {
        const svc = yield* core.VerifyService
        return yield* svc.show(taskId)
      })
    )
  }
  async verifyRun(taskId: string, options?: { timeout?: number }): Promise<SerializedVerifyResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<SerializedVerifyResult>(
      Effect.gen(function* () {
        const svc = yield* core.VerifyService
        const result = yield* svc.run(taskId, options)
        return {
          taskId: result.taskId,
          exitCode: result.exitCode,
          passed: result.passed,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
          output: result.output,
          schemaValid: result.schemaValid,
        }
      })
    )
  }
  async verifyClear(taskId: string): Promise<{ message: string }> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<{ message: string }>(
      Effect.gen(function* () {
        const svc = yield* core.VerifyService
        yield* svc.clear(taskId)
        return { message: `Verify command cleared for task ${taskId}` }
      })
    )
  }

  // Reflect
  async reflect(options?: { sessions?: number; hours?: number; analyze?: boolean }): Promise<SerializedReflectResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    return await this.run<SerializedReflectResult>(
      Effect.gen(function* () {
        const svc = yield* core.ReflectService
        const result = yield* svc.reflect(options)
        return {
          sessions: result.sessions,
          throughput: result.throughput,
          proliferation: result.proliferation,
          stuckTasks: [...result.stuckTasks],
          signals: [...result.signals],
          analysis: result.analysis,
        }
      })
    )
  }

  // Stats
  async getStats(): Promise<StatsResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<StatsResult>(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        const readyService = yield* core.ReadyService
        const learningService = yield* core.LearningService
        const sqliteClient = yield* core.SqliteClient

        const allTasks = yield* taskService.count({})
        const doneTasks = yield* taskService.count({ status: "done" })
        const readyTasks = yield* readyService.getReady(1000)
        const learningsCount = yield* learningService.count()

        // Get run counts from DB directly (matches REST handler)
        const db = sqliteClient
        const runningRow = db.prepare(
          `SELECT COUNT(*) as count FROM runs WHERE status = 'running'`
        ).get() as { count: number } | undefined
        const totalRow = db.prepare(
          `SELECT COUNT(*) as count FROM runs`
        ).get() as { count: number } | undefined

        return {
          tasks: allTasks,
          done: doneTasks,
          ready: (readyTasks as any[]).length,
          learnings: learningsCount,
          runsRunning: runningRow?.count ?? 0,
          runsTotal: totalRow?.count ?? 0,
        }
      })
    )
  }

  /**
   * Dispose of the runtime and release resources.
   * Only actually disposes when all clients using this dbPath have disposed.
   *
   * Safe against concurrent calls: `this.runtime` is nulled synchronously
   * before any await, so a second call immediately sees null and returns.
   */
  async dispose(): Promise<void> {
    const rt = this.runtime
    if (!rt) return

    // Null immediately so concurrent calls are idempotent from this tick.
    this.runtime = null

    const cached = runtimeCache.get(this.dbPath)
    if (cached) {
      cached.refCount--
      if (cached.refCount <= 0) {
        // Last client - actually dispose the runtime
        runtimeCache.delete(this.dbPath)
        await rt.dispose()
      }
    }
  }
}

// =============================================================================
// Namespace Classes
// =============================================================================

/**
 * Task operations namespace.
 */
class TasksNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * List tasks with pagination and filtering.
   *
   * @param options - Query options for filtering and pagination
   * @param options.cursor - Pagination cursor from a previous response's `nextCursor`
   * @param options.limit - Maximum number of tasks to return (default: 20)
   * @param options.status - Filter by status (single value or array)
   * @param options.search - Full-text search across title and description
   * @returns Paginated response with tasks, cursor, and total count
   * @example
   * ```typescript
   * // List all tasks
   * const all = await tx.tasks.list()
   *
   * // Filter by status
   * const active = await tx.tasks.list({ status: 'active' })
   *
   * // Paginate through results
   * const page1 = await tx.tasks.list({ limit: 10 })
   * if (page1.hasMore) {
   *   const page2 = await tx.tasks.list({ limit: 10, cursor: page1.nextCursor! })
   * }
   * ```
   */
  async list(options: ListOptions = {}): Promise<PaginatedResponse<SerializedTaskWithDeps>> {
    return this.transport.listTasks(options)
  }

  /**
   * Get a task by ID, including dependency information.
   *
   * @param id - Task ID (format: `tx-[a-z0-9]{6,12}`)
   * @returns Task with blockedBy, blocks, children, and isReady fields
   * @throws {TxError} `NOT_FOUND` if the task does not exist
   * @example
   * ```typescript
   * const task = await tx.tasks.get('tx-abc123')
   * console.log(task.title, task.isReady)
   * ```
   */
  async get(id: string): Promise<SerializedTaskWithDeps> {
    return this.transport.getTask(id)
  }

  /**
   * Create a new task.
   *
   * @param data - Task creation data
   * @param data.title - Task title (required, must be non-empty)
   * @param data.description - Optional description with details
   * @param data.parentId - Optional parent task ID for hierarchy
   * @param data.score - Priority score (higher = more urgent, default: 0)
   * @param data.metadata - Arbitrary key-value metadata
   * @returns The created task with dependency information
   * @throws {TxError} `VALIDATION_ERROR` if title is empty
   * @throws {TxError} `NOT_FOUND` if parentId references a non-existent task
   * @example
   * ```typescript
   * const task = await tx.tasks.create({
   *   title: 'Implement auth',
   *   description: 'Add JWT-based authentication',
   *   score: 100
   * })
   * ```
   */
  async create(data: {
    title: string
    description?: string
    parentId?: string
    score?: number
    assigneeType?: "human" | "agent" | null
    assigneeId?: string | null
    assignedAt?: string | Date | null
    assignedBy?: string | null
    metadata?: Record<string, unknown>
  }): Promise<SerializedTaskWithDeps> {
    return this.transport.createTask(data)
  }

  /**
   * Update a task's fields. Only provided fields are changed.
   *
   * @param id - Task ID to update
   * @param data - Fields to update (all optional)
   * @param data.title - New title
   * @param data.description - New description
   * @param data.status - New status (must follow valid transitions)
   * @param data.parentId - New parent ID, or `null` to remove parent
   * @param data.score - New priority score
   * @param data.metadata - New metadata (replaces existing)
   * @returns The updated task with dependency information
   * @throws {TxError} `NOT_FOUND` if the task does not exist
   * @throws {TxError} `VALIDATION_ERROR` for invalid status transitions
   * @example
   * ```typescript
   * await tx.tasks.update('tx-abc123', {
   *   status: 'active',
   *   score: 200
   * })
   * ```
   */
  async update(
    id: string,
    data: {
      title?: string
      description?: string
      status?: TaskStatus
      parentId?: string | null
      score?: number
      assigneeType?: "human" | "agent" | null
      assigneeId?: string | null
      assignedAt?: string | Date | null
      assignedBy?: string | null
      metadata?: Record<string, unknown>
    }
  ): Promise<SerializedTaskWithDeps> {
    return this.transport.updateTask(id, data)
  }

  /**
   * Set direct task-group context on a task.
   *
   * Effective context is inherited by related ancestors and descendants.
   */
  async setGroupContext(id: string, context: string): Promise<SerializedTaskWithDeps> {
    return this.transport.setTaskGroupContext(id, context)
  }

  /**
   * Clear direct task-group context from a task.
   */
  async clearGroupContext(id: string): Promise<SerializedTaskWithDeps> {
    return this.transport.clearTaskGroupContext(id)
  }

  /**
   * Delete a task and remove its dependency edges.
   *
   * Fails if the task has children unless `cascade` is true.
   * With cascade, all descendant tasks are deleted depth-first.
   *
   * @param id - Task ID to delete
   * @param options.cascade - If true, delete all descendant tasks
   * @throws {TxError} `NOT_FOUND` if the task does not exist
   * @throws {TxError} `HAS_CHILDREN` if the task has children and cascade is not set
   * @example
   * ```typescript
   * await tx.tasks.delete('tx-abc123')
   * await tx.tasks.delete('tx-abc123', { cascade: true })
   * ```
   */
  async delete(id: string, options?: { cascade?: boolean }): Promise<void> {
    return this.transport.deleteTask(id, options)
  }

  /**
   * Mark a task as done and discover newly unblocked tasks.
   *
   * Sets the task status to `done`. Any tasks that were blocked solely
   * by this task will appear in the `nowReady` array.
   *
   * @param id - Task ID to complete
   * @returns The completed task and an array of tasks that became ready
   * @throws {TxError} `NOT_FOUND` if the task does not exist
   * @example
   * ```typescript
   * const { task, nowReady } = await tx.tasks.done('tx-abc123')
   * console.log(`Completed: ${task.title}`)
   * console.log(`Unblocked ${nowReady.length} tasks`)
   * ```
   */
  async done(id: string): Promise<CompleteResult> {
    return this.transport.completeTask(id)
  }

  /**
   * Get tasks that are ready to be worked on (all blockers completed).
   *
   * Returns tasks sorted by priority score (descending). A task is
   * ready when its status is workable and all blockers have status `done`.
   *
   * @param options - Query options
   * @param options.limit - Maximum number of tasks to return (default: 100)
   * @param options.labels - Only include tasks with these labels
   * @param options.excludeLabels - Exclude tasks with these labels
   * @returns Array of ready tasks with dependency information
   * @example
   * ```typescript
   * const ready = await tx.tasks.ready({ limit: 5, labels: ['phase:implement'] })
   * if (ready.length > 0) {
   *   console.log(`Next task: ${ready[0].title}`)
   * }
   * ```
   */
  async ready(options: ReadyOptions = {}): Promise<SerializedTaskWithDeps[]> {
    return this.transport.readyTasks(options)
  }

  /**
   * Add a blocker dependency between two tasks.
   *
   * The `blockerId` task must be completed before the `id` task
   * can become ready. Circular dependencies are rejected.
   *
   * @param id - Task ID that will be blocked
   * @param blockerId - Task ID that must complete first
   * @returns The blocked task with updated dependency information
   * @throws {TxError} `NOT_FOUND` if either task does not exist
   * @throws {TxError} `CIRCULAR_DEPENDENCY` if this would create a cycle
   * @example
   * ```typescript
   * // "deploy" can't start until "build" is done
   * await tx.tasks.block('tx-deploy', 'tx-build')
   * ```
   */
  async block(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    return this.transport.blockTask(id, blockerId)
  }

  /**
   * Remove a blocker dependency between two tasks.
   *
   * @param id - Task ID to unblock
   * @param blockerId - Blocker task ID to remove
   * @returns The task with updated dependency information
   * @throws {TxError} `NOT_FOUND` if either task does not exist
   * @example
   * ```typescript
   * await tx.tasks.unblock('tx-deploy', 'tx-build')
   * ```
   */
  async unblock(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    return this.transport.unblockTask(id, blockerId)
  }

  /**
   * Get a task and all its descendants as a flat array.
   *
   * @param id - Root task ID
   * @returns Flat array of the task and all descendant tasks
   * @throws {TxError} `NOT_FOUND` if the task does not exist
   * @example
   * ```typescript
   * const tree = await tx.tasks.tree('tx-root')
   * console.log(`${tree.length} tasks in tree`)
   * ```
   */
  async tree(id: string): Promise<SerializedTaskWithDeps[]> {
    return this.transport.getTaskTree(id)
  }
}

/**
 * Learning operations namespace.
 */
class LearningsNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * Search learnings using BM25 text search.
   *
   * When no query is provided, returns the most recent learnings.
   * Results include relevance scores for ranking.
   *
   * @param options - Search options
   * @param options.query - Search query string (omit for recent learnings)
   * @param options.limit - Maximum results to return (default: 10)
   * @param options.minScore - Minimum relevance score threshold (0-1)
   * @param options.category - Filter by learning category
   * @returns Array of learnings with relevance scores
   * @example
   * ```typescript
   * // Search by keyword
   * const results = await tx.learnings.search({ query: 'authentication' })
   *
   * // Get recent learnings
   * const recent = await tx.learnings.search({ limit: 5 })
   * ```
   */
  async search(options: SearchLearningsOptions = {}): Promise<SerializedLearningWithScore[]> {
    return this.transport.searchLearnings(options)
  }

  /**
   * Get a learning by its numeric ID.
   *
   * @param id - Learning ID
   * @returns The learning record
   * @throws {TxError} `NOT_FOUND` if the learning does not exist
   * @example
   * ```typescript
   * const learning = await tx.learnings.get(42)
   * console.log(learning.content)
   * ```
   */
  async get(id: number): Promise<SerializedLearning> {
    return this.transport.getLearning(id)
  }

  /**
   * Create a new learning to persist knowledge for future agents.
   *
   * @param data - Learning creation data
   * @param data.content - The learning content (required)
   * @param data.sourceType - Origin type: `'manual'`, `'run'`, `'compaction'`, or `'claude_md'`
   * @param data.sourceRef - Reference to the source (e.g. task ID)
   * @param data.category - Category for filtering
   * @param data.keywords - Keywords for search indexing
   * @returns The created learning record
   * @example
   * ```typescript
   * await tx.learnings.add({
   *   content: 'Use retry logic for flaky network calls',
   *   sourceType: 'manual',
   *   sourceRef: 'tx-abc123',
   *   category: 'best-practices'
   * })
   * ```
   */
  async add(data: CreateLearningData): Promise<SerializedLearning> {
    return this.transport.createLearning(data)
  }

  /**
   * Record that a learning was helpful, boosting its outcome score.
   *
   * Higher outcome scores cause learnings to rank higher in future searches.
   *
   * @param id - Learning ID
   * @param score - Helpfulness score (default: 1.0)
   * @throws {TxError} `NOT_FOUND` if the learning does not exist
   * @example
   * ```typescript
   * await tx.learnings.helpful(42)
   * ```
   */
  async helpful(id: number, score = 1.0): Promise<void> {
    return this.transport.recordHelpful(id, score)
  }
}

/**
 * File learning operations namespace.
 */
class FileLearningsNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * List all file learnings, optionally filtering by file path.
   *
   * @param path - Optional file path to filter by
   * @returns Array of file learnings
   * @example
   * ```typescript
   * // List all file learnings
   * const all = await tx.fileLearnings.list()
   *
   * // Filter by path
   * const forFile = await tx.fileLearnings.list('src/auth.ts')
   * ```
   */
  async list(path?: string): Promise<SerializedFileLearning[]> {
    return this.transport.listFileLearnings(path)
  }

  /**
   * Recall file learnings matching a specific file path.
   *
   * Use this to retrieve notes attached to a file before working on it.
   *
   * @param path - File path to match against file patterns
   * @returns Array of matching file learnings
   * @example
   * ```typescript
   * const notes = await tx.fileLearnings.recall('src/auth.ts')
   * for (const note of notes) {
   *   console.log(`${note.filePattern}: ${note.note}`)
   * }
   * ```
   */
  async recall(path: string): Promise<SerializedFileLearning[]> {
    return this.transport.listFileLearnings(path)
  }

  /**
   * Create a file learning that associates a note with a file pattern.
   *
   * @param data - File learning creation data
   * @param data.filePattern - Glob pattern or file path to match
   * @param data.note - The note to associate with matching files
   * @param data.taskId - Optional task ID that produced this learning
   * @returns The created file learning
   * @example
   * ```typescript
   * await tx.fileLearnings.add({
   *   filePattern: 'src/auth.ts',
   *   note: 'JWT tokens expire after 1 hour, refresh logic is in middleware',
   *   taskId: 'tx-abc123'
   * })
   * ```
   */
  async add(data: CreateFileLearningData): Promise<SerializedFileLearning> {
    return this.transport.createFileLearning(data)
  }
}

/**
 * Context operations namespace.
 */
class ContextNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * Get contextual learnings for a task.
   *
   * Uses the task's title and description to search for relevant learnings.
   * This is the primary mechanism for injecting memory into agent prompts.
   *
   * @param taskId - Task ID to get context for
   * @returns Context result with the task info, matching learnings, and search metadata
   * @throws {TxError} `NOT_FOUND` if the task does not exist
   * @example
   * ```typescript
   * const ctx = await tx.context.forTask('tx-abc123')
   * console.log(`Found ${ctx.learnings.length} relevant learnings`)
   * for (const l of ctx.learnings) {
   *   console.log(`- [${(l.relevanceScore * 100).toFixed(0)}%] ${l.content}`)
   * }
   * ```
   */
  async forTask(taskId: string): Promise<SerializedContextResult> {
    return this.transport.getContext(taskId)
  }
}

/**
 * Run tracing namespace for run inspection, logs, and heartbeat primitives.
 */
class RunsNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * List recent runs with pagination and filtering.
   */
  async list(options: RunsListOptions = {}): Promise<PaginatedRunsResult> {
    return this.transport.listRuns(options)
  }

  /**
   * Get a run with parsed transcript messages and captured logs.
   */
  async get(id: string): Promise<RunDetailResult> {
    return this.transport.getRun(id)
  }

  /**
   * Get parsed transcript messages for a run.
   */
  async transcript(id: string): Promise<SerializedTraceMessage[]> {
    return this.transport.getRunTranscript(id)
  }

  /**
   * Get stderr content for a run, optionally tailing the last N lines.
   */
  async stderr(id: string, options?: { tail?: number }): Promise<LogContentResult> {
    return this.transport.getRunStderr(id, options)
  }

  /**
   * List recent run/span/event errors across the tracing store.
   */
  async errors(options: TraceErrorsOptions = {}): Promise<TraceErrorEntry[]> {
    return this.transport.getRunErrors(options)
  }

  /**
   * Record a run heartbeat sample for progress monitoring.
   */
  async heartbeat(runId: string, data: RunHeartbeatData = {}): Promise<RunHeartbeatResult> {
    return this.transport.runHeartbeat(runId, data)
  }

  /**
   * List currently running runs that appear stalled.
   */
  async stalled(options: StalledRunsOptions = {}): Promise<SerializedStalledRun[]> {
    return this.transport.listStalledRuns(options)
  }

  /**
   * Reap stalled runs by terminating process trees and cancelling runs.
   */
  async reap(options: ReapStalledRunsOptions = {}): Promise<SerializedReapedRun[]> {
    return this.transport.reapStalledRuns(options)
  }
}

/**
 * Spec traceability namespace for invariant-to-test mapping and FCI scoring.
 */
class SpecNamespace {
  constructor(private readonly transport: Transport) {}

  async discover(options?: { doc?: string; patterns?: string[] }): Promise<DiscoverResult> {
    return this.transport.specDiscover(options)
  }

  async link(invariantId: string, file: string, name?: string, framework?: string): Promise<SerializedSpecTest> {
    return this.transport.specLink(invariantId, file, name, framework)
  }

  async unlink(invariantId: string, testId: string): Promise<{ removed: boolean }> {
    return this.transport.specUnlink(invariantId, testId)
  }

  async tests(invariantId: string): Promise<SerializedSpecTest[]> {
    return this.transport.specTests(invariantId)
  }

  async invariantsForTest(testId: string): Promise<string[]> {
    return this.transport.specInvariantsForTest(testId)
  }

  async gaps(options?: SpecScopeOptions): Promise<SerializedSpecGap[]> {
    return this.transport.specGaps(options)
  }

  async fci(options?: SpecScopeOptions): Promise<FciResult> {
    return this.transport.specFci(options)
  }

  async matrix(options?: SpecScopeOptions): Promise<SerializedTraceabilityMatrixEntry[]> {
    return this.transport.specMatrix(options)
  }

  async status(options?: SpecScopeOptions): Promise<SpecStatusResult> {
    return this.transport.specStatus(options)
  }

  async run(testId: string, passed: boolean, options?: { durationMs?: number | null; details?: string | null; runAt?: string }): Promise<SpecBatchRunResult> {
    return this.transport.specRun(testId, passed, options)
  }

  async batch(data: { results?: SpecBatchRunInput[]; raw?: string; from?: SpecBatchSource; runAt?: string }): Promise<SpecBatchRunResult> {
    return this.transport.specBatch(data)
  }

  async complete(options: { doc?: string; subsystem?: string; signedOffBy: string; notes?: string }): Promise<SerializedSpecSignoff> {
    return this.transport.specComplete(options)
  }
}

// =============================================================================
// Messages Namespace
// =============================================================================

/**
 * Messages namespace providing inter-agent communication operations.
 *
 * Messages use a channel-based model where agents send to named channels
 * and read from their inbox. Messages support correlation IDs for
 * request/response patterns and TTL-based expiry.
 *
 * @example
 * ```typescript
 * // Send a message
 * await tx.messages.send({ channel: 'agent-1', content: 'Task complete' })
 *
 * // Read inbox
 * const msgs = await tx.messages.inbox('agent-1')
 *
 * // Acknowledge
 * await tx.messages.ack(msgs[0].id)
 * ```
 */
class MessagesNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * Send a message to a channel.
   *
   * @param data - Message data including channel, content, and optional sender/TTL
   * @returns The created message
   * @example
   * ```typescript
   * const msg = await tx.messages.send({
   *   channel: 'worker-1',
   *   content: 'Please review task tx-abc123',
   *   sender: 'orchestrator',
   *   ttlSeconds: 3600
   * })
   * ```
   */
  async send(data: SendMessageData): Promise<SerializedMessage> {
    return this.transport.sendMessage(data)
  }

  /**
   * Read messages from a channel inbox.
   *
   * Returns unacknowledged messages by default. Use `includeAcked` to
   * also return acknowledged messages.
   *
   * @param channel - Channel name to read from
   * @param options - Filtering and pagination options
   * @returns Array of messages in the inbox
   * @example
   * ```typescript
   * const msgs = await tx.messages.inbox('agent-1', { limit: 10 })
   * const fromOrch = await tx.messages.inbox('agent-1', { sender: 'orchestrator' })
   * ```
   */
  async inbox(channel: string, options?: InboxOptions): Promise<SerializedMessage[]> {
    return this.transport.inbox(channel, options)
  }

  /**
   * Acknowledge a single message by ID.
   *
   * Acknowledged messages are excluded from future inbox reads by default.
   *
   * @param id - Message ID to acknowledge
   * @returns The acknowledged message
   * @example
   * ```typescript
   * const msg = await tx.messages.ack(42)
   * console.log(`Acked message from ${msg.sender}`)
   * ```
   */
  async ack(id: number): Promise<SerializedMessage> {
    return this.transport.ackMessage(id)
  }

  /**
   * Acknowledge all messages on a channel.
   *
   * @param channel - Channel to ack all messages on
   * @returns The channel name and number of messages acknowledged
   * @example
   * ```typescript
   * const { ackedCount } = await tx.messages.ackAll('agent-1')
   * console.log(`Cleared ${ackedCount} messages`)
   * ```
   */
  async ackAll(channel: string): Promise<{ channel: string; ackedCount: number }> {
    return this.transport.ackAllMessages(channel)
  }

  /**
   * Get the count of pending (unacknowledged) messages on a channel.
   *
   * @param channel - Channel to count pending messages for
   * @returns Number of pending messages
   * @example
   * ```typescript
   * const count = await tx.messages.pending('agent-1')
   * if (count > 0) console.log(`${count} messages waiting`)
   * ```
   */
  async pending(channel: string): Promise<number> {
    return this.transport.pendingCount(channel)
  }

  /**
   * Garbage collect expired and old acknowledged messages.
   *
   * @param options - GC options (e.g., age threshold for acked messages)
   * @returns Count of expired and acked messages removed
   * @example
   * ```typescript
   * const { expired, acked } = await tx.messages.gc({ ackedOlderThanHours: 24 })
   * console.log(`Cleaned up ${expired + acked} messages`)
   * ```
   */
  async gc(options?: GcOptions): Promise<GcResult> {
    return this.transport.gcMessages(options)
  }
}

// =============================================================================
// Claims Namespace
// =============================================================================

/**
 * Claims namespace providing worker coordination via lease-based task claiming.
 *
 * Claims prevent multiple agents from working on the same task simultaneously.
 * Each claim has a lease duration that auto-expires if not renewed.
 *
 * @example
 * ```typescript
 * // Claim a task for 30 minutes
 * const claim = await tx.claims.claim('tx-abc123', 'worker-1', 30)
 *
 * // Renew the lease
 * await tx.claims.renew('tx-abc123', 'worker-1')
 *
 * // Release when done
 * await tx.claims.release('tx-abc123', 'worker-1')
 * ```
 */
class ClaimsNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * Claim a task with a lease for exclusive access.
   *
   * @param taskId - Task ID to claim
   * @param workerId - Unique worker identifier
   * @param leaseDurationMinutes - Lease duration in minutes (default: server-defined)
   * @returns The created claim
   * @throws {TxError} If the task is already claimed by another worker
   * @example
   * ```typescript
   * const claim = await tx.claims.claim('tx-abc123', 'worker-1', 30)
   * console.log(`Lease expires at ${claim.leaseExpiresAt}`)
   * ```
   */
  async claim(taskId: string, workerId: string, leaseDurationMinutes?: number): Promise<SerializedClaim> {
    return this.transport.claimTask(taskId, workerId, leaseDurationMinutes)
  }

  /**
   * Release a claim on a task.
   *
   * @param taskId - Task ID to release
   * @param workerId - Worker releasing the claim
   * @example
   * ```typescript
   * await tx.claims.release('tx-abc123', 'worker-1')
   * ```
   */
  async release(taskId: string, workerId: string): Promise<void> {
    return this.transport.releaseClaim(taskId, workerId)
  }

  /**
   * Renew an existing claim's lease.
   *
   * @param taskId - Task ID whose claim to renew
   * @param workerId - Worker renewing the claim
   * @returns The renewed claim with updated lease expiry
   * @throws {TxError} If no active claim exists for this worker
   * @example
   * ```typescript
   * const renewed = await tx.claims.renew('tx-abc123', 'worker-1')
   * console.log(`New expiry: ${renewed.leaseExpiresAt}`)
   * ```
   */
  async renew(taskId: string, workerId: string): Promise<SerializedClaim> {
    return this.transport.renewClaim(taskId, workerId)
  }

  /**
   * Get the active claim for a task, if any.
   *
   * @param taskId - Task ID to check
   * @returns The active claim, or null if unclaimed
   * @example
   * ```typescript
   * const claim = await tx.claims.getActive('tx-abc123')
   * if (claim) console.log(`Claimed by ${claim.workerId}`)
   * ```
   */
  async getActive(taskId: string): Promise<SerializedClaim | null> {
    return this.transport.getActiveClaim(taskId)
  }
}

// =============================================================================
// Pins Namespace
// =============================================================================

/**
 * Namespace for context pin operations.
 *
 * Pins are named content blocks that sync to target files (e.g. CLAUDE.md)
 * as `<tx-pin id="...">` XML-tagged sections.
 */
class PinsNamespace {
  constructor(private readonly transport: Transport) {}

  /**
   * Create or update a context pin.
   *
   * @param id - Pin ID (kebab-case)
   * @param content - Pin content (markdown)
   * @returns The created/updated pin
   * @example
   * ```typescript
   * const pin = await tx.pins.set('auth-patterns', '## Auth\n- Use JWT')
   * ```
   */
  async set(id: string, content: string): Promise<SerializedPin> {
    return this.transport.setPin(id, content)
  }

  /**
   * Get a pin by ID.
   *
   * @param id - Pin ID
   * @returns The pin, or null if not found
   */
  async get(id: string): Promise<SerializedPin | null> {
    return this.transport.getPin(id)
  }

  /**
   * List all pins.
   *
   * @returns Array of all pins
   */
  async list(): Promise<SerializedPin[]> {
    return this.transport.listPins()
  }

  /**
   * Remove a pin from the database and all target files.
   *
   * @param id - Pin ID to remove
   * @returns Whether the pin existed and was deleted
   */
  async remove(id: string): Promise<{ deleted: boolean }> {
    return this.transport.removePin(id)
  }

  /**
   * Sync all pins to configured target files.
   *
   * Writes `<tx-pin>` blocks to each target file, creating files if needed.
   *
   * @returns List of synced file paths
   */
  async sync(): Promise<{ synced: string[] }> {
    return this.transport.syncPins()
  }

  /**
   * Get the list of target files pins sync to.
   *
   * @returns Array of file paths
   */
  async getTargets(): Promise<string[]> {
    return this.transport.getPinTargets()
  }

  /**
   * Set the target files pins sync to.
   *
   * @param files - Array of relative file paths
   * @returns The updated list of target files
   */
  async setTargets(files: string[]): Promise<string[]> {
    return this.transport.setPinTargets(files)
  }
}

// =============================================================================
// Memory Namespace
// =============================================================================

/**
 * Memory namespace for filesystem-backed .md document operations.
 *
 * @example
 * ```typescript
 * // Add a memory source
 * await tx.memory.sourceAdd('/path/to/notes')
 *
 * // Index documents
 * await tx.memory.index({ incremental: true })
 *
 * // Search
 * const results = await tx.memory.search({ query: 'authentication patterns' })
 * ```
 */
class MemoryNamespace {
  constructor(private readonly transport: Transport) {}

  async sourceAdd(dir: string, label?: string): Promise<SerializedMemorySource> { return this.transport.memorySourceAdd(dir, label) }
  async sourceRemove(dir: string): Promise<void> { return this.transport.memorySourceRemove(dir) }
  async sourceList(): Promise<SerializedMemorySource[]> { return this.transport.memorySourceList() }
  async add(data: CreateMemoryDocumentData): Promise<SerializedMemoryDocument> { return this.transport.memoryDocumentCreate(data) }
  async show(id: string): Promise<SerializedMemoryDocument> { return this.transport.memoryDocumentGet(id) }
  async list(options?: { source?: string; tags?: string[] }): Promise<SerializedMemoryDocument[]> { return this.transport.memoryDocumentList(options) }
  async search(options: MemorySearchOptions): Promise<SerializedMemoryDocumentWithScore[]> { return this.transport.memorySearch(options) }
  async index(options?: { incremental?: boolean }): Promise<MemoryIndexResult> { return this.transport.memoryIndex(options) }
  async indexStatus(): Promise<MemoryIndexStatus> { return this.transport.memoryIndexStatus() }
  async tag(id: string, tags: string[]): Promise<void> { return this.transport.memoryTagAdd(id, tags) }
  async untag(id: string, tags: string[]): Promise<void> { return this.transport.memoryTagRemove(id, tags) }
  async relate(id: string, target: string): Promise<void> { return this.transport.memoryRelate(id, target) }
  async set(id: string, key: string, value: string): Promise<void> { return this.transport.memoryPropertySet(id, key, value) }
  async unset(id: string, key: string): Promise<void> { return this.transport.memoryPropertyRemove(id, key) }
  async props(id: string): Promise<Record<string, string>> { return this.transport.memoryProperties(id) }
  async links(id: string): Promise<SerializedMemoryLink[]> { return this.transport.memoryLinks(id) }
  async backlinks(id: string): Promise<SerializedMemoryLink[]> { return this.transport.memoryBacklinks(id) }
  async link(sourceId: string, targetRef: string): Promise<void> { return this.transport.memoryLinkCreate(sourceId, targetRef) }
}

// =============================================================================
// Sync Namespace
// =============================================================================

/**
 * Sync namespace for stream-based sync operations.
 *
 * @example
 * ```typescript
 * // Export stream events
 * const { eventCount, path } = await tx.sync.export()
 *
 * // Check sync status
 * const status = await tx.sync.status()
 * ```
 */
class SyncNamespace {
  constructor(private readonly transport: Transport) {}

  async export(): Promise<SyncExportResult> { return this.transport.syncExport() }
  async import(): Promise<SyncImportResult> { return this.transport.syncImport() }
  async status(): Promise<SyncStatusResult> { return this.transport.syncStatus() }
  async stream(): Promise<SyncStreamInfoResult> { return this.transport.syncStream() }
  async hydrate(): Promise<SyncHydrateResult> { return this.transport.syncHydrate() }
}

// =============================================================================
// Docs Namespace
// =============================================================================

/**
 * Docs namespace for documentation-as-primitives operations.
 *
 * @example
 * ```typescript
 * // List all docs
 * const docs = await tx.docs.list()
 *
 * // Create a doc
 * const doc = await tx.docs.create({ kind: 'prd', name: 'my-feature', title: 'My Feature', yamlContent: '...' })
 * ```
 */
class DocsNamespace {
  constructor(private readonly transport: Transport) {}

  async list(options?: { kind?: string; status?: string }): Promise<SerializedDoc[]> { return this.transport.docsList(options) }
  async get(name: string): Promise<SerializedDoc> { return this.transport.docsGet(name) }
  async create(data: { kind: string; name: string; title: string; yamlContent: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc> { return this.transport.docsCreate(data) }
  async update(name: string, yamlContent: string): Promise<SerializedDoc> { return this.transport.docsUpdate(name, yamlContent) }
  async delete(name: string): Promise<void> { return this.transport.docsDelete(name) }
  async lock(name: string): Promise<SerializedDoc> { return this.transport.docsLock(name) }
  async link(fromName: string, toName: string, linkType?: string): Promise<SerializedDocLink> { return this.transport.docsLink(fromName, toName, linkType) }
  async render(name?: string): Promise<string[]> { return this.transport.docsRender(name) }
  async graph(): Promise<DocGraph> { return this.transport.docsGraph() }
}

// =============================================================================
// Invariants Namespace
// =============================================================================

/**
 * Invariants namespace for design-doc invariant tracking.
 *
 * @example
 * ```typescript
 * // List all invariants
 * const invariants = await tx.invariants.list()
 *
 * // Record a check result
 * await tx.invariants.record('INV-001', true, 'All assertions passed', 150)
 * ```
 */
class InvariantsNamespace {
  constructor(private readonly transport: Transport) {}

  async list(options?: { subsystem?: string; enforcement?: string }): Promise<SerializedInvariant[]> { return this.transport.invariantsList(options) }
  async get(id: string): Promise<SerializedInvariant> { return this.transport.invariantsGet(id) }
  async record(id: string, passed: boolean, details?: string, durationMs?: number): Promise<SerializedInvariantCheck> { return this.transport.invariantsRecord(id, passed, details, durationMs) }
}

// =============================================================================
// Cycles Namespace
// =============================================================================

/**
 * Cycles namespace for cycle-based issue discovery results.
 *
 * @example
 * ```typescript
 * // List past cycle runs
 * const cycles = await tx.cycles.list()
 *
 * // Get cycle details
 * const detail = await tx.cycles.get(cycles[0].id)
 * ```
 */
class CyclesNamespace {
  constructor(private readonly transport: Transport) {}

  async list(): Promise<SerializedCycleRun[]> { return this.transport.cyclesList() }
  async get(id: string): Promise<SerializedCycleDetail> { return this.transport.cyclesGet(id) }
  async delete(id: string): Promise<void> { return this.transport.cyclesDelete(id) }
  async deleteIssues(issueIds: string[]): Promise<{ success: boolean; deletedCount: number }> { return this.transport.cyclesDeleteIssues(issueIds) }
}

// =============================================================================
// Guards Namespace
// =============================================================================

class GuardsNamespace {
  constructor(private readonly transport: Transport) {}

  async set(options: { scope?: string; maxPending?: number; maxChildren?: number; maxDepth?: number; enforce?: boolean }): Promise<SerializedGuard> {
    return this.transport.guardSet(options)
  }
  async show(): Promise<SerializedGuard[]> { return this.transport.guardShow() }
  async clear(scope?: string): Promise<{ cleared: boolean }> { return this.transport.guardClear(scope) }
  async check(options?: { parentId?: string }): Promise<{ passed: boolean; warnings: string[] }> {
    return this.transport.guardCheck(options?.parentId)
  }
}

// =============================================================================
// Verify Namespace
// =============================================================================

class VerifyNamespace {
  constructor(private readonly transport: Transport) {}

  async set(taskId: string, cmd: string, schema?: string): Promise<{ message: string }> {
    return this.transport.verifySet(taskId, cmd, schema)
  }
  async show(taskId: string): Promise<{ cmd: string | null; schema: string | null }> {
    return this.transport.verifyShow(taskId)
  }
  async run(taskId: string, options?: { timeout?: number }): Promise<SerializedVerifyResult> {
    return this.transport.verifyRun(taskId, options)
  }
  async clear(taskId: string): Promise<{ message: string }> {
    return this.transport.verifyClear(taskId)
  }
}

// =============================================================================
// Reflect Namespace
// =============================================================================

class ReflectNamespace {
  constructor(private readonly transport: Transport) {}

  async run(options?: { sessions?: number; hours?: number; analyze?: boolean }): Promise<SerializedReflectResult> {
    return this.transport.reflect(options)
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * TX Client for task management, messaging, and worker coordination.
 *
 * Provides a simple, Promise-based API for managing tasks, learnings,
 * inter-agent messaging, and claim-based worker coordination.
 * Supports both HTTP API mode and direct SQLite access.
 *
 * @example
 * ```typescript
 * // HTTP mode
 * const tx = new TxClient({ apiUrl: 'http://localhost:3456' })
 *
 * // Get ready tasks
 * const ready = await tx.tasks.ready({ limit: 10 })
 *
 * // Create a task
 * const task = await tx.tasks.create({ title: 'Implement feature X' })
 *
 * // Mark complete
 * const { task: completed, nowReady } = await tx.tasks.done(task.id)
 *
 * // Add a learning
 * await tx.learnings.add({ content: 'Use pattern Y for Z' })
 *
 * // Get context for a task
 * const context = await tx.context.forTask(task.id)
 *
 * // Send a message to another agent
 * await tx.messages.send({ channel: 'worker-1', content: 'New task available' })
 *
 * // Claim a task for exclusive access
 * await tx.claims.claim(task.id, 'worker-1', 30)
 * ```
 */
export class TxClient {
  private readonly transport: Transport
  private readonly config: TxClientConfig

  /**
   * Task operations.
   */
  public readonly tasks: TasksNamespace

  /**
   * Learning operations.
   */
  public readonly learnings: LearningsNamespace

  /**
   * File learning operations.
   */
  public readonly fileLearnings: FileLearningsNamespace

  /**
   * Context operations.
   */
  public readonly context: ContextNamespace

  /**
   * Run heartbeat and stall-detection operations.
   */
  public readonly runs: RunsNamespace

  /**
   * Message operations for inter-agent communication.
   */
  public readonly messages: MessagesNamespace

  /**
   * Claim operations for worker coordination.
   */
  public readonly claims: ClaimsNamespace

  /**
   * Context pin operations.
   */
  public readonly pins: PinsNamespace

  /**
   * Memory document operations (filesystem-backed .md search).
   */
  public readonly memory: MemoryNamespace

  /**
   * Sync operations (stream event export/import).
   */
  public readonly sync: SyncNamespace

  /**
   * Documentation-as-primitives operations.
   */
  public readonly docs: DocsNamespace

  /**
   * Design-doc invariant tracking operations.
   */
  public readonly invariants: InvariantsNamespace

  /**
   * Spec traceability and FCI operations.
   */
  public readonly spec: SpecNamespace

  /**
   * Cycle-based issue discovery results.
   */
  public readonly cycles: CyclesNamespace

  /**
   * Guard operations for task creation limits.
   */
  public readonly guards: GuardsNamespace

  /**
   * Verify operations for machine-checkable done criteria.
   */
  public readonly verify: VerifyNamespace

  /**
   * Reflect operations for session retrospective.
   */
  public readonly reflect: ReflectNamespace

  /**
   * Create a new TxClient.
   *
   * @param config - Client configuration
   * @throws TxError if neither apiUrl nor dbPath is provided
   */
  constructor(config: TxClientConfig) {
    if (!config.apiUrl && !config.dbPath) {
      throw new TxError(
        "Either apiUrl or dbPath must be provided",
        "CONFIG_ERROR"
      )
    }

    this.config = config

    // Prefer direct mode if dbPath is provided
    if (config.dbPath) {
      this.transport = new DirectTransport(config)
    } else {
      this.transport = new HttpTransport(config)
    }

    // Initialize namespaces
    this.tasks = new TasksNamespace(this.transport)
    this.learnings = new LearningsNamespace(this.transport)
    this.fileLearnings = new FileLearningsNamespace(this.transport)
    this.context = new ContextNamespace(this.transport)
    this.runs = new RunsNamespace(this.transport)
    this.messages = new MessagesNamespace(this.transport)
    this.claims = new ClaimsNamespace(this.transport)
    this.pins = new PinsNamespace(this.transport)
    this.memory = new MemoryNamespace(this.transport)
    this.sync = new SyncNamespace(this.transport)
    this.docs = new DocsNamespace(this.transport)
    this.invariants = new InvariantsNamespace(this.transport)
    this.spec = new SpecNamespace(this.transport)
    this.cycles = new CyclesNamespace(this.transport)
    this.guards = new GuardsNamespace(this.transport)
    this.verify = new VerifyNamespace(this.transport)
    this.reflect = new ReflectNamespace(this.transport)
  }

  /**
   * Whether the client is using direct SQLite mode.
   *
   * Direct mode is selected when `dbPath` is provided in the config.
   * It requires `@tx/core` and `effect` as installed dependencies.
   */
  get isDirect(): boolean {
    return this.transport instanceof DirectTransport
  }

  /**
   * Whether the client is using HTTP API mode.
   *
   * HTTP mode is selected when only `apiUrl` is provided in the config.
   * Requires a running tx API server.
   */
  get isHttp(): boolean {
    return this.transport instanceof HttpTransport
  }

  /**
   * Get a read-only copy of the current client configuration.
   */
  get configuration(): Readonly<TxClientConfig> {
    return { ...this.config }
  }

  /**
   * Get queue statistics: task counts, ready count, and learnings count.
   *
   * @returns Stats with task, done, ready, and learnings counts
   * @example
   * ```typescript
   * const stats = await tx.stats()
   * console.log(`${stats.ready} tasks ready, ${stats.done}/${stats.tasks} done`)
   * ```
   */
  async stats(): Promise<StatsResult> {
    return this.transport.getStats()
  }

  /**
   * Dispose of resources and close the database connection.
   *
   * Only needed for direct mode. HTTP mode has no resources to dispose.
   * Safe to call multiple times. Uses reference counting so the
   * underlying runtime is only disposed when the last client disconnects.
   *
   * @example
   * ```typescript
   * const tx = new TxClient({ dbPath: '.tx/tasks.db' })
   * try {
   *   await tx.tasks.ready()
   * } finally {
   *   await tx.dispose()
   * }
   * ```
   */
  async dispose(): Promise<void> {
    if (this.transport instanceof DirectTransport) {
      await this.transport.dispose()
    }
  }
}

/**
 * @internal Test-only helper to inspect runtime cache state.
 * Not part of the public API.
 */
export function _testGetRuntimeCacheSize(): number {
  return runtimeCache.size
}

/**
 * @internal Test-only helper to clear runtime cache between tests.
 * Not part of the public API.
 */
export function _testClearRuntimeCache(): void {
  runtimeCache.clear()
  pendingInit.clear()
}

/**
 * @internal Test-only helper to inject a mock runtime into the cache
 * and set it on a DirectTransport (via TxClient). Returns the mock
 * runtime so tests can assert on dispose() call count.
 * Not part of the public API.
 */
export function _testInjectMockRuntime(
  client: TxClient,
  refCount: number
): { dispose: () => Promise<void>; disposeCallCount: () => number } {
  let calls = 0
  const mockRuntime = {
    dispose: async () => { calls++ },
    runPromise: async () => {},
  }
  const transport = (client as any).transport as DirectTransport
  const dbPath = (transport as any).dbPath as string
  ;(transport as any).runtime = mockRuntime
  runtimeCache.set(dbPath, { runtime: mockRuntime, refCount, core: {}, Effect: {} })
  return { dispose: mockRuntime.dispose, disposeCallCount: () => calls }
}
