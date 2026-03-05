import { describe, it, expect } from "vitest"
import { Context, Effect, Layer } from "effect"
import {
  DatabaseError,
  RetrievalError,
  LearningRepository,
  AttemptRepository,
  FileLearningRepository,
  TaskRepository,
  LearningServiceLive,
  LearningService,
  AttemptServiceLive,
  AttemptService,
  FileLearningServiceLive,
  FileLearningService,
  EmbeddingServiceNoop,
  AutoSyncServiceNoop,
  QueryExpansionServiceNoop,
  RerankerServiceNoop,
  RetrieverServiceNoop,
  RetrieverService
} from "@jamesaphoenix/tx-core"
import { FIXTURES } from "../fixtures.js"
import type { AttemptId, FileLearning, FileLearningId, Task } from "@jamesaphoenix/tx-types"

/**
 * Database Error Handling Tests
 *
 * These tests verify that services correctly propagate DatabaseError when
 * repository operations fail. We use mock repositories that throw errors
 * to trigger the Effect.tryPromise catch blocks.
 */

const testDbError = new DatabaseError({ cause: new Error("Simulated database failure") })

/** Mock task that exists for validations */
const mockTask: Task = {
  id: FIXTURES.TASK_JWT,
  title: "JWT validation",
  description: "Test task",
  status: "ready",
  score: 700,
  parentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  assigneeType: null,
  assigneeId: null,
  assignedAt: null,
  assignedBy: null,
  metadata: {}
}

const baseLearningRepository: Context.Tag.Service<typeof LearningRepository> = {
  insert: (_input) => Effect.fail(testDbError),
  findById: (_id) => Effect.succeed(null),
  findAll: (_limit) => Effect.succeed([]),
  findPaginated: (_limit, _afterId) => Effect.succeed([]),
  findWithoutEmbeddingPaginated: (_limit, _afterId) => Effect.succeed([]),
  findRecent: (_limit) => Effect.succeed([]),
  findRecentWithoutEmbedding: (_limit) => Effect.succeed([]),
  bm25Search: (_query, _limit) => Effect.succeed([]),
  findWithEmbeddings: (_limit) => Effect.succeed([]),
  incrementUsage: (_id) => Effect.void,
  incrementUsageMany: (_ids) => Effect.void,
  updateOutcomeScore: (_id, _score) => Effect.void,
  updateEmbedding: (_id, _embedding) => Effect.void,
  remove: (_id) => Effect.void,
  count: () => Effect.succeed(0),
  countWithEmbeddings: () => Effect.succeed(0),
  countWithoutEmbeddings: () => Effect.succeed(0),
  getConfig: (_key) => Effect.succeed(null)
}

const baseTaskRepository: Context.Tag.Service<typeof TaskRepository> = {
  findById: (_id) => Effect.succeed(null),
  findByIds: (_ids) => Effect.succeed([]),
  findAll: (_filter) => Effect.succeed([]),
  findByParent: (_parentId) => Effect.succeed([]),
  getChildIds: (_id) => Effect.succeed([]),
  getChildIdsForMany: (_ids) => Effect.succeed(new Map()),
  getAncestorChain: (_id) => Effect.succeed([]),
  getDescendants: (_id, _maxDepth) => Effect.succeed([]),
  getGroupContextForMany: (_ids) => Effect.succeed(new Map()),
  resolveEffectiveGroupContextForMany: (_ids) => Effect.succeed(new Map()),
  insert: (_task) => Effect.void,
  update: (_task, _expectedUpdatedAt) => Effect.void,
  updateMany: (_tasks) => Effect.void,
  setGroupContext: (_taskId, _context) => Effect.void,
  clearGroupContext: (_taskId) => Effect.void,
  remove: (_id) => Effect.void,
  count: (_filter) => Effect.succeed(0),
  recoverTaskStatus: (_taskId, _expectedStatus) => Effect.succeed(false),
  updateVerifyCmd: (_taskId, _cmd, _schema) => Effect.void,
  getVerifyCmd: (_taskId) => Effect.succeed({ cmd: null, schema: null })
}

// ========================================================================
// LearningService Database Error Tests
// ========================================================================

