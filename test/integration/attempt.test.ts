import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  AttemptRepositoryLive,
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  AttemptServiceLive,
  AttemptService,
  AutoSyncServiceNoop
} from "@jamesaphoenix/tx-core"

function makeTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    AttemptRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )
  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    AttemptServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, AutoSyncServiceNoop))
  )
  return services
}

describe("Attempt CRUD", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("create returns an attempt with valid ID", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "Used Redux for state", "failed", "Too complex")
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.id).toBe(1)
    expect(attempt.taskId).toBe(FIXTURES.TASK_JWT)
    expect(attempt.approach).toBe("Used Redux for state")
    expect(attempt.outcome).toBe("failed")
    expect(attempt.reason).toBe("Too complex")
    expect(attempt.createdAt).toBeInstanceOf(Date)
  })

  it("create works with succeeded outcome", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "Used Zustand", "succeeded", null)
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.outcome).toBe("succeeded")
    expect(attempt.reason).toBeNull()
  })

  it("create validates task exists", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.create("tx-nonexistent", "Some approach", "failed", null)
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })

  it("create validates approach is not empty", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.create(FIXTURES.TASK_JWT, "   ", "failed", null)
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })

  it("get returns the attempt by ID", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "Test approach", "failed", "Test reason")
        return yield* svc.get(1 as any)
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.approach).toBe("Test approach")
  })

  it("get throws AttemptNotFoundError for non-existent ID", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.get(999 as any)
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })

  it("listForTask returns attempts sorted by created_at DESC", async () => {
    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "First approach", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Second approach", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Third approach", "succeeded", null)
        return yield* svc.listForTask(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(3)
    // All attempts should be present
    const approaches = attempts.map(a => a.approach)
    expect(approaches).toContain("First approach")
    expect(approaches).toContain("Second approach")
    expect(approaches).toContain("Third approach")
  })

  it("listForTask returns empty array for task with no attempts", async () => {
    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.listForTask(FIXTURES.TASK_LOGIN)
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(0)
  })

  it("remove deletes the attempt", async () => {
    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "To be deleted", "failed", null)
        yield* svc.remove(1 as any)
        return yield* svc.listForTask(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(0)
  })

  it("remove throws AttemptNotFoundError for non-existent ID", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttemptService
          return yield* svc.remove(999 as any)
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow("Attempt not found: 999")
  })
})

describe("Attempt Failed Count", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("getFailedCount returns count of failed attempts", async () => {
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "Approach 1", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Approach 2", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Approach 3", "succeeded", null)
        return yield* svc.getFailedCount(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(count).toBe(2)
  })

  it("getFailedCount returns 0 for task with no attempts", async () => {
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.getFailedCount(FIXTURES.TASK_LOGIN)
      }).pipe(Effect.provide(layer))
    )

    expect(count).toBe(0)
  })

  it("getFailedCount returns 0 when all attempts succeeded", async () => {
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "Approach 1", "succeeded", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Approach 2", "succeeded", null)
        return yield* svc.getFailedCount(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(count).toBe(0)
  })
})

