/**
 * Integration tests for REST API cycle endpoints.
 *
 * Tests the cycle route handlers at the service level (same pattern as api-claim tests).
 * The REST handlers in apps/api-server/src/routes/cycles.ts use raw SQL against
 * SqliteClient to query runs, events, and tasks tables.
 *
 * Critical bug regression tests:
 * - getCycle for non-existent ID returns NotFound (404), NOT InternalError (500)
 * - deleteCycle for non-existent ID returns NotFound (404), NOT InternalError (500)
 *
 * These tests replicate the exact handler logic from cycles.ts to verify that
 * the Effect.mapError pattern correctly preserves NotFound errors while mapping
 * other errors to InternalError.
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { beforeEach, describe, it, expect } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { SqliteClient } from "@jamesaphoenix/tx-core"

// =============================================================================
// Types (mirror the route handler types)
// =============================================================================

interface CycleRunRow {
  id: string
  agent: string
  started_at: string
  ended_at: string | null
  status: string
  summary: string | null
  metadata: string
}

interface EventRow {
  metadata: string
}

interface IssueRow {
  id: string
  title: string
  description: string
  metadata: string
}

// Error types matching api.ts definitions (for assertion matching)
class NotFound {
  readonly _tag = "NotFound"
  constructor(readonly message: string) {}
}

class InternalError {
  readonly _tag = "InternalError"
  constructor(readonly message: string) {}
}

// =============================================================================
// Helpers — replicate handler logic from apps/api-server/src/routes/cycles.ts
// =============================================================================

/**
 * Mirrors the listCycles handler: query runs WHERE agent = 'cycle-scanner'.
 */
const listCycles = Effect.gen(function* () {
  const db = yield* SqliteClient
  const rows = db
    .prepare(
      `SELECT id, agent, started_at, ended_at, status, summary, metadata
       FROM runs
       WHERE agent = 'cycle-scanner'
       ORDER BY started_at DESC`
    )
    .all() as CycleRunRow[]

  const cycles = rows.map((row) => {
    const meta = JSON.parse(row.metadata || "{}") as Record<string, unknown>
    return {
      id: row.id,
      cycle: (meta.cycle as number) ?? 0,
      name: (meta.name as string) ?? "",
      description: (meta.description as string) ?? "",
      startedAt: row.started_at,
      endedAt: row.ended_at ?? null,
      status: row.status,
      rounds: (meta.rounds as number) ?? 0,
      totalNewIssues: (meta.totalNewIssues as number) ?? 0,
      existingIssues: (meta.existingIssues as number) ?? 0,
      finalLoss: (meta.finalLoss as number) ?? 0,
      converged: (meta.converged as boolean) ?? false,
    }
  })

  return { cycles }
}).pipe(
  Effect.catchAll((e) => Effect.fail(new InternalError(String(e))))
)

/**
 * Mirrors the getCycle handler: look up a run by ID, return 404 if not found.
 * This is the handler where the bug was: NotFound was being swallowed by catchAll
 * and converted to InternalError (500) instead of being preserved as NotFound (404).
 */
