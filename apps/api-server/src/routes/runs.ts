/**
 * Run Route Handlers
 *
 * Implements run tracking endpoint handlers.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import type { Run, RunId, RunStatus } from "@jamesaphoenix/tx-types"
import { serializeRun } from "@jamesaphoenix/tx-types"
import { RunRepository } from "@jamesaphoenix/tx-core"
import { TxApi, NotFound, mapCoreError } from "../api.js"
import { parseTranscript, findMatchingTranscript, type ChatMessage } from "../utils/transcript-parser.js"
import { readLogFile } from "../utils/log-reader.js"

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
        const runRepo = yield* RunRepository
        yield* runRepo.update(path.id as RunId, {
          status: payload.status,
          endedAt: payload.endedAt ? new Date(payload.endedAt) : undefined,
          exitCode: payload.exitCode,
          summary: payload.summary,
          errorMessage: payload.errorMessage,
          transcriptPath: payload.transcriptPath,
        })
        const updated = yield* runRepo.findById(path.id as RunId)
        if (!updated) {
          return yield* Effect.fail(new NotFound({ message: `Run not found: ${path.id}` }))
        }
        return serializeRun(updated)
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