describe("LearningService Database Error Handling", () => {
  describe("create", () => {
    it("propagates DatabaseError from repository insert", async () => {
      const mockLearningRepo = Layer.succeed(LearningRepository, {
        ...baseLearningRepository
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository
      })

      const layer = LearningServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockLearningRepo, mockTaskRepo, EmbeddingServiceNoop, AutoSyncServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, RetrieverServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.create({ content: "Test learning" })
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("search", () => {
    it("propagates RetrievalError from RetrieverService", async () => {
      const testRetrievalError = new RetrievalError({ reason: "Simulated retrieval failure" })

      const mockLearningRepo = Layer.succeed(LearningRepository, {
        ...baseLearningRepository
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository
      })

      // Mock RetrieverService that fails on search
      const mockRetrieverService = Layer.succeed(RetrieverService, {
        search: () => Effect.fail(testRetrievalError),
        isAvailable: () => Effect.succeed(false)
      })

      const layer = LearningServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockLearningRepo, mockTaskRepo, EmbeddingServiceNoop, AutoSyncServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, mockRetrieverService))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.search({ query: "test query", limit: 10, minScore: 0 })
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("RetrievalError")
      }
    })
  })

  describe("get", () => {
    it("propagates DatabaseError from findById", async () => {
      const mockLearningRepo = Layer.succeed(LearningRepository, {
        ...baseLearningRepository,
        findById: () => Effect.fail(testDbError),
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository
      })

      const layer = LearningServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockLearningRepo, mockTaskRepo, EmbeddingServiceNoop, AutoSyncServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, RetrieverServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.get(1)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("count", () => {
    it("propagates DatabaseError from count", async () => {
      const mockLearningRepo = Layer.succeed(LearningRepository, {
        ...baseLearningRepository,
        count: () => Effect.fail(testDbError),
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository
      })

      const layer = LearningServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockLearningRepo, mockTaskRepo, EmbeddingServiceNoop, AutoSyncServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, RetrieverServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* LearningService
          return yield* svc.count()
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })
})

// ========================================================================
// AttemptService Database Error Tests
// ========================================================================

describe("AttemptService Database Error Handling", () => {
  describe("create", () => {
    it("propagates DatabaseError from repository insert", async () => {
      const mockAttemptRepo = Layer.succeed(AttemptRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findByTaskId: () => Effect.succeed([]),
        count: () => Effect.succeed(0),
        remove: () => Effect.void,
        findAll: () => Effect.succeed([]),
        getFailedCountsForTasks: () => Effect.succeed(new Map())
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository,
        findById: () => Effect.succeed(mockTask)
      })

      const layer = AttemptServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockAttemptRepo, mockTaskRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.create(FIXTURES.TASK_JWT, "Test approach", "failed")
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })

    it("propagates DatabaseError when validating task existence", async () => {
      const mockAttemptRepo = Layer.succeed(AttemptRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findByTaskId: () => Effect.succeed([]),
        count: () => Effect.succeed(0),
        remove: () => Effect.void,
        findAll: () => Effect.succeed([]),
        getFailedCountsForTasks: () => Effect.succeed(new Map())
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository,
        findById: () => Effect.fail(testDbError),
      })

      const layer = AttemptServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockAttemptRepo, mockTaskRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.create(FIXTURES.TASK_JWT, "Test approach", "failed")
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("listForTask", () => {
    it("propagates DatabaseError from findByTaskId", async () => {
      const mockAttemptRepo = Layer.succeed(AttemptRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findByTaskId: () => Effect.fail(testDbError),
        count: () => Effect.succeed(0),
        remove: () => Effect.void,
        findAll: () => Effect.succeed([]),
        getFailedCountsForTasks: () => Effect.succeed(new Map())
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository,
        findById: () => Effect.succeed(mockTask)
      })

      const layer = AttemptServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockAttemptRepo, mockTaskRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.listForTask(FIXTURES.TASK_JWT)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("get", () => {
    it("propagates DatabaseError from findById", async () => {
      const mockAttemptRepo = Layer.succeed(AttemptRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.fail(testDbError),
        findByTaskId: () => Effect.succeed([]),
        count: () => Effect.succeed(0),
        remove: () => Effect.void,
        findAll: () => Effect.succeed([]),
        getFailedCountsForTasks: () => Effect.succeed(new Map())
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository,
        findById: () => Effect.succeed(mockTask)
      })

      const layer = AttemptServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockAttemptRepo, mockTaskRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.get(1 as AttemptId)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("getFailedCount", () => {
    it("propagates DatabaseError from findByTaskId", async () => {
      const mockAttemptRepo = Layer.succeed(AttemptRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findByTaskId: () => Effect.fail(testDbError),
        count: () => Effect.succeed(0),
        remove: () => Effect.void,
        findAll: () => Effect.succeed([]),
        getFailedCountsForTasks: () => Effect.succeed(new Map())
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        ...baseTaskRepository,
        findById: () => Effect.succeed(mockTask)
      })

      const layer = AttemptServiceLive.pipe(
        Layer.provide(Layer.mergeAll(mockAttemptRepo, mockTaskRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.getFailedCount(FIXTURES.TASK_JWT)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })
})

// ========================================================================
// FileLearningService Database Error Tests
// ========================================================================

describe("FileLearningService Database Error Handling", () => {
  describe("create", () => {
    it("propagates DatabaseError from repository insert", async () => {
      const mockFileLearningRepo = Layer.succeed(FileLearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findAll: () => Effect.succeed([]),
        findByPath: () => Effect.succeed([]),
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
      })

      const layer = FileLearningServiceLive.pipe(
        Layer.provide(Layer.merge(mockFileLearningRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.create({ filePattern: "src/*.ts", note: "Test note" })
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("recall", () => {
    it("propagates DatabaseError from findByPath", async () => {
      const mockFileLearningRepo = Layer.succeed(FileLearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findAll: () => Effect.succeed([]),
        findByPath: () => Effect.fail(testDbError),
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
      })

      const layer = FileLearningServiceLive.pipe(
        Layer.provide(Layer.merge(mockFileLearningRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.recall("src/db.ts")
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("get", () => {
    it("propagates DatabaseError from findById", async () => {
      const mockFileLearningRepo = Layer.succeed(FileLearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.fail(testDbError),
        findAll: () => Effect.succeed([]),
        findByPath: () => Effect.succeed([]),
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
      })

      const layer = FileLearningServiceLive.pipe(
        Layer.provide(Layer.merge(mockFileLearningRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.get(1)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("getAll", () => {
    it("propagates DatabaseError from findAll", async () => {
      const mockFileLearningRepo = Layer.succeed(FileLearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findAll: () => Effect.fail(testDbError),
        findByPath: () => Effect.succeed([]),
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
      })

      const layer = FileLearningServiceLive.pipe(
        Layer.provide(Layer.merge(mockFileLearningRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.getAll()
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("count", () => {
    it("propagates DatabaseError from count", async () => {
      const mockFileLearningRepo = Layer.succeed(FileLearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findAll: () => Effect.succeed([]),
        findByPath: () => Effect.succeed([]),
        remove: () => Effect.void,
        count: () => Effect.fail(testDbError)
      })

      const layer = FileLearningServiceLive.pipe(
        Layer.provide(Layer.merge(mockFileLearningRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.count()
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })

  describe("remove", () => {
    it("propagates DatabaseError when checking existence", async () => {
      const mockFileLearningRepo = Layer.succeed(FileLearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.fail(testDbError),
        findAll: () => Effect.succeed([]),
        findByPath: () => Effect.succeed([]),
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
      })

      const layer = FileLearningServiceLive.pipe(
        Layer.provide(Layer.merge(mockFileLearningRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.remove(1)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })

    it("propagates DatabaseError from remove operation", async () => {
      const mockFileLearning: FileLearning = {
        id: 1 as unknown as FileLearningId,
        filePattern: "src/*.ts",
        note: "Test note",
        taskId: null,
        createdAt: new Date()
      }

      const mockFileLearningRepo = Layer.succeed(FileLearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(mockFileLearning),
        findAll: () => Effect.succeed([]),
        findByPath: () => Effect.succeed([]),
        remove: () => Effect.fail(testDbError),
        count: () => Effect.succeed(0)
      })

      const layer = FileLearningServiceLive.pipe(
        Layer.provide(Layer.merge(mockFileLearningRepo, AutoSyncServiceNoop))
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.remove(1)
        }).pipe(Effect.provide(layer), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect((result.left as any)._tag).toBe("DatabaseError")
      }
    })
  })
})

// ========================================================================
// DatabaseError Structure Tests
// ========================================================================

describe("DatabaseError Structure", () => {
  it("preserves the original cause", () => {
    const originalError = new Error("SQLite constraint violation")
    const dbError = new DatabaseError({ cause: originalError })

    expect(dbError._tag).toBe("DatabaseError")
    expect(dbError.cause).toBe(originalError)
  })

  it("message includes cause string representation", () => {
    const originalError = new Error("SQLite constraint violation")
    const dbError = new DatabaseError({ cause: originalError })

    expect(dbError.message).toContain("SQLite constraint violation")
  })

  it("handles non-Error causes", () => {
    const dbError = new DatabaseError({ cause: "string error" })

    expect(dbError._tag).toBe("DatabaseError")
    expect(dbError.cause).toBe("string error")
    expect(dbError.message).toContain("string error")
  })
})