const getCycle = (id: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient

    const runRow = db
      .prepare(
        `SELECT id, agent, started_at, ended_at, status, summary, metadata
         FROM runs WHERE id = ?`
      )
      .get(id) as CycleRunRow | undefined

    if (!runRow) {
      return yield* Effect.fail(new NotFound(`Cycle run not found: ${id}`))
    }

    const meta = JSON.parse(runRow.metadata || "{}") as Record<string, unknown>
    const cycle = {
      id: runRow.id,
      cycle: (meta.cycle as number) ?? 0,
      name: (meta.name as string) ?? "",
      description: (meta.description as string) ?? "",
      startedAt: runRow.started_at,
      endedAt: runRow.ended_at ?? null,
      status: runRow.status,
      rounds: (meta.rounds as number) ?? 0,
      totalNewIssues: (meta.totalNewIssues as number) ?? 0,
      existingIssues: (meta.existingIssues as number) ?? 0,
      finalLoss: (meta.finalLoss as number) ?? 0,
      converged: (meta.converged as boolean) ?? false,
    }

    // Get round metrics
    const eventRows = db
      .prepare(
        `SELECT metadata FROM events
         WHERE run_id = ? AND event_type = 'metric' AND content = 'cycle.round.loss'
         ORDER BY timestamp ASC`
      )
      .all(id) as EventRow[]

    const roundMetrics = eventRows.map((row) => {
      const m = JSON.parse(row.metadata || "{}") as Record<string, unknown>
      return {
        cycle: (m.cycle as number) ?? 0,
        round: (m.round as number) ?? 0,
        loss: (m.loss as number) ?? 0,
        newIssues: (m.newIssues as number) ?? 0,
        existingIssues: (m.existingIssues as number) ?? 0,
        duplicates: (m.duplicates as number) ?? 0,
        high: (m.high as number) ?? 0,
        medium: (m.medium as number) ?? 0,
        low: (m.low as number) ?? 0,
      }
    })

    // Get issues (tasks created by this cycle)
    const issueRows = db
      .prepare(
        `SELECT id, title, description, metadata FROM tasks
         WHERE json_extract(metadata, '$.foundByScan') = 1
           AND json_extract(metadata, '$.cycleId') = ?
         ORDER BY json_extract(metadata, '$.round') ASC,
                  CASE json_extract(metadata, '$.severity')
                    WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3
                  END ASC`
      )
      .all(id) as IssueRow[]

    const issues = issueRows.map((row) => {
      const m = JSON.parse(row.metadata || "{}") as Record<string, unknown>
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        severity: (m.severity as string) ?? "low",
        issueType: (m.issueType as string) ?? "",
        file: (m.file as string) ?? "",
        line: (m.line as number) ?? 0,
        cycle: (m.cycle as number) ?? 0,
        round: (m.round as number) ?? 0,
      }
    })

    return { cycle, roundMetrics, issues }
  }).pipe(
    Effect.mapError((e): NotFound | InternalError =>
      e instanceof NotFound ? e : new InternalError(String(e))
    )
  )

/**
 * Mirrors the deleteCycle handler: verify run exists, then delete run + events + issues.
 * Same NotFound bug pattern as getCycle.
 */
const deleteCycle = (id: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient

    const row = db
      .prepare(`SELECT id, agent FROM runs WHERE id = ?`)
      .get(id) as { id: string; agent: string } | undefined

    if (!row) {
      return yield* Effect.fail(new NotFound(`Cycle not found: ${id}`))
    }

    // Delete associated issues
    const deleteIssues = db
      .prepare(`DELETE FROM tasks WHERE json_extract(metadata, '$.cycleId') = ?`)
      .run(id)

    // Delete associated events
    db.prepare(`DELETE FROM events WHERE run_id = ?`).run(id)

    // Delete the run itself
    db.prepare(`DELETE FROM runs WHERE id = ?`).run(id)

    return {
      success: true,
      id,
      deletedIssues: deleteIssues.changes,
    }
  }).pipe(
    Effect.mapError((e): NotFound | InternalError =>
      e instanceof NotFound ? e : new InternalError(String(e))
    )
  )

/**
 * Mirrors the deleteIssues handler: delete tasks by IDs.
 */
