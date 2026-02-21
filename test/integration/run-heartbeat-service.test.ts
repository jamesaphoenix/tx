import { beforeAll, afterEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { fixtureId } from "../fixtures.js"
import { RunHeartbeatService, RunRepository } from "@jamesaphoenix/tx-core"
import type { RunId, TaskId } from "@jamesaphoenix/tx-types"

const runFixtureId = (name: string): RunId => `run-${fixtureId(`run-heartbeat:${name}`).slice(3)}` as RunId
const taskFixtureId = (name: string): TaskId => fixtureId(`run-heartbeat:${name}`) as TaskId
const workerFixtureId = (name: string): string => fixtureId(`run-heartbeat-worker:${name}`)

const insertTask = (shared: SharedTestLayerResult, id: TaskId, status: string = "ready"): void => {
  const now = new Date().toISOString()
  shared.getDb().prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, NULL, 500, ?, ?, NULL, '{}')`
  ).run(id, `Task ${id}`, "Run heartbeat test task", status, now, now)
}

const insertRun = (
  shared: SharedTestLayerResult,
  id: RunId,
  taskId: TaskId | null = null,
  startedAt: string = new Date().toISOString()
): void => {
  shared.getDb().prepare(
    `INSERT INTO runs (id, task_id, agent, started_at, status, pid, metadata)
     VALUES (?, ?, 'tx-implementer', ?, 'running', NULL, '{}')`
  ).run(id, taskId, startedAt)
}

const insertWorker = (
  shared: SharedTestLayerResult,
  workerId: string,
  status: "starting" | "idle" | "busy" | "stopping" | "dead" = "busy",
): void => {
  const now = new Date().toISOString()
  shared.getDb().prepare(
    `INSERT INTO workers (
       id, name, hostname, pid, status, registered_at, last_heartbeat_at, current_task_id, capabilities, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', '{}')`
  ).run(workerId, `Worker ${workerId}`, "localhost", 42424, status, now, now)
}

const insertActiveClaim = (shared: SharedTestLayerResult, taskId: TaskId, workerId: string): void => {
  const claimedAt = new Date()
  const leaseExpiresAt = new Date(claimedAt.getTime() + 30 * 60 * 1000)
  shared.getDb().prepare(
    `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
     VALUES (?, ?, ?, ?, 0, 'active')`
  ).run(taskId, workerId, claimedAt.toISOString(), leaseExpiresAt.toISOString())
}

