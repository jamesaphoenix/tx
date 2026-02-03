/**
 * Anchor TTL Cache Integration Tests (PRD-017)
 *
 * Tests lazy verification behavior:
 * 1. Stale anchor (verified_at older than TTL) triggers re-verification
 * 2. Fresh anchor (verified_at within TTL) returns cached result without verification
 * 3. Custom TTL via TX_ANCHOR_CACHE_TTL env var
 * 4. Anchor never verified (null verified_at) triggers verification
 *
 * Uses real in-memory SQLite and SHA256-based fixture IDs per Rule 3.
 */

import { describe, it, expect, afterEach } from "vitest"
import { Effect } from "effect"
import { createHash } from "node:crypto"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`anchor-ttl-cache-test:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `fixture-${hash}`
}

const FIXTURES = {
  LEARNING_TTL: fixtureId("learning-ttl"),
  FILE_PATH: "src/services/anchor-service.ts",
  GLOB_PATTERN: "src/**/*.ts",
  CONTENT_HASH: "a".repeat(64),
} as const

// =============================================================================
// Test 1: Anchor never verified (null verified_at) triggers verification
// =============================================================================

describe("Anchor TTL Cache - Never Verified", () => {
  it("anchor with null verified_at triggers verification", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for TTL testing - never verified",
          sourceType: "manual",
        })

        // Create anchor - verified_at will be null initially
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Get anchor to verify verified_at is null
        const anchor = yield* anchorSvc.get(1)

        // getWithVerification should trigger verification since verified_at is null
        const withVerification = yield* anchorSvc.getWithVerification(1)

        return { anchor, withVerification }
      }).pipe(Effect.provide(layer))
    )

    // Initial anchor should have null verified_at
    expect(result.anchor.verifiedAt).toBeNull()

    // getWithVerification should have performed verification
    expect(result.withVerification.isFresh).toBe(false)
    expect(result.withVerification.wasVerified).toBe(true)
    expect(result.withVerification.anchor).toBeDefined()
    // After verification, verified_at should be set
    expect(result.withVerification.anchor.verifiedAt).not.toBeNull()
  })
})

// =============================================================================
// Test 2: Fresh anchor returns cached result without verification
// =============================================================================

describe("Anchor TTL Cache - Fresh Anchor", () => {
  it("fresh anchor (just verified) returns cached result without re-verification", async () => {
    const { makeAppLayer, AnchorService, LearningService, AnchorRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for TTL testing - fresh anchor",
          sourceType: "manual",
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Manually set verified_at to now (simulating recent verification)
        yield* anchorRepo.updateVerifiedAt(1)

        // Get anchor to verify verified_at is set
        const anchor = yield* anchorSvc.get(1)

        // getWithVerification should return cached result since it's fresh
        const withVerification = yield* anchorSvc.getWithVerification(1)

        return { anchor, withVerification }
      }).pipe(Effect.provide(layer))
    )

    // Anchor should have verified_at set
    expect(result.anchor.verifiedAt).not.toBeNull()

    // getWithVerification should return fresh result without verification
    expect(result.withVerification.isFresh).toBe(true)
    expect(result.withVerification.wasVerified).toBe(false)
    expect(result.withVerification.anchor).toBeDefined()
    // verificationResult should not be present for fresh anchors
    expect(result.withVerification.verificationResult).toBeUndefined()
  })
})

// =============================================================================
// Test 3: Stale anchor triggers re-verification
// =============================================================================

describe("Anchor TTL Cache - Stale Anchor", () => {
  it("stale anchor (verified_at older than TTL) triggers re-verification", async () => {
    const { makeAppLayer, AnchorService, LearningService, AnchorRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for TTL testing - stale anchor",
          sourceType: "manual",
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Set verified_at to 2 hours ago (older than default 1 hour TTL)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
        yield* anchorRepo.update(1, { verifiedAt: twoHoursAgo })

        // Get anchor to verify verified_at is set to old timestamp
        const anchorBefore = yield* anchorSvc.get(1)

        // getWithVerification should trigger re-verification since it's stale
        const withVerification = yield* anchorSvc.getWithVerification(1)

        // Get anchor after to check verified_at was updated
        const anchorAfter = yield* anchorSvc.get(1)

        return { anchorBefore, withVerification, anchorAfter }
      }).pipe(Effect.provide(layer))
    )

    // Before: verified_at should be 2 hours ago
    expect(result.anchorBefore.verifiedAt).not.toBeNull()
    const twoHoursAgoMs = Date.now() - 2 * 60 * 60 * 1000
    const verifiedAtMs = result.anchorBefore.verifiedAt!.getTime()
    expect(verifiedAtMs).toBeLessThan(twoHoursAgoMs + 5000) // within 5s tolerance

    // getWithVerification should indicate stale (not fresh) and verification occurred
    expect(result.withVerification.isFresh).toBe(false)
    expect(result.withVerification.wasVerified).toBe(true)
    expect(result.withVerification.verificationResult).toBeDefined()

    // After: verified_at should be updated to now
    expect(result.anchorAfter.verifiedAt).not.toBeNull()
    const now = Date.now()
    const afterVerifiedAtMs = result.anchorAfter.verifiedAt!.getTime()
    expect(afterVerifiedAtMs).toBeGreaterThan(now - 5000) // within last 5 seconds
  })

  it("stale anchor returns unchanged action when status doesn't change", async () => {
    const { makeAppLayer, AnchorService, LearningService, AnchorRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for TTL testing - stale unchanged",
          sourceType: "manual",
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Set verified_at to 2 hours ago
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
        yield* anchorRepo.update(1, { verifiedAt: twoHoursAgo })

        // getWithVerification should trigger re-verification
        return yield* anchorSvc.getWithVerification(1)
      }).pipe(Effect.provide(layer))
    )

    expect(result.wasVerified).toBe(true)
    expect(result.verificationResult).toBeDefined()
    // Status should be unchanged (valid -> valid for glob anchor)
    expect(result.verificationResult!.action).toBe("unchanged")
    expect(result.verificationResult!.previousStatus).toBe("valid")
    expect(result.verificationResult!.newStatus).toBe("valid")
  })
})

// =============================================================================
// Test 4: Custom TTL via TX_ANCHOR_CACHE_TTL env var
// =============================================================================

describe("Anchor TTL Cache - Custom TTL", () => {
  const originalEnv = process.env.TX_ANCHOR_CACHE_TTL

  afterEach(() => {
    // Restore original env var
    if (originalEnv === undefined) {
      delete process.env.TX_ANCHOR_CACHE_TTL
    } else {
      process.env.TX_ANCHOR_CACHE_TTL = originalEnv
    }
  })

  it("respects custom TX_ANCHOR_CACHE_TTL env var (short TTL makes anchor stale)", async () => {
    // Set a very short TTL (1 second)
    process.env.TX_ANCHOR_CACHE_TTL = "1"

    const { makeAppLayer, AnchorService, LearningService, AnchorRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for custom TTL testing - short",
          sourceType: "manual",
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Set verified_at to 5 seconds ago (older than 1 second TTL)
        const fiveSecondsAgo = new Date(Date.now() - 5000)
        yield* anchorRepo.update(1, { verifiedAt: fiveSecondsAgo })

        // getWithVerification should trigger re-verification with custom TTL
        return yield* anchorSvc.getWithVerification(1)
      }).pipe(Effect.provide(layer))
    )

    // With 1 second TTL and verified_at 5 seconds ago, should be stale
    expect(result.isFresh).toBe(false)
    expect(result.wasVerified).toBe(true)
  })

  it("respects custom TX_ANCHOR_CACHE_TTL env var (long TTL keeps anchor fresh)", async () => {
    // Set a very long TTL (1 hour = 3600 seconds)
    process.env.TX_ANCHOR_CACHE_TTL = "3600"

    const { makeAppLayer, AnchorService, LearningService, AnchorRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for custom TTL testing - long",
          sourceType: "manual",
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Set verified_at to 30 minutes ago (still within 1 hour TTL)
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
        yield* anchorRepo.update(1, { verifiedAt: thirtyMinutesAgo })

        // getWithVerification should return cached result with long TTL
        return yield* anchorSvc.getWithVerification(1)
      }).pipe(Effect.provide(layer))
    )

    // With 1 hour TTL and verified_at 30 minutes ago, should be fresh
    expect(result.isFresh).toBe(true)
    expect(result.wasVerified).toBe(false)
  })
})

// =============================================================================
// Test 5: Edge Cases
// =============================================================================

describe("Anchor TTL Cache - Edge Cases", () => {
  it("getWithVerification fails with AnchorNotFoundError for nonexistent ID", async () => {
    const { makeAppLayer, AnchorService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const anchorSvc = yield* AnchorService
        return yield* anchorSvc.getWithVerification(999)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("AnchorNotFoundError")
    }
  })

  it("verified_at exactly at TTL boundary is considered stale", async () => {
    const { makeAppLayer, AnchorService, LearningService, AnchorRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    // Default TTL is 3600 seconds (1 hour)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for TTL boundary testing",
          sourceType: "manual",
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Set verified_at to exactly TTL ago (plus a tiny bit for safety)
        const exactlyAtTTL = new Date(Date.now() - 3600 * 1000 - 100)
        yield* anchorRepo.update(1, { verifiedAt: exactlyAtTTL })

        return yield* anchorSvc.getWithVerification(1)
      }).pipe(Effect.provide(layer))
    )

    // At or beyond TTL boundary should be stale
    expect(result.isFresh).toBe(false)
    expect(result.wasVerified).toBe(true)
  })

  it("verified_at just before TTL boundary is considered fresh", async () => {
    const { makeAppLayer, AnchorService, LearningService, AnchorRepository } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    // Default TTL is 3600 seconds (1 hour)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService
        const anchorRepo = yield* AnchorRepository

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for TTL boundary testing - fresh",
          sourceType: "manual",
        })

        // Create anchor
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // Set verified_at to 10 seconds before TTL expires
        const justBeforeTTL = new Date(Date.now() - 3600 * 1000 + 10000)
        yield* anchorRepo.update(1, { verifiedAt: justBeforeTTL })

        return yield* anchorSvc.getWithVerification(1)
      }).pipe(Effect.provide(layer))
    )

    // Just before TTL boundary should be fresh
    expect(result.isFresh).toBe(true)
    expect(result.wasVerified).toBe(false)
  })

  it("multiple getWithVerification calls on same anchor within TTL only verify once", async () => {
    const { makeAppLayer, AnchorService, LearningService } = await import("@jamesaphoenix/tx-core")
    const layer = makeAppLayer(":memory:")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService
        const anchorSvc = yield* AnchorService

        // Create a learning
        const learning = yield* learningSvc.create({
          content: "Learning for multiple calls testing",
          sourceType: "manual",
        })

        // Create anchor (verified_at is null initially)
        yield* anchorSvc.createAnchor({
          learningId: learning.id,
          anchorType: "glob",
          filePath: FIXTURES.FILE_PATH,
          value: FIXTURES.GLOB_PATTERN,
        })

        // First call - should verify (verified_at is null)
        const first = yield* anchorSvc.getWithVerification(1)

        // Second call - should return cached (verified_at is now set)
        const second = yield* anchorSvc.getWithVerification(1)

        // Third call - should return cached
        const third = yield* anchorSvc.getWithVerification(1)

        return { first, second, third }
      }).pipe(Effect.provide(layer))
    )

    // First call should have triggered verification
    expect(result.first.wasVerified).toBe(true)
    expect(result.first.isFresh).toBe(false)

    // Second call should return cached
    expect(result.second.wasVerified).toBe(false)
    expect(result.second.isFresh).toBe(true)

    // Third call should return cached
    expect(result.third.wasVerified).toBe(false)
    expect(result.third.isFresh).toBe(true)
  })
})

