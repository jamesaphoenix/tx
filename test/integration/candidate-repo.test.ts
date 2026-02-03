/**
 * CandidateRepository Integration Tests
 *
 * Tests the CandidateRepository at the repository layer with full dependency injection.
 * Uses real SQLite database (in-memory) and SHA256-based fixture IDs per Rule 3.
 *
 * @see PRD-015 for the knowledge promotion pipeline
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`candidate-repo-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  RUN_1: fixtureId("run-1"),
  RUN_2: fixtureId("run-2"),
  TASK_1: fixtureId("task-1"),
  TASK_2: fixtureId("task-2"),
} as const

// =============================================================================
// CandidateRepository CRUD Tests
// =============================================================================

describe("CandidateRepository.insert", () => {
  it("creates a candidate with required fields", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        return yield* repo.insert({
          content: "Always validate user input before processing",
          confidence: "high",
          sourceFile: "src/validation.ts"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toBe(1)
    expect(result.content).toBe("Always validate user input before processing")
    expect(result.confidence).toBe("high")
    expect(result.sourceFile).toBe("src/validation.ts")
    expect(result.status).toBe("pending")
    expect(result.category).toBeNull()
    expect(result.sourceRunId).toBeNull()
    expect(result.sourceTaskId).toBeNull()
    expect(result.reviewedAt).toBeNull()
    expect(result.reviewedBy).toBeNull()
    expect(result.promotedLearningId).toBeNull()
    expect(result.rejectionReason).toBeNull()
    expect(result.extractedAt).toBeInstanceOf(Date)
  })

  it("creates a candidate with all optional fields", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        return yield* repo.insert({
          content: "Use connection pooling for database operations",
          confidence: "medium",
          category: "performance",
          sourceFile: "src/db.ts",
          sourceRunId: FIXTURES.RUN_1,
          sourceTaskId: FIXTURES.TASK_1
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result.id).toBe(1)
    expect(result.content).toBe("Use connection pooling for database operations")
    expect(result.confidence).toBe("medium")
    expect(result.category).toBe("performance")
    expect(result.sourceFile).toBe("src/db.ts")
    expect(result.sourceRunId).toBe(FIXTURES.RUN_1)
    expect(result.sourceTaskId).toBe(FIXTURES.TASK_1)
    expect(result.status).toBe("pending")
  })

  it("auto-increments IDs for multiple inserts", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const c1 = yield* repo.insert({
          content: "Candidate 1",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        const c2 = yield* repo.insert({
          content: "Candidate 2",
          confidence: "medium",
          sourceFile: "src/b.ts"
        })
        const c3 = yield* repo.insert({
          content: "Candidate 3",
          confidence: "low",
          sourceFile: "src/c.ts"
        })

        return { c1, c2, c3 }
      }).pipe(Effect.provide(layer))
    )

    expect(result.c1.id).toBe(1)
    expect(result.c2.id).toBe(2)
    expect(result.c3.id).toBe(3)
  })
})

describe("CandidateRepository.findById", () => {
  it("returns candidate by ID", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const inserted = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* repo.findById(inserted.id)
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.id).toBe(1)
    expect(result!.content).toBe("Test candidate")
  })

  it("returns null for nonexistent ID", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        return yield* repo.findById(999)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// CandidateRepository Filter Tests
// =============================================================================

describe("CandidateRepository.findByFilter", () => {
  it("returns all candidates when no filter applied", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "Candidate 1",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "Candidate 2",
          confidence: "medium",
          sourceFile: "src/b.ts"
        })
        yield* repo.insert({
          content: "Candidate 3",
          confidence: "low",
          sourceFile: "src/c.ts"
        })

        return yield* repo.findByFilter({})
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(3)
  })

  it("returns empty array when no candidates exist", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        return yield* repo.findByFilter({})
      }).pipe(Effect.provide(layer))
    )

    expect(result).toEqual([])
  })

  it("filters by single status", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "Pending candidate",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        const c2 = yield* repo.insert({
          content: "Will be promoted",
          confidence: "high",
          sourceFile: "src/b.ts"
        })
        yield* repo.updateStatus(c2.id, "promoted")

        return yield* repo.findByFilter({ status: "pending" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("Pending candidate")
  })

  it("filters by multiple statuses", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "Pending",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        const c2 = yield* repo.insert({
          content: "Promoted",
          confidence: "high",
          sourceFile: "src/b.ts"
        })
        const c3 = yield* repo.insert({
          content: "Rejected",
          confidence: "low",
          sourceFile: "src/c.ts"
        })

        yield* repo.updateStatus(c2.id, "promoted")
        yield* repo.updateStatus(c3.id, "rejected")

        return yield* repo.findByFilter({ status: ["pending", "promoted"] })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    const contents = result.map(c => c.content)
    expect(contents).toContain("Pending")
    expect(contents).toContain("Promoted")
  })

  it("filters by single confidence level", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "High confidence",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "Medium confidence",
          confidence: "medium",
          sourceFile: "src/b.ts"
        })
        yield* repo.insert({
          content: "Low confidence",
          confidence: "low",
          sourceFile: "src/c.ts"
        })

        return yield* repo.findByFilter({ confidence: "high" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].confidence).toBe("high")
  })

  it("filters by multiple confidence levels", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "High",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "Medium",
          confidence: "medium",
          sourceFile: "src/b.ts"
        })
        yield* repo.insert({
          content: "Low",
          confidence: "low",
          sourceFile: "src/c.ts"
        })

        return yield* repo.findByFilter({ confidence: ["high", "medium"] })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    const confidences = result.map(c => c.confidence)
    expect(confidences).toContain("high")
    expect(confidences).toContain("medium")
  })

  it("filters by single category", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "Security learning",
          confidence: "high",
          category: "security",
          sourceFile: "src/auth.ts"
        })
        yield* repo.insert({
          content: "Performance learning",
          confidence: "high",
          category: "performance",
          sourceFile: "src/cache.ts"
        })

        return yield* repo.findByFilter({ category: "security" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].category).toBe("security")
  })

  it("filters by multiple categories", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "Security",
          confidence: "high",
          category: "security",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "Performance",
          confidence: "high",
          category: "performance",
          sourceFile: "src/b.ts"
        })
        yield* repo.insert({
          content: "Testing",
          confidence: "high",
          category: "testing",
          sourceFile: "src/c.ts"
        })

        return yield* repo.findByFilter({ category: ["security", "testing"] })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
    const categories = result.map(c => c.category)
    expect(categories).toContain("security")
    expect(categories).toContain("testing")
  })

  it("filters by sourceFile", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "From db.ts",
          confidence: "high",
          sourceFile: "src/db.ts"
        })
        yield* repo.insert({
          content: "From auth.ts",
          confidence: "high",
          sourceFile: "src/auth.ts"
        })

        return yield* repo.findByFilter({ sourceFile: "src/db.ts" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].sourceFile).toBe("src/db.ts")
  })

  it("filters by sourceRunId", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "From run 1",
          confidence: "high",
          sourceFile: "src/a.ts",
          sourceRunId: FIXTURES.RUN_1
        })
        yield* repo.insert({
          content: "From run 2",
          confidence: "high",
          sourceFile: "src/b.ts",
          sourceRunId: FIXTURES.RUN_2
        })

        return yield* repo.findByFilter({ sourceRunId: FIXTURES.RUN_1 })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].sourceRunId).toBe(FIXTURES.RUN_1)
  })

  it("filters by sourceTaskId", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "From task 1",
          confidence: "high",
          sourceFile: "src/a.ts",
          sourceTaskId: FIXTURES.TASK_1
        })
        yield* repo.insert({
          content: "From task 2",
          confidence: "high",
          sourceFile: "src/b.ts",
          sourceTaskId: FIXTURES.TASK_2
        })

        return yield* repo.findByFilter({ sourceTaskId: FIXTURES.TASK_1 })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].sourceTaskId).toBe(FIXTURES.TASK_1)
  })

  it("supports pagination with limit", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        for (let i = 1; i <= 5; i++) {
          yield* repo.insert({
            content: `Candidate ${i}`,
            confidence: "medium",
            sourceFile: `src/file${i}.ts`
          })
        }

        return yield* repo.findByFilter({ limit: 2 })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
  })

  it("supports pagination with limit and offset", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        for (let i = 1; i <= 5; i++) {
          yield* repo.insert({
            content: `Candidate ${i}`,
            confidence: "medium",
            sourceFile: `src/file${i}.ts`
          })
        }

        const firstPage = yield* repo.findByFilter({ limit: 2 })
        const secondPage = yield* repo.findByFilter({ limit: 2, offset: 2 })

        return { firstPage, secondPage }
      }).pipe(Effect.provide(layer))
    )

    expect(result.firstPage).toHaveLength(2)
    expect(result.secondPage).toHaveLength(2)

    // Verify different candidates (no overlap)
    const firstIds = result.firstPage.map(c => c.id)
    const secondIds = result.secondPage.map(c => c.id)
    expect(firstIds.some(id => secondIds.includes(id))).toBe(false)
  })

  it("combines multiple filters", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        yield* repo.insert({
          content: "High security",
          confidence: "high",
          category: "security",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "Medium security",
          confidence: "medium",
          category: "security",
          sourceFile: "src/b.ts"
        })
        yield* repo.insert({
          content: "High performance",
          confidence: "high",
          category: "performance",
          sourceFile: "src/c.ts"
        })

        return yield* repo.findByFilter({
          confidence: "high",
          category: "security"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("High security")
  })

  it("orders results by extracted_at DESC", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        // Insert in sequence - latest should come first
        yield* repo.insert({
          content: "First inserted",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "Second inserted",
          confidence: "high",
          sourceFile: "src/b.ts"
        })
        yield* repo.insert({
          content: "Third inserted",
          confidence: "high",
          sourceFile: "src/c.ts"
        })

        return yield* repo.findByFilter({})
      }).pipe(Effect.provide(layer))
    )

    // Most recently inserted should be first (DESC order by extracted_at)
    expect(result).toHaveLength(3)
    expect(result[0].content).toBe("Third inserted")
    expect(result[1].content).toBe("Second inserted")
    expect(result[2].content).toBe("First inserted")
  })
})

// =============================================================================
// CandidateRepository Update Tests
// =============================================================================

describe("CandidateRepository.update", () => {
  it("updates status field", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* repo.update(candidate.id, { status: "promoted" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("promoted")
  })

  it("updates reviewedAt field", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const reviewedAt = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* repo.update(candidate.id, { reviewedAt })
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.reviewedAt).not.toBeNull()
    // Compare timestamps (may have slight precision differences)
    expect(result!.reviewedAt!.getTime()).toBeCloseTo(reviewedAt.getTime(), -3)
  })

  it("updates reviewedBy field", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* repo.update(candidate.id, { reviewedBy: "auto" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.reviewedBy).toBe("auto")
  })

  it("updates promotedLearningId field", async () => {
    const { makeAppLayer, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const learningSvc = yield* LearningService

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        const learning = yield* learningSvc.create({
          content: "Promoted learning",
          sourceType: "manual"
        })

        return yield* repo.update(candidate.id, { promotedLearningId: learning.id })
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.promotedLearningId).not.toBeNull()
  })

  it("updates rejectionReason field", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        return yield* repo.update(candidate.id, {
          status: "rejected",
          rejectionReason: "Duplicate content"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("rejected")
    expect(result!.rejectionReason).toBe("Duplicate content")
  })

  it("updates multiple fields at once", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const reviewedAt = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* repo.update(candidate.id, {
          status: "promoted",
          reviewedAt,
          reviewedBy: "manual"
        })
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("promoted")
    expect(result!.reviewedAt).not.toBeNull()
    expect(result!.reviewedBy).toBe("manual")
  })

  it("returns current row when no updates provided", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* repo.update(candidate.id, {})
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.content).toBe("Test candidate")
    expect(result!.status).toBe("pending")
  })

  it("returns null for nonexistent ID", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        return yield* repo.update(999, { status: "promoted" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })
})

describe("CandidateRepository.updateStatus", () => {
  it("updates status to promoted", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* repo.updateStatus(candidate.id, "promoted")
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("promoted")
  })

  it("updates status to rejected", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        return yield* repo.updateStatus(candidate.id, "rejected")
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("rejected")
  })

  it("updates status to merged", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate",
          confidence: "medium",
          sourceFile: "src/test.ts"
        })

        return yield* repo.updateStatus(candidate.id, "merged")
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("merged")
  })

  it("returns null for nonexistent ID", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        return yield* repo.updateStatus(999, "promoted")
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBeNull()
  })

  it("preserves other fields when updating status", async () => {
    const { makeAppLayer, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository

        const candidate = yield* repo.insert({
          content: "Test candidate content",
          confidence: "high",
          category: "security",
          sourceFile: "src/auth.ts",
          sourceRunId: FIXTURES.RUN_1,
          sourceTaskId: FIXTURES.TASK_1
        })

        return yield* repo.updateStatus(candidate.id, "promoted")
      }).pipe(Effect.provide(layer))
    )

    expect(result).not.toBeNull()
    expect(result!.status).toBe("promoted")
    expect(result!.content).toBe("Test candidate content")
    expect(result!.confidence).toBe("high")
    expect(result!.category).toBe("security")
    expect(result!.sourceFile).toBe("src/auth.ts")
    expect(result!.sourceRunId).toBe(FIXTURES.RUN_1)
    expect(result!.sourceTaskId).toBe(FIXTURES.TASK_1)
  })
})
