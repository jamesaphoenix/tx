/**
 * Integration tests for MCP cycle tools.
 *
 * Tests the cycle scan query logic at the service level using raw SQL
 * via SqliteClient (same pattern as the MCP cycle tool handlers in
 * apps/mcp-server/src/tools/cycle.ts).
 *
 * Inserts test data directly into the `runs`, `events`, and `tasks` tables
 * to validate the cycle list and get queries.
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { SqliteClient } from "@jamesaphoenix/tx-core"

// =============================================================================
// Types (mirror the MCP tool's internal types)
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

// =============================================================================
// Helpers (mirror the logic from apps/mcp-server/src/tools/cycle.ts)
// =============================================================================

/**
 * List cycle runs — same SQL and mapping as handleCycleList in cycle.ts
 */
const listCycleRuns = Effect.gen(function* () {
  const db = yield* SqliteClient
  const rows = db
    .prepare(
      `SELECT id, agent, started_at, ended_at, status, summary, metadata
       FROM runs
       WHERE agent = 'cycle-scanner'
       ORDER BY started_at DESC`
    )
    .all() as CycleRunRow[]

  return rows.map((row) => {
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
})

/**
 * Get cycle details — same SQL and mapping as handleCycleGet in cycle.ts
 */
const getCycleDetails = (id: string) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient

    const runRow = db
      .prepare(
        `SELECT id, agent, started_at, ended_at, status, summary, metadata
         FROM runs WHERE id = ?`
      )
      .get(id) as CycleRunRow | undefined

    if (!runRow) {
      return null
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

    // Get round metrics from events table
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

    // Get issues (tasks) created by this cycle
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
  })

// =============================================================================
// Tests
// =============================================================================

describe("MCP Cycle Tools Integration", () => {
  let shared: SharedTestLayerResult

  beforeEach(async () => {
    shared = await getSharedTestLayer()
  })

  // ---------------------------------------------------------------------------
  // 1. cycle list returns empty when no cycle runs exist
  // ---------------------------------------------------------------------------

  it("cycle list returns empty when no cycle runs exist", async () => {
    const result = await Effect.runPromise(
      listCycleRuns.pipe(Effect.provide(shared.layer))
    )

    expect(result).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // 2. cycle list returns cycle runs with metadata fields
  // ---------------------------------------------------------------------------

  it("cycle list returns cycle runs with metadata fields", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient

        // Insert a cycle run
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, ended_at, status, summary, metadata)
           VALUES (?, 'cycle-scanner', datetime('now'), datetime('now'), 'completed', 'Test cycle run', ?)`
        ).run(
          "test-run-1",
          JSON.stringify({
            cycle: 1,
            name: "Test Cycle",
            description: "Testing cycle scanner",
            rounds: 3,
            totalNewIssues: 5,
            existingIssues: 2,
            finalLoss: 0.42,
            converged: true,
          })
        )

        return yield* listCycleRuns
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)

    const run = result[0]
    expect(run.id).toBe("test-run-1")
    expect(run.cycle).toBe(1)
    expect(run.name).toBe("Test Cycle")
    expect(run.description).toBe("Testing cycle scanner")
    expect(run.status).toBe("completed")
    expect(run.rounds).toBe(3)
    expect(run.totalNewIssues).toBe(5)
    expect(run.existingIssues).toBe(2)
    expect(run.finalLoss).toBe(0.42)
    expect(run.converged).toBe(true)
    expect(run.startedAt).toBeTruthy()
    expect(run.endedAt).toBeTruthy()
  })

  // ---------------------------------------------------------------------------
  // 3. cycle list excludes non-cycle-scanner runs
  // ---------------------------------------------------------------------------

  it("cycle list excludes non-cycle-scanner runs", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient

        // Insert a non-cycle-scanner run
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, ended_at, status, summary, metadata)
           VALUES (?, 'other-agent', datetime('now'), datetime('now'), 'completed', 'Other run', ?)`
        ).run("other-run-1", JSON.stringify({}))

        // Insert a cycle-scanner run
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, ended_at, status, summary, metadata)
           VALUES (?, 'cycle-scanner', datetime('now'), datetime('now'), 'completed', 'Cycle run', ?)`
        ).run(
          "cycle-run-1",
          JSON.stringify({
            cycle: 1,
            name: "Cycle Only",
            rounds: 1,
            totalNewIssues: 0,
          })
        )

        return yield* listCycleRuns
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("cycle-run-1")
    expect(result[0].name).toBe("Cycle Only")
  })

  // ---------------------------------------------------------------------------
  // 4. cycle get returns null for non-existent run
  // ---------------------------------------------------------------------------

  it("cycle get returns null for non-existent run", async () => {
    const result = await Effect.runPromise(
      getCycleDetails("nonexistent-run-id").pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 5. cycle get returns cycle details with round metrics
  // ---------------------------------------------------------------------------

  it("cycle get returns cycle details with round metrics", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient

        // Insert a cycle run
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, ended_at, status, summary, metadata)
           VALUES (?, 'cycle-scanner', datetime('now'), datetime('now'), 'completed', 'Metrics cycle', ?)`
        ).run(
          "metrics-run-1",
          JSON.stringify({
            cycle: 1,
            name: "Metrics Cycle",
            description: "Testing round metrics",
            rounds: 2,
            totalNewIssues: 3,
            existingIssues: 0,
            finalLoss: 0.5,
            converged: false,
          })
        )

        // Insert round metric events
        db.prepare(
          `INSERT INTO events (run_id, event_type, content, timestamp, metadata)
           VALUES (?, 'metric', 'cycle.round.loss', datetime('now', '-2 minutes'), ?)`
        ).run(
          "metrics-run-1",
          JSON.stringify({
            cycle: 1,
            round: 1,
            loss: 0.8,
            newIssues: 2,
            existingIssues: 0,
            duplicates: 0,
            high: 1,
            medium: 1,
            low: 0,
          })
        )

        db.prepare(
          `INSERT INTO events (run_id, event_type, content, timestamp, metadata)
           VALUES (?, 'metric', 'cycle.round.loss', datetime('now', '-1 minutes'), ?)`
        ).run(
          "metrics-run-1",
          JSON.stringify({
            cycle: 1,
            round: 2,
            loss: 0.5,
            newIssues: 1,
            existingIssues: 2,
            duplicates: 1,
            high: 0,
            medium: 1,
            low: 0,
          })
        )

        return yield* getCycleDetails("metrics-run-1")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()

    // Verify cycle metadata
    expect(result!.cycle.id).toBe("metrics-run-1")
    expect(result!.cycle.name).toBe("Metrics Cycle")
    expect(result!.cycle.rounds).toBe(2)
    expect(result!.cycle.finalLoss).toBe(0.5)
    expect(result!.cycle.converged).toBe(false)

    // Verify round metrics
    expect(result!.roundMetrics).toHaveLength(2)

    const round1 = result!.roundMetrics[0]
    expect(round1.cycle).toBe(1)
    expect(round1.round).toBe(1)
    expect(round1.loss).toBe(0.8)
    expect(round1.newIssues).toBe(2)
    expect(round1.high).toBe(1)
    expect(round1.medium).toBe(1)
    expect(round1.low).toBe(0)

    const round2 = result!.roundMetrics[1]
    expect(round2.cycle).toBe(1)
    expect(round2.round).toBe(2)
    expect(round2.loss).toBe(0.5)
    expect(round2.newIssues).toBe(1)
    expect(round2.existingIssues).toBe(2)
    expect(round2.duplicates).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // 6. cycle get returns issues from tasks table
  // ---------------------------------------------------------------------------

  it("cycle get returns issues from tasks table", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* SqliteClient

        // Insert a cycle run
        db.prepare(
          `INSERT INTO runs (id, agent, started_at, ended_at, status, summary, metadata)
           VALUES (?, 'cycle-scanner', datetime('now'), datetime('now'), 'completed', 'Issues cycle', ?)`
        ).run(
          "issues-run-1",
          JSON.stringify({
            cycle: 1,
            name: "Issues Cycle",
            description: "Testing issue discovery",
            rounds: 1,
            totalNewIssues: 2,
            existingIssues: 0,
            finalLoss: 0.3,
            converged: true,
          })
        )

        // Insert tasks with foundByScan metadata
        db.prepare(
          `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, ?, 'backlog', 100, datetime('now'), datetime('now'), ?)`
        ).run(
          "tx-cycle001",
          "Missing error handling in auth module",
          "The auth module lacks proper error handling for expired tokens",
          JSON.stringify({
            foundByScan: 1,
            cycleId: "issues-run-1",
            severity: "high",
            issueType: "bug",
            file: "src/auth.ts",
            line: 42,
            cycle: 1,
            round: 1,
          })
        )

        db.prepare(
          `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, ?, 'backlog', 80, datetime('now'), datetime('now'), ?)`
        ).run(
          "tx-cycle002",
          "Console.log in production code",
          "Found console.log statements in production path",
          JSON.stringify({
            foundByScan: 1,
            cycleId: "issues-run-1",
            severity: "medium",
            issueType: "code-quality",
            file: "src/utils.ts",
            line: 15,
            cycle: 1,
            round: 1,
          })
        )

        // Insert a task from a different cycle (should NOT appear)
        db.prepare(
          `INSERT INTO tasks (id, title, description, status, score, created_at, updated_at, metadata)
           VALUES (?, ?, ?, 'backlog', 60, datetime('now'), datetime('now'), ?)`
        ).run(
          "tx-cycle003",
          "Unrelated issue",
          "From another cycle",
          JSON.stringify({
            foundByScan: 1,
            cycleId: "other-cycle-id",
            severity: "low",
            issueType: "docs",
            file: "README.md",
            line: 1,
            cycle: 2,
            round: 1,
          })
        )

        return yield* getCycleDetails("issues-run-1")
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).not.toBeNull()

    // Verify issues
    expect(result!.issues).toHaveLength(2)

    // Issues should be sorted by round ASC, then severity (high before medium)
    const issue1 = result!.issues[0]
    expect(issue1.id).toBe("tx-cycle001")
    expect(issue1.title).toBe("Missing error handling in auth module")
    expect(issue1.severity).toBe("high")
    expect(issue1.issueType).toBe("bug")
    expect(issue1.file).toBe("src/auth.ts")
    expect(issue1.line).toBe(42)
    expect(issue1.cycle).toBe(1)
    expect(issue1.round).toBe(1)

    const issue2 = result!.issues[1]
    expect(issue2.id).toBe("tx-cycle002")
    expect(issue2.title).toBe("Console.log in production code")
    expect(issue2.severity).toBe("medium")
    expect(issue2.issueType).toBe("code-quality")
    expect(issue2.file).toBe("src/utils.ts")
    expect(issue2.line).toBe(15)
  })
})
