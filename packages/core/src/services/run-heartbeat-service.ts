/**
 * RunHeartbeatService
 *
 * Run-level heartbeat primitives for transcript/log progress tracking and
 * stalled run detection/reaping.
 */

import { execFileSync } from "node:child_process"
import { Context, Duration, Effect, Layer } from "effect"
import type { Run, RunId, TaskId } from "@jamesaphoenix/tx-types"
import { SqliteClient } from "../db.js"
import { DatabaseError, RunNotFoundError, ValidationError } from "../errors.js"
import { RunRepository } from "../repo/run-repo.js"
import { TaskService } from "./task-service.js"

export interface RunHeartbeatInput {
  readonly runId: RunId
  readonly checkAt?: Date
  readonly activityAt?: Date
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly transcriptBytes: number
  readonly deltaBytes?: number
}

export interface StalledRun {
  readonly run: Run
  readonly reason: "transcript_idle" | "heartbeat_stale"
  readonly transcriptIdleSeconds: number | null
  readonly heartbeatLagSeconds: number | null
  readonly lastActivityAt: Date | null
  readonly lastCheckAt: Date | null
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly transcriptBytes: number
}

export interface StalledRunQuery {
  readonly transcriptIdleSeconds: number
  readonly heartbeatLagSeconds?: number
}

export interface ReapStalledOptions extends StalledRunQuery {
  readonly resetTask?: boolean
  readonly dryRun?: boolean
}

export interface ReapedRun {
  readonly id: RunId
  readonly taskId: string | null
  readonly pid: number | null
  readonly reason: "transcript_idle" | "heartbeat_stale"
  readonly transcriptIdleSeconds: number | null
  readonly heartbeatLagSeconds: number | null
  readonly processTerminated: boolean
  readonly taskReset: boolean
}

interface HeartbeatRow {
  run_id: string
  last_check_at: string
  last_activity_at: string
  stdout_bytes: number
  stderr_bytes: number
  transcript_bytes: number
}

const asDate = (value: string | null | undefined): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const nonNegativeInt = (value: number): number => Math.max(0, Math.floor(value))

const TASK_ID_PATTERN = /^tx-[a-z0-9]{6,12}$/
const isTaskId = (value: string): value is TaskId => TASK_ID_PATTERN.test(value)

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const childPids = (pid: number): readonly number[] => {
  try {
    const out = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (!out) return []
    return out
      .split("\n")
      .map((v) => parseInt(v.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  } catch {
    return []
  }
}

const killTree = (pid: number, signal: NodeJS.Signals): void => {
  const children = childPids(pid)
  for (const child of children) {
    killTree(child, signal)
  }
  try {
    process.kill(pid, signal)
  } catch {
    // Ignore races where process exits before signal
  }
}

const terminateProcessTree = (pid: number): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    if (!isProcessAlive(pid)) return false

    killTree(pid, "SIGTERM")
    yield* Effect.sleep(Duration.seconds(2))
    if (!isProcessAlive(pid)) return true

    killTree(pid, "SIGKILL")
    return !isProcessAlive(pid)
  })

export class RunHeartbeatService extends Context.Tag("RunHeartbeatService")<
  RunHeartbeatService,
  {
    readonly heartbeat: (
      input: RunHeartbeatInput
    ) => Effect.Effect<void, ValidationError | RunNotFoundError | DatabaseError>

    readonly listStalled: (
      query: StalledRunQuery
    ) => Effect.Effect<readonly StalledRun[], ValidationError | DatabaseError>

    readonly reapStalled: (
      options: ReapStalledOptions
    ) => Effect.Effect<readonly ReapedRun[], ValidationError | RunNotFoundError | DatabaseError>
  }
>() {}

