import type { SpecHealth } from "@jamesaphoenix/tx"
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
 * const tx = new TxClient({
 *   stateRoot: '/path/to/main-repo',
 *   contentRoot: '/path/to/worktree',
 * })
 *
 * // Usage
 * const ready = await tx.tasks.ready({ limit: 10 })
 * const task = ready[0]
 * await tx.tasks.done(task.id)
 * ```
 */

import { dirname, resolve } from "node:path"
import type {
  TxClientConfig,
  ListOptions,
  ReadyOptions,
  SerializedTaskWithDeps,
  CompleteResult,
  PaginatedResponse,
  TaskStatus,
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
  DocGraph,
  StatsResult,
  SerializedDecision,
  CreateDecisionData,
  DecisionListOptions,
} from "./types.js"
import { buildUrl, normalizeApiUrl, parseApiError, TxError } from "./utils.js"

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
  deleteTask(id: string, options?: { cascade?: boolean }): Promise<void>
  completeTask(id: string): Promise<CompleteResult>
  readyTasks(options: ReadyOptions): Promise<SerializedTaskWithDeps[]>
  blockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps>
  unblockTask(id: string, blockerId: string): Promise<SerializedTaskWithDeps>
  getTaskTree(id: string): Promise<SerializedTaskWithDeps[]>

  // Sync
  syncExport(): Promise<SyncExportResult>
  syncImport(): Promise<SyncImportResult>
  syncStatus(): Promise<SyncStatusResult>
  syncStream(): Promise<SyncStreamInfoResult>
  syncHydrate(): Promise<SyncHydrateResult>

  // Docs
  docsList(options?: { kind?: string; status?: string }): Promise<SerializedDoc[]>
  docsGet(name: string): Promise<SerializedDoc>
  docsCreate(data: { kind: string; name: string; title: string; content: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc>
  docsUpdate(name: string, content: string): Promise<SerializedDoc>
  docsDelete(name: string): Promise<void>
  docsLock(name: string): Promise<SerializedDoc>
  docsLink(fromName: string, toName: string, linkType?: string): Promise<SerializedDocLink>
  docsRender(name?: string): Promise<string[]>

  // Invariants
  invariantsList(options?: { subsystem?: string; enforcement?: string }): Promise<SerializedInvariant[]>
  invariantsGet(id: string): Promise<SerializedInvariant>
  invariantsRecord(id: string, passed: boolean, details?: string, durationMs?: number): Promise<SerializedInvariantCheck>

  // Spec traceability
  specDiscover(options?: { doc?: string; patterns?: string[]; dryRun?: boolean; prune?: boolean }): Promise<DiscoverResult>
  specLink(invariantId: string, file: string, name?: string, framework?: string): Promise<SerializedSpecTest>
  specUnlink(invariantId: string, testId: string): Promise<{ removed: boolean }>
  specTests(invariantId: string): Promise<SerializedSpecTest[]>
  specInvariantsForTest(testId: string): Promise<string[]>
  specGaps(options?: SpecScopeOptions): Promise<SerializedSpecGap[]>
  specFci(options?: SpecScopeOptions): Promise<FciResult>
  specMatrix(options?: SpecScopeOptions): Promise<SerializedTraceabilityMatrixEntry[]>
  specHealth(): Promise<SpecHealth>
  specStatus(options?: SpecScopeOptions): Promise<SpecStatusResult>
  specRun(testId: string, passed: boolean, options?: { durationMs?: number | null; details?: string | null; runAt?: string }): Promise<SpecBatchRunResult>
  specBatch(data: { results?: SpecBatchRunInput[]; raw?: string; from?: SpecBatchSource; runAt?: string }): Promise<SpecBatchRunResult>
  specComplete(options: { doc?: string; subsystem?: string; signedOffBy: string; notes?: string }): Promise<SerializedSpecSignoff>

  // Docs (additional)
  docsGraph(): Promise<DocGraph>

  // Stats
  getStats(): Promise<StatsResult>

  // Decisions
  decisionAdd(data: CreateDecisionData): Promise<SerializedDecision>
  decisionList(options?: DecisionListOptions): Promise<SerializedDecision[]>
  decisionShow(id: string): Promise<SerializedDecision>
  decisionApprove(id: string, reviewer?: string, note?: string): Promise<SerializedDecision>
  decisionReject(id: string, reviewer?: string, reason?: string): Promise<SerializedDecision>
  decisionEdit(id: string, content: string, reviewer?: string): Promise<SerializedDecision>
  decisionPending(): Promise<SerializedDecision[]>
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

  async docsCreate(data: { kind: string; name: string; title: string; content: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc> {
    return await this.request<SerializedDoc>("POST", "/api/docs", { body: data })
  }

  async docsUpdate(name: string, content: string): Promise<SerializedDoc> {
    return await this.request<SerializedDoc>("PATCH", `/api/docs/${encodeURIComponent(name)}`, { body: { content } })
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

  async specDiscover(options?: { doc?: string; patterns?: string[]; dryRun?: boolean; prune?: boolean }): Promise<DiscoverResult> {
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

  async specHealth(): Promise<SpecHealth> { return this.request("GET", "/api/spec/health") }
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

  async docsGraph(): Promise<DocGraph> {
    return await this.request<DocGraph>("GET", "/api/docs/graph")
  }

  // Stats
  async getStats(): Promise<StatsResult> {
    return await this.request<StatsResult>("GET", "/api/stats")
  }

  // Decisions
  async decisionAdd(data: CreateDecisionData): Promise<SerializedDecision> {
    return await this.request<SerializedDecision>("POST", "/api/decisions", { body: data })
  }

  async decisionList(options?: DecisionListOptions): Promise<SerializedDecision[]> {
    const result = await this.request<{ decisions: SerializedDecision[] }>("GET", "/api/decisions", {
      params: {
        status: options?.status,
        source: options?.source,
        limit: options?.limit,
      },
    })
    return result.decisions
  }

  async decisionShow(id: string): Promise<SerializedDecision> {
    return await this.request<SerializedDecision>("GET", `/api/decisions/${id}`)
  }

  async decisionApprove(id: string, reviewer?: string, note?: string): Promise<SerializedDecision> {
    return await this.request<SerializedDecision>("POST", `/api/decisions/${id}/approve`, {
      body: { reviewer, note },
    })
  }

  async decisionReject(id: string, reviewer?: string, reason?: string): Promise<SerializedDecision> {
    return await this.request<SerializedDecision>("POST", `/api/decisions/${id}/reject`, {
      body: { reviewer, reason },
    })
  }

  async decisionEdit(id: string, content: string, reviewer?: string): Promise<SerializedDecision> {
    return await this.request<SerializedDecision>("POST", `/api/decisions/${id}/edit`, {
      body: { content, reviewer },
    })
  }

  async decisionPending(): Promise<SerializedDecision[]> {
    const result = await this.request<{ decisions: SerializedDecision[] }>("GET", "/api/decisions/pending")
    return result.decisions
  }
}

// =============================================================================
// Direct Transport (Optional - requires @tx/core)
// =============================================================================

/**
 * Module-level cache for ManagedRuntime instances.
 * Keyed by database path and content checkout so shared task state can retain
 * independent derived spec projections.
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

const resolveDirectDbPath = (dbPath: string): string =>
  dbPath === ":memory:" || dbPath.startsWith("file:")
    ? dbPath
    : resolve(dbPath)

/**
 * Direct SQLite transport using @tx/core.
 * Only available when @tx/core is installed and running on Bun runtime.
 */
class DirectTransport implements Transport {

  private runtime: any
  private dbPath: string
  private stateRoot?: string
  private contentRoot?: string
  private contentCwd: string
  private runtimeKey: string
  private runtimeRefCounted = false

  constructor(config: TxClientConfig) {
    if (!config.dbPath && !config.stateRoot) {
      throw new TxError("dbPath or stateRoot is required for direct transport", "CONFIG_ERROR")
    }
    this.contentCwd = process.cwd()
    this.stateRoot = config.stateRoot ? resolve(config.stateRoot) : undefined
    this.contentRoot = config.contentRoot ? resolve(config.contentRoot) : undefined
    this.dbPath = resolveDirectDbPath(
      config.dbPath ?? resolve(this.stateRoot!, ".tx", "tasks.db")
    )
    this.runtimeKey = JSON.stringify([
      this.dbPath,
      this.contentRoot ?? resolve(this.contentCwd),
    ])
  }

  private async ensureRuntime(): Promise<void> {
    if (this.runtime) return

    // Check if we already have a cached runtime for this dbPath
    const cached = runtimeCache.get(this.runtimeKey)
    if (cached) {
      if (!this.runtimeRefCounted) {
        cached.refCount++
        this.runtimeRefCounted = true
      }
      this.runtime = cached.runtime
      ;(this as any).Effect = cached.Effect
      ;(this as any).core = cached.core
      return
    }

    // Check if another call is already initializing this dbPath.
    // This prevents the TOCTOU race where concurrent ensureRuntime()
    // calls both miss the cache, both do async imports, and both
    // create separate runtimes — orphaning the first one.
    const pending = pendingInit.get(this.runtimeKey)
    if (pending) {
      const result = await pending
      // After the pending init resolves, the cache entry exists.
      // Only increment refCount once per transport instance - concurrent calls
      // on the same transport must not inflate the count.
      if (!this.runtimeRefCounted) {
        const nowCached = runtimeCache.get(this.runtimeKey)
        if (nowCached) {
          nowCached.refCount++
        }
        this.runtimeRefCounted = true
      }
      this.runtime = result.runtime
      ;(this as any).Effect = result.Effect
      ;(this as any).core = result.core
      return
    }

    // We are the first caller — create the initialization Promise
    // and store it so concurrent callers coalesce on it.
    const initPromise = this.initRuntime()
    pendingInit.set(this.runtimeKey, initPromise)

    try {
      const result = await initPromise
      this.runtime = result.runtime
      ;(this as any).Effect = result.Effect
      ;(this as any).core = result.core
      // initRuntime() already set refCount=1 for this transport in the cache
      this.runtimeRefCounted = true
    } finally {
      pendingInit.delete(this.runtimeKey)
    }
  }

  /**
   * Perform the actual runtime initialization. Separated from ensureRuntime()
   * so the Promise can be stored in pendingInit for deduplication.
   */
  private async initRuntime(): Promise<{ runtime: any; core: any; Effect: any }> {
    try {
      // Dynamic import to make @tx/core optional
      const core = await import("@jamesaphoenix/tx")
      const { Effect, ManagedRuntime } = await import("effect")

      const workspace = core.resolveWorkspaceContext({
        cwd: this.contentCwd,
        stateRoot: this.stateRoot,
        contentRoot: this.contentRoot,
        dbPath: this.dbPath,
      })
      const layer = core.makeAppLayer(workspace.dbPath, {
        contentRoot: workspace.contentRoot,
        projection: workspace,
      })
      const runtime = ManagedRuntime.make(layer)

      // Cache the runtime for reuse by other clients
      runtimeCache.set(this.runtimeKey, { runtime, refCount: 1, core, Effect })

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
      linkedDocs: Array.isArray(task.linkedDocs) ? task.linkedDocs.map((doc: any) => ({
        docId: doc.docId,
        name: doc.name,
        title: doc.title,
        kind: doc.kind,
        version: doc.version,
        status: doc.status,
        filePath: doc.filePath,
        linkType: doc.linkType,
      })) : [],
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

  private serializeDoc(doc: any): SerializedDoc {
    return {
      id: doc.id,
      docId: doc.docId,
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

  async docsGet(ref: string): Promise<SerializedDoc> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.get(ref)
      })
    )

    return self.serializeDoc(doc)
  }

  async docsCreate(data: { kind: string; name: string; title: string; content: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc> {
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

  async docsUpdate(ref: string, content: string): Promise<SerializedDoc> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.update(ref, content)
      })
    )

    return self.serializeDoc(doc)
  }

  async docsDelete(ref: string): Promise<void> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        yield* docService.remove(ref)
      })
    )
  }

  async docsLock(ref: string): Promise<SerializedDoc> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core
    const self = this

    const doc = await this.run(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        return yield* docService.lock(ref)
      })
    )

    return self.serializeDoc(doc)
  }

  async docsLink(fromRef: string, toRef: string, linkType?: string): Promise<SerializedDocLink> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedDocLink>(
      Effect.gen(function* () {
        const docService = yield* core.DocService
        const link = yield* docService.linkDocs(fromRef, toRef, linkType as any)
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
  async specDiscover(options?: { doc?: string; patterns?: string[]; dryRun?: boolean; prune?: boolean }): Promise<DiscoverResult> {
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

  async specHealth(): Promise<SpecHealth> { await this.ensureRuntime(); return this.run((this as any).core.getSpecHealth()) }
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

  // Stats
  async getStats(): Promise<StatsResult> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<StatsResult>(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        const readyService = yield* core.ReadyService

        const allTasks = yield* taskService.count({})
        const doneTasks = yield* taskService.count({ status: "done" })
        const readyTasks = yield* readyService.getReady(1000)
        return {
          tasks: allTasks,
          done: doneTasks,
          ready: (readyTasks as any[]).length,
        }
      })
    )
  }

  // Decisions
  private serializeDecisionDirect(d: any): SerializedDecision {
    return {
      id: d.id,
      content: d.content,
      question: d.question,
      status: d.status,
      source: d.source,
      commitSha: d.commitSha,
      runId: d.runId,
      taskId: d.taskId,
      docId: d.docId,
      invariantId: d.invariantId,
      reviewedBy: d.reviewedBy,
      reviewNote: d.reviewNote,
      editedContent: d.editedContent,
      reviewedAt: d.reviewedAt instanceof Date ? d.reviewedAt.toISOString() : d.reviewedAt,
      contentHash: d.contentHash,
      supersededBy: d.supersededBy,
      syncedToDoc: d.syncedToDoc,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
      updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : d.updatedAt,
    }
  }

  async decisionAdd(data: CreateDecisionData): Promise<SerializedDecision> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<SerializedDecision>(
      Effect.gen(function* () {
        const svc = yield* core.DecisionService
        return yield* svc.add({
          content: data.content,
          question: data.question ?? null,
          source: data.source ?? "manual",
          taskId: data.taskId ?? null,
          docId: data.docId ?? null,
          commitSha: data.commitSha ?? null,
        })
      })
    ).then((d: any) => this.serializeDecisionDirect(d))
  }

  async decisionList(options?: DecisionListOptions): Promise<SerializedDecision[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<any[]>(
      Effect.gen(function* () {
        const svc = yield* core.DecisionService
        return yield* svc.list({
          status: options?.status,
          source: options?.source,
          limit: options?.limit,
        })
      })
    ).then((ds: any[]) => ds.map((d) => this.serializeDecisionDirect(d)))
  }

  async decisionShow(id: string): Promise<SerializedDecision> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<any>(
      Effect.gen(function* () {
        const svc = yield* core.DecisionService
        return yield* svc.show(id)
      })
    ).then((d: any) => this.serializeDecisionDirect(d))
  }

  async decisionApprove(id: string, reviewer?: string, note?: string): Promise<SerializedDecision> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<any>(
      Effect.gen(function* () {
        const svc = yield* core.DecisionService
        return yield* svc.approve(id, reviewer, note)
      })
    ).then((d: any) => this.serializeDecisionDirect(d))
  }

  async decisionReject(id: string, reviewer?: string, reason?: string): Promise<SerializedDecision> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<any>(
      Effect.gen(function* () {
        const svc = yield* core.DecisionService
        return yield* svc.reject(id, reviewer, reason)
      })
    ).then((d: any) => this.serializeDecisionDirect(d))
  }

  async decisionEdit(id: string, content: string, reviewer?: string): Promise<SerializedDecision> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<any>(
      Effect.gen(function* () {
        const svc = yield* core.DecisionService
        return yield* svc.edit(id, content, reviewer)
      })
    ).then((d: any) => this.serializeDecisionDirect(d))
  }

  async decisionPending(): Promise<SerializedDecision[]> {
    await this.ensureRuntime()
    const Effect = (this as any).Effect
    const core = (this as any).core

    return await this.run<any[]>(
      Effect.gen(function* () {
        const svc = yield* core.DecisionService
        return yield* svc.pending()
      })
    ).then((ds: any[]) => ds.map((d) => this.serializeDecisionDirect(d)))
  }

  /**
   * Dispose of the runtime and release resources.
   * Only actually disposes when all clients using this database and content
   * checkout have disposed.
   *
   * Safe against concurrent calls: `this.runtime` is nulled synchronously
   * before any await, so a second call immediately sees null and returns.
   */
  async dispose(): Promise<void> {
    const rt = this.runtime
    if (!rt) return

    // Null immediately so concurrent calls are idempotent from this tick.
    this.runtime = null

    const cached = runtimeCache.get(this.runtimeKey)
    if (cached) {
      cached.refCount--
      if (cached.refCount <= 0) {
        // Last client - actually dispose the runtime
        runtimeCache.delete(this.runtimeKey)
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
 * Spec traceability namespace for invariant-to-test mapping and FCI scoring.
 */
class SpecNamespace {
  health(): Promise<SpecHealth> { return this.transport.specHealth() }
  constructor(private readonly transport: Transport) {}

  async discover(options?: { doc?: string; patterns?: string[]; dryRun?: boolean; prune?: boolean }): Promise<DiscoverResult> {
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
 * const doc = await tx.docs.create({ kind: 'prd', name: 'my-feature', title: 'My Feature', content: '...' })
 * ```
 */
