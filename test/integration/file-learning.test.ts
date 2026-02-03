import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDb, seedFixtures, FIXTURES } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  LearningRepositoryLive,
  FileLearningRepositoryLive,
  matchesPattern,
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  LearningServiceLive,
  FileLearningServiceLive,
  FileLearningService,
  EmbeddingServiceNoop,
  AutoSyncServiceNoop,
  QueryExpansionServiceNoop,
  RerankerServiceNoop,
  RetrieverServiceLive
} from "@jamesaphoenix/tx-core"
import type { Database } from "bun:sqlite"

function makeTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as any)
  const repos = Layer.mergeAll(
    TaskRepositoryLive,
    DependencyRepositoryLive,
    LearningRepositoryLive,
    FileLearningRepositoryLive
  ).pipe(
    Layer.provide(infra)
  )

  // RetrieverServiceLive needs repos, embedding, query expansion, and reranker
  const retrieverLayer = RetrieverServiceLive.pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop))
  )

  const services = Layer.mergeAll(
    TaskServiceLive,
    DependencyServiceLive,
    ReadyServiceLive,
    HierarchyServiceLive,
    LearningServiceLive,
    FileLearningServiceLive
  ).pipe(
    Layer.provide(Layer.mergeAll(repos, EmbeddingServiceNoop, QueryExpansionServiceNoop, RerankerServiceNoop, retrieverLayer, AutoSyncServiceNoop))
  )
  return services
}

describe("Glob Pattern Matching", () => {
  it("matches exact paths", () => {
    expect(matchesPattern("src/db.ts", "src/db.ts")).toBe(true)
    expect(matchesPattern("src/db.ts", "src/index.ts")).toBe(false)
  })

  it("matches single wildcard *", () => {
    expect(matchesPattern("src/*.ts", "src/db.ts")).toBe(true)
    expect(matchesPattern("src/*.ts", "src/index.ts")).toBe(true)
    expect(matchesPattern("src/*.ts", "src/deep/nested.ts")).toBe(false) // * doesn't match /
    expect(matchesPattern("src/*.ts", "test/db.ts")).toBe(false)
  })

  it("matches double wildcard **", () => {
    expect(matchesPattern("src/**/*.ts", "src/db.ts")).toBe(true)
    expect(matchesPattern("src/**/*.ts", "src/deep/nested.ts")).toBe(true)
    expect(matchesPattern("src/**/*.ts", "src/very/deep/nested.ts")).toBe(true)
    expect(matchesPattern("src/**/*.ts", "test/db.ts")).toBe(false)
  })

  it("matches question mark ?", () => {
    expect(matchesPattern("src/?.ts", "src/a.ts")).toBe(true)
    expect(matchesPattern("src/?.ts", "src/ab.ts")).toBe(false)
  })

  it("escapes special regex characters", () => {
    expect(matchesPattern("src/file.test.ts", "src/file.test.ts")).toBe(true)
    expect(matchesPattern("src/[special].ts", "src/[special].ts")).toBe(true)
  })
})

describe("FileLearning CRUD", () => {
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("create returns a file learning with valid ID", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        return yield* svc.create({
          filePattern: "src/db.ts",
          note: "Always run migrations in a transaction"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(learning.id).toBe(1)
    expect(learning.filePattern).toBe("src/db.ts")
    expect(learning.note).toBe("Always run migrations in a transaction")
    expect(learning.taskId).toBeNull()
  })

  it("create with task ID associates learning", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        return yield* svc.create({
          filePattern: "src/services/*.ts",
          note: "Services must use Effect-TS patterns",
          taskId: FIXTURES.TASK_AUTH
        })
      }).pipe(Effect.provide(layer))
    )

    expect(learning.taskId).toBe(FIXTURES.TASK_AUTH)
  })

  it("get returns the learning by ID", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        yield* svc.create({ filePattern: "test.ts", note: "Test note" })
        return yield* svc.get(1)
      }).pipe(Effect.provide(layer))
    )

    expect(learning.note).toBe("Test note")
  })

  it("get throws FileLearningNotFoundError for non-existent ID", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.get(999)
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })

  it("remove deletes the learning", async () => {
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        yield* svc.create({ filePattern: "to-delete.ts", note: "Delete me" })
        yield* svc.remove(1)
        return yield* svc.count()
      }).pipe(Effect.provide(layer))
    )

    expect(count).toBe(0)
  })

  it("getAll returns all learnings", async () => {
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        yield* svc.create({ filePattern: "first.ts", note: "First" })
        yield* svc.create({ filePattern: "second.ts", note: "Second" })
        yield* svc.create({ filePattern: "third.ts", note: "Third" })
        return yield* svc.getAll()
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(3)
    // All learnings should be present
    const notes = learnings.map(l => l.note)
    expect(notes).toContain("First")
    expect(notes).toContain("Second")
    expect(notes).toContain("Third")
  })
})

describe("FileLearning Recall by Path", () => {
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("recall returns learnings matching exact path", async () => {
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        yield* svc.create({ filePattern: "src/db.ts", note: "DB specific" })
        yield* svc.create({ filePattern: "src/index.ts", note: "Index specific" })
        return yield* svc.recall("src/db.ts")
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(1)
    expect(learnings[0]!.note).toBe("DB specific")
  })

  it("recall returns learnings matching glob pattern", async () => {
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        yield* svc.create({ filePattern: "src/services/*.ts", note: "Service pattern" })
        yield* svc.create({ filePattern: "src/db.ts", note: "DB specific" })
        return yield* svc.recall("src/services/task-service.ts")
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(1)
    expect(learnings[0]!.note).toBe("Service pattern")
  })

  it("recall returns multiple matching patterns", async () => {
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        yield* svc.create({ filePattern: "src/**/*.ts", note: "All TS files" })
        yield* svc.create({ filePattern: "src/services/*.ts", note: "Services only" })
        yield* svc.create({ filePattern: "test/*.ts", note: "Tests only" })
        return yield* svc.recall("src/services/task-service.ts")
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(2)
    const notes = learnings.map(l => l.note)
    expect(notes).toContain("All TS files")
    expect(notes).toContain("Services only")
  })

  it("recall returns empty for non-matching path", async () => {
    const learnings = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        yield* svc.create({ filePattern: "src/*.ts", note: "Source files" })
        return yield* svc.recall("test/unit/example.test.ts")
      }).pipe(Effect.provide(layer))
    )

    expect(learnings).toHaveLength(0)
  })
})

describe("FileLearning Validation", () => {
  let db: Database
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("rejects empty file pattern", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.create({ filePattern: "", note: "Valid note" })
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow("File pattern is required")
  })

  it("rejects whitespace-only file pattern", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.create({ filePattern: "   ", note: "Valid note" })
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow("File pattern is required")
  })

  it("rejects empty note", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.create({ filePattern: "src/db.ts", note: "" })
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow("Note is required")
  })

  it("rejects whitespace-only note", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* FileLearningService
          return yield* svc.create({ filePattern: "src/db.ts", note: "   " })
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow("Note is required")
  })

  it("trims file pattern and note", async () => {
    const learning = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* FileLearningService
        return yield* svc.create({
          filePattern: "  src/db.ts  ",
          note: "  Trimmed note  "
        })
      }).pipe(Effect.provide(layer))
    )

    expect(learning.filePattern).toBe("src/db.ts")
    expect(learning.note).toBe("Trimmed note")
  })
})
