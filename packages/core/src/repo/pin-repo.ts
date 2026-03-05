/**
 * PinRepository — Context Pins
 *
 * Repository for context_pins and pin_config tables.
 * Provides CRUD for named content blocks that sync to agent context files.
 */

import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToPin } from "../mappers/pin.js"
import type { Pin, PinRow } from "@jamesaphoenix/tx-types"
import { coerceDbResult } from "../utils/db-result.js"

export class PinRepository extends Context.Tag("PinRepository")<
  PinRepository,
  {
    /** Upsert a pin (insert or update). Returns the upserted pin. */
    readonly upsert: (id: string, content: string) => Effect.Effect<Pin, DatabaseError>

    /** Find a pin by ID. */
    readonly findById: (id: string) => Effect.Effect<Pin | null, DatabaseError>

    /** List all pins. */
    readonly findAll: () => Effect.Effect<readonly Pin[], DatabaseError>

    /** Remove a pin by ID. Returns true if deleted, false if not found. */
    readonly remove: (id: string) => Effect.Effect<boolean, DatabaseError>

    /** Get configured target files (JSON array in DB). */
    readonly getTargetFiles: () => Effect.Effect<readonly string[], DatabaseError>

    /** Set target files (stored as JSON array). */
    readonly setTargetFiles: (files: readonly string[]) => Effect.Effect<void, DatabaseError>
  }
>() {}

export const PinRepositoryLive = Layer.effect(
  PinRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      upsert: (id, content) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            db.prepare(
              `INSERT INTO context_pins (id, content, created_at, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 content = excluded.content,
                 updated_at = excluded.updated_at`
            ).run(id, content, now, now)

            const row = coerceDbResult<PinRow | undefined>(db.prepare(
              "SELECT * FROM context_pins WHERE id = ?"
            ).get(id))
            if (!row) {
              throw new EntityFetchError({ entity: "pin", id, operation: "insert" })
            }
            return rowToPin(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<PinRow | undefined>(db.prepare(
              "SELECT * FROM context_pins WHERE id = ?"
            ).get(id))
            return row ? rowToPin(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<PinRow[]>(db.prepare(
              "SELECT * FROM context_pins ORDER BY id"
            ).all())
            return rows.map(rowToPin)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (id) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "DELETE FROM context_pins WHERE id = ?"
            ).run(id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getTargetFiles: () =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<{ value: string } | undefined>(db.prepare(
              "SELECT value FROM pin_config WHERE key = 'target_files'"
            ).get())
            if (!row || !row.value) return ["CLAUDE.md"]
            // Support both JSON array (new) and comma-separated (legacy) formats
            try {
              const parsed = JSON.parse(row.value)
              if (Array.isArray(parsed)) return parsed.filter((f): f is string => typeof f === "string" && f.length > 0)
            } catch { /* not JSON, fall through to legacy */ }
            return row.value.split(",").map(f => f.trim()).filter(Boolean)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      setTargetFiles: (files) =>
        Effect.try({
          try: () => {
            const value = JSON.stringify([...files])
            db.prepare(
              `INSERT INTO pin_config (key, value) VALUES ('target_files', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`
            ).run(value)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
    }
  })
)
