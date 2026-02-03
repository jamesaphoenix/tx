/**
 * Learning Routes
 *
 * Provides REST API endpoints for learnings and file learnings.
 * Includes contextual learning retrieval for tasks.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { Effect } from "effect"
import type { Learning, LearningWithScore, FileLearning, LearningSourceType } from "@jamesaphoenix/tx-types"
import { LEARNING_SOURCE_TYPES } from "@jamesaphoenix/tx-types"
import { LearningService, FileLearningService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const LearningSourceTypeSchema = z.enum(LEARNING_SOURCE_TYPES).openapi({
  example: "manual",
  description: "Learning source type"
})

const LearningSchema = z.object({
  id: z.number().int(),
  content: z.string(),
  sourceType: LearningSourceTypeSchema,
  sourceRef: z.string().nullable(),
  createdAt: z.string().datetime(),
  keywords: z.array(z.string()),
  category: z.string().nullable(),
  usageCount: z.number().int(),
  lastUsedAt: z.string().datetime().nullable(),
  outcomeScore: z.number().nullable()
}).openapi("Learning")

const LearningWithScoreSchema = LearningSchema.extend({
  relevanceScore: z.number(),
  bm25Score: z.number(),
  vectorScore: z.number(),
  recencyScore: z.number(),
  rrfScore: z.number(),
  bm25Rank: z.number().int(),
  vectorRank: z.number().int(),
  rerankerScore: z.number().optional()
}).openapi("LearningWithScore")

const FileLearningSchema = z.object({
  id: z.number().int(),
  filePattern: z.string(),
  note: z.string(),
  taskId: z.string().nullable(),
  createdAt: z.string().datetime()
}).openapi("FileLearning")

const CreateLearningSchema = z.object({
  content: z.string().min(1),
  sourceType: LearningSourceTypeSchema.optional(),
  sourceRef: z.string().optional(),
  category: z.string().optional(),
  keywords: z.array(z.string()).optional()
}).openapi("CreateLearning")

const CreateFileLearningSchema = z.object({
  filePattern: z.string().min(1),
  note: z.string().min(1),
  taskId: z.string().optional()
}).openapi("CreateFileLearning")

const ContextResultSchema = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  learnings: z.array(LearningWithScoreSchema),
  searchQuery: z.string(),
  searchDuration: z.number()
}).openapi("ContextResult")

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

const serializeLearning = (learning: Learning): z.infer<typeof LearningSchema> => ({
  id: learning.id,
  content: learning.content,
  sourceType: learning.sourceType,
  sourceRef: learning.sourceRef,
  createdAt: learning.createdAt.toISOString(),
  keywords: learning.keywords,
  category: learning.category,
  usageCount: learning.usageCount,
  lastUsedAt: learning.lastUsedAt?.toISOString() ?? null,
  outcomeScore: learning.outcomeScore
})

const serializeLearningWithScore = (learning: LearningWithScore): z.infer<typeof LearningWithScoreSchema> => ({
  ...serializeLearning(learning),
  relevanceScore: learning.relevanceScore,
  bm25Score: learning.bm25Score,
  vectorScore: learning.vectorScore,
  recencyScore: learning.recencyScore,
  rrfScore: learning.rrfScore,
  bm25Rank: learning.bm25Rank,
  vectorRank: learning.vectorRank,
  rerankerScore: learning.rerankerScore
})

const serializeFileLearning = (learning: FileLearning): z.infer<typeof FileLearningSchema> => ({
  id: learning.id,
  filePattern: learning.filePattern,
  note: learning.note,
  taskId: learning.taskId,
  createdAt: learning.createdAt.toISOString()
})

// -----------------------------------------------------------------------------
// Route Definitions
// -----------------------------------------------------------------------------

const searchLearningsRoute = createRoute({
  method: "get",
  path: "/api/learnings",
  tags: ["Learnings"],
  summary: "Search learnings",
  description: "Search learnings using BM25 text search with optional filters",
  request: {
    query: z.object({
      query: z.string().optional().openapi({ description: "Search query text" }),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      minScore: z.coerce.number().min(0).max(1).optional(),
      category: z.string().optional()
    })
  },
  responses: {
    200: {
      description: "Search results",
      content: { "application/json": { schema: z.object({ learnings: z.array(LearningWithScoreSchema) }) } }
    }
  }
})

const getLearningRoute = createRoute({
  method: "get",
  path: "/api/learnings/{id}",
  tags: ["Learnings"],
  summary: "Get learning by ID",
  request: {
    params: z.object({ id: z.coerce.number().int() })
  },
  responses: {
    200: {
      description: "Learning details",
      content: { "application/json": { schema: LearningSchema } }
    },
    404: { description: "Learning not found" }
  }
})

const createLearningRoute = createRoute({
  method: "post",
  path: "/api/learnings",
  tags: ["Learnings"],
  summary: "Create a new learning",
  request: {
    body: { content: { "application/json": { schema: CreateLearningSchema } } }
  },
  responses: {
    201: {
      description: "Learning created",
      content: { "application/json": { schema: LearningSchema } }
    }
  }
})

const updateLearningHelpfulnessRoute = createRoute({
  method: "post",
  path: "/api/learnings/{id}/helpful",
  tags: ["Learnings"],
  summary: "Record helpfulness score",
  description: "Update the outcome score for a learning based on helpfulness feedback",
  request: {
    params: z.object({ id: z.coerce.number().int() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            score: z.number().min(0).max(1).default(1.0)
          })
        }
      }
    }
  },
  responses: {
    200: {
      description: "Helpfulness recorded",
      content: { "application/json": { schema: z.object({ success: z.boolean(), id: z.number(), score: z.number() }) } }
    },
    404: { description: "Learning not found" }
  }
})

const getContextRoute = createRoute({
  method: "get",
  path: "/api/context/{taskId}",
  tags: ["Learnings"],
  summary: "Get contextual learnings for a task",
  description: "Retrieves relevant learnings for a task based on its title and description",
  request: {
    params: z.object({ taskId: z.string() })
  },
  responses: {
    200: {
      description: "Contextual learnings",
      content: { "application/json": { schema: ContextResultSchema } }
    },
    404: { description: "Task not found" }
  }
})

// File learnings routes
const listFileLearningsRoute = createRoute({
  method: "get",
  path: "/api/file-learnings",
  tags: ["File Learnings"],
  summary: "List or recall file learnings",
  description: "List all file learnings or recall learnings matching a specific path",
  request: {
    query: z.object({
      path: z.string().optional().openapi({ description: "File path to match against patterns" })
    })
  },
  responses: {
    200: {
      description: "File learnings",
      content: { "application/json": { schema: z.object({ learnings: z.array(FileLearningSchema) }) } }
    }
  }
})

const createFileLearningRoute = createRoute({
  method: "post",
  path: "/api/file-learnings",
  tags: ["File Learnings"],
  summary: "Create a file learning",
  description: "Attach a learning to a file path or glob pattern",
  request: {
    body: { content: { "application/json": { schema: CreateFileLearningSchema } } }
  },
  responses: {
    201: {
      description: "File learning created",
      content: { "application/json": { schema: FileLearningSchema } }
    }
  }
})

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export const learningsRouter = new OpenAPIHono()

learningsRouter.openapi(searchLearningsRoute, async (c) => {
  const { query, limit, minScore, category } = c.req.valid("query")

  const learnings = await runEffect(
    Effect.gen(function* () {
      const learningService = yield* LearningService

      if (!query) {
        // Return recent learnings if no query
        return yield* learningService.getRecent(limit)
      }

      return yield* learningService.search({
        query,
        limit,
        minScore: minScore ?? undefined,
        category: category ?? undefined
      })
    })
  )

  // Type guard to check if it's LearningWithScore
  const isWithScore = (l: Learning | LearningWithScore): l is LearningWithScore =>
    "relevanceScore" in l

  return c.json({
    learnings: learnings.map(l =>
      isWithScore(l) ? serializeLearningWithScore(l) : serializeLearningWithScore({
        ...l,
        relevanceScore: 1,
        bm25Score: 0,
        vectorScore: 0,
        recencyScore: 0,
        rrfScore: 0,
        bm25Rank: 0,
        vectorRank: 0
      })
    )
  }, 200)
})

learningsRouter.openapi(getLearningRoute, async (c) => {
  const { id } = c.req.valid("param")

  const learning = await runEffect(
    Effect.gen(function* () {
      const learningService = yield* LearningService
      return yield* learningService.get(id)
    })
  )

  return c.json(serializeLearning(learning), 200)
})

learningsRouter.openapi(createLearningRoute, async (c) => {
  const body = c.req.valid("json")

  const learning = await runEffect(
    Effect.gen(function* () {
      const learningService = yield* LearningService
      return yield* learningService.create({
        content: body.content,
        sourceType: (body.sourceType as LearningSourceType) ?? "manual",
        sourceRef: body.sourceRef ?? undefined,
        category: body.category ?? undefined,
        keywords: body.keywords ?? undefined
      })
    })
  )

  return c.json(serializeLearning(learning), 201)
})

learningsRouter.openapi(updateLearningHelpfulnessRoute, async (c) => {
  const { id } = c.req.valid("param")
  const { score } = c.req.valid("json")

  await runEffect(
    Effect.gen(function* () {
      const learningService = yield* LearningService
      yield* learningService.updateOutcome(id, score)
    })
  )

  return c.json({ success: true, id, score }, 200)
})

learningsRouter.openapi(getContextRoute, async (c) => {
  const { taskId } = c.req.valid("param")

  const result = await runEffect(
    Effect.gen(function* () {
      const learningService = yield* LearningService
      return yield* learningService.getContextForTask(taskId)
    })
  )

  return c.json({
    taskId: result.taskId,
    taskTitle: result.taskTitle,
    learnings: result.learnings.map(serializeLearningWithScore),
    searchQuery: result.searchQuery,
    searchDuration: result.searchDuration
  }, 200)
})

learningsRouter.openapi(listFileLearningsRoute, async (c) => {
  const { path } = c.req.valid("query")

  const learnings = await runEffect(
    Effect.gen(function* () {
      const fileLearningService = yield* FileLearningService
      if (path) {
        return yield* fileLearningService.recall(path)
      }
      return yield* fileLearningService.getAll()
    })
  )

  return c.json({ learnings: learnings.map(serializeFileLearning) }, 200)
})

learningsRouter.openapi(createFileLearningRoute, async (c) => {
  const body = c.req.valid("json")

  const learning = await runEffect(
    Effect.gen(function* () {
      const fileLearningService = yield* FileLearningService
      return yield* fileLearningService.create({
        filePattern: body.filePattern,
        note: body.note,
        taskId: body.taskId ?? undefined
      })
    })
  )

  return c.json(serializeFileLearning(learning), 201)
})
