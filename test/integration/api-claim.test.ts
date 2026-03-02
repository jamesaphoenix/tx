/**
 * Integration tests for REST API claim endpoints.
 *
 * Tests the claim route handlers at the service level (same pattern as MCP tests).
 * The REST handlers in apps/api-server/src/routes/tasks.ts delegate to ClaimService
 * and serialize results via serializeClaim (Date -> ISO string conversion).
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 *
 * @see PRD-018 for worker orchestration specification
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { ClaimService, TaskService, SqliteClient } from "@jamesaphoenix/tx-core"

// Helper: register a worker in the workers table (required by FK on task_claims)
const registerWorker = (workerId: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    db.prepare(
      `INSERT OR IGNORE INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at)
       VALUES (?, ?, 'localhost', 1, 'idle', datetime('now'), datetime('now'))`
    ).run(workerId, workerId)
  })

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mirrors the serializeClaim function from apps/api-server/src/routes/tasks.ts.
 * The REST API converts Date fields to ISO strings before returning to clients.
 */
const serializeClaim = (claim: {
  id: number
  taskId: string
  workerId: string
  claimedAt: Date
  leaseExpiresAt: Date
  renewedCount: number
  status: string
}) => ({
  id: claim.id,
  taskId: claim.taskId,
  workerId: claim.workerId,
  claimedAt: claim.claimedAt.toISOString(),
  leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
  renewedCount: claim.renewedCount,
  status: claim.status,
})

// =============================================================================
// Tests
// =============================================================================