describe("getFailedCountsForTasks Batch Query", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("returns counts for multiple tasks with failed attempts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        // Create failed attempts for JWT task
        yield* svc.create(FIXTURES.TASK_JWT, "Approach 1", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Approach 2", "failed", null)
        // Create failed attempt for LOGIN task
        yield* svc.create(FIXTURES.TASK_LOGIN, "Login approach", "failed", "Auth error")
        // Query both tasks
        return yield* svc.getFailedCountsForTasks([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
      }).pipe(Effect.provide(layer))
    )

    expect(result.get(FIXTURES.TASK_JWT)).toBe(2)
    expect(result.get(FIXTURES.TASK_LOGIN)).toBe(1)
  })

  it("returns empty map for empty task ID array", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.getFailedCountsForTasks([])
      }).pipe(Effect.provide(layer))
    )

    expect(result.size).toBe(0)
  })

  it("only counts failed outcomes, not succeeded", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        // Mixed outcomes
        yield* svc.create(FIXTURES.TASK_JWT, "Failed approach", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Succeeded approach", "succeeded", null)
        yield* svc.create(FIXTURES.TASK_JWT, "Another failed", "failed", null)
        return yield* svc.getFailedCountsForTasks([FIXTURES.TASK_JWT])
      }).pipe(Effect.provide(layer))
    )

    // Should only count the 2 failed, not the 1 succeeded
    expect(result.get(FIXTURES.TASK_JWT)).toBe(2)
  })

  it("returns undefined for tasks with no failed attempts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        // Only successful attempts for JWT
        yield* svc.create(FIXTURES.TASK_JWT, "Succeeded approach", "succeeded", null)
        return yield* svc.getFailedCountsForTasks([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
      }).pipe(Effect.provide(layer))
    )

    // JWT has no failed attempts (only succeeded), LOGIN has no attempts at all
    expect(result.get(FIXTURES.TASK_JWT)).toBeUndefined()
    expect(result.get(FIXTURES.TASK_LOGIN)).toBeUndefined()
    expect(result.size).toBe(0)
  })

  it("excludes tasks not in the input array", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        // Failed attempts for JWT and LOGIN
        yield* svc.create(FIXTURES.TASK_JWT, "JWT approach", "failed", null)
        yield* svc.create(FIXTURES.TASK_LOGIN, "Login approach", "failed", null)
        // Only query JWT, not LOGIN
        return yield* svc.getFailedCountsForTasks([FIXTURES.TASK_JWT])
      }).pipe(Effect.provide(layer))
    )

    expect(result.get(FIXTURES.TASK_JWT)).toBe(1)
    expect(result.get(FIXTURES.TASK_LOGIN)).toBeUndefined()
    expect(result.size).toBe(1)
  })

  it("handles single task in array", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "Single approach", "failed", null)
        return yield* svc.getFailedCountsForTasks([FIXTURES.TASK_JWT])
      }).pipe(Effect.provide(layer))
    )

    expect(result.get(FIXTURES.TASK_JWT)).toBe(1)
    expect(result.size).toBe(1)
  })

  it("handles many tasks efficiently in batch", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        // Create attempts for multiple tasks
        yield* svc.create(FIXTURES.TASK_JWT, "JWT fail 1", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "JWT fail 2", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "JWT fail 3", "failed", null)
        yield* svc.create(FIXTURES.TASK_LOGIN, "Login fail", "failed", null)
        yield* svc.create(FIXTURES.TASK_AUTH, "Auth fail 1", "failed", null)
        yield* svc.create(FIXTURES.TASK_AUTH, "Auth fail 2", "failed", null)
        yield* svc.create(FIXTURES.TASK_BLOCKED, "Blocked success", "succeeded", null)

        return yield* svc.getFailedCountsForTasks([
          FIXTURES.TASK_JWT,
          FIXTURES.TASK_LOGIN,
          FIXTURES.TASK_AUTH,
          FIXTURES.TASK_BLOCKED,
          FIXTURES.TASK_ROOT // No attempts at all
        ])
      }).pipe(Effect.provide(layer))
    )

    expect(result.get(FIXTURES.TASK_JWT)).toBe(3)
    expect(result.get(FIXTURES.TASK_LOGIN)).toBe(1)
    expect(result.get(FIXTURES.TASK_AUTH)).toBe(2)
    expect(result.get(FIXTURES.TASK_BLOCKED)).toBeUndefined() // Only has succeeded
    expect(result.get(FIXTURES.TASK_ROOT)).toBeUndefined() // No attempts
  })
})

describe("Attempt Integration with Tasks", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("attempts persist across service calls", async () => {
    // Create attempt and verify it persists
    const [created, retrieved] = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        const attempt = yield* svc.create(FIXTURES.TASK_JWT, "Test persistence", "failed", "Reason")
        const retrieved = yield* svc.get(attempt.id)
        return [attempt, retrieved]
      }).pipe(Effect.provide(layer))
    )

    expect(created.id).toBe(retrieved.id)
    expect(created.approach).toBe(retrieved.approach)
    expect(created.outcome).toBe(retrieved.outcome)
    expect(created.reason).toBe(retrieved.reason)
  })

  it("multiple tasks can have independent attempts", async () => {
    const [jwtAttempts, loginAttempts] = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "JWT approach 1", "failed", null)
        yield* svc.create(FIXTURES.TASK_JWT, "JWT approach 2", "failed", null)
        yield* svc.create(FIXTURES.TASK_LOGIN, "Login approach 1", "succeeded", null)

        const jwtAttempts = yield* svc.listForTask(FIXTURES.TASK_JWT)
        const loginAttempts = yield* svc.listForTask(FIXTURES.TASK_LOGIN)
        return [jwtAttempts, loginAttempts]
      }).pipe(Effect.provide(layer))
    )

    expect(jwtAttempts).toHaveLength(2)
    expect(loginAttempts).toHaveLength(1)
    expect(jwtAttempts.every(a => a.taskId === FIXTURES.TASK_JWT)).toBe(true)
    expect(loginAttempts.every(a => a.taskId === FIXTURES.TASK_LOGIN)).toBe(true)
  })
})
