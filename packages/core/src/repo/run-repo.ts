import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToRun, generateRunId } from "../mappers/run.js"
import type { Run, RunId, RunStatus, RunRow, CreateRunInput, UpdateRunInput } from "@jamesaphoenix/tx-types"

export class RunRepository extends Context.Tag("RunRepository")<
  RunRepository,
  {
    /** Create a new run record */
    readonly create: (input: CreateRunInput) => Effect.Effect<Run, DatabaseError>

    /** Find a run by ID */
    readonly findById: (id: RunId) => Effect.Effect<Run | null, DatabaseError>

    /** Find runs by task ID */
    readonly findByTaskId: (taskId: string) => Effect.Effect<readonly Run[], DatabaseError>

    /** Find runs by status */
    readonly findByStatus: (status: RunStatus) => Effect.Effect<readonly Run[], DatabaseError>

    /** Get recent runs */
    readonly findRecent: (limit: number) => Effect.Effect<readonly Run[], DatabaseError>

    /** Update a run */
    readonly update: (id: RunId, input: UpdateRunInput) => Effect.Effect<void, DatabaseError>

    /** Mark a run as completed */
    readonly complete: (id: RunId, exitCode: number, summary?: string) => Effect.Effect<void, DatabaseError>

    /** Mark a run as failed */
    readonly fail: (id: RunId, errorMessage: string, exitCode?: number) => Effect.Effect<void, DatabaseError>

    /** Get currently running runs */
    readonly getRunning: () => Effect.Effect<readonly Run[], DatabaseError>

    /** Count runs by status */
    readonly countByStatus: () => Effect.Effect<Record<RunStatus, number>, DatabaseError>
  }
>() {}

export const RunRepositoryLive = Layer.effect(
  RunRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      create: (input) =>
        Effect.try({
          try: () => {
            const id = generateRunId()
            const now = new Date().toISOString()

            db.prepare(`
              INSERT INTO runs (id, task_id, agent, started_at, status, pid, transcript_path, context_injected, metadata)
              VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)
            `).run(
              id,
              input.taskId ?? null,
              input.agent,
              now,
              input.pid ?? null,
              input.transcriptPath ?? null,
              input.contextInjected ?? null,
              JSON.stringify(input.metadata ?? {})
            )

            const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow
            return rowToRun(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined
            return row ? rowToRun(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByTaskId: (taskId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC"
            ).all(taskId) as RunRow[]
            return rows.map(rowToRun)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByStatus: (status) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM runs WHERE status = ? ORDER BY started_at DESC"
            ).all(status) as RunRow[]
            return rows.map(rowToRun)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findRecent: (limit) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM runs ORDER BY started_at DESC LIMIT ?"
            ).all(limit) as RunRow[]
            return rows.map(rowToRun)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (id, input) =>
        Effect.try({
          try: () => {
            const updates: string[] = []
            const values: unknown[] = []

            if (input.status !== undefined) {
              updates.push("status = ?")
              values.push(input.status)
            }
            if (input.endedAt !== undefined) {
              updates.push("ended_at = ?")
              values.push(input.endedAt.toISOString())
            }
            if (input.exitCode !== undefined) {
              updates.push("exit_code = ?")
              values.push(input.exitCode)
            }
            if (input.summary !== undefined) {
              updates.push("summary = ?")
              values.push(input.summary)
            }
            if (input.errorMessage !== undefined) {
              updates.push("error_message = ?")
              values.push(input.errorMessage)
            }
            if (input.transcriptPath !== undefined) {
              updates.push("transcript_path = ?")
              values.push(input.transcriptPath)
            }
            if (input.stderrPath !== undefined) {
              updates.push("stderr_path = ?")
              values.push(input.stderrPath)
            }
            if (input.stdoutPath !== undefined) {
              updates.push("stdout_path = ?")
              values.push(input.stdoutPath)
            }

            if (updates.length === 0) return

            values.push(id)
            db.prepare(`UPDATE runs SET ${updates.join(", ")} WHERE id = ?`).run(...values)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      complete: (id, exitCode, summary) =>
        Effect.try({
          try: () => {
            db.prepare(`
              UPDATE runs
              SET status = 'completed', ended_at = ?, exit_code = ?, summary = ?
              WHERE id = ?
            `).run(new Date().toISOString(), exitCode, summary ?? null, id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      fail: (id, errorMessage, exitCode) =>
        Effect.try({
          try: () => {
            db.prepare(`
              UPDATE runs
              SET status = 'failed', ended_at = ?, exit_code = ?, error_message = ?
              WHERE id = ?
            `).run(new Date().toISOString(), exitCode ?? null, errorMessage, id)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getRunning: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM runs WHERE status = 'running' ORDER BY started_at DESC"
            ).all() as RunRow[]
            return rows.map(rowToRun)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countByStatus: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT status, COUNT(*) as count FROM runs GROUP BY status"
            ).all() as Array<{ status: string; count: number }>

            const counts: Record<RunStatus, number> = {
              running: 0,
              completed: 0,
              failed: 0,
              timeout: 0,
              cancelled: 0
            }

            for (const row of rows) {
              counts[row.status as RunStatus] = row.count
            }

            return counts
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
