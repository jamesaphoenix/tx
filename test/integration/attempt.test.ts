import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDb, seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
import { SqliteClient } from "../../src/db.js"
import { TaskRepositoryLive } from "../../src/repo/task-repo.js"
import { AttemptRepositoryLive, AttemptRepository } from "../../src/repo/attempt-repo.js"
import { AttemptServiceLive, AttemptService } from "../../src/services/attempt-service.js"
import type { AttemptId } from "../../src/schemas/attempt.js"
import type { TaskId } from "../../src/schema.js"
import type Database from "better-sqlite3"

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, AttemptRepositoryLive).pipe(
    Layer.provide(infra)
  )
  const services = AttemptServiceLive.pipe(
    Layer.provide(repos)
  )
  return Layer.merge(repos, services)
}

describe("AttemptRepository CRUD", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("insert creates a new attempt with auto-generated ID", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "Try using manual validation",
          outcome: "failed",
          reason: "Parsing error"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.id).toBeGreaterThan(0)
    expect(attempt.taskId).toBe(FIXTURES.TASK_JWT)
    expect(attempt.approach).toBe("Try using manual validation")
    expect(attempt.outcome).toBe("failed")
    expect(attempt.reason).toBe("Parsing error")
    expect(attempt.createdAt).toBeInstanceOf(Date)
  })

  it("insert stores null reason when not provided", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "New approach",
          outcome: "succeeded"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.reason).toBeNull()
  })

  it("findById returns existing attempt", async () => {
    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "Test approach",
          outcome: "failed",
          reason: "Test reason"
        })
      }).pipe(Effect.provide(layer))
    )

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.findById(created.id)
      }).pipe(Effect.provide(layer))
    )

    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.approach).toBe("Test approach")
  })

  it("findById returns null for non-existent attempt", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.findById(99999 as AttemptId)
      }).pipe(Effect.provide(layer))
    )

    expect(found).toBeNull()
  })

  it("findByTaskId returns all attempts for a task ordered by created_at DESC", async () => {
    // Insert multiple attempts for the same task
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "First approach",
          outcome: "failed"
        })
        yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "Second approach",
          outcome: "failed"
        })
        yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "Third approach",
          outcome: "succeeded"
        })
      }).pipe(Effect.provide(layer))
    )

    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.findByTaskId(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(3)
    // Most recent first (DESC order)
    expect(attempts[0].approach).toBe("Third approach")
    expect(attempts[1].approach).toBe("Second approach")
    expect(attempts[2].approach).toBe("First approach")
  })

  it("findByTaskId returns empty array for task with no attempts", async () => {
    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.findByTaskId(FIXTURES.TASK_LOGIN)
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(0)
  })

  it("count returns total number of attempts", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "Approach 1",
          outcome: "failed"
        })
        yield* repo.insert({
          taskId: FIXTURES.TASK_LOGIN,
          approach: "Approach 2",
          outcome: "succeeded"
        })
      }).pipe(Effect.provide(layer))
    )

    const total = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.count()
      }).pipe(Effect.provide(layer))
    )

    expect(total).toBe(2)
  })

  it("count with taskId returns attempts for specific task", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "JWT Approach 1",
          outcome: "failed"
        })
        yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "JWT Approach 2",
          outcome: "failed"
        })
        yield* repo.insert({
          taskId: FIXTURES.TASK_LOGIN,
          approach: "Login Approach",
          outcome: "succeeded"
        })
      }).pipe(Effect.provide(layer))
    )

    const jwtCount = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.count(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    const loginCount = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.count(FIXTURES.TASK_LOGIN)
      }).pipe(Effect.provide(layer))
    )

    expect(jwtCount).toBe(2)
    expect(loginCount).toBe(1)
  })

  it("remove deletes an attempt", async () => {
    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.insert({
          taskId: FIXTURES.TASK_JWT,
          approach: "To be deleted",
          outcome: "failed"
        })
      }).pipe(Effect.provide(layer))
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        yield* repo.remove(created.id)
      }).pipe(Effect.provide(layer))
    )

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        return yield* repo.findById(created.id)
      }).pipe(Effect.provide(layer))
    )

    expect(found).toBeNull()
  })

  it("remove is idempotent (no error for non-existent ID)", async () => {
    // Should not throw
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AttemptRepository
        yield* repo.remove(99999 as AttemptId)
      }).pipe(Effect.provide(layer))
    )
  })
})

