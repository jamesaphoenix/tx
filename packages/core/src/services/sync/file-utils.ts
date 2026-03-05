import { Effect, Schema } from "effect"
import { writeFile, rename, readFile, mkdir, access } from "node:fs/promises"
import { dirname } from "node:path"
import { DatabaseError, ValidationError } from "../../errors.js"
import type { EntityImportResult } from "./types.js"

/** Empty entity import result for early returns. */
export const EMPTY_ENTITY_IMPORT_RESULT: EntityImportResult = { imported: 0, skipped: 0 }

/** Check if a file exists without blocking the event loop. */
export const fileExists = (filePath: string): Effect.Effect<boolean> =>
  Effect.promise(() => access(filePath).then(() => true).catch(() => false))

/**
 * Write content to file atomically using temp file + rename.
 * Uses async fs operations to avoid blocking the event loop.
 */
export const atomicWrite = (filePath: string, content: string): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const dir = dirname(filePath)
      await mkdir(dir, { recursive: true })
      const tempPath = `${filePath}.tmp.${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2)}`
      await writeFile(tempPath, content, "utf-8")
      await rename(tempPath, filePath)
    },
    catch: (cause) => new DatabaseError({ cause })
  })

/** Read and parse a JSONL file into plain object records. */
export const readJsonlRecords = (
  filePath: string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, DatabaseError | ValidationError> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(filePath)
    if (!exists) return []
    const content = yield* Effect.tryPromise({
      try: () => readFile(filePath, "utf-8"),
      catch: (cause) => new DatabaseError({ cause })
    })
    const lines = content.trim().split("\n").filter(Boolean)
    const records: Record<string, unknown>[] = []
    for (const line of lines) {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(line),
        catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
      })
      if (!parsed || typeof parsed !== "object") {
        return yield* Effect.fail(new ValidationError({ reason: "JSONL line is not an object" }))
      }
      records.push(parsed as Record<string, unknown>)
    }
    return records
  })

/**
 * Generic helper: parse a JSONL file, validate with schema, dedup by contentHash,
 * filter against existing entities, and insert new ones via caller-provided batch function.
 */
export const importEntityJsonl = <Op extends { contentHash: string; ts: string }>(
  filePath: string,
  schema: Schema.Schema<Op>,
  existingHashes: Set<string>,
  insertBatch: (newOps: ReadonlyArray<Op>) => number
): Effect.Effect<EntityImportResult, ValidationError | DatabaseError> =>
  Effect.gen(function* () {
    const importFileExists = yield* fileExists(filePath)
    if (!importFileExists) {
      return EMPTY_ENTITY_IMPORT_RESULT
    }

    const content = yield* Effect.tryPromise({
      try: () => readFile(filePath, "utf-8"),
      catch: (cause) => new DatabaseError({ cause })
    })

    const lines = content.trim().split("\n").filter(Boolean)
    if (lines.length === 0) {
      return EMPTY_ENTITY_IMPORT_RESULT
    }

    const states = new Map<string, Op>()
    for (const line of lines) {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(line),
        catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
      })
      const op: Op = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(parsed),
        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
      })
      const existing = states.get(op.contentHash)
      if (!existing || op.ts > existing.ts) {
        states.set(op.contentHash, op)
      }
    }

    const newOps: Op[] = []
    let skipped = 0
    for (const op of states.values()) {
      if (existingHashes.has(op.contentHash)) {
        skipped++
      } else {
        newOps.push(op)
      }
    }

    if (newOps.length === 0) {
      return { imported: 0, skipped }
    }

    const imported = yield* Effect.try({
      try: () => insertBatch(newOps),
      catch: (cause) => new DatabaseError({ cause })
    })

    return { imported, skipped }
  })