const deleteIssues = (issueIds: string[]) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient

    if (issueIds.length === 0) {
      return { success: true, deletedCount: 0 }
    }

    const placeholders = issueIds.map(() => "?").join(",")
    const result = db
      .prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`)
      .run(...issueIds)

    return {
      success: true,
      deletedCount: result.changes,
    }
  }).pipe(
    Effect.catchAll((e) => Effect.fail(new InternalError(String(e))))
  )

/**
 * Insert a cycle run directly into the runs table for testing.
 * Returns the run ID.
 */
const insertCycleRun = (opts: {
  id: string
  status?: string
  cycle?: number
  name?: string
  description?: string
  rounds?: number
  totalNewIssues?: number
  existingIssues?: number
  finalLoss?: number
  converged?: boolean
}) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const metadata = JSON.stringify({
      cycle: opts.cycle ?? 1,
      name: opts.name ?? "Test Cycle",
      description: opts.description ?? "A test cycle scan",
      rounds: opts.rounds ?? 3,
      totalNewIssues: opts.totalNewIssues ?? 5,
      existingIssues: opts.existingIssues ?? 2,
      finalLoss: opts.finalLoss ?? 0.1,
      converged: opts.converged ?? true,
    })
    db.prepare(
      `INSERT INTO runs (id, agent, started_at, ended_at, status, metadata)
       VALUES (?, 'cycle-scanner', datetime('now'), datetime('now'), ?, ?)`
    ).run(opts.id, opts.status ?? "completed", metadata)
    return opts.id
  })

/**
 * Insert a metric event for a cycle round.
 */
const insertRoundMetricEvent = (opts: {
  runId: string
  cycle: number
  round: number
  loss: number
  newIssues?: number
  existingIssues?: number
  duplicates?: number
  high?: number
  medium?: number
  low?: number
}) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const metadata = JSON.stringify({
      cycle: opts.cycle,
      round: opts.round,
      loss: opts.loss,
      newIssues: opts.newIssues ?? 0,
      existingIssues: opts.existingIssues ?? 0,
      duplicates: opts.duplicates ?? 0,
      high: opts.high ?? 0,
      medium: opts.medium ?? 0,
      low: opts.low ?? 0,
    })
    db.prepare(
      `INSERT INTO events (timestamp, event_type, run_id, content, metadata)
       VALUES (datetime('now'), 'metric', ?, 'cycle.round.loss', ?)`
    ).run(opts.runId, metadata)
  })

/**
 * Insert a cycle issue (task with cycle metadata).
 */
const insertCycleIssue = (opts: {
  taskId: string
  cycleId: string
  title: string
  description?: string
  severity?: string
  issueType?: string
  file?: string
  line?: number
  cycle?: number
  round?: number
}) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const metadata = JSON.stringify({
      foundByScan: 1,
      cycleId: opts.cycleId,
      severity: opts.severity ?? "medium",
      issueType: opts.issueType ?? "bug",
      file: opts.file ?? "src/index.ts",
      line: opts.line ?? 42,
      cycle: opts.cycle ?? 1,
      round: opts.round ?? 1,
    })
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
       VALUES (?, ?, ?, 'backlog', 50, datetime('now'), datetime('now'), ?)`
    ).run(opts.taskId, opts.title, opts.description ?? "", metadata)
    return opts.taskId
  })

// =============================================================================
// Tests
// =============================================================================

