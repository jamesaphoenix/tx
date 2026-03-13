/**
 * Integration tests for the orchestration status layer.
 *
 * Verifies that `deriveOrchestrationStatus` is correctly wired through
 * `enrichWithDeps`/`enrichWithDepsBatch` and surfaces claim-derived
 * orchestration states in `TaskWithDeps`.
 *
 * Uses real in-memory SQLite, no mocks (Doctrine Rule 3 & 8).
 *
 * REF: Plan Phase 1-2 (OrchestrationStatus + claims enrichment)
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { ClaimService, TaskService, ReadyService, AttemptService, SqliteClient } from "@jamesaphoenix/tx-core"
import { serializeTask } from "@jamesaphoenix/tx-types"

const registerWorker = (workerId: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    db.prepare(
      `INSERT OR IGNORE INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at)
       VALUES (?, ?, 'localhost', 1, 'idle', datetime('now'), datetime('now'))`
    ).run(workerId, workerId)
  })

describe("Orchestration Status", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // ---------------------------------------------------------------------------
  // 1. Unclaimed — no claims exist
  // ---------------------------------------------------------------------------

  it("returns 'unclaimed' orchestrationStatus for task with no claims", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const task = yield* taskService.create({ title: "Orch: no claim" })
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.orchestrationStatus).toBe("unclaimed")
    expect(result.claimedBy).toBeNull()
    expect(result.claimExpiresAt).toBeNull()
    expect(result.failedAttempts).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 2. Claimed — active claim, task not yet active
  // ---------------------------------------------------------------------------

  it("returns 'claimed' when task is claimed but not active", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const task = yield* taskService.create({ title: "Orch: claimed" })
        yield* registerWorker("orch-w1")
        yield* claimService.claim(task.id, "orch-w1", 30)
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.orchestrationStatus).toBe("claimed")
    expect(result.claimedBy).toBe("orch-w1")
    expect(result.claimExpiresAt).toBeInstanceOf(Date)
    expect(result.failedAttempts).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 3. Running — active claim + task status is 'active'
  // ---------------------------------------------------------------------------

  it("returns 'running' when task is claimed AND has status 'active'", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const task = yield* taskService.create({ title: "Orch: running" })
        yield* registerWorker("orch-w2")
        yield* claimService.claim(task.id, "orch-w2", 30)
        yield* taskService.update(task.id, { status: "active" })
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.orchestrationStatus).toBe("running")
    expect(result.claimedBy).toBe("orch-w2")
    expect(result.claimExpiresAt).toBeInstanceOf(Date)
  })

  // ---------------------------------------------------------------------------
  // 4. Released — claim explicitly released
  // ---------------------------------------------------------------------------

  it("returns 'released' when claim is explicitly released", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const task = yield* taskService.create({ title: "Orch: released" })
        yield* registerWorker("orch-w3")
        yield* claimService.claim(task.id, "orch-w3", 30)
        yield* claimService.release(task.id, "orch-w3")
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.orchestrationStatus).toBe("released")
    expect(result.claimedBy).toBe("orch-w3")
  })

  // ---------------------------------------------------------------------------
  // 5. Lease expired — claim active but lease past due
  // ---------------------------------------------------------------------------

  it("returns 'lease_expired' when claim lease is past due", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const db = yield* SqliteClient
        const task = yield* taskService.create({ title: "Orch: expired" })
        yield* registerWorker("orch-w4")
        yield* claimService.claim(task.id, "orch-w4", 30)
        // Manually backdate the lease to ensure it's clearly in the past
        db.prepare(
          "UPDATE task_claims SET lease_expires_at = ? WHERE task_id = ? AND status = 'active'"
        ).run("2020-01-01T00:00:00.000Z", task.id)
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.orchestrationStatus).toBe("lease_expired")
    expect(result.claimedBy).toBe("orch-w4")
  })

  // ---------------------------------------------------------------------------
  // 6. Batch enrichment includes orchestration status
  // ---------------------------------------------------------------------------

  it("batch enrichment returns correct orchestration for all tasks", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService

        const t1 = yield* taskService.create({ title: "Batch: unclaimed" })
        const t2 = yield* taskService.create({ title: "Batch: claimed" })
        const t3 = yield* taskService.create({ title: "Batch: running" })

        yield* registerWorker("orch-batch-1")
        yield* registerWorker("orch-batch-2")
        yield* claimService.claim(t2.id, "orch-batch-1", 30)
        yield* claimService.claim(t3.id, "orch-batch-2", 30)
        yield* taskService.update(t3.id, { status: "active" })

        return yield* taskService.getWithDepsBatch([t1.id, t2.id, t3.id])
      }).pipe(Effect.provide(shared.layer))
    )

    const byTitle = (title: string) => results.find((t) => t.title === title)!

    expect(byTitle("Batch: unclaimed").orchestrationStatus).toBe("unclaimed")
    expect(byTitle("Batch: claimed").orchestrationStatus).toBe("claimed")
    expect(byTitle("Batch: claimed").claimedBy).toBe("orch-batch-1")
    expect(byTitle("Batch: running").orchestrationStatus).toBe("running")
    expect(byTitle("Batch: running").claimedBy).toBe("orch-batch-2")
  })

  // ---------------------------------------------------------------------------
  // 7. Serialization round-trip preserves fields
  // ---------------------------------------------------------------------------

  it("serialization preserves orchestration fields", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const task = yield* taskService.create({ title: "Orch: serialize" })
        yield* registerWorker("orch-w5")
        yield* claimService.claim(task.id, "orch-w5", 30)
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    // Use the production serializeTask function (not hand-rolled serialization)
    const serialized = serializeTask(result)

    const json = JSON.stringify(serialized)
    const parsed = JSON.parse(json) as Record<string, unknown>

    expect(parsed.orchestrationStatus).toBe("claimed")
    expect(parsed.claimedBy).toBe("orch-w5")
    expect(typeof parsed.claimExpiresAt).toBe("string")
    expect(parsed.failedAttempts).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 8. listWithDeps includes orchestration status
  // ---------------------------------------------------------------------------

  it("listWithDeps includes orchestration status for claimed tasks", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const task = yield* taskService.create({ title: "Orch: list-check" })
        yield* registerWorker("orch-w6")
        yield* claimService.claim(task.id, "orch-w6", 30)
        const all = yield* taskService.listWithDeps()
        return all.filter((t) => t.title === "Orch: list-check")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.orchestrationStatus).toBe("claimed")
    expect(results[0]!.claimedBy).toBe("orch-w6")
  })

  // ---------------------------------------------------------------------------
  // 9. Completed claim → shows "unclaimed"
  // ---------------------------------------------------------------------------

  it("returns 'unclaimed' when claim status is 'completed'", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const db = yield* SqliteClient
        const task = yield* taskService.create({ title: "Orch: completed claim" })
        yield* registerWorker("orch-w7")
        yield* claimService.claim(task.id, "orch-w7", 30)
        // Mark claim as completed via direct SQL (simulates post-task-completion cleanup)
        db.prepare(
          "UPDATE task_claims SET status = 'completed' WHERE task_id = ? AND status = 'active'"
        ).run(task.id)
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.orchestrationStatus).toBe("unclaimed")
    expect(result.claimedBy).toBeNull()
    expect(result.claimExpiresAt).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 10. Multiple claims — only latest non-completed governs status
  // ---------------------------------------------------------------------------

  it("returns status from the latest claim when multiple claims exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const task = yield* taskService.create({ title: "Orch: multi-claim" })
        yield* registerWorker("orch-w8")
        yield* registerWorker("orch-w9")
        // First claim and release
        yield* claimService.claim(task.id, "orch-w8", 30)
        yield* claimService.release(task.id, "orch-w8")
        // Second claim by different worker
        yield* claimService.claim(task.id, "orch-w9", 30)
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    // Latest claim is the active one by orch-w9
    expect(result.orchestrationStatus).toBe("claimed")
    expect(result.claimedBy).toBe("orch-w9")
  })

  // ---------------------------------------------------------------------------
  // 11. readyAndClaim returns task with "claimed" status
  // ---------------------------------------------------------------------------

  it("readyAndClaim returns task with orchestrationStatus 'claimed'", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        yield* taskService.create({ title: "Orch: ready-and-claim" })
        const readyService = yield* ReadyService
        yield* registerWorker("orch-w10")
        return yield* readyService.readyAndClaim("orch-w10", 30)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()
    expect(result!.task.orchestrationStatus).toBe("claimed")
    expect(result!.task.claimedBy).toBe("orch-w10")
    expect(result!.task.claimExpiresAt).toBeInstanceOf(Date)
    expect(result!.claim.status).toBe("active")
  })

  // ---------------------------------------------------------------------------
  // 12. lease_expired wins over active status (evaluation priority)
  // ---------------------------------------------------------------------------

  it("returns 'lease_expired' even when task status is 'active'", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const db = yield* SqliteClient
        const task = yield* taskService.create({ title: "Orch: expired-active" })
        yield* registerWorker("orch-w11")
        yield* claimService.claim(task.id, "orch-w11", 30)
        yield* taskService.update(task.id, { status: "active" })
        // Backdate the lease to expire — expired must win over active
        db.prepare(
          "UPDATE task_claims SET lease_expires_at = ? WHERE task_id = ? AND status = 'active'"
        ).run("2020-01-01T00:00:00.000Z", task.id)
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.orchestrationStatus).toBe("lease_expired")
    expect(result.claimedBy).toBe("orch-w11")
  })

  // ---------------------------------------------------------------------------
  // 13. failedAttempts serialization round-trip with non-zero value
  // ---------------------------------------------------------------------------

  it("serialization preserves non-zero failedAttempts through full chain", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const attemptService = yield* AttemptService
        const task = yield* taskService.create({ title: "Orch: failed-attempts" })
        // Record 3 failed attempts
        yield* attemptService.create(task.id, "approach-1", "failed", "timeout")
        yield* attemptService.create(task.id, "approach-2", "failed", "OOM")
        yield* attemptService.create(task.id, "approach-3", "failed", "flaky dep")
        return yield* taskService.getWithDeps(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.failedAttempts).toBe(3)

    // Verify serialization round-trip preserves the count
    const serialized = serializeTask(result)
    const parsed = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>
    expect(parsed.failedAttempts).toBe(3)
  })

  // ---------------------------------------------------------------------------
  // 14. getReady returns correct orchestrationStatus for released claims
  // ---------------------------------------------------------------------------

  it("getReady returns 'released' status for tasks with released claims", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const readyService = yield* ReadyService
        const task = yield* taskService.create({ title: "Orch: ready-released" })
        yield* registerWorker("orch-w12")
        yield* claimService.claim(task.id, "orch-w12", 30)
        yield* claimService.release(task.id, "orch-w12")
        // Released claims don't exclude from ready queue
        const ready = yield* readyService.getReady(100)
        return ready.filter((t) => t.title === "Orch: ready-released")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(results.length).toBe(1)
    expect(results[0]!.orchestrationStatus).toBe("released")
  })

  // ---------------------------------------------------------------------------
  // 15. readyAndClaim excludes active tasks
  // ---------------------------------------------------------------------------

  it("readyAndClaim returns null when only active tasks exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const readyService = yield* ReadyService
        const task = yield* taskService.create({ title: "Orch: active-only" })
        yield* taskService.update(task.id, { status: "active" })
        yield* registerWorker("orch-w13")
        return yield* readyService.readyAndClaim("orch-w13", 30)
      }).pipe(Effect.provide(shared.layer))
    )

    // Active tasks are excluded from the ready queue — readyAndClaim cannot claim them
    expect(result).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 16. Batch enrichment consistency — released + lease_expired in batch
  // ---------------------------------------------------------------------------

  it("batch enrichment returns correct status for released and expired claims", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const taskService = yield* TaskService
        const claimService = yield* ClaimService
        const db = yield* SqliteClient

        const t1 = yield* taskService.create({ title: "Batch2: released" })
        const t2 = yield* taskService.create({ title: "Batch2: expired" })

        yield* registerWorker("orch-batch-3")
        yield* registerWorker("orch-batch-4")
        yield* claimService.claim(t1.id, "orch-batch-3", 30)
        yield* claimService.release(t1.id, "orch-batch-3")
        yield* claimService.claim(t2.id, "orch-batch-4", 30)
        db.prepare(
          "UPDATE task_claims SET lease_expires_at = ? WHERE task_id = ? AND status = 'active'"
        ).run("2020-01-01T00:00:00.000Z", t2.id)

        return yield* taskService.getWithDepsBatch([t1.id, t2.id])
      }).pipe(Effect.provide(shared.layer))
    )

    const byTitle = (title: string) => results.find((t) => t.title === title)!

    expect(byTitle("Batch2: released").orchestrationStatus).toBe("released")
    expect(byTitle("Batch2: expired").orchestrationStatus).toBe("lease_expired")
  })
})