class DocsNamespace {
  constructor(private readonly transport: Transport) {}

  async list(options?: { kind?: string; status?: string }): Promise<SerializedDoc[]> { return this.transport.docsList(options) }
  async get(name: string): Promise<SerializedDoc> { return this.transport.docsGet(name) }
  async create(data: { kind: string; name: string; title: string; content: string; metadata?: Record<string, unknown> }): Promise<SerializedDoc> { return this.transport.docsCreate(data) }
  async update(name: string, content: string): Promise<SerializedDoc> { return this.transport.docsUpdate(name, content) }
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
// Decisions Namespace
// =============================================================================

/**
 * Namespace for decision lifecycle operations.
 *
 * Decisions are first-class artifacts in the spec-driven development triangle.
 * They capture implementation choices, support review workflows, and sync to docs.
 */
class DecisionsNamespace {
  constructor(private readonly transport: Transport) {}

  async add(data: CreateDecisionData): Promise<SerializedDecision> {
    return this.transport.decisionAdd(data)
  }

  async list(options?: DecisionListOptions): Promise<SerializedDecision[]> {
    return this.transport.decisionList(options)
  }

  async show(id: string): Promise<SerializedDecision> {
    return this.transport.decisionShow(id)
  }

  async approve(id: string, reviewer?: string, note?: string): Promise<SerializedDecision> {
    return this.transport.decisionApprove(id, reviewer, note)
  }