describe("API Cycles Endpoints Integration", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // ---------------------------------------------------------------------------
  // 1. listCycles returns empty array when no cycle runs exist
  // ---------------------------------------------------------------------------

  it("listCycles returns empty array when no cycle runs exist", async () => {
    const result = await Effect.runPromise(
      listCycles.pipe(Effect.provide(shared.layer))
    )

    expect(result.cycles).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // 2. listCycles returns only cycle-scanner runs, not other agents
  // ---------------------------------------------------------------------------

  it("listCycles returns only cycle-scanner runs, not other agents", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient

        // Insert a cycle-scanner run
        yield* insertCycleRun({ id: "run-aabbcc01", name: "Cycle Run 1" })

        // Insert a non-cycle run (e.g. tx-implementer)
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, status, metadata)
           VALUES (?, 'tx-implementer', datetime('now'), 'completed', '{}')`
        ).run("run-dd001122")

        return yield* listCycles
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.cycles).toHaveLength(1)
    expect(result.cycles[0].id).toBe("run-aabbcc01")
    expect(result.cycles[0].name).toBe("Cycle Run 1")
  })

  // ---------------------------------------------------------------------------
  // 3. listCycles returns correct metadata fields from cycle run
  // ---------------------------------------------------------------------------

  it("listCycles returns correct metadata fields from cycle run", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* insertCycleRun({
          id: "run-meta0001",
          cycle: 3,
          name: "Full Scan",
          description: "Complete project scan",
          rounds: 5,
          totalNewIssues: 12,
          existingIssues: 4,
          finalLoss: 0.05,
          converged: true,
          status: "completed",
        })

        return yield* listCycles
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.cycles).toHaveLength(1)
    const cycle = result.cycles[0]
    expect(cycle.id).toBe("run-meta0001")
    expect(cycle.cycle).toBe(3)
    expect(cycle.name).toBe("Full Scan")
    expect(cycle.description).toBe("Complete project scan")
    expect(cycle.rounds).toBe(5)
    expect(cycle.totalNewIssues).toBe(12)
    expect(cycle.existingIssues).toBe(4)
    expect(cycle.finalLoss).toBe(0.05)
    expect(cycle.converged).toBe(true)
    expect(cycle.status).toBe("completed")
    // startedAt should be a date string
    expect(cycle.startedAt).toBeTruthy()
  })

  // ---------------------------------------------------------------------------
  // 4. getCycle returns 404 (NotFound) for non-existent cycle — REGRESSION TEST
  // ---------------------------------------------------------------------------

  it("getCycle returns NotFound for non-existent cycle ID (not InternalError)", async () => {
    const result = await Effect.runPromise(
      getCycle("run-deadbeef").pipe(
        Effect.either,
        Effect.provide(shared.layer)
      )
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      const error = result.left
      // This is the critical assertion: must be NotFound (404), NOT InternalError (500)
      expect(error._tag).toBe("NotFound")
      expect(error.message).toContain("run-deadbeef")
    }
  })

  // ---------------------------------------------------------------------------
  // 5. getCycle returns cycle detail with round metrics and issues
  // ---------------------------------------------------------------------------

  it("getCycle returns full detail with round metrics and issues", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runId = "run-detail01"

        // Insert the cycle run
        yield* insertCycleRun({
          id: runId,
          cycle: 2,
          name: "Detail Test",
          rounds: 2,
          totalNewIssues: 3,
        })

        // Insert round metric events
        yield* insertRoundMetricEvent({
          runId,
          cycle: 2,
          round: 1,
          loss: 0.8,
          newIssues: 2,
          high: 1,
          medium: 1,
        })
        yield* insertRoundMetricEvent({
          runId,
          cycle: 2,
          round: 2,
          loss: 0.3,
          newIssues: 1,
          low: 1,
        })

        // Insert cycle issues (tasks)
        yield* insertCycleIssue({
          taskId: "tx-issue001",
          cycleId: runId,
          title: "Missing error handling",
          severity: "high",
          round: 1,
        })
        yield* insertCycleIssue({
          taskId: "tx-issue002",
          cycleId: runId,
          title: "Unused import",
          severity: "low",
          round: 2,
        })

        return yield* getCycle(runId)
      }).pipe(Effect.provide(shared.layer))
    )

    // Verify cycle data
    expect(result.cycle.id).toBe("run-detail01")
    expect(result.cycle.name).toBe("Detail Test")
    expect(result.cycle.cycle).toBe(2)

    // Verify round metrics
    expect(result.roundMetrics).toHaveLength(2)
    expect(result.roundMetrics[0].round).toBe(1)
    expect(result.roundMetrics[0].loss).toBe(0.8)
    expect(result.roundMetrics[0].high).toBe(1)
    expect(result.roundMetrics[1].round).toBe(2)
    expect(result.roundMetrics[1].loss).toBe(0.3)
    expect(result.roundMetrics[1].low).toBe(1)

    // Verify issues
    expect(result.issues).toHaveLength(2)
    // Issues are ordered by round ASC, then severity (high before low)
    expect(result.issues[0].title).toBe("Missing error handling")
    expect(result.issues[0].severity).toBe("high")
    expect(result.issues[1].title).toBe("Unused import")
    expect(result.issues[1].severity).toBe("low")
  })

  // ---------------------------------------------------------------------------
  // 6. getCycle returns empty metrics and issues when none exist
  // ---------------------------------------------------------------------------

  it("getCycle returns empty roundMetrics and issues for cycle with no events", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* insertCycleRun({ id: "run-noevents" })
        return yield* getCycle("run-noevents")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.cycle.id).toBe("run-noevents")
    expect(result.roundMetrics).toEqual([])
    expect(result.issues).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // 7. deleteCycle returns 404 (NotFound) for non-existent cycle — REGRESSION TEST
  // ---------------------------------------------------------------------------

  it("deleteCycle returns NotFound for non-existent cycle ID (not InternalError)", async () => {
    const result = await Effect.runPromise(
      deleteCycle("run-deadbeef").pipe(
        Effect.either,
        Effect.provide(shared.layer)
      )
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      const error = result.left
      // This is the critical assertion: must be NotFound (404), NOT InternalError (500)
      expect(error._tag).toBe("NotFound")
      expect(error.message).toContain("run-deadbeef")
    }
  })

  // ---------------------------------------------------------------------------
  // 8. deleteCycle successfully deletes run, events, and issues
  // ---------------------------------------------------------------------------

  it("deleteCycle deletes run and associated events and issues", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient
        const runId = "run-todelete"

        // Insert cycle run
        yield* insertCycleRun({ id: runId })

        // Insert associated events
        yield* insertRoundMetricEvent({
          runId,
          cycle: 1,
          round: 1,
          loss: 0.5,
        })

        // Insert associated issues
        yield* insertCycleIssue({
          taskId: "tx-del001",
          cycleId: runId,
          title: "Issue to delete",
        })
        yield* insertCycleIssue({
          taskId: "tx-del002",
          cycleId: runId,
          title: "Another issue to delete",
        })

        // Delete the cycle
        const deleteResult = yield* deleteCycle(runId)

        // Verify everything is gone
        const runExists = db
          .prepare(`SELECT id FROM runs WHERE id = ?`)
          .get(runId) as { id: string } | undefined
        const eventCount = db
          .prepare(`SELECT COUNT(*) as count FROM events WHERE run_id = ?`)
          .get(runId) as { count: number }
        const issueCount = db
          .prepare(
            `SELECT COUNT(*) as count FROM tasks WHERE json_extract(metadata, '$.cycleId') = ?`
          )
          .get(runId) as { count: number }

        return {
          deleteResult,
          runExists: !!runExists,
          eventCount: eventCount.count,
          issueCount: issueCount.count,
        }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.deleteResult.success).toBe(true)
    expect(result.deleteResult.id).toBe("run-todelete")
    expect(result.deleteResult.deletedIssues).toBe(2)
    expect(result.runExists).toBe(false)
    expect(result.eventCount).toBe(0)
    expect(result.issueCount).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 9. deleteCycle with no associated issues reports 0 deleted
  // ---------------------------------------------------------------------------

  it("deleteCycle with no associated issues reports 0 deletedIssues", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* insertCycleRun({ id: "run-noissue1" })
        return yield* deleteCycle("run-noissue1")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.success).toBe(true)
    expect(result.deletedIssues).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 10. deleteIssues removes specified task IDs
  // ---------------------------------------------------------------------------

  it("deleteIssues removes tasks by ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient
        const runId = "run-issdel01"

        yield* insertCycleRun({ id: runId })
        yield* insertCycleIssue({
          taskId: "tx-iss001a",
          cycleId: runId,
          title: "Delete me",
        })
        yield* insertCycleIssue({
          taskId: "tx-iss002a",
          cycleId: runId,
          title: "Keep me",
        })
        yield* insertCycleIssue({
          taskId: "tx-iss003a",
          cycleId: runId,
          title: "Delete me too",
        })

        // Delete only 2 of the 3 issues
        const delResult = yield* deleteIssues(["tx-iss001a", "tx-iss003a"])

        // Verify remaining tasks
        const remaining = db
          .prepare(`SELECT id FROM tasks WHERE id IN ('tx-iss001a', 'tx-iss002a', 'tx-iss003a')`)
          .all() as { id: string }[]

        return { delResult, remaining }
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.delResult.success).toBe(true)
    expect(result.delResult.deletedCount).toBe(2)
    expect(result.remaining).toHaveLength(1)
    expect(result.remaining[0].id).toBe("tx-iss002a")
  })

  // ---------------------------------------------------------------------------
  // 11. deleteIssues with empty array returns 0
  // ---------------------------------------------------------------------------

  it("deleteIssues with empty array returns deletedCount 0", async () => {
    const result = await Effect.runPromise(
      deleteIssues([]).pipe(Effect.provide(shared.layer))
    )

    expect(result.success).toBe(true)
    expect(result.deletedCount).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 12. deleteIssues with non-existent IDs returns 0
  // ---------------------------------------------------------------------------

  it("deleteIssues with non-existent IDs returns deletedCount 0", async () => {
    const result = await Effect.runPromise(
      deleteIssues(["tx-nope0001", "tx-nope0002"]).pipe(
        Effect.provide(shared.layer)
      )
    )

    expect(result.success).toBe(true)
    expect(result.deletedCount).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 13. getCycle metadata defaults for missing fields
  // ---------------------------------------------------------------------------

  it("getCycle returns defaults for cycle run with minimal metadata", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient
        // Insert a run with empty metadata to test default value handling
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, status, metadata)
           VALUES (?, 'cycle-scanner', datetime('now'), 'completed', '{}')`
        ).run("run-minimal1")

        return yield* getCycle("run-minimal1")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.cycle.id).toBe("run-minimal1")
    expect(result.cycle.cycle).toBe(0)
    expect(result.cycle.name).toBe("")
    expect(result.cycle.description).toBe("")
    expect(result.cycle.rounds).toBe(0)
    expect(result.cycle.totalNewIssues).toBe(0)
    expect(result.cycle.existingIssues).toBe(0)
    expect(result.cycle.finalLoss).toBe(0)
    expect(result.cycle.converged).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // 14. listCycles orders by started_at DESC
  // ---------------------------------------------------------------------------

  it("listCycles returns cycles ordered by started_at descending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient

        // Insert cycles with explicit timestamps to control ordering
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, status, metadata)
           VALUES (?, 'cycle-scanner', '2026-01-01T10:00:00Z', 'completed', ?)`
        ).run("run-old00001", JSON.stringify({ name: "Old Cycle" }))

        db.prepare(
          `INSERT INTO runs (id, agent, started_at, status, metadata)
           VALUES (?, 'cycle-scanner', '2026-01-03T10:00:00Z', 'completed', ?)`
        ).run("run-new00001", JSON.stringify({ name: "New Cycle" }))

        db.prepare(
          `INSERT INTO runs (id, agent, started_at, status, metadata)
           VALUES (?, 'cycle-scanner', '2026-01-02T10:00:00Z', 'completed', ?)`
        ).run("run-mid00001", JSON.stringify({ name: "Mid Cycle" }))

        return yield* listCycles
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.cycles).toHaveLength(3)
    // Most recent first
    expect(result.cycles[0].id).toBe("run-new00001")
    expect(result.cycles[1].id).toBe("run-mid00001")
    expect(result.cycles[2].id).toBe("run-old00001")
  })

  // ---------------------------------------------------------------------------
  // 15. getCycle issue ordering: by round ASC, then severity priority
  // ---------------------------------------------------------------------------

  it("getCycle orders issues by round ASC then severity priority", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runId = "run-issorder"
        yield* insertCycleRun({ id: runId })

        // Round 2, medium severity
        yield* insertCycleIssue({
          taskId: "tx-ord001a",
          cycleId: runId,
          title: "Round 2 medium",
          severity: "medium",
          round: 2,
        })
        // Round 1, low severity
        yield* insertCycleIssue({
          taskId: "tx-ord002a",
          cycleId: runId,
          title: "Round 1 low",
          severity: "low",
          round: 1,
        })
        // Round 1, high severity
        yield* insertCycleIssue({
          taskId: "tx-ord003a",
          cycleId: runId,
          title: "Round 1 high",
          severity: "high",
          round: 1,
        })

        return yield* getCycle(runId)
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result.issues).toHaveLength(3)
    // Round 1 first (ASC), high before low within same round
    expect(result.issues[0].title).toBe("Round 1 high")
    expect(result.issues[0].severity).toBe("high")
    expect(result.issues[1].title).toBe("Round 1 low")
    expect(result.issues[1].severity).toBe("low")
    // Round 2
    expect(result.issues[2].title).toBe("Round 2 medium")
    expect(result.issues[2].severity).toBe("medium")
  })
})
