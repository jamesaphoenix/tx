/**
 * Memory Route Handlers
 *
 * Implements memory document endpoint handlers for source management,
 * document CRUD, indexing, search, tags, properties, and links.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { MemoryService, MemoryRetrieverService } from "@jamesaphoenix/tx-core"
import { serializeMemoryDocument, serializeMemoryDocumentWithScore } from "@jamesaphoenix/tx-types"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

export const MemoryLive = HttpApiBuilder.group(TxApi, "memory", (handlers) =>
  handlers
    .handle("addSource", ({ payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        return yield* memoryService.addSource(payload.dir, payload.label)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("removeSource", ({ payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        yield* memoryService.removeSource(payload.dir)
        return { success: true }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listSources", () =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const sources = yield* memoryService.listSources()
        return { sources: [...sources] }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("createMemoryDocument", ({ payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const doc = yield* memoryService.createDocument({ ...payload })
        return serializeMemoryDocument(doc)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getMemoryDocument", ({ path }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const doc = yield* memoryService.getDocument(path.id)
        return serializeMemoryDocument(doc)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("listMemoryDocuments", ({ urlParams }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const tags = urlParams.tags?.split(",").filter(Boolean)
        const docs = yield* memoryService.listDocuments({
          source: urlParams.source,
          tags,
        })
        return { documents: docs.map(serializeMemoryDocument) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("searchMemoryDocuments", ({ urlParams }) =>
      Effect.gen(function* () {
        const retrieverService = yield* MemoryRetrieverService
        const tags = urlParams.tags?.split(",").filter(Boolean)
        const props = urlParams.props?.split(",").filter(Boolean)
        const results = yield* retrieverService.search(urlParams.query, {
          limit: urlParams.limit,
          minScore: urlParams.minScore,
          semantic: urlParams.semantic === "true",
          expand: urlParams.expand === "true",
          tags,
          props,
        })
        return { results: results.map(serializeMemoryDocumentWithScore) }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("indexMemoryDocuments", ({ payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        return yield* memoryService.index({ incremental: payload.incremental })
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getMemoryIndexStatus", () =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        return yield* memoryService.indexStatus()
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("addMemoryTags", ({ path, payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const doc = yield* memoryService.updateFrontmatter(path.id, { addTags: payload.tags })
        return serializeMemoryDocument(doc)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("removeMemoryTags", ({ path, payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const doc = yield* memoryService.updateFrontmatter(path.id, { removeTags: payload.tags })
        return serializeMemoryDocument(doc)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("addMemoryRelation", ({ path, payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const doc = yield* memoryService.updateFrontmatter(path.id, { addRelated: [payload.target] })
        return serializeMemoryDocument(doc)
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("setMemoryProperty", ({ path, payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        yield* memoryService.setProperty(path.id, path.key, payload.value)
        return { success: true }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("removeMemoryProperty", ({ path }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        yield* memoryService.removeProperty(path.id, path.key)
        return { success: true }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getMemoryProperties", ({ path }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const properties = yield* memoryService.getProperties(path.id)
        return { properties: [...properties] }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getMemoryLinks", ({ path }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const links = yield* memoryService.getLinks(path.id)
        return { links: [...links] }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getMemoryBacklinks", ({ path }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        const links = yield* memoryService.getBacklinks(path.id)
        return { links: [...links] }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("createMemoryLink", ({ payload }) =>
      Effect.gen(function* () {
        const memoryService = yield* MemoryService
        yield* memoryService.addLink(payload.sourceId, payload.targetRef)
        return { success: true }
      }).pipe(Effect.mapError(mapCoreError))
    )
)
