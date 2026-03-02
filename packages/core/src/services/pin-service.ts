/**
 * PinService — Context Pin management
 *
 * CRUD for named content blocks ("pins") that are synchronized to
 * agent context files (CLAUDE.md, AGENTS.md) as <tx-pin> XML blocks.
 */

import { Context, Effect, Layer } from "effect"
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs"
import { resolve, sep, dirname } from "node:path"
import { PinRepository } from "../repo/pin-repo.js"
import { DatabaseError, ValidationError } from "../errors.js"
import { syncBlocks } from "../utils/pin-file.js"
import type { Pin } from "@jamesaphoenix/tx-types"

/**
 * Validate that a target file path does not escape the project directory.
 */
const validateProjectPath = (targetFile: string): Effect.Effect<string, ValidationError> => {
  const projectRoot = process.cwd()
  const resolved = resolve(projectRoot, targetFile)

  if (!resolved.startsWith(projectRoot + sep)) {
    return Effect.fail(new ValidationError({
      reason: `Path traversal rejected: '${resolved}' escapes project directory '${projectRoot}'`
    }))
  }

  return Effect.succeed(resolved)
}

export class PinService extends Context.Tag("PinService")<
  PinService,
  {
    /** Create or update a pin, then sync to target files. */
    readonly set: (id: string, content: string) => Effect.Effect<Pin, DatabaseError | ValidationError>

    /** Get a pin by ID. */
    readonly get: (id: string) => Effect.Effect<Pin | null, DatabaseError>

    /** Remove a pin and sync target files. */
    readonly remove: (id: string) => Effect.Effect<boolean, DatabaseError | ValidationError>

    /** List all pins. */
    readonly list: () => Effect.Effect<readonly Pin[], DatabaseError>

    /** Re-sync all pins to target files (idempotent). */
    readonly sync: () => Effect.Effect<{ synced: readonly string[] }, DatabaseError | ValidationError>

    /** Get configured target files. */
    readonly getTargetFiles: () => Effect.Effect<readonly string[], DatabaseError>

    /** Set target files. */
    readonly setTargetFiles: (files: readonly string[]) => Effect.Effect<void, DatabaseError | ValidationError>
  }
>() {}

export const PinServiceLive = Layer.effect(
  PinService,
  Effect.gen(function* () {
    const repo = yield* PinRepository

    const syncToFiles = (): Effect.Effect<{ synced: readonly string[] }, DatabaseError | ValidationError> =>
      Effect.gen(function* () {
        const pins = yield* repo.findAll()
        const targetFiles = yield* repo.getTargetFiles()
        const synced: string[] = []

        // Build pin map from DB
        const pinMap = new Map<string, string>()
        for (const pin of pins) {
          pinMap.set(pin.id, pin.content)
        }

        for (const targetFile of targetFiles) {
          const resolvedPath = yield* validateProjectPath(targetFile)

          // Read file content — ENOENT → empty string, other errors → typed DatabaseError
          const fileContent = yield* Effect.try({
            try: () => {
              try {
                return readFileSync(resolvedPath, "utf-8")
              } catch (e: unknown) {
                if ((e as NodeJS.ErrnoException).code === "ENOENT") return ""
                throw e
              }
            },
            catch: (e) => new DatabaseError({ cause: e })
          })

          const updated = syncBlocks(fileContent, pinMap)

          // Only write if content changed — use temp file + rename for atomicity
          if (updated !== fileContent) {
            yield* Effect.try({
              try: () => {
                const dir = dirname(resolvedPath)
                mkdirSync(dir, { recursive: true })
                const tempPath = `${resolvedPath}.tmp.${Date.now()}.${process.pid}`
                try {
                  writeFileSync(tempPath, updated, "utf-8")
                  renameSync(tempPath, resolvedPath)
                } catch (e) {
                  try { unlinkSync(tempPath) } catch { /* ignore cleanup error */ }
                  throw e
                }
              },
              catch: (e) => new DatabaseError({ cause: e })
            })
            synced.push(targetFile)
          }
        }

        return { synced }
      })

    return {
      set: (id, content) =>
        Effect.gen(function* () {
          yield* validatePinId(id)
          yield* validatePinContent(content)
          const pin = yield* repo.upsert(id, content)
          yield* syncToFiles()
          return pin
        }),

      get: (id) => repo.findById(id),

      remove: (id) =>
        Effect.gen(function* () {
          const deleted = yield* repo.remove(id)
          if (deleted) {
            yield* syncToFiles()
          }
          return deleted
        }),

      list: () => repo.findAll(),

      sync: () => syncToFiles(),

      getTargetFiles: () => repo.getTargetFiles(),

      setTargetFiles: (files) =>
        Effect.gen(function* () {
          if (files.length === 0) {
            return yield* Effect.fail(new ValidationError({
              reason: "At least one target file is required"
            }))
          }
          // Validate all paths
          for (const f of files) {
            yield* validateProjectPath(f)
          }
          yield* repo.setTargetFiles(files)
        }),
    }
  })
)

/** Validate pin ID format. */
/** Reserved pin IDs that conflict with API route segments. */
const RESERVED_PIN_IDS = new Set(["sync", "targets"])

const validatePinId = (id: string): Effect.Effect<void, ValidationError> => {
  if (RESERVED_PIN_IDS.has(id)) {
    return Effect.fail(new ValidationError({
      reason: `Pin ID '${id}' is reserved`
    }))
  }
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(id)) {
    return Effect.fail(new ValidationError({
      reason: `Invalid pin ID '${id}'. Must be kebab-case: lowercase letters, numbers, dots, hyphens, underscores. Must start and end with alphanumeric. Minimum 2 characters.`
    }))
  }
  return Effect.succeed(undefined)
}

/** Validate pin content does not contain XML tags that would corrupt file sync. */
const validatePinContent = (content: string): Effect.Effect<void, ValidationError> => {
  if (/<tx-pin[\s>]/.test(content) || content.includes("</tx-pin>")) {
    return Effect.fail(new ValidationError({
      reason: "Pin content must not contain <tx-pin> or </tx-pin> tags"
    }))
  }
  return Effect.succeed(undefined)
}
