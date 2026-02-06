/**
 * @tx/agent-sdk Client
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
  TaskStatus
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
  createTask(data: { title: string; description?: string; parentId?: string; score?: number; metadata?: Record<string, unknown> }): Promise<SerializedTaskWithDeps>
  updateTask(id: string, data: { title?: string; description?: string; status?: TaskStatus; parentId?: string | null; score?: number; metadata?: Record<string, unknown> }): Promise<SerializedTaskWithDeps>
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
      "Content-Type": "application/json"
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
        throw await parseApiError(response)
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
      { params: { limit: options.limit } }
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

    try {
      // Dynamic import to make @tx/core optional
      const core = await import("@jamesaphoenix/tx-core")
      const { Effect, ManagedRuntime } = await import("effect")

      const layer = core.makeAppLayer(this.dbPath)
      const runtime = ManagedRuntime.make(layer)

      // Cache the runtime for reuse by other clients
      runtimeCache.set(this.dbPath, { runtime, refCount: 1, core, Effect })

      this.runtime = runtime

      // Store Effect for running operations

      ;(this as any).Effect = Effect

      ;(this as any).core = core
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
      completedAt: task.completedAt instanceof Date ? task.completedAt.toISOString() : task.completedAt,
      metadata: task.metadata,
      blockedBy: task.blockedBy,
      blocks: task.blocks,
      children: task.children,
      isReady: task.isReady
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
      lastUsedAt: learning.lastUsedAt instanceof Date ? learning.lastUsedAt.toISOString() : learning.lastUsedAt,
      outcomeScore: learning.outcomeScore
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
      rerankerScore: learning.rerankerScore
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
      metadata?: Record<string, unknown>
    }
  ): Promise<SerializedTaskWithDeps> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    const task = await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        yield* taskService.update(id, data)
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
        yield* taskService.update(id, { status: "done" })

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

    const tasks = await this.run(
      Effect.gen(function* () {
        const readyService = yield* core.ReadyService
        return yield* readyService.getReady(options.limit ?? 100)
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

  /**
   * Dispose of the runtime and release resources.
   * Only actually disposes when all clients using this dbPath have disposed.
   */
  async dispose(): Promise<void> {
    if (this.runtime) {
      const cached = runtimeCache.get(this.dbPath)
      if (cached) {
        cached.refCount--
        if (cached.refCount <= 0) {
          // Last client - actually dispose the runtime
          runtimeCache.delete(this.dbPath)
          await this.runtime.dispose()
        }
      }
      this.runtime = null
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
   * @returns Array of ready tasks with dependency information
   * @example
   * ```typescript
   * const ready = await tx.tasks.ready({ limit: 5 })
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

// =============================================================================
// Main Client
// =============================================================================

/**
 * TX Client for task management.
 *
 * Provides a simple, Promise-based API for managing tasks and learnings.
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