describe("API Claim Endpoints Integration", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // ---------------------------------------------------------------------------
  // 1. claim endpoint returns serialized claim with ISO dates
  // ---------------------------------------------------------------------------

  it("claim endpoint returns serialized claim with ISO dates", async () => {
    const workerId = "worker-iso-test"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const created = yield* taskService.create({ title: "Claim ISO dates task" })
        yield* registerWorker(workerId)
        const claim = yield* claimService.claim(created.id, workerId)
        return serializeClaim(claim)
      }).pipe(Effect.provide(shared.layer))
    )

    // Verify ISO string format for date fields
    expect(result.claimedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.leaseExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    // Verify they are valid dates
    expect(new Date(result.claimedAt).getTime()).not.toBeNaN()
    expect(new Date(result.leaseExpiresAt).getTime()).not.toBeNaN()
    // Verify other fields
    expect(result.workerId).toBe(workerId)
    expect(result.renewedCount).toBe(0)
    expect(result.status).toBe("active")
    expect(typeof result.id).toBe("number")
  })

  // ---------------------------------------------------------------------------
  // 2. claim with custom leaseDurationMinutes
  // ---------------------------------------------------------------------------

  it("claim with custom leaseDurationMinutes", async () => {
    const workerId = "worker-custom-lease"
    const leaseDurationMinutes = 60

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const task = yield* taskService.create({ title: "Custom lease task" })
        yield* registerWorker(workerId)
        const beforeClaim = new Date()
        const claim = yield* claimService.claim(task.id, workerId, leaseDurationMinutes)
        return { claim: serializeClaim(claim), beforeClaim }
      }).pipe(Effect.provide(shared.layer))
    )

    const claimedAt = new Date(result.claim.claimedAt)
    const leaseExpiresAt = new Date(result.claim.leaseExpiresAt)

    // The lease should expire approximately 60 minutes from the claim time
    const diffMs = leaseExpiresAt.getTime() - claimedAt.getTime()
    const diffMinutes = diffMs / (60 * 1000)

    // Allow a small tolerance for execution time (should be very close to 60)
    expect(diffMinutes).toBeGreaterThanOrEqual(59.9)
    expect(diffMinutes).toBeLessThanOrEqual(60.1)
  })

  // ---------------------------------------------------------------------------
  // 3. release endpoint returns success
  // ---------------------------------------------------------------------------

  it("release endpoint returns success", async () => {
    const workerId = "worker-release-test"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const task = yield* taskService.create({ title: "Release test task" })
        yield* registerWorker(workerId)
        yield* claimService.claim(task.id, workerId)

        // Release the claim (mirrors the route handler returning { success: true })
        yield* claimService.release(task.id, workerId)

        // Verify the claim is no longer active
        const activeClaim = yield* claimService.getActiveClaim(task.id)
        return { success: true as const, activeClaim }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.success).toBe(true)
    expect(result.activeClaim).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 4. release fails with error for unclaimed task
  // ---------------------------------------------------------------------------

  it("release fails with ClaimNotFoundError for unclaimed task", async () => {
    const workerId = "worker-release-fail"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const task = yield* taskService.create({ title: "Unclaimed release task" })

        // Try to release a task that has no claim
        const exit = yield* claimService.release(task.id, workerId).pipe(Effect.either)
        return exit
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("ClaimNotFoundError")
    }
  })

  // ---------------------------------------------------------------------------
  // 5. renew endpoint returns updated claim
  // ---------------------------------------------------------------------------

  it("renew endpoint returns updated claim with incremented renewedCount", async () => {
    const workerId = "worker-renew-test"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const task = yield* taskService.create({ title: "Renew test task" })
        yield* registerWorker(workerId)
        const originalClaim = yield* claimService.claim(task.id, workerId)
        const originalSerialized = serializeClaim(originalClaim)

        // Renew the claim
        const renewedClaim = yield* claimService.renew(task.id, workerId)
        const renewedSerialized = serializeClaim(renewedClaim)

        return { original: originalSerialized, renewed: renewedSerialized }
      }).pipe(Effect.provide(shared.layer))
    )

    // renewedCount should increment from 0 to 1
    expect(result.original.renewedCount).toBe(0)
    expect(result.renewed.renewedCount).toBe(1)

    // leaseExpiresAt should be updated (renewed lease extends from current time)
    expect(result.renewed.leaseExpiresAt).toBeDefined()
    expect(new Date(result.renewed.leaseExpiresAt).getTime()).not.toBeNaN()

    // Same task and worker
    expect(result.renewed.taskId).toBe(result.original.taskId)
    expect(result.renewed.workerId).toBe(result.original.workerId)
    expect(result.renewed.status).toBe("active")
  })

  // ---------------------------------------------------------------------------
  // 6. renew fails for nonexistent claim
  // ---------------------------------------------------------------------------

  it("renew fails for task without an active claim", async () => {
    const workerId = "worker-renew-fail"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const task = yield* taskService.create({ title: "No claim renew task" })

        // Try to renew without having claimed first
        const exit = yield* claimService.renew(task.id, workerId).pipe(Effect.either)
        return exit
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("ClaimNotFoundError")
    }
  })

  // ---------------------------------------------------------------------------
  // 7. getClaim returns null when no active claim
  // ---------------------------------------------------------------------------

  it("getActiveClaim returns null when no active claim exists", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const task = yield* taskService.create({ title: "No claim task" })

        // Get claim for a task that has never been claimed
        const claim = yield* claimService.getActiveClaim(task.id)

        // Mirrors the route handler: { claim: claim ? serializeClaim(claim) : null }
        return { claim: claim ? serializeClaim(claim) : null }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.claim).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 8. getClaim returns active claim when claimed
  // ---------------------------------------------------------------------------

  it("getActiveClaim returns serialized claim when task is claimed", async () => {
    const workerId = "worker-get-claim"

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const task = yield* taskService.create({ title: "Get claim task" })
        yield* registerWorker(workerId)
        yield* claimService.claim(task.id, workerId)

        // Get the active claim (mirrors the getTaskClaim route handler)
        const claim = yield* claimService.getActiveClaim(task.id)
        return { claim: claim ? serializeClaim(claim) : null }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.claim).not.toBeNull()
    expect(result.claim!.workerId).toBe(workerId)
    expect(result.claim!.status).toBe("active")
    expect(result.claim!.renewedCount).toBe(0)
    // Verify ISO string serialization
    expect(typeof result.claim!.claimedAt).toBe("string")
    expect(typeof result.claim!.leaseExpiresAt).toBe("string")
    expect(result.claim!.claimedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.claim!.leaseExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
