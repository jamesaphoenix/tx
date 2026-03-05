/**
 * Memory repositories - CRUD + FTS5 search for memory documents
 *
 * Follows the Context.Tag + Layer.effect pattern from learning-repo.ts.
 * Stores indexed data derived from .md files on disk.
 */

import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { createMemoryDocumentRepository } from "./memory-repo/document.js"
import { createMemoryLinkRepository } from "./memory-repo/link.js"
import { createMemoryPropertyRepository } from "./memory-repo/property.js"
import { createMemorySourceRepository } from "./memory-repo/source.js"
import type {
  MemoryDocument,
  MemoryLink,
  MemorySource,
  MemoryProperty,
} from "@jamesaphoenix/tx-types"

/** Scored memory document result from BM25 search */
export type MemoryBM25Result = {
  document: MemoryDocument
  score: number
}

export type MemoryDocumentRepositoryService = {
  readonly upsertDocument: (doc: {
    id: string
    filePath: string
    rootDir: string
    title: string
    content: string
    frontmatter: string | null
    tags: string | null
    fileHash: string
    fileMtime: string
    createdAt: string
    indexedAt: string
  }) => Effect.Effect<void, DatabaseError>
  readonly findById: (id: string) => Effect.Effect<MemoryDocument | null, DatabaseError>
  readonly findByPath: (filePath: string, rootDir: string) => Effect.Effect<MemoryDocument | null, DatabaseError>
  readonly findByHash: (hash: string) => Effect.Effect<readonly MemoryDocument[], DatabaseError>
  readonly searchBM25: (query: string, limit: number) => Effect.Effect<readonly MemoryBM25Result[], DatabaseError>
  readonly findWithEmbeddings: (limit: number) => Effect.Effect<readonly MemoryDocument[], DatabaseError>
  readonly listAll: (filter?: { rootDir?: string; tags?: readonly string[] }) => Effect.Effect<readonly MemoryDocument[], DatabaseError>
  readonly deleteByRootDir: (rootDir: string) => Effect.Effect<number, DatabaseError>
  readonly deleteById: (id: string) => Effect.Effect<void, DatabaseError>
  readonly deleteByPaths: (rootDir: string, paths: readonly string[]) => Effect.Effect<number, DatabaseError>
  readonly updateFileHash: (id: string, hash: string) => Effect.Effect<void, DatabaseError>
  readonly updateEmbedding: (id: string, embedding: Float32Array) => Effect.Effect<void, DatabaseError>
  readonly count: () => Effect.Effect<number, DatabaseError>
  readonly countWithEmbeddings: () => Effect.Effect<number, DatabaseError>
  readonly listPathsByRootDir: (rootDir: string) => Effect.Effect<readonly string[], DatabaseError>
}

export class MemoryDocumentRepository extends Context.Tag("MemoryDocumentRepository")<
  MemoryDocumentRepository,
  MemoryDocumentRepositoryService
>() {}

export const MemoryDocumentRepositoryLive = Layer.effect(
  MemoryDocumentRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    return createMemoryDocumentRepository(db)
  })
)

export type MemoryLinkRepositoryService = {
  readonly insertLinks: (links: readonly { sourceDocId: string; targetRef: string; linkType: string }[]) => Effect.Effect<void, DatabaseError>
  readonly findOutgoing: (docId: string) => Effect.Effect<readonly MemoryLink[], DatabaseError>
  readonly findIncoming: (docId: string) => Effect.Effect<readonly MemoryLink[], DatabaseError>
  readonly deleteBySource: (docId: string) => Effect.Effect<void, DatabaseError>
  readonly resolveTargets: () => Effect.Effect<number, DatabaseError>
  readonly insertExplicit: (sourceId: string, targetRef: string) => Effect.Effect<void, DatabaseError>
  readonly count: () => Effect.Effect<number, DatabaseError>
}

export class MemoryLinkRepository extends Context.Tag("MemoryLinkRepository")<
  MemoryLinkRepository,
  MemoryLinkRepositoryService
>() {}

export const MemoryLinkRepositoryLive = Layer.effect(
  MemoryLinkRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    return createMemoryLinkRepository(db)
  })
)

export type MemoryPropertyRepositoryService = {
  readonly setProperty: (docId: string, key: string, value: string) => Effect.Effect<void, DatabaseError>
  readonly getProperty: (docId: string, key: string) => Effect.Effect<MemoryProperty | null, DatabaseError>
  readonly getProperties: (docId: string) => Effect.Effect<readonly MemoryProperty[], DatabaseError>
  readonly deleteProperty: (docId: string, key: string) => Effect.Effect<void, DatabaseError>
  readonly syncFromFrontmatter: (docId: string, properties: Record<string, string>) => Effect.Effect<void, DatabaseError>
  readonly findByProperty: (key: string, value?: string) => Effect.Effect<readonly string[], DatabaseError>
}

export class MemoryPropertyRepository extends Context.Tag("MemoryPropertyRepository")<
  MemoryPropertyRepository,
  MemoryPropertyRepositoryService
>() {}

export const MemoryPropertyRepositoryLive = Layer.effect(
  MemoryPropertyRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    return createMemoryPropertyRepository(db)
  })
)

export type MemorySourceRepositoryService = {
  readonly addSource: (rootDir: string, label?: string) => Effect.Effect<MemorySource, DatabaseError>
  readonly removeSource: (rootDir: string) => Effect.Effect<void, DatabaseError>
  readonly listSources: () => Effect.Effect<readonly MemorySource[], DatabaseError>
  readonly findSource: (rootDir: string) => Effect.Effect<MemorySource | null, DatabaseError>
}

export class MemorySourceRepository extends Context.Tag("MemorySourceRepository")<
  MemorySourceRepository,
  MemorySourceRepositoryService
>() {}

export const MemorySourceRepositoryLive = Layer.effect(
  MemorySourceRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    return createMemorySourceRepository(db)
  })
)
