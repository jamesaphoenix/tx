import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDb } from "../fixtures.js"
import {
  SqliteClient,
  AnchorRepository,
  AnchorRepositoryLive,
  LearningRepositoryLive
} from "@jamesaphoenix/tx-core"
import type Database from "better-sqlite3"
import type { Anchor } from "@jamesaphoenix/tx-types"

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as any)
  return Layer.mergeAll(
    AnchorRepositoryLive,
    LearningRepositoryLive
  ).pipe(Layer.provide(infra))
}

/**
 * Create a test learning and return its ID.
 * Learnings are required since anchors have FK to learnings.
 */
function createTestLearning(db: InstanceType<typeof Database>, content: string): number {
  const now = new Date().toISOString()
  const result = db.prepare(
    `INSERT INTO learnings (content, source_type, created_at) VALUES (?, 'manual', ?)`
  ).run(content, now)
  return Number(result.lastInsertRowid)
}

describe("AnchorRepository CRUD", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>
  let learningId: number

  beforeEach(() => {
    db = createTestDb()
    layer = makeTestLayer(db)
    // Create a learning that anchors will reference
    learningId = createTestLearning(db, "Use transactions for DB operations")
  })

  afterEach(() => {
    db.close()
  })

  it("create returns an anchor with valid ID", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "src/repo/*.ts",
          filePath: "src/repo/task-repo.ts"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(anchor.id).toBe(1)
    expect(anchor.learningId).toBe(learningId)
    expect(anchor.anchorType).toBe("glob")
    expect(anchor.anchorValue).toBe("src/repo/*.ts")
    expect(anchor.filePath).toBe("src/repo/task-repo.ts")
    expect(anchor.status).toBe("valid")
    expect(anchor.createdAt).toBeInstanceOf(Date)
  })

  it("create with all optional fields", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.create({
          learningId,
          anchorType: "symbol",
          anchorValue: "TaskService",
          filePath: "src/services/task-service.ts",
          symbolFqname: "src/services/task-service.ts::TaskService",
          lineStart: 10,
          lineEnd: 50,
          contentHash: "abc123def456"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(anchor.symbolFqname).toBe("src/services/task-service.ts::TaskService")
    expect(anchor.lineStart).toBe(10)
    expect(anchor.lineEnd).toBe(50)
    expect(anchor.contentHash).toBe("abc123def456")
  })

  it("findById returns the anchor", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "hash",
          anchorValue: "content-hash",
          filePath: "src/db.ts"
        })
        return yield* repo.findById(1)
      }).pipe(Effect.provide(layer))
    )

    expect(anchor).not.toBeNull()
    expect(anchor!.anchorType).toBe("hash")
  })

  it("findById returns null for non-existent ID", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.findById(999)
      }).pipe(Effect.provide(layer))
    )

    expect(anchor).toBeNull()
  })

  it("findByLearningId returns all anchors for a learning", async () => {
    const anchors = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "src/**/*.ts",
          filePath: "src/db.ts"
        })
        yield* repo.create({
          learningId,
          anchorType: "symbol",
          anchorValue: "SqliteClient",
          filePath: "src/db.ts"
        })
        return yield* repo.findByLearningId(learningId)
      }).pipe(Effect.provide(layer))
    )

    expect(anchors).toHaveLength(2)
    expect(anchors[0]!.anchorType).toBe("glob")
    expect(anchors[1]!.anchorType).toBe("symbol")
  })

  it("findByFilePath returns all anchors for a file", async () => {
    const learning2 = createTestLearning(db, "Another learning")

    const anchors = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "src/**/*.ts",
          filePath: "src/db.ts"
        })
        yield* repo.create({
          learningId: learning2,
          anchorType: "hash",
          anchorValue: "hash-value",
          filePath: "src/db.ts"
        })
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "test/*.ts",
          filePath: "test/unit.test.ts"
        })
        return yield* repo.findByFilePath("src/db.ts")
      }).pipe(Effect.provide(layer))
    )

    expect(anchors).toHaveLength(2)
    anchors.forEach((a: Anchor) => expect(a.filePath).toBe("src/db.ts"))
  })

  it("update modifies anchor fields", async () => {
    const updated = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "old-value",
          filePath: "old/path.ts"
        })
        return yield* repo.update(1, {
          anchorValue: "new-value",
          filePath: "new/path.ts",
          status: "drifted"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(updated).not.toBeNull()
    expect(updated!.anchorValue).toBe("new-value")
    expect(updated!.filePath).toBe("new/path.ts")
    expect(updated!.status).toBe("drifted")
  })

  it("update with no fields returns existing anchor unchanged", async () => {
    const updated = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "value",
          filePath: "path.ts"
        })
        return yield* repo.update(1, {})
      }).pipe(Effect.provide(layer))
    )

    expect(updated).not.toBeNull()
    expect(updated!.anchorValue).toBe("value")
  })

  it("update returns null for non-existent anchor", async () => {
    const updated = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.update(999, { anchorValue: "new-value" })
      }).pipe(Effect.provide(layer))
    )

    expect(updated).toBeNull()
  })

  it("delete removes the anchor", async () => {
    const deleted = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "to-delete",
          filePath: "delete/me.ts"
        })
        const result = yield* repo.delete(1)
        const found = yield* repo.findById(1)
        return { result, found }
      }).pipe(Effect.provide(layer))
    )

    expect(deleted.result).toBe(true)
    expect(deleted.found).toBeNull()
  })

  it("delete returns false for non-existent anchor", async () => {
    const deleted = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.delete(999)
      }).pipe(Effect.provide(layer))
    )

    expect(deleted).toBe(false)
  })
})