describe("RunHeartbeatService integration", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await getSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  it("records heartbeat state and does not mark fresh runs as stalled", async () => {
    const runId = runFixtureId("fresh-run")
    insertRun(shared, runId)

    await Effect.runPromise(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        yield* heartbeat.heartbeat({
          runId,
          stdoutBytes: 100,
          stderrBytes: 5,
          transcriptBytes: 1024,
          deltaBytes: 128,
          checkAt: new Date(),
          activityAt: new Date(),
        })

        const stalled = yield* heartbeat.listStalled({ transcriptIdleSeconds: 300 })
        expect(stalled).toHaveLength(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("detects transcript-idle runs", async () => {
    const runId = runFixtureId("idle-run")
    insertRun(shared, runId)
    const old = new Date(Date.now() - 10 * 60 * 1000)

    const stalled = await Effect.runPromise(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        yield* heartbeat.heartbeat({
          runId,
          stdoutBytes: 10,
          stderrBytes: 2,
          transcriptBytes: 20,
          deltaBytes: 0,
          checkAt: old,
          activityAt: old,
        })

        return yield* heartbeat.listStalled({ transcriptIdleSeconds: 300 })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(stalled).toHaveLength(1)
    expect(stalled[0]?.run.id).toBe(runId)
    expect(stalled[0]?.reason).toBe("transcript_idle")
    expect(stalled[0]?.transcriptBytes).toBe(20)
  })

  it("detects heartbeat-stale runs independently of transcript idleness", async () => {
    const runId = runFixtureId("stale-run")
    insertRun(shared, runId)
    const oldCheck = new Date(Date.now() - 10 * 60 * 1000)

    const stalled = await Effect.runPromise(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        yield* heartbeat.heartbeat({
          runId,
          stdoutBytes: 200,
          stderrBytes: 0,
          transcriptBytes: 300,
          deltaBytes: 0,
          checkAt: oldCheck,
          activityAt: new Date(),
        })

        return yield* heartbeat.listStalled({
          transcriptIdleSeconds: 3600,
          heartbeatLagSeconds: 60,
        })
      }).pipe(Effect.provide(shared.layer))
    )

    expect(stalled).toHaveLength(1)
    expect(stalled[0]?.run.id).toBe(runId)
    expect(stalled[0]?.reason).toBe("heartbeat_stale")
  })

  it("dry-run reap returns candidates without mutating run/task status", async () => {
    const runId = runFixtureId("dry-reap")
    const taskId = taskFixtureId("dry-reap-task")
    const workerId = workerFixtureId("dry-reap-worker")
    insertTask(shared, taskId, "active")
    insertRun(shared, runId, taskId)
    insertWorker(shared, workerId)
    insertActiveClaim(shared, taskId, workerId)
    const old = new Date(Date.now() - 10 * 60 * 1000)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        const runRepo = yield* RunRepository

        yield* heartbeat.heartbeat({
          runId,
          stdoutBytes: 10,
          stderrBytes: 10,
          transcriptBytes: 10,
          deltaBytes: 0,
          checkAt: old,
          activityAt: old,
        })

        const reaped = yield* heartbeat.reapStalled({
          transcriptIdleSeconds: 300,
          dryRun: true,
        })
        const run = yield* runRepo.findById(runId)
        return { reaped, run }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.reaped).toHaveLength(1)
    expect(result.reaped[0]?.id).toBe(runId)
    expect(result.reaped[0]?.taskReset).toBe(false)
    expect(result.run?.status).toBe("running")

    const taskRow = shared.getDb().prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
      | { status: string }
      | undefined
    expect(taskRow?.status).toBe("active")

    const claimStatusRow = shared.getDb().prepare(
      "SELECT status FROM task_claims WHERE task_id = ? ORDER BY id DESC LIMIT 1"
    ).get(taskId) as { status: string } | undefined
    expect(claimStatusRow?.status).toBe("active")
  })

  it("reaps stalled runs and resets task to ready by default", async () => {
    const runId = runFixtureId("real-reap")
    const taskId = taskFixtureId("real-reap-task")
    const workerId = workerFixtureId("real-reap-worker")
    insertTask(shared, taskId, "active")
    insertRun(shared, runId, taskId)
    insertWorker(shared, workerId)
    insertActiveClaim(shared, taskId, workerId)
    const old = new Date(Date.now() - 10 * 60 * 1000)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        const runRepo = yield* RunRepository

        yield* heartbeat.heartbeat({
          runId,
          stdoutBytes: 0,
          stderrBytes: 0,
          transcriptBytes: 0,
          deltaBytes: 0,
          checkAt: old,
          activityAt: old,
        })

        const reaped = yield* heartbeat.reapStalled({
          transcriptIdleSeconds: 300,
          dryRun: false,
        })
        const run = yield* runRepo.findById(runId)
        return { reaped, run }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.reaped).toHaveLength(1)
    expect(result.reaped[0]?.id).toBe(runId)
    expect(result.reaped[0]?.taskReset).toBe(true)
    expect(result.run?.status).toBe("cancelled")
    expect(result.run?.exitCode).toBe(137)

    const taskRow = shared.getDb().prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
      | { status: string }
      | undefined
    expect(taskRow?.status).toBe("ready")

    const claimStatusRow = shared.getDb().prepare(
      "SELECT status FROM task_claims WHERE task_id = ? ORDER BY id DESC LIMIT 1"
    ).get(taskId) as { status: string } | undefined
    const activeClaims = shared.getDb().prepare(
      "SELECT COUNT(*) as count FROM task_claims WHERE task_id = ? AND status = 'active'"
    ).get(taskId) as { count: number } | undefined

    expect(claimStatusRow?.status).toBe("expired")
    expect(activeClaims?.count ?? 0).toBe(0)
  })

  it("reaps stalled runs without resetting task when resetTask is false", async () => {
    const runId = runFixtureId("real-reap-no-reset")
    const taskId = taskFixtureId("real-reap-no-reset-task")
    const workerId = workerFixtureId("real-reap-no-reset-worker")
    insertTask(shared, taskId, "active")
    insertRun(shared, runId, taskId)
    insertWorker(shared, workerId)
    insertActiveClaim(shared, taskId, workerId)
    const old = new Date(Date.now() - 10 * 60 * 1000)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        const runRepo = yield* RunRepository

        yield* heartbeat.heartbeat({
          runId,
          stdoutBytes: 0,
          stderrBytes: 0,
          transcriptBytes: 0,
          deltaBytes: 0,
          checkAt: old,
          activityAt: old,
        })

        const reaped = yield* heartbeat.reapStalled({
          transcriptIdleSeconds: 300,
          dryRun: false,
          resetTask: false,
        })
        const run = yield* runRepo.findById(runId)
        return { reaped, run }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.reaped).toHaveLength(1)
    expect(result.reaped[0]?.id).toBe(runId)
    expect(result.reaped[0]?.taskReset).toBe(false)
    expect(result.run?.status).toBe("cancelled")

    const taskRow = shared.getDb().prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
      | { status: string }
      | undefined
    expect(taskRow?.status).toBe("active")

    const claimStatusRow = shared.getDb().prepare(
      "SELECT status FROM task_claims WHERE task_id = ? ORDER BY id DESC LIMIT 1"
    ).get(taskId) as { status: string } | undefined
    const activeClaims = shared.getDb().prepare(
      "SELECT COUNT(*) as count FROM task_claims WHERE task_id = ? AND status = 'active'"
    ).get(taskId) as { count: number } | undefined

    expect(claimStatusRow?.status).toBe("expired")
    expect(activeClaims?.count ?? 0).toBe(0)
  })

  it("returns validation errors for invalid stalled query thresholds", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const heartbeat = yield* RunHeartbeatService
        return yield* heartbeat.listStalled({
          transcriptIdleSeconds: 0,
        })
      }).pipe(Effect.provide(shared.layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ValidationError")
    }
  })
})
