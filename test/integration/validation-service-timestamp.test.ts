/**
 * ValidationService timestamp-format regression test.
 *
 * `tx validate --fix` must write `updated_at` as ISO-8601 (matching toISOString
 * everywhere else), NOT SQLite's datetime('now') format ("YYYY-MM-DD HH:MM:SS").
 * A SQLite-format value breaks ISO string comparisons used by optimistic
 * locking (task-repo write) and sync import ordering.
 *
 * Uses the shared singleton test layer (Rule 8). An orphaned-parent row is
 * seeded by briefly toggling foreign_keys off (restored immediately) so the
 * checkMissingParentRefs fix path runs.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { SqliteClient, ValidationService } from "@jamesaphoenix/tx-core"

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe("ValidationService timestamp format", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  it("validate --fix writes updated_at as ISO-8601, not datetime('now') format", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient
        const validation = yield* ValidationService

        // Seed a task whose parent_id dangles (no such task). FK enforcement
        // would normally reject this, so toggle it off for the insert only.
        const iso = new Date().toISOString()
        db.run("PRAGMA foreign_keys = OFF")
        try {
          db.prepare(
            `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at)
             VALUES ('tx-orphan01', 'Orphan', '', 'backlog', 'tx-ghost-parent', 0, ?, ?)`
          ).run(iso, iso)
        } finally {
          db.run("PRAGMA foreign_keys = ON")
        }

        // Run the orphaned-parent fix path.
        const validationResult = yield* validation.validate({ fix: true })

        const row = db
          .prepare("SELECT parent_id, updated_at FROM tasks WHERE id = 'tx-orphan01'")
          .get() as { parent_id: string | null; updated_at: string }

        return { validationResult, row }
      }).pipe(Effect.provide(shared.layer))
    )

    // The fix cleared the dangling parent reference...
    expect(result.row.parent_id).toBeNull()
    // ...and stamped updated_at in ISO-8601 form (not "2026-06-24 15:51:33").
    expect(result.row.updated_at).toMatch(ISO_8601)
    expect(result.row.updated_at).not.toContain(" ")
  })
})
