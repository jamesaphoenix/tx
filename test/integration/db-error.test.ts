import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
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
  metadata: {}
}

// ========================================================================
// LearningService Database Error Tests
// ========================================================================

describe("LearningService Database Error Handling", () => {
  describe("create", () => {
    it("propagates DatabaseError from repository insert", async () => {
      const mockLearningRepo = Layer.succeed(LearningRepository, {
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findAll: () => Effect.succeed([]),
        findRecent: () => Effect.succeed([]),
        bm25Search: () => Effect.succeed([]),
        findWithEmbeddings: () => Effect.succeed([]),
        incrementUsage: () => Effect.void,
        incrementUsageMany: () => Effect.void,
        updateOutcomeScore: () => Effect.void,
        updateEmbedding: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0),
        countWithEmbeddings: () => Effect.succeed(0),
        getConfig: () => Effect.succeed(null)
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        findById: () => Effect.succeed(null),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findAll: () => Effect.succeed([]),
        findRecent: () => Effect.succeed([]),
        bm25Search: () => Effect.succeed([]),
        findWithEmbeddings: () => Effect.succeed([]),
        incrementUsage: () => Effect.void,
        incrementUsageMany: () => Effect.void,
        updateOutcomeScore: () => Effect.void,
        updateEmbedding: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0),
        countWithEmbeddings: () => Effect.succeed(0),
        getConfig: () => Effect.succeed(null)
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        findById: () => Effect.succeed(null),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.fail(testDbError),
        findAll: () => Effect.succeed([]),
        findRecent: () => Effect.succeed([]),
        bm25Search: () => Effect.succeed([]),
        findWithEmbeddings: () => Effect.succeed([]),
        incrementUsage: () => Effect.void,
        incrementUsageMany: () => Effect.void,
        updateOutcomeScore: () => Effect.void,
        updateEmbedding: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0),
        countWithEmbeddings: () => Effect.succeed(0),
        getConfig: () => Effect.succeed(null)
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        findById: () => Effect.succeed(null),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        insert: () => Effect.fail(testDbError),
        findById: () => Effect.succeed(null),
        findAll: () => Effect.succeed([]),
        findRecent: () => Effect.succeed([]),
        bm25Search: () => Effect.succeed([]),
        findWithEmbeddings: () => Effect.succeed([]),
        incrementUsage: () => Effect.void,
        incrementUsageMany: () => Effect.void,
        updateOutcomeScore: () => Effect.void,
        updateEmbedding: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.fail(testDbError),
        countWithEmbeddings: () => Effect.succeed(0),
        getConfig: () => Effect.succeed(null)
      })

      const mockTaskRepo = Layer.succeed(TaskRepository, {
        findById: () => Effect.succeed(null),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        findById: () => Effect.succeed(mockTask),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        findById: () => Effect.fail(testDbError),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        findById: () => Effect.succeed(mockTask),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        findById: () => Effect.succeed(mockTask),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
        findById: () => Effect.succeed(mockTask),
        findByIds: () => Effect.succeed([]),
        findAll: () => Effect.succeed([]),
        findByParent: () => Effect.succeed([]),
        getChildIds: () => Effect.succeed([]),
        getChildIdsForMany: () => Effect.succeed(new Map()),
        insert: () => Effect.void,
        update: () => Effect.void,
        remove: () => Effect.void,
        count: () => Effect.succeed(0)
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