describe("AttemptService create", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("creates attempt for existing task", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(
          FIXTURES.TASK_JWT,
          "Use library for validation",
          "succeeded",
          "Works great"
        )
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.id).toBeGreaterThan(0)
    expect(attempt.taskId).toBe(FIXTURES.TASK_JWT)
    expect(attempt.approach).toBe("Use library for validation")
    expect(attempt.outcome).toBe("succeeded")
    expect(attempt.reason).toBe("Works great")
  })

  it("trims whitespace from approach", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(
          FIXTURES.TASK_JWT,
          "  Padded approach  ",
          "failed"
        )
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.approach).toBe("Padded approach")
  })

  it("handles null reason", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "Approach", "failed", null)
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.reason).toBeNull()
  })

  it("fails with TaskNotFoundError for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(
          "tx-nonexist" as string,
          "Some approach",
          "failed"
        )
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("fails with ValidationError for empty approach", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "", "failed")
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
      expect((result.left as any).reason).toBe("Approach is required")
    }
  })

  it("fails with ValidationError for whitespace-only approach", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "   ", "failed")
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("fails with ValidationError for invalid outcome", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(
          FIXTURES.TASK_JWT,
          "Some approach",
          "invalid_outcome" as any
        )
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
      expect((result.left as any).reason).toContain("Invalid outcome")
    }
  })

  it("accepts 'failed' outcome", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "Approach", "failed")
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.outcome).toBe("failed")
  })

  it("accepts 'succeeded' outcome", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "Approach", "succeeded")
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.outcome).toBe("succeeded")
  })
})

describe("AttemptService get", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("returns existing attempt", async () => {
    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "Test approach", "failed")
      }).pipe(Effect.provide(layer))
    )

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.get(created.id)
      }).pipe(Effect.provide(layer))
    )

    expect(found.id).toBe(created.id)
    expect(found.approach).toBe("Test approach")
  })

  it("fails with AttemptNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.get(99999 as AttemptId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AttemptNotFoundError")
    }
  })
})

describe("AttemptService listForTask", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("returns all attempts for a task", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "First try", "failed")
        yield* svc.create(FIXTURES.TASK_JWT, "Second try", "succeeded")
      }).pipe(Effect.provide(layer))
    )

    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.listForTask(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(2)
  })

  it("returns empty array for task with no attempts", async () => {
    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.listForTask(FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(layer))
    )

    expect(attempts).toHaveLength(0)
  })

  it("only returns attempts for specified task", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "JWT attempt", "failed")
        yield* svc.create(FIXTURES.TASK_LOGIN, "Login attempt", "succeeded")
      }).pipe(Effect.provide(layer))
    )

    const jwtAttempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.listForTask(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(jwtAttempts).toHaveLength(1)
    expect(jwtAttempts[0].taskId).toBe(FIXTURES.TASK_JWT)
  })
})

describe("AttemptService remove", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("removes existing attempt", async () => {
    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_JWT, "To remove", "failed")
      }).pipe(Effect.provide(layer))
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.remove(created.id)
      }).pipe(Effect.provide(layer))
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.get(created.id)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
  })

  it("fails with AttemptNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.remove(99999 as AttemptId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AttemptNotFoundError")
    }
  })
})

describe("AttemptService getFailedCount", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("returns count of failed attempts", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "Failed 1", "failed")
        yield* svc.create(FIXTURES.TASK_JWT, "Failed 2", "failed")
        yield* svc.create(FIXTURES.TASK_JWT, "Succeeded", "succeeded")
      }).pipe(Effect.provide(layer))
    )

    const failedCount = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.getFailedCount(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(failedCount).toBe(2)
  })

  it("returns 0 for task with no attempts", async () => {
    const failedCount = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.getFailedCount(FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(layer))
    )

    expect(failedCount).toBe(0)
  })

  it("returns 0 for task with only succeeded attempts", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "Success 1", "succeeded")
        yield* svc.create(FIXTURES.TASK_JWT, "Success 2", "succeeded")
      }).pipe(Effect.provide(layer))
    )

    const failedCount = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.getFailedCount(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(failedCount).toBe(0)
  })
})

describe("Attempt-Task relationship", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("attempts are properly associated with tasks", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        yield* svc.create(FIXTURES.TASK_JWT, "JWT approach 1", "failed")
        yield* svc.create(FIXTURES.TASK_JWT, "JWT approach 2", "succeeded")
        yield* svc.create(FIXTURES.TASK_LOGIN, "Login approach", "failed")
      }).pipe(Effect.provide(layer))
    )

    const jwtAttempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.listForTask(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    const loginAttempts = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.listForTask(FIXTURES.TASK_LOGIN)
      }).pipe(Effect.provide(layer))
    )

    expect(jwtAttempts).toHaveLength(2)
    expect(loginAttempts).toHaveLength(1)
    expect(jwtAttempts.every(a => a.taskId === FIXTURES.TASK_JWT)).toBe(true)
    expect(loginAttempts.every(a => a.taskId === FIXTURES.TASK_LOGIN)).toBe(true)
  })

  it("attempts reference valid task IDs from fixtures", async () => {
    const attempt = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AttemptService
        return yield* svc.create(FIXTURES.TASK_BLOCKED, "Blocked task attempt", "failed")
      }).pipe(Effect.provide(layer))
    )

    expect(attempt.taskId).toBe(FIXTURES.TASK_BLOCKED)
    expect(attempt.taskId).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("fixtureId generates deterministic SHA256-based IDs", () => {
    // Verify consistency with test/fixtures.ts pattern
    expect(FIXTURES.TASK_AUTH).toBe(fixtureId("auth"))
    expect(FIXTURES.TASK_JWT).toBe(fixtureId("jwt"))
    expect(FIXTURES.TASK_LOGIN).toBe(fixtureId("login"))

    // Verify format
    for (const id of Object.values(FIXTURES)) {
      expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
    }
  })
})