export const RunHeartbeatServiceLive = Layer.effect(
  RunHeartbeatService,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const runRepo = yield* RunRepository
    const taskSvc = yield* TaskService

    const listHeartbeatRows = (
      runIds: readonly RunId[]
    ): Effect.Effect<Map<string, HeartbeatRow>, DatabaseError> =>
      Effect.try({
        try: () => {
          if (runIds.length === 0) return new Map<string, HeartbeatRow>()

          const placeholders = runIds.map(() => "?").join(",")
          const rows = db.prepare(
            `SELECT run_id, last_check_at, last_activity_at, stdout_bytes, stderr_bytes, transcript_bytes
             FROM run_heartbeat_state
             WHERE run_id IN (${placeholders})`
          ).all(...runIds) as HeartbeatRow[]

          return new Map(rows.map((r) => [r.run_id, r]))
        },
        catch: (cause) => new DatabaseError({ cause }),
      })

    const listStalledImpl = (
      query: StalledRunQuery
    ): Effect.Effect<readonly StalledRun[], ValidationError | DatabaseError> =>
      Effect.gen(function* () {
        if (!Number.isFinite(query.transcriptIdleSeconds) || query.transcriptIdleSeconds < 1) {
          return yield* Effect.fail(
            new ValidationError({ reason: "transcriptIdleSeconds must be a positive integer" })
          )
        }
        if (
          query.heartbeatLagSeconds !== undefined &&
          (!Number.isFinite(query.heartbeatLagSeconds) || query.heartbeatLagSeconds < 1)
        ) {
          return yield* Effect.fail(
            new ValidationError({ reason: "heartbeatLagSeconds must be a positive integer" })
          )
        }

        const nowMs = Date.now()
        const running = yield* runRepo.getRunning()
        const heartbeatRows = yield* listHeartbeatRows(running.map((r) => r.id))
        const stalled: StalledRun[] = []

        for (const run of running) {
          const hb = heartbeatRows.get(run.id)
          const lastActivityAt = asDate(hb?.last_activity_at ?? null)
          const lastCheckAt = asDate(hb?.last_check_at ?? null)

          const activityBase = lastActivityAt ?? run.startedAt
          const transcriptIdleSeconds = Math.floor((nowMs - activityBase.getTime()) / 1000)
          const heartbeatLagSeconds = lastCheckAt
            ? Math.floor((nowMs - lastCheckAt.getTime()) / 1000)
            : null

          const transcriptIdle = transcriptIdleSeconds >= query.transcriptIdleSeconds
          const heartbeatStale = query.heartbeatLagSeconds !== undefined
            && heartbeatLagSeconds !== null
            && heartbeatLagSeconds >= query.heartbeatLagSeconds

          if (!transcriptIdle && !heartbeatStale) continue

          stalled.push({
            run,
            reason: transcriptIdle ? "transcript_idle" : "heartbeat_stale",
            transcriptIdleSeconds,
            heartbeatLagSeconds,
            lastActivityAt,
            lastCheckAt,
            stdoutBytes: hb?.stdout_bytes ?? 0,
            stderrBytes: hb?.stderr_bytes ?? 0,
            transcriptBytes: hb?.transcript_bytes ?? 0,
          })
        }

        return stalled
      })

    const expireActiveClaimsForTask = (
      taskId: TaskId
    ): Effect.Effect<void, DatabaseError> =>
      Effect.try({
        try: () => {
          db.prepare(
            `UPDATE task_claims
             SET status = 'expired'
             WHERE task_id = ? AND status = 'active'`
          ).run(taskId)
        },
        catch: (cause) => new DatabaseError({ cause }),
      }).pipe(Effect.asVoid)

    return {
      heartbeat: (input) =>
        Effect.gen(function* () {
          if (
            !Number.isFinite(input.stdoutBytes) ||
            !Number.isFinite(input.stderrBytes) ||
            !Number.isFinite(input.transcriptBytes) ||
            (input.deltaBytes !== undefined && !Number.isFinite(input.deltaBytes))
          ) {
            return yield* Effect.fail(
              new ValidationError({ reason: "Heartbeat byte counters must be finite numbers" })
            )
          }

          const run = yield* runRepo.findById(input.runId)
          if (!run) {
            return yield* Effect.fail(new RunNotFoundError({ id: input.runId }))
          }

          const now = input.checkAt ?? new Date()
          const deltaBytes = nonNegativeInt(input.deltaBytes ?? 0)
          const existing = yield* Effect.try({
            try: () =>
              db.prepare(
                `SELECT last_activity_at FROM run_heartbeat_state WHERE run_id = ?`
              ).get(input.runId) as { last_activity_at: string } | null,
            catch: (cause) => new DatabaseError({ cause }),
          })

          const existingActivity = asDate(existing?.last_activity_at ?? null)
          const activityAt = input.activityAt
            ?? (deltaBytes > 0 ? now : existingActivity ?? now)

          yield* Effect.try({
            try: () => {
              db.prepare(
                `INSERT INTO run_heartbeat_state (
                   run_id,
                   last_check_at,
                   last_activity_at,
                   stdout_bytes,
                   stderr_bytes,
                   transcript_bytes,
                   last_delta_bytes,
                   updated_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(run_id) DO UPDATE SET
                   last_check_at = excluded.last_check_at,
                   last_activity_at = excluded.last_activity_at,
                   stdout_bytes = excluded.stdout_bytes,
                   stderr_bytes = excluded.stderr_bytes,
                   transcript_bytes = excluded.transcript_bytes,
                   last_delta_bytes = excluded.last_delta_bytes,
                   updated_at = excluded.updated_at`
              ).run(
                input.runId,
                now.toISOString(),
                activityAt.toISOString(),
                nonNegativeInt(input.stdoutBytes),
                nonNegativeInt(input.stderrBytes),
                nonNegativeInt(input.transcriptBytes),
                deltaBytes,
                now.toISOString(),
              )
            },
            catch: (cause) => new DatabaseError({ cause }),
          })
        }),

      listStalled: (query) => listStalledImpl(query),

      reapStalled: (options) =>
        Effect.gen(function* () {
          const stalled = yield* listStalledImpl({
            transcriptIdleSeconds: options.transcriptIdleSeconds,
            heartbeatLagSeconds: options.heartbeatLagSeconds,
          })

          const resetTask = options.resetTask ?? true
          const dryRun = options.dryRun ?? false
          const results: ReapedRun[] = []

          for (const item of stalled) {
            let processTerminated = false
            let taskReset = false

            if (!dryRun && item.run.pid !== null && item.run.pid > 0) {
              processTerminated = yield* terminateProcessTree(item.run.pid)
            }

            if (!dryRun) {
              const reasonText = item.reason === "transcript_idle"
                ? `Transcript heartbeat idle > ${options.transcriptIdleSeconds}s`
                : `Heartbeat lag > ${options.heartbeatLagSeconds ?? 0}s`

              yield* runRepo.update(item.run.id, {
                status: "cancelled",
                endedAt: new Date(),
                exitCode: 137,
                errorMessage: `Run reaped by heartbeat primitive: ${reasonText}`,
              })

              if (item.run.taskId && isTaskId(item.run.taskId)) {
                yield* expireActiveClaimsForTask(item.run.taskId)
              }

              if (resetTask && item.run.taskId && isTaskId(item.run.taskId)) {
                taskReset = yield* taskSvc.forceStatus(item.run.taskId, "ready").pipe(
                  Effect.map(() => true),
                  Effect.catchAll(() => Effect.succeed(false)),
                )
              }
            }

            results.push({
              id: item.run.id,
              taskId: item.run.taskId,
              pid: item.run.pid,
              reason: item.reason,
              transcriptIdleSeconds: item.transcriptIdleSeconds,
              heartbeatLagSeconds: item.heartbeatLagSeconds,
              processTerminated,
              taskReset,
            })
          }

          return results
        }),
    }
  }),
)
