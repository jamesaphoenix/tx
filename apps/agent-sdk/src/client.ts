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
  deleteTask(id: string): Promise<void>
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

  async deleteTask(id: string): Promise<void> {
    await this.request<{ success: boolean }>("DELETE", `/api/tasks/${id}`)
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

    try {
      // Dynamic import to make @tx/core optional
      const core = await import("@jamesaphoenix/tx-core")
      const { Effect, ManagedRuntime } = await import("effect")

      const layer = core.makeAppLayer(this.dbPath)
      this.runtime = ManagedRuntime.make(layer)

      // Store Effect for running operations
       
      ;(this as any).Effect = Effect
       
      ;(this as any).core = core
    } catch {
      throw new TxError(
        "Direct mode requires @tx/core and effect packages. Install them or use apiUrl for HTTP mode.",
        "MISSING_DEPENDENCY"
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

    // Normalize status to array for consistent handling
    const statusArray = options.status
      ? (Array.isArray(options.status) ? options.status : [options.status])
      : []

    // If single status, pass to service for efficiency
    // If multiple statuses, fetch all and filter locally
    const serviceStatus = statusArray.length === 1 ? statusArray[0] : undefined

     
    const tasks = await this.run<any[]>(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        return yield* taskService.listWithDeps({ status: serviceStatus })
      })
    )

    // Apply status filter if multiple statuses provided
     
    let filtered = statusArray.length > 1
      ? tasks.filter((t: any) => statusArray.includes(t.status))
      : tasks
    if (options.search) {
      const searchLower = options.search.toLowerCase()
       
      filtered = tasks.filter((t: any) =>
        t.title.toLowerCase().includes(searchLower) ||
        t.description.toLowerCase().includes(searchLower)
      )
    }

    // Sort by score DESC
     
    filtered.sort((a: any, b: any) => b.score - a.score)

    // Apply pagination
    const limit = options.limit ?? 20
    const paginated = filtered.slice(0, limit + 1)
    const hasMore = paginated.length > limit
    const resultTasks = hasMore ? paginated.slice(0, limit) : paginated

    return {
      items: resultTasks.map((t: unknown) => this.serializeTask(t)),
      nextCursor: hasMore && resultTasks.length > 0
        ? `${resultTasks[resultTasks.length - 1].score}:${resultTasks[resultTasks.length - 1].id}`
        : null,
      hasMore,
      total: filtered.length
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

  async deleteTask(id: string): Promise<void> {
    await this.ensureRuntime()
     
    const Effect = (this as any).Effect
     
    const core = (this as any).core

    await this.run(
      Effect.gen(function* () {
        const taskService = yield* core.TaskService
        yield* taskService.remove(id)
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
   */
  async dispose(): Promise<void> {
    if (this.runtime) {
      await this.runtime.dispose()
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
   */
  async list(options: ListOptions = {}): Promise<PaginatedResponse<SerializedTaskWithDeps>> {
    return this.transport.listTasks(options)
  }

  /**
   * Get a task by ID.
   */
  async get(id: string): Promise<SerializedTaskWithDeps> {
    return this.transport.getTask(id)
  }

  /**
   * Create a new task.
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
   * Update a task.
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
   * Delete a task.
   */
  async delete(id: string): Promise<void> {
    return this.transport.deleteTask(id)
  }

  /**
   * Mark a task as done.
   * Returns the completed task and any tasks that became ready.
   */
  async done(id: string): Promise<CompleteResult> {
    return this.transport.completeTask(id)
  }

  /**
   * Get ready tasks (no incomplete blockers).
   */
  async ready(options: ReadyOptions = {}): Promise<SerializedTaskWithDeps[]> {
    return this.transport.readyTasks(options)
  }

  /**
   * Add a blocker dependency.
   * The blockerId task must be completed before the id task can be worked on.
   */
  async block(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    return this.transport.blockTask(id, blockerId)
  }

  /**
   * Remove a blocker dependency.
   */
  async unblock(id: string, blockerId: string): Promise<SerializedTaskWithDeps> {
    return this.transport.unblockTask(id, blockerId)
  }

  /**
   * Get the task tree (task and all descendants).
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
   */
  async search(options: SearchLearningsOptions = {}): Promise<SerializedLearningWithScore[]> {
    return this.transport.searchLearnings(options)
  }

  /**
   * Get a learning by ID.
   */
  async get(id: number): Promise<SerializedLearning> {
    return this.transport.getLearning(id)
  }

  /**
   * Create a new learning.
   */
  async add(data: CreateLearningData): Promise<SerializedLearning> {
    return this.transport.createLearning(data)
  }

  /**
   * Record that a learning was helpful.
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
   * List file learnings, optionally filtering by path.
   */
  async list(path?: string): Promise<SerializedFileLearning[]> {
    return this.transport.listFileLearnings(path)
  }

  /**
   * Recall file learnings matching a specific file path.
   */
  async recall(path: string): Promise<SerializedFileLearning[]> {
    return this.transport.listFileLearnings(path)
  }

  /**
   * Create a file learning.
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
   * Uses the task's title and description to find relevant learnings.
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
   * Check if the client is using direct SQLite mode.
   */
  get isDirect(): boolean {
    return this.transport instanceof DirectTransport
  }

  /**
   * Check if the client is using HTTP API mode.
   */
  get isHttp(): boolean {
    return this.transport instanceof HttpTransport
  }

  /**
   * Get the current configuration.
   */
  get configuration(): Readonly<TxClientConfig> {
    return { ...this.config }
  }

  /**
   * Dispose of resources (only needed for direct mode).
   */
  async dispose(): Promise<void> {
    if (this.transport instanceof DirectTransport) {
      await this.transport.dispose()
    }
  }
}