describe("AnchorRepository Status Queries", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>
  let learningId: number

  beforeEach(() => {
    db = createTestDb()
    layer = makeTestLayer(db)
    learningId = createTestLearning(db, "Test learning for status queries")
  })

  afterEach(() => {
    db.close()
  })

  it("findDrifted returns only drifted anchors", async () => {
    const drifted = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        // Create anchors with different statuses
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "valid-anchor",
          filePath: "valid.ts"
        })
        const a2 = yield* repo.create({
          learningId,
          anchorType: "hash",
          anchorValue: "drifted-anchor",
          filePath: "drifted.ts"
        })
        yield* repo.updateStatus(a2.id, "drifted")

        const a3 = yield* repo.create({
          learningId,
          anchorType: "symbol",
          anchorValue: "invalid-anchor",
          filePath: "invalid.ts"
        })
        yield* repo.updateStatus(a3.id, "invalid")

        return yield* repo.findDrifted()
      }).pipe(Effect.provide(layer))
    )

    expect(drifted).toHaveLength(1)
    expect(drifted[0]!.anchorValue).toBe("drifted-anchor")
    expect(drifted[0]!.status).toBe("drifted")
  })

  it("findInvalid returns only invalid anchors", async () => {
    const invalid = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        // Create anchors with different statuses
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "valid-anchor",
          filePath: "valid.ts"
        })
        const a2 = yield* repo.create({
          learningId,
          anchorType: "hash",
          anchorValue: "invalid-anchor-1",
          filePath: "invalid1.ts"
        })
        yield* repo.updateStatus(a2.id, "invalid")

        const a3 = yield* repo.create({
          learningId,
          anchorType: "symbol",
          anchorValue: "invalid-anchor-2",
          filePath: "invalid2.ts"
        })
        yield* repo.updateStatus(a3.id, "invalid")

        return yield* repo.findInvalid()
      }).pipe(Effect.provide(layer))
    )

    expect(invalid).toHaveLength(2)
    invalid.forEach((a: Anchor) => expect(a.status).toBe("invalid"))
  })

  it("updateStatus changes anchor status", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "status-test",
          filePath: "status.ts"
        })
        const updated = yield* repo.updateStatus(1, "drifted")
        const anchor = yield* repo.findById(1)
        return { updated, anchor }
      }).pipe(Effect.provide(layer))
    )

    expect(result.updated).toBe(true)
    expect(result.anchor!.status).toBe("drifted")
  })

  it("updateVerifiedAt sets verification timestamp", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "verify-test",
          filePath: "verify.ts"
        })
        const before = yield* repo.findById(1)
        yield* repo.updateVerifiedAt(1)
        const after = yield* repo.findById(1)
        return { before, after }
      }).pipe(Effect.provide(layer))
    )

    expect(result.before!.verifiedAt).toBeNull()
    expect(result.after!.verifiedAt).toBeInstanceOf(Date)
  })
})

