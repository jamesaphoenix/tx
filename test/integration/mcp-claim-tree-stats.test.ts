/**
 * Integration tests for MCP claim, tree, and stats tools.
 *
 * Tests the Effect services that back the MCP tools:
 * - tx_claim, tx_claim_release, tx_claim_renew, tx_claim_get (ClaimService)
 * - tx_tree (HierarchyService)
 * - tx_stats (TaskService + ReadyService + LearningService)
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  ClaimService,
  TaskService,
  ReadyService,
  HierarchyService,
  LearningService,
  DependencyService,
  SqliteClient,
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

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
// Claim Tools Integration Tests
// =============================================================================

describe("MCP Claim Tools", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // ---------------------------------------------------------------------------
  // 1. tx_claim - Claim a task
  // ---------------------------------------------------------------------------

  it("claim creates a new claim on a task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Claimable task", score: 100 })
        yield* registerWorker("worker-alpha")
        const claim = yield* claimSvc.claim(task.id, "worker-alpha")

        return claim
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeTruthy()
    expect(result.workerId).toBe("worker-alpha")
    expect(result.status).toBe("active")
  })

  it("claim returns claim with correct fields", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Field check task", score: 100 })
        yield* registerWorker("worker-beta")
        const claim = yield* claimSvc.claim(task.id, "worker-beta", 15)

        return { claim, taskId: task.id }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.claim.taskId).toBe(result.taskId)
    expect(result.claim.workerId).toBe("worker-beta")
    expect(result.claim.status).toBe("active")
    expect(result.claim.renewedCount).toBe(0)
    expect(result.claim.claimedAt).toBeInstanceOf(Date)
    expect(result.claim.leaseExpiresAt).toBeInstanceOf(Date)
    expect(result.claim.leaseExpiresAt.getTime()).toBeGreaterThan(
      result.claim.claimedAt.getTime()
    )
  })

  it("claim fails for already claimed task", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Double claim task", score: 100 })

        // First claim succeeds
        yield* registerWorker("worker-1")
        yield* claimSvc.claim(task.id, "worker-1")

        // Second claim should fail
        yield* registerWorker("worker-2")
        return yield* claimSvc.claim(task.id, "worker-2").pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("AlreadyClaimedError")
  })

  // ---------------------------------------------------------------------------
  // 2. tx_claim_release - Release a claim
  // ---------------------------------------------------------------------------

  it("release releases an active claim", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Release test task", score: 100 })

        yield* registerWorker("worker-r1")
        yield* claimSvc.claim(task.id, "worker-r1")
        yield* claimSvc.release(task.id, "worker-r1")

        const activeClaim = yield* claimSvc.getActiveClaim(task.id)
        return activeClaim
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  it("release fails for wrong worker", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Wrong worker release", score: 100 })

        // Worker 1 claims
        yield* registerWorker("worker-owner")
        yield* claimSvc.claim(task.id, "worker-owner")

        // Worker 2 tries to release
        yield* registerWorker("worker-intruder")
        return yield* claimSvc.release(task.id, "worker-intruder").pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  // ---------------------------------------------------------------------------
  // 3. tx_claim_renew - Renew a lease
  // ---------------------------------------------------------------------------

  it("renew extends an active claim", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Renew test task", score: 100 })

        yield* registerWorker("worker-renew")
        const original = yield* claimSvc.claim(task.id, "worker-renew")
        const renewed = yield* claimSvc.renew(task.id, "worker-renew")

        return { original, renewed }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.renewed.renewedCount).toBe(1)
    expect(result.renewed.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(
      result.original.leaseExpiresAt.getTime()
    )
  })

  it("renew fails if no active claim", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "No claim renew task", score: 100 })

        // Try to renew without claiming first
        return yield* claimSvc.renew(task.id, "worker-noone").pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("ClaimNotFoundError")
  })

  // ---------------------------------------------------------------------------
  // 4. tx_claim_get - Get active claim
  // ---------------------------------------------------------------------------

  it("released task can be reclaimed by a different worker", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Reclaim after release", score: 100 })

        // Worker A claims and then releases
        yield* registerWorker("worker-A")
        yield* claimSvc.claim(task.id, "worker-A")
        yield* claimSvc.release(task.id, "worker-A")

        // Worker B reclaims
        yield* registerWorker("worker-B")
        const claim = yield* claimSvc.claim(task.id, "worker-B")

        return claim
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.workerId).toBe("worker-B")
    expect(result.status).toBe("active")
  })

  it("getActiveClaim returns claim details when task is claimed", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Active claim details", score: 100 })
        yield* registerWorker("worker-detail")
        yield* claimSvc.claim(task.id, "worker-detail")

        const activeClaim = yield* claimSvc.getActiveClaim(task.id)
        return { activeClaim, taskId: task.id }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.activeClaim).not.toBeNull()
    expect(result.activeClaim!.workerId).toBe("worker-detail")
    expect(result.activeClaim!.taskId).toBe(result.taskId)
    expect(result.activeClaim!.status).toBe("active")
  })

  it("getActiveClaim returns null when no claim exists", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const claimSvc = yield* ClaimService

        const task = yield* taskSvc.create({ title: "Unclaimed task", score: 100 })
        return yield* claimSvc.getActiveClaim(task.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })
})

// =============================================================================
// Tree Tool Integration Tests
// =============================================================================

describe("MCP Tree Tool", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("getTree returns task tree with children", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const hierarchySvc = yield* HierarchyService

        const parent = yield* taskSvc.create({ title: "Parent task", score: 100 })
        yield* taskSvc.create({ title: "Child A", parentId: parent.id, score: 80 })
        yield* taskSvc.create({ title: "Child B", parentId: parent.id, score: 60 })

        return yield* hierarchySvc.getTree(parent.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.task.title).toBe("Parent task")
    expect(result.children).toHaveLength(2)

    const childTitles = result.children.map((c) => c.task.title)
    expect(childTitles).toContain("Child A")
    expect(childTitles).toContain("Child B")
  })

  it("getTree returns nested tree with 3 levels", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const hierarchySvc = yield* HierarchyService

        const root = yield* taskSvc.create({ title: "Root", score: 100 })
        const mid = yield* taskSvc.create({ title: "Middle", parentId: root.id, score: 80 })
        yield* taskSvc.create({ title: "Leaf", parentId: mid.id, score: 60 })

        return yield* hierarchySvc.getTree(root.id)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.task.title).toBe("Root")
    expect(result.children).toHaveLength(1)
    expect(result.children[0].task.title).toBe("Middle")
    expect(result.children[0].children).toHaveLength(1)
    expect(result.children[0].children[0].task.title).toBe("Leaf")
    expect(result.children[0].children[0].children).toHaveLength(0)
  })

  it("getTree fails for non-existent task", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const hierarchySvc = yield* HierarchyService
        return yield* hierarchySvc.getTree("tx-nonexist" as TaskId).pipe(Effect.flip)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(error._tag).toBe("TaskNotFoundError")
  })
})

// =============================================================================
// Stats Tool Integration Tests
// =============================================================================

describe("MCP Stats Tool", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("stats returns task counts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        yield* taskSvc.create({ title: "Task one", score: 100 })
        yield* taskSvc.create({ title: "Task two", score: 200 })
        yield* taskSvc.create({ title: "Task three", score: 300 })

        const total = yield* taskSvc.count()
        const readyTasks = yield* readySvc.getReady(1000)

        return { total, ready: readyTasks.length }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(3)
    expect(result.ready).toBe(3)
  })

  it("stats returns done count", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService

        const t1 = yield* taskSvc.create({ title: "Will complete", score: 100 })
        yield* taskSvc.create({ title: "Still open", score: 200 })

        // Mark one as done
        yield* taskSvc.update(t1.id, { status: "done" })

        const total = yield* taskSvc.count()
        const done = yield* taskSvc.count({ status: "done" })

        return { total, done }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(2)
    expect(result.done).toBe(1)
  })

  it("stats returns zero for all fields with empty database", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService

        const total = yield* taskSvc.count()
        const readyTasks = yield* readySvc.getReady(1000)

        return { total, ready: readyTasks.length }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(0)
    expect(result.ready).toBe(0)
  })

  it("stats correctly excludes blocked tasks from ready count", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const readySvc = yield* ReadyService
        const depService = yield* DependencyService

        const task1 = yield* taskSvc.create({ title: "Blocker task", score: 100 })
        const task2 = yield* taskSvc.create({ title: "Blocked task", score: 200 })
        yield* taskSvc.create({ title: "Free task", score: 300 })

        // task2 is blocked by task1
        yield* depService.addBlocker(task2.id, task1.id)

        const total = yield* taskSvc.count()
        const readyTasks = yield* readySvc.getReady(1000)

        return { total, ready: readyTasks.length }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.total).toBe(3)
    expect(result.ready).toBe(2) // task2 is blocked, so only task1 and task3 are ready
  })

  it("stats returns learning count", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learningSvc = yield* LearningService

        yield* learningSvc.create({ content: "First learning" })
        yield* learningSvc.create({ content: "Second learning" })

        const count = yield* learningSvc.count()
        return count
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBe(2)
  })
})
