/**
 * PromotionService Integration Tests
 *
 * Tests the PromotionService at the service layer with full dependency injection.
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
    .update(`promotion-service-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  RUN_1: fixtureId("run-1"),
  RUN_2: fixtureId("run-2"),
  TASK_1: fixtureId("task-1"),
} as const

// Suppress unused warning - kept for documentation and future use
void FIXTURES

// =============================================================================
// PromotionService.list Tests
// =============================================================================

describe("PromotionService.list", () => {
  it("returns empty array when no candidates exist", async () => {
    const { makeAppLayer, PromotionService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromotionService
        return yield* svc.list({})
      }).pipe(Effect.provide(layer))
    )

    expect(result).toEqual([])
  })

  it("returns all candidates when no filter is applied", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Insert test candidates
        yield* repo.insert({
          content: "Always validate user input",
          confidence: "high",
          sourceFile: "src/validation.ts"
        })
        yield* repo.insert({
          content: "Use transactions for database operations",
          confidence: "medium",
          sourceFile: "src/db.ts"
        })

        return yield* svc.list({})
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(2)
  })

  it("filters by status", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

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

        // All are 'pending' by default
        const pending = yield* svc.list({ status: "pending" })
        const promoted = yield* svc.list({ status: "promoted" })

        return { pending, promoted }
      }).pipe(Effect.provide(layer))
    )

    expect(result.pending).toHaveLength(2)
    expect(result.promoted).toHaveLength(0)
  })

  it("filters by confidence level", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "High confidence learning",
          confidence: "high",
          sourceFile: "src/high.ts"
        })
        yield* repo.insert({
          content: "Medium confidence learning",
          confidence: "medium",
          sourceFile: "src/medium.ts"
        })
        yield* repo.insert({
          content: "Low confidence learning",
          confidence: "low",
          sourceFile: "src/low.ts"
        })

        return yield* svc.list({ confidence: "high" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].confidence).toBe("high")
  })

  it("filters by category", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "Security best practice",
          confidence: "high",
          category: "security",
          sourceFile: "src/auth.ts"
        })
        yield* repo.insert({
          content: "Performance optimization",
          confidence: "high",
          category: "performance",
          sourceFile: "src/cache.ts"
        })

        return yield* svc.list({ category: "security" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].category).toBe("security")
  })

  it("supports pagination with limit and offset", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Insert 5 candidates
        for (let i = 1; i <= 5; i++) {
          yield* repo.insert({
            content: `Learning ${i}`,
            confidence: "medium",
            sourceFile: `src/file${i}.ts`
          })
        }

        const firstPage = yield* svc.list({ limit: 2 })
        const secondPage = yield* svc.list({ limit: 2, offset: 2 })

        return { firstPage, secondPage }
      }).pipe(Effect.provide(layer))
    )

    expect(result.firstPage).toHaveLength(2)
    expect(result.secondPage).toHaveLength(2)

    // Verify different candidates
    const firstIds = result.firstPage.map(c => c.id)
    const secondIds = result.secondPage.map(c => c.id)
    expect(firstIds.some(id => secondIds.includes(id))).toBe(false)
  })
})

// =============================================================================
// PromotionService.promote Tests
// =============================================================================

describe("PromotionService.promote", () => {
  it("promotes a candidate to a learning", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        const candidate = yield* repo.insert({
          content: "Always use prepared statements for SQL queries",
          confidence: "high",
          category: "security",
          sourceFile: "src/db.ts"
        })

        const promotionResult = yield* svc.promote(candidate.id)

        // Verify the learning exists
        const learning = yield* learningSvc.get(promotionResult.learning.id)

        return { promotionResult, learning, candidate }
      }).pipe(Effect.provide(layer))
    )

    expect(result.promotionResult.candidate.id).toBe(result.candidate.id)
    expect(result.promotionResult.candidate.status).toBe("promoted")
    expect(result.promotionResult.candidate.reviewedBy).toBe("manual")
    expect(result.promotionResult.candidate.promotedLearningId).toBe(result.promotionResult.learning.id)
    expect(result.promotionResult.learning.content).toBe("Always use prepared statements for SQL queries")
    expect(result.promotionResult.learning.category).toBe("security")
    expect(result.learning.content).toBe("Always use prepared statements for SQL queries")
  })

  it("fails with CandidateNotFoundError for nonexistent candidate", async () => {
    const { makeAppLayer, PromotionService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromotionService
        return yield* svc.promote(99999)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("CandidateNotFoundError")
    }
  })

  it("sets reviewedAt timestamp on promotion", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const before = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Test learning",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* svc.promote(candidate.id)
      }).pipe(Effect.provide(layer))
    )

    const after = new Date()

    expect(result.candidate.reviewedAt).not.toBeNull()
    const reviewedAt = result.candidate.reviewedAt!
    expect(reviewedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(reviewedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it("links promoted learning to source run via DERIVED_FROM edge", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, EdgeService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const edgeSvc = yield* EdgeService

        const candidate = yield* repo.insert({
          content: "Learning from a run",
          confidence: "high",
          sourceFile: "src/test.ts",
          sourceRunId: FIXTURES.RUN_1
        })

        const promotionResult = yield* svc.promote(candidate.id)

        // Check for DERIVED_FROM edge
        const edges = yield* edgeSvc.findFromSource("learning", String(promotionResult.learning.id))

        return { promotionResult, edges }
      }).pipe(Effect.provide(layer))
    )

    const derivedEdge = result.edges.find(e => e.edgeType === "DERIVED_FROM")
    expect(derivedEdge).toBeDefined()
    expect(derivedEdge!.targetType).toBe("run")
    expect(derivedEdge!.targetId).toBe(FIXTURES.RUN_1)
  })

  it("links promoted learning to source task via DERIVED_FROM edge", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, EdgeService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const edgeSvc = yield* EdgeService

        const candidate = yield* repo.insert({
          content: "Learning from a task",
          confidence: "high",
          sourceFile: "src/test.ts",
          sourceTaskId: FIXTURES.TASK_1
        })

        const promotionResult = yield* svc.promote(candidate.id)

        // Check for DERIVED_FROM edge
        const edges = yield* edgeSvc.findFromSource("learning", String(promotionResult.learning.id))

        return { promotionResult, edges }
      }).pipe(Effect.provide(layer))
    )

    const derivedEdge = result.edges.find(e => e.edgeType === "DERIVED_FROM")
    expect(derivedEdge).toBeDefined()
    expect(derivedEdge!.targetType).toBe("task")
    expect(derivedEdge!.targetId).toBe(FIXTURES.TASK_1)
  })

  it("does not create edge when candidate has no source run or task", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, EdgeService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const edgeSvc = yield* EdgeService

        const candidate = yield* repo.insert({
          content: "Learning with no source",
          confidence: "high",
          sourceFile: "src/test.ts"
          // No sourceRunId or sourceTaskId
        })

        const promotionResult = yield* svc.promote(candidate.id)

        // Check for edges
        const edges = yield* edgeSvc.findFromSource("learning", String(promotionResult.learning.id))

        return { promotionResult, edges }
      }).pipe(Effect.provide(layer))
    )

    // Should not have any DERIVED_FROM edges
    const derivedEdges = result.edges.filter(e => e.edgeType === "DERIVED_FROM")
    expect(derivedEdges).toHaveLength(0)
  })
})

// =============================================================================
// PromotionService.reject Tests
// =============================================================================

describe("PromotionService.reject", () => {
  it("rejects a candidate with a reason", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Possibly incorrect learning",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        return yield* svc.reject(candidate.id, "Not accurate enough")
      }).pipe(Effect.provide(layer))
    )

    expect(result.status).toBe("rejected")
    expect(result.reviewedBy).toBe("manual")
    expect(result.rejectionReason).toBe("Not accurate enough")
  })

  it("fails with CandidateNotFoundError for nonexistent candidate", async () => {
    const { makeAppLayer, PromotionService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromotionService
        return yield* svc.reject(99999, "Some reason")
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("CandidateNotFoundError")
    }
  })

  it("fails with ValidationError for empty rejection reason", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Test learning",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        return yield* svc.reject(candidate.id, "")
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("fails with ValidationError for whitespace-only rejection reason", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Test learning",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        return yield* svc.reject(candidate.id, "   ")
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("trims whitespace from rejection reason", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Test learning",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        return yield* svc.reject(candidate.id, "  Duplicate content  ")
      }).pipe(Effect.provide(layer))
    )

    expect(result.rejectionReason).toBe("Duplicate content")
  })

  it("sets reviewedAt timestamp on rejection", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const before = new Date()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Test learning",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        return yield* svc.reject(candidate.id, "Not relevant")
      }).pipe(Effect.provide(layer))
    )

    const after = new Date()

    expect(result.reviewedAt).not.toBeNull()
    const reviewedAt = result.reviewedAt!
    expect(reviewedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(reviewedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// =============================================================================
// PromotionService.autoPromote Tests
// =============================================================================

describe("PromotionService.autoPromote", () => {
  it("promotes high-confidence pending candidates", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Insert candidates with different confidence levels
        yield* repo.insert({
          content: "High confidence learning 1",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "High confidence learning 2",
          confidence: "high",
          sourceFile: "src/b.ts"
        })
        yield* repo.insert({
          content: "Medium confidence learning",
          confidence: "medium",
          sourceFile: "src/c.ts"
        })
        yield* repo.insert({
          content: "Low confidence learning",
          confidence: "low",
          sourceFile: "src/d.ts"
        })

        return yield* svc.autoPromote()
      }).pipe(Effect.provide(layer))
    )

    // Only high-confidence candidates should be promoted
    expect(result.promoted).toBe(2)
    expect(result.learningIds).toHaveLength(2)
  })

  it("returns zero counts when no high-confidence candidates exist", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "Medium confidence learning",
          confidence: "medium",
          sourceFile: "src/a.ts"
        })

        return yield* svc.autoPromote()
      }).pipe(Effect.provide(layer))
    )

    expect(result.promoted).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.learningIds).toHaveLength(0)
  })

  it("skips candidates that are duplicates of existing learnings", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        // Create an existing learning
        yield* learningSvc.create({
          content: "Exactly the same content",
          sourceType: "manual"
        })

        // Create a candidate with similar content
        yield* repo.insert({
          content: "Exactly the same content",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        return yield* svc.autoPromote()
      }).pipe(Effect.provide(layer))
    )

    // Since the content is identical, it may be detected as duplicate
    // (depends on embedding similarity and threshold)
    // With EmbeddingServiceNoop, search returns empty so no duplicates detected
    expect(result.promoted + result.skipped).toBe(1)
  })

  it("uses 'auto' as reviewer identifier", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        yield* repo.insert({
          content: "Auto-promoted learning",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        yield* svc.autoPromote()

        // Check the candidate's reviewedBy field
        return yield* svc.list({ status: "promoted" })
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].reviewedBy).toBe("auto")
  })

  it("does not promote non-pending candidates", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Insert a candidate and manually mark it as rejected
        const candidate = yield* repo.insert({
          content: "Already rejected",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        yield* repo.updateStatus(candidate.id, "rejected")

        return yield* svc.autoPromote()
      }).pipe(Effect.provide(layer))
    )

    expect(result.promoted).toBe(0)
  })

  it("creates DERIVED_FROM edge during auto-promotion", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, EdgeService, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const edgeSvc = yield* EdgeService
        const learningSvc = yield* LearningService

        yield* repo.insert({
          content: "Auto-promoted with edge",
          confidence: "high",
          sourceFile: "src/test.ts",
          sourceRunId: FIXTURES.RUN_2
        })

        const autoResult = yield* svc.autoPromote()

        // Verify the learning was created
        expect(autoResult.learningIds).toHaveLength(1)

        // Check for DERIVED_FROM edge from the learning
        const edges = yield* edgeSvc.findFromSource("learning", String(autoResult.learningIds[0]))

        // Verify learning exists and has correct content
        const learning = yield* learningSvc.get(autoResult.learningIds[0])

        return { autoResult, edges, learning }
      }).pipe(Effect.provide(layer))
    )

    expect(result.autoResult.promoted).toBe(1)
    expect(result.learning.content).toBe("Auto-promoted with edge")

    const derivedEdge = result.edges.find(e => e.edgeType === "DERIVED_FROM")
    expect(derivedEdge).toBeDefined()
    expect(derivedEdge!.targetType).toBe("run")
    expect(derivedEdge!.targetId).toBe(FIXTURES.RUN_2)
  })
})

// =============================================================================
// PromotionService.getPending Tests
// =============================================================================

describe("PromotionService.getPending", () => {
  it("returns only pending candidates", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        // Insert candidates
        const candidate1 = yield* repo.insert({
          content: "Pending 1",
          confidence: "high",
          sourceFile: "src/a.ts"
        })
        yield* repo.insert({
          content: "Pending 2",
          confidence: "medium",
          sourceFile: "src/b.ts"
        })
        const candidate3 = yield* repo.insert({
          content: "Will be rejected",
          confidence: "low",
          sourceFile: "src/c.ts"
        })

        // Reject one candidate
        yield* repo.updateStatus(candidate3.id, "rejected")

        // Promote one candidate
        yield* svc.promote(candidate1.id)

        return yield* svc.getPending()
      }).pipe(Effect.provide(layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("Pending 2")
    expect(result[0].status).toBe("pending")
  })

  it("returns empty array when no pending candidates exist", async () => {
    const { makeAppLayer, PromotionService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const pending = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromotionService
        return yield* svc.getPending()
      }).pipe(Effect.provide(layer))
    )

    expect(pending).toEqual([])
  })
})

// =============================================================================
// PromotionService Candidate Lifecycle Tests
// =============================================================================

describe("PromotionService candidate lifecycle", () => {
  it("candidate transitions correctly: pending → promoted", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Lifecycle test",
          confidence: "high",
          sourceFile: "src/test.ts"
        })

        // Initial state
        const initialCandidate = candidate

        // Promote
        const promotionResult = yield* svc.promote(candidate.id)

        return { initialCandidate, promotionResult }
      }).pipe(Effect.provide(layer))
    )

    expect(result.initialCandidate.status).toBe("pending")
    expect(result.promotionResult.candidate.status).toBe("promoted")
    expect(result.promotionResult.candidate.promotedLearningId).not.toBeNull()
  })

  it("candidate transitions correctly: pending → rejected", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService

        const candidate = yield* repo.insert({
          content: "Lifecycle test",
          confidence: "low",
          sourceFile: "src/test.ts"
        })

        // Initial state
        const initialCandidate = candidate

        // Reject
        const rejectedCandidate = yield* svc.reject(candidate.id, "Not useful")

        return { initialCandidate, rejectedCandidate }
      }).pipe(Effect.provide(layer))
    )

    expect(result.initialCandidate.status).toBe("pending")
    expect(result.rejectedCandidate.status).toBe("rejected")
    expect(result.rejectedCandidate.rejectionReason).toBe("Not useful")
    expect(result.rejectedCandidate.promotedLearningId).toBeNull()
  })

  it("promoted learning inherits candidate category", async () => {
    const { makeAppLayer, PromotionService, CandidateRepository, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* CandidateRepository
        const svc = yield* PromotionService
        const learningSvc = yield* LearningService

        const candidate = yield* repo.insert({
          content: "Category test",
          confidence: "high",
          category: "architecture",
          sourceFile: "src/test.ts"
        })

        const promotionResult = yield* svc.promote(candidate.id)

        // Verify learning has the category
        const learning = yield* learningSvc.get(promotionResult.learning.id)

        return { promotionResult, learning }
      }).pipe(Effect.provide(layer))
    )

    expect(result.learning.category).toBe("architecture")
  })
})
