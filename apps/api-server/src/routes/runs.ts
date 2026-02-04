/**
 * Run Routes
 *
 * Provides REST API endpoints for agent run tracking with cursor-based pagination.
 * Runs track Claude agent sessions for observability.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { HTTPException } from "hono/http-exception"
import { Effect } from "effect"
import type { Run, RunId, RunStatus } from "@jamesaphoenix/tx-types"
import { RUN_STATUSES } from "@jamesaphoenix/tx-types"
import { RunRepository } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const RunIdSchema = z.string().regex(/^run-[a-f0-9]{8}$/).openapi({
  example: "run-abc12345",
  description: "Run ID in format run-<8 hex chars>"
})

const RunStatusSchema = z.enum(RUN_STATUSES).openapi({
  example: "running",
  description: "Run status"
})

const RunSchema = z.object({
  id: RunIdSchema,
  taskId: z.string().nullable(),
  agent: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  status: RunStatusSchema,
  exitCode: z.number().int().nullable(),
  pid: z.number().int().nullable(),
  transcriptPath: z.string().nullable(),
  contextInjected: z.string().nullable(),
  summary: z.string().nullable(),
  errorMessage: z.string().nullable(),
  metadata: z.record(z.unknown())
}).openapi("Run")

const PaginatedRunsSchema = z.object({
  runs: z.array(RunSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  total: z.number().int()
}).openapi("PaginatedRuns")

const CreateRunSchema = z.object({
  taskId: z.string().optional(),
  agent: z.string(),
  pid: z.number().int().optional(),
  transcriptPath: z.string().optional(),
  contextInjected: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
}).openapi("CreateRun")

const UpdateRunSchema = z.object({
  status: RunStatusSchema.optional(),
  endedAt: z.string().datetime().optional(),
  exitCode: z.number().int().optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  transcriptPath: z.string().optional()
}).openapi("UpdateRun")

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

const serializeRun = (run: Run): z.infer<typeof RunSchema> => ({
  id: run.id,
  taskId: run.taskId,
  agent: run.agent,
  startedAt: run.startedAt.toISOString(),
  endedAt: run.endedAt?.toISOString() ?? null,
  status: run.status,
  exitCode: run.exitCode,
  pid: run.pid,
  transcriptPath: run.transcriptPath,
  contextInjected: run.contextInjected,
  summary: run.summary,
  errorMessage: run.errorMessage,
  metadata: run.metadata
})

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
    id: cursor.slice(colonIndex + 1)
  }
}

const buildRunCursor = (run: Run): string => {
  return `${run.startedAt.toISOString()}:${run.id}`
}

// -----------------------------------------------------------------------------
// Route Definitions
// -----------------------------------------------------------------------------

const listRunsRoute = createRoute({
  method: "get",
  path: "/api/runs",
  tags: ["Runs"],
  summary: "List runs with cursor-based pagination",
  description: "Returns paginated agent runs with optional filtering",
  request: {
    query: z.object({
      cursor: z.string().optional().openapi({ description: "Pagination cursor (format: startedAt:id)" }),
      limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ description: "Items per page" }),
      agent: z.string().optional().openapi({ description: "Filter by agent name" }),
      status: z.string().optional().openapi({ description: "Comma-separated statuses to filter" }),
      taskId: z.string().optional().openapi({ description: "Filter by task ID" })
    })
  },
  responses: {
    200: {
      description: "Paginated list of runs",
      content: { "application/json": { schema: PaginatedRunsSchema } }
    }
  }
})

const getRunRoute = createRoute({
  method: "get",
  path: "/api/runs/{id}",
  tags: ["Runs"],
  summary: "Get run details",
  request: {
    params: z.object({ id: RunIdSchema })
  },
  responses: {
    200: {
      description: "Run details",
      content: { "application/json": { schema: RunSchema } }
    },
    404: { description: "Run not found" }
  }
})

const createRunRoute = createRoute({
  method: "post",
  path: "/api/runs",
  tags: ["Runs"],
  summary: "Create a new run",
  request: {
    body: { content: { "application/json": { schema: CreateRunSchema } } }
  },
  responses: {
    201: {
      description: "Run created",
      content: { "application/json": { schema: RunSchema } }
    }
  }
})

const updateRunRoute = createRoute({
  method: "patch",
  path: "/api/runs/{id}",
  tags: ["Runs"],
  summary: "Update a run",
  request: {
    params: z.object({ id: RunIdSchema }),
    body: { content: { "application/json": { schema: UpdateRunSchema } } }
  },
  responses: {
    200: {
      description: "Run updated",
      content: { "application/json": { schema: RunSchema } }
    },
    404: { description: "Run not found" }
  }
})

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export const runsRouter = new OpenAPIHono()

runsRouter.openapi(listRunsRoute, async (c) => {
  const { cursor, limit, agent, status, taskId } = c.req.valid("query")

  const result = await runEffect(
    Effect.gen(function* () {
      const runRepo = yield* RunRepository

      // Get runs based on filters
      let allRuns: readonly Run[]
      if (taskId) {
        allRuns = yield* runRepo.findByTaskId(taskId)
      } else if (status && status.split(",").length === 1) {
        allRuns = yield* runRepo.findByStatus(status as RunStatus)
      } else {
        allRuns = yield* runRepo.findRecent(1000) // Get all for filtering
      }

      // Apply additional filters in memory
      let filtered: Run[] = [...allRuns]

      if (agent) {
        filtered = filtered.filter(r => r.agent === agent)
      }

      if (status && status.split(",").length > 1) {
        const statusFilter = status.split(",").filter(Boolean) as RunStatus[]
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
      if (cursor) {
        const parsed = parseRunCursor(cursor)
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
        runs: resultRuns,
        hasMore,
        total,
        nextCursor: hasMore && resultRuns.length > 0
          ? buildRunCursor(resultRuns[resultRuns.length - 1])
          : null
      }
    })
  )

  return c.json({
    runs: result.runs.map(serializeRun),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    total: result.total
  }, 200)
})

runsRouter.openapi(getRunRoute, async (c) => {
  const { id } = c.req.valid("param")

  const run = await runEffect(
    Effect.gen(function* () {
      const runRepo = yield* RunRepository
      const found = yield* runRepo.findById(id as RunId)
      if (!found) {
        throw new HTTPException(404, { message: `Run not found: ${id}` })
      }
      return found
    })
  )

  return c.json(serializeRun(run), 200)
})

runsRouter.openapi(createRunRoute, async (c) => {
  const body = c.req.valid("json")

  const run = await runEffect(
    Effect.gen(function* () {
      const runRepo = yield* RunRepository
      return yield* runRepo.create({
        taskId: body.taskId,
        agent: body.agent,
        pid: body.pid,
        transcriptPath: body.transcriptPath,
        contextInjected: body.contextInjected,
        metadata: body.metadata
      })
    })
  )

  return c.json(serializeRun(run), 201)
})

runsRouter.openapi(updateRunRoute, async (c) => {
  const { id } = c.req.valid("param")
  const body = c.req.valid("json")

  const run = await runEffect(
    Effect.gen(function* () {
      const runRepo = yield* RunRepository
      yield* runRepo.update(id as RunId, {
        status: body.status,
        endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
        exitCode: body.exitCode,
        summary: body.summary,
        errorMessage: body.errorMessage,
        transcriptPath: body.transcriptPath
      })
      const updated = yield* runRepo.findById(id as RunId)
      if (!updated) {
        throw new HTTPException(404, { message: `Run not found: ${id}` })
      }
      return updated
    })
  )

  return c.json(serializeRun(run), 200)
})