  async reject(id: string, reviewer?: string, reason?: string): Promise<SerializedDecision> {
    return this.transport.decisionReject(id, reviewer, reason)
  }

  async edit(id: string, content: string, reviewer?: string): Promise<SerializedDecision> {
    return this.transport.decisionEdit(id, content, reviewer)
  }

  async pending(): Promise<SerializedDecision[]> {
    return this.transport.decisionPending()
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * TX Client for tasks, documents and specification verification.
 *
 * Provides a Promise-based API for tasks, docs, decisions and spec evidence.
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
   * Decision lifecycle operations (spec-driven development triangle).
   */
  public readonly decisions: DecisionsNamespace

  /**
   * Create a new TxClient.
   *
   * @param config - Client configuration
   * @throws TxError if neither apiUrl nor direct-mode state is provided
   */
  constructor(config: TxClientConfig) {
    if (!config.apiUrl && !config.dbPath && !config.stateRoot) {
      throw new TxError(
        "Either apiUrl, dbPath, or stateRoot must be provided",
        "CONFIG_ERROR"
      )
    }

    this.config = config

    // Prefer direct mode if dbPath is provided
    if (config.dbPath || config.stateRoot) {
      this.transport = new DirectTransport(config)
    } else {
      this.transport = new HttpTransport(config)
    }

    // Initialize namespaces
    this.tasks = new TasksNamespace(this.transport)
    this.sync = new SyncNamespace(this.transport)
    this.docs = new DocsNamespace(this.transport)
    this.invariants = new InvariantsNamespace(this.transport)
    this.spec = new SpecNamespace(this.transport)
    this.decisions = new DecisionsNamespace(this.transport)
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
   * @returns Task, done and ready counts
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
  const runtimeKey = (transport as any).runtimeKey as string
  ;(transport as any).runtime = mockRuntime
  runtimeCache.set(runtimeKey, { runtime: mockRuntime, refCount, core: {}, Effect: {} })
  return { dispose: mockRuntime.dispose, disposeCallCount: () => calls }
}