describe("AnchorRepository Anchor Types", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>
  let learningId: number

  beforeEach(() => {
    db = createTestDb()
    layer = makeTestLayer(db)
    learningId = createTestLearning(db, "Test learning for anchor types")
  })

  afterEach(() => {
    db.close()
  })

  it("supports glob anchor type", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "src/**/*.ts",
          filePath: "src/services/task-service.ts"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(anchor.anchorType).toBe("glob")
  })

  it("supports hash anchor type", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.create({
          learningId,
          anchorType: "hash",
          anchorValue: "sha256:abcd1234",
          filePath: "src/db.ts",
          contentHash: "abcd1234efgh5678",
          lineStart: 1,
          lineEnd: 10
        })
      }).pipe(Effect.provide(layer))
    )

    expect(anchor.anchorType).toBe("hash")
    expect(anchor.contentHash).toBe("abcd1234efgh5678")
  })

  it("supports symbol anchor type", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.create({
          learningId,
          anchorType: "symbol",
          anchorValue: "TaskService",
          filePath: "src/services/task-service.ts",
          symbolFqname: "src/services/task-service.ts::TaskService"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(anchor.anchorType).toBe("symbol")
    expect(anchor.symbolFqname).toBe("src/services/task-service.ts::TaskService")
  })

  it("supports line_range anchor type", async () => {
    const anchor = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        return yield* repo.create({
          learningId,
          anchorType: "line_range",
          anchorValue: "10-25",
          filePath: "src/db.ts",
          lineStart: 10,
          lineEnd: 25
        })
      }).pipe(Effect.provide(layer))
    )

    expect(anchor.anchorType).toBe("line_range")
    expect(anchor.lineStart).toBe(10)
    expect(anchor.lineEnd).toBe(25)
  })
})

describe("AnchorRepository Foreign Key Constraint", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
    layer = makeTestLayer(db)
  })

  afterEach(() => {
    db.close()
  })

  it("fails to create anchor with non-existent learning ID", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* AnchorRepository
          return yield* repo.create({
            learningId: 99999,
            anchorType: "glob",
            anchorValue: "test",
            filePath: "test.ts"
          })
        }).pipe(Effect.provide(layer))
      )
    ).rejects.toThrow()
  })

  it("cascades delete when learning is deleted", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AnchorRepository
        // Create learning and anchor manually
        const now = new Date().toISOString()
        const learningResult = db.prepare(
          `INSERT INTO learnings (content, source_type, created_at) VALUES (?, 'manual', ?)`
        ).run("Cascade test learning", now)
        const learningId = Number(learningResult.lastInsertRowid)

        yield* repo.create({
          learningId,
          anchorType: "glob",
          anchorValue: "cascade-test",
          filePath: "cascade.ts"
        })

        // Verify anchor exists
        const beforeDelete = yield* repo.findByLearningId(learningId)

        // Delete the learning
        db.prepare("DELETE FROM learnings WHERE id = ?").run(learningId)

        // Anchor should be gone due to CASCADE
        const afterDelete = yield* repo.findByLearningId(learningId)

        return { beforeDelete, afterDelete }
      }).pipe(Effect.provide(layer))
    )

    expect(result.beforeDelete).toHaveLength(1)
    expect(result.afterDelete).toHaveLength(0)
  })
})
