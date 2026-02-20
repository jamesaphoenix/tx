/**
 * Run Route Handlers
 *
 * Implements run tracking endpoint handlers.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import type { Run, RunId, RunStatus } from "@jamesaphoenix/tx-types"
import { serializeRun } from "@jamesaphoenix/tx-types"
import { RunRepository, RunHeartbeatService } from "@jamesaphoenix/tx-core"
import { TxApi, NotFound, BadRequest, mapCoreError } from "../api.js"
import { parseTranscript, findMatchingTranscript, isAllowedTranscriptPath, type ChatMessage } from "../utils/transcript-parser.js"
import { readLogFile, isAllowedRunPath } from "../utils/log-reader.js"

// -----------------------------------------------------------------------------
// Cursor Pagination Helpers
// -----------------------------------------------------------------------------

interface ParsedRunCursor {
  startedAt: string
  id: string
}

const parseRunCursor = (cursor: string): ParsedRunCursor | null => {
  const colonIndex = cursor.lastIndexOf(":")
  if (colonIndex === -1) return null
  return {
    startedAt: cursor.slice(0, colonIndex),
    id: cursor.slice(colonIndex + 1),
  }
}

const buildRunCursor = (run: Run): string => {
  return `${run.startedAt.toISOString()}:${run.id}`
}

const parseIsoDateOrFail = (value: string | undefined, fieldName: string) => {
  if (!value) return Effect.succeed(undefined as Date | undefined)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return Effect.fail(new BadRequest({ message: `Invalid ${fieldName}: must be an ISO timestamp` }))
  }
  return Effect.succeed(parsed)
}

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const RunsLive = HttpApiBuilder.group(TxApi, "runs", (handlers) =>
  handlers
    .handle("listRuns", ({ urlParams }) =>
      Effect.gen(function* () {
        const runRepo = yield* RunRepository
        const limit = urlParams.limit ?? 20

        // Get runs based on filters
        let allRuns: readonly Run[]
        if (urlParams.taskId) {
          allRuns = yield* runRepo.findByTaskId(urlParams.taskId)
        } else if (urlParams.status && urlParams.status.split(",").length === 1) {
          allRuns = yield* runRepo.findByStatus(urlParams.status as RunStatus)
        } else {
          allRuns = yield* runRepo.findRecent(1000)
        }

        // Apply additional filters in memory
        let filtered: Run[] = [...allRuns]

        if (urlParams.agent) {
          filtered = filtered.filter(r => r.agent === urlParams.agent)
        }

        if (urlParams.status && urlParams.status.split(",").length > 1) {
          const statusFilter = urlParams.status.split(",").filter(Boolean) as RunStatus[]
          filtered = filtered.filter(r => statusFilter.includes(r.status))
        }

        // Sort by startedAt DESC, id ASC
        filtered.sort((a: Run, b: Run) => {
          const aTime = a.startedAt.getTime()
          const bTime = b.startedAt.getTime()
          if (aTime !== bTime) return bTime - aTime
          return a.id.localeCompare(b.id)
        })

        // Apply cursor pagination
        let startIndex = 0
        if (urlParams.cursor) {
          const parsed = parseRunCursor(urlParams.cursor)
          if (parsed) {
            const cursorTime = new Date(parsed.startedAt).getTime()
            startIndex = filtered.findIndex(r =>
              r.startedAt.getTime() < cursorTime ||
              (r.startedAt.getTime() === cursorTime && r.id > parsed.id)
            )
            if (startIndex === -1) startIndex = filtered.length
          }
        }

        const total = filtered.length
        const paginated = filtered.slice(startIndex, startIndex + limit + 1)
        const hasMore = paginated.length > limit
        const resultRuns = hasMore ? paginated.slice(0, limit) : paginated

        return {
          runs: resultRuns.map(serializeRun),
          nextCursor: hasMore && resultRuns.length > 0
            ? buildRunCursor(resultRuns[resultRuns.length - 1])
            : null,
          hasMore,
          total,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listStalledRuns", ({ urlParams }) =>
      Effect.gen(function* () {
        const runHeartbeat = yield* RunHeartbeatService
        const runs = yield* runHeartbeat.listStalled({
          transcriptIdleSeconds: urlParams.transcriptIdleSeconds ?? 300,
          heartbeatLagSeconds: urlParams.heartbeatLagSeconds,
        })

        return {
          runs: runs.map((item) => ({
            run: serializeRun(item.run),
            reason: item.reason,
            transcriptIdleSeconds: item.transcriptIdleSeconds,
            heartbeatLagSeconds: item.heartbeatLagSeconds,
            lastActivityAt: item.lastActivityAt?.toISOString() ?? null,
            lastCheckAt: item.lastCheckAt?.toISOString() ?? null,
            stdoutBytes: item.stdoutBytes,
            stderrBytes: item.stderrBytes,
            transcriptBytes: item.transcriptBytes,
          })),
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("reapStalledRuns", ({ payload }) =>
      Effect.gen(function* () {
        const runHeartbeat = yield* RunHeartbeatService
        const runs = yield* runHeartbeat.reapStalled({
          transcriptIdleSeconds: payload.transcriptIdleSeconds ?? 300,
          heartbeatLagSeconds: payload.heartbeatLagSeconds,
          resetTask: payload.resetTask,
          dryRun: payload.dryRun,
        })

        return {
          runs: runs.map((item) => ({
            id: item.id,
            taskId: item.taskId,
            pid: item.pid,
            reason: item.reason,
            transcriptIdleSeconds: item.transcriptIdleSeconds,
            heartbeatLagSeconds: item.heartbeatLagSeconds,
            processTerminated: item.processTerminated,
            taskReset: item.taskReset,
          })),
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getRun", ({ path }) =>
      Effect.gen(function* () {
        const runRepo = yield* RunRepository
        const found = yield* runRepo.findById(path.id as RunId)
        if (!found) {
          return yield* Effect.fail(new NotFound({ message: `Run not found: ${path.id}` }))
        }

        // Parse transcript if available
        let messages: ChatMessage[] = []
        let transcriptPath = found.transcriptPath

        // If no explicit transcript path, try to find one by timestamp correlation
        if (!transcriptPath) {
          // Derive project root from DB path (e.g. /path/to/project/.tx/tasks.db -> /path/to/project)
          // Falls back to process.cwd() if TX_DB_PATH is not absolute
          const dbPath = process.env.TX_DB_PATH ?? ""
          const projectRoot = dbPath.includes("/.tx/")
            ? dbPath.slice(0, dbPath.indexOf("/.tx/"))
            : process.cwd()
          const discovered = yield* Effect.tryPromise({
            try: () => findMatchingTranscript(projectRoot, found.startedAt, found.endedAt),
            catch: () => null,
          })
          transcriptPath = discovered
        }

        if (transcriptPath) {
          const parsed = yield* parseTranscript(transcriptPath).pipe(
            Effect.catchAll(() => Effect.succeed([] as ChatMessage[]))
          )
          messages = parsed
        }

        return {
          run: serializeRun(found),
          messages: messages as Array<{
            role: "user" | "assistant" | "system"
            content: unknown
            type?: "tool_use" | "tool_result" | "text" | "thinking"
            tool_name?: string
            timestamp?: string
          }>,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("createRun", ({ payload }) =>
      Effect.gen(function* () {
        // Security: validate transcriptPath before storing
        if (payload.transcriptPath && !isAllowedTranscriptPath(payload.transcriptPath)) {
          return yield* Effect.fail(
            new BadRequest({ message: "Invalid transcriptPath: must be under ~/.claude/ or .tx/" })
          )
        }
        // Security: validate contextInjected path is under .tx/runs/ (prefix match, not substring)
        if (payload.contextInjected) {
          if (!isAllowedRunPath(payload.contextInjected)) {
            return yield* Effect.fail(
              new BadRequest({ message: "Invalid contextInjected: must be under .tx/runs/" })
            )
          }
        }
        const runRepo = yield* RunRepository
        const run = yield* runRepo.create({
          taskId: payload.taskId,
          agent: payload.agent,
          pid: payload.pid,
          transcriptPath: payload.transcriptPath,
          contextInjected: payload.contextInjected,
          metadata: payload.metadata,
        })
        return serializeRun(run)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("updateRun", ({ path, payload }) =>
      Effect.gen(function* () {
        // Security: validate transcriptPath before storing
        if (payload.transcriptPath && !isAllowedTranscriptPath(payload.transcriptPath)) {
          return yield* Effect.fail(
            new BadRequest({ message: "Invalid transcriptPath: must be under ~/.claude/ or .tx/" })
          )
        }
        const runRepo = yield* RunRepository
        yield* runRepo.update(path.id as RunId, {
          status: payload.status,
          endedAt: yield* parseIsoDateOrFail(payload.endedAt, "endedAt"),
          exitCode: payload.exitCode,
          summary: payload.summary,
          errorMessage: payload.errorMessage,
          transcriptPath: payload.transcriptPath,
          metadata: payload.metadata,
        })
        const updated = yield* runRepo.findById(path.id as RunId)
        if (!updated) {
          return yield* Effect.fail(new NotFound({ message: `Run not found: ${path.id}` }))
        }
        return serializeRun(updated)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("heartbeatRun", ({ path, payload }) =>
      Effect.gen(function* () {
        const runHeartbeat = yield* RunHeartbeatService
        const checkAt = yield* parseIsoDateOrFail(payload.checkAt, "checkAt")
        const activityAt = yield* parseIsoDateOrFail(payload.activityAt, "activityAt")

        yield* runHeartbeat.heartbeat({
          runId: path.id as RunId,
          checkAt,
          activityAt,
          stdoutBytes: payload.stdoutBytes ?? 0,
          stderrBytes: payload.stderrBytes ?? 0,
          transcriptBytes: payload.transcriptBytes ?? 0,
          deltaBytes: payload.deltaBytes,
        })

        return {
          runId: path.id,
          checkAt: (checkAt ?? new Date()).toISOString(),
          activityAt: activityAt?.toISOString() ?? null,
          stdoutBytes: payload.stdoutBytes ?? 0,
          stderrBytes: payload.stderrBytes ?? 0,
          transcriptBytes: payload.transcriptBytes ?? 0,
          deltaBytes: payload.deltaBytes ?? 0,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getRunStdout", ({ path, urlParams }) =>
      Effect.gen(function* () {
        const runRepo = yield* RunRepository
        const found = yield* runRepo.findById(path.id as RunId)
        if (!found) {
          return yield* Effect.fail(new NotFound({ message: `Run not found: ${path.id}` }))
        }
        if (!found.stdoutPath) {
          return { content: "", truncated: false }
        }
        return yield* readLogFile(found.stdoutPath, urlParams.tail ?? 0).pipe(
          Effect.catchAll(() => Effect.succeed({ content: "", truncated: false }))
        )
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getRunStderr", ({ path, urlParams }) =>
      Effect.gen(function* () {
        const runRepo = yield* RunRepository
        const found = yield* runRepo.findById(path.id as RunId)
        if (!found) {
          return yield* Effect.fail(new NotFound({ message: `Run not found: ${path.id}` }))
        }
        if (!found.stderrPath) {
          return { content: "", truncated: false }
        }
        return yield* readLogFile(found.stderrPath, urlParams.tail ?? 0).pipe(
          Effect.catchAll(() => Effect.succeed({ content: "", truncated: false }))
        )
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getRunContext", ({ path }) =>
      Effect.gen(function* () {
        const runRepo = yield* RunRepository
        const found = yield* runRepo.findById(path.id as RunId)
        if (!found) {
          return yield* Effect.fail(new NotFound({ message: `Run not found: ${path.id}` }))
        }
        if (!found.contextInjected) {
          return { content: "", truncated: false }
        }
        return yield* readLogFile(found.contextInjected).pipe(
          Effect.catchAll(() => Effect.succeed({ content: "", truncated: false }))
        )
      }).pipe(Effect.mapError(mapCoreError))
    )
)
