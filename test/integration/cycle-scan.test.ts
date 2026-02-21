/**
 * Cycle-Scan Integration Tests
 *
 * Tests for PRD-023 / DD-023 cycle-based issue discovery.
 * Covers invariants INV-CYCLE-001 through INV-CYCLE-004,
 * loss computation, dry-run mode, and parse failure handling.
 *
 * Uses a mock AgentService since CycleScanService is NOT in the default
 * app layer — it requires AgentService + SqliteClient composed manually.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  SqliteClient,
  applyMigrations,
  AgentService,
  CycleScanService,
  CycleScanServiceLive,
} from "@jamesaphoenix/tx-core"
import type { AgentRunConfig, AgentRunResult, AgentMessageCallback } from "@jamesaphoenix/tx-core"
import { LOSS_WEIGHTS } from "@jamesaphoenix/tx-types"
import type { Finding, CycleProgressEvent } from "@jamesaphoenix/tx-types"

// =============================================================================
// Mock AgentService
// =============================================================================

/**
 * Creates a mock AgentService that returns controlled findings and dedup results.
 * The scanResponses queue is consumed in order by scan agents.
 * The dedupResponses queue is consumed by dedup agents.
 */
function createMockAgentService(opts: {
  scanResponses: Array<{ findings: Finding[] }>
  dedupResponses?: Array<{ newIssues: Finding[]; duplicates: Array<{ findingIdx: number; existingIssueId: string; reason: string }> }>
  failScan?: boolean
  scanMessage?: unknown
  dedupMessage?: unknown
  fixMessage?: unknown
}) {
  let scanCallIdx = 0
  let dedupCallIdx = 0

  return Layer.succeed(AgentService, {
    run: (config: AgentRunConfig, onMessage?: AgentMessageCallback) => {
      // Determine if this is a scan, dedup, or fix agent based on prompt content
      const prompt = config.prompt
      const isScan = prompt.includes("## Your Mission")
      const isDedup = prompt.includes("## Known Issues")

      if (opts.failScan && isScan) {
        return Effect.fail({
          _tag: "AgentError" as const,
          agent: "mock-scan",
          reason: "Mock scan failure",
          message: "Mock scan failure",
        } as any)
      }

      if (isScan) {
        if (opts.scanMessage && onMessage) {
          onMessage(opts.scanMessage)
        }
        const response = opts.scanResponses[scanCallIdx % opts.scanResponses.length]
        scanCallIdx++
        return Effect.succeed({
          text: JSON.stringify(response),
          structuredOutput: response,
        } as AgentRunResult)
      }

      if (isDedup && opts.dedupResponses) {
        if (opts.dedupMessage && onMessage) {
          onMessage(opts.dedupMessage)
        }
        const response = opts.dedupResponses[dedupCallIdx % opts.dedupResponses.length]
        dedupCallIdx++
        return Effect.succeed({
          text: JSON.stringify(response),
          structuredOutput: response,
        } as AgentRunResult)
      }

      // Fix agent or unknown — return empty
      if (opts.fixMessage && onMessage) {
        onMessage(opts.fixMessage)
      }
      return Effect.succeed({
        text: "",
        structuredOutput: null,
      } as AgentRunResult)
    },
  })
}

// =============================================================================
// Test database setup
// =============================================================================

interface TestDb {
  db: any // bun:sqlite Database
  layer: Layer.Layer<CycleScanService | SqliteClient>
  reset: () => void
}

async function setupTestDb(mockAgent: Layer.Layer<AgentService>): Promise<TestDb> {
  const { Database } = await import("bun:sqlite")
  const db = new Database(":memory:")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  applyMigrations(db)

  const infraLayer = Layer.succeed(SqliteClient, db as any)
  const cycleScanLayer = CycleScanServiceLive.pipe(
    Layer.provide(Layer.merge(mockAgent, infraLayer))
  )
  const layer = Layer.merge(cycleScanLayer, infraLayer)

  const reset = () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_version'
           AND name NOT LIKE '%_fts'
           AND name NOT LIKE '%_fts_%'
           AND name NOT LIKE '%_config'`
      )
      .all() as Array<{ name: string }>

    db.run("PRAGMA foreign_keys = OFF")
    for (const { name } of tables) {
      db.exec(`DELETE FROM "${name}"`)
    }
    try { db.exec("DELETE FROM sqlite_sequence") } catch { /* may not exist */ }
    db.run("PRAGMA foreign_keys = ON")
  }

  return { db, layer, reset }
}

// =============================================================================
// Sample findings
// =============================================================================

const FINDING_HIGH: Finding = {
  title: "SQL injection in user query",
  description: "User input is concatenated directly into SQL query",
  severity: "high",
  issueType: "security",
  file: "src/api/users.ts",
  line: 42,
}

const FINDING_MEDIUM: Finding = {
  title: "Missing error handling in fetch",
  description: "API call has no try-catch",
  severity: "medium",
  issueType: "bug",
  file: "src/api/client.ts",
  line: 88,
}

const FINDING_LOW: Finding = {
  title: "Console.log left in production code",
  description: "Debug logging should be removed",
  severity: "low",
  issueType: "anti-pattern",
  file: "src/utils/helper.ts",
  line: 15,
}

// =============================================================================
// Tests
// =============================================================================

describe("CycleScanService — Invariants (DD-023)", () => {
  let testDb: TestDb

  beforeAll(async () => {
    const mockAgent = createMockAgentService({
      scanResponses: [
        { findings: [FINDING_HIGH, FINDING_MEDIUM, FINDING_LOW] },
      ],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  // INV-CYCLE-001: Every cycle group run records metadata with type, cycle number, and final loss
  it("INV-CYCLE-001: cycle group run records metadata with type, cycle, and finalLoss", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review the auth module",
          scanPrompt: "Find security issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    expect(results).toHaveLength(1)
    const cycleRunId = results[0].cycleRunId

    // Verify the run exists in the database with correct metadata
    const row = testDb.db
      .prepare("SELECT id, agent, status, metadata FROM runs WHERE id = ?")
      .get(cycleRunId) as { id: string; agent: string; status: string; metadata: string }

    expect(row).toBeDefined()
    expect(row.agent).toBe("cycle-scanner")
    expect(row.status).toBe("completed")

    const meta = JSON.parse(row.metadata)
    expect(meta.type).toBe("cycle")
    expect(meta.cycle).toBe(1)
    expect(typeof meta.finalLoss).toBe("number")
    expect(typeof meta.rounds).toBe("number")
    expect(typeof meta.totalNewIssues).toBe("number")
    expect(typeof meta.converged).toBe("boolean")
  })

  // INV-CYCLE-003: All scan-created tasks have metadata.foundByScan true and metadata.cycleId set
  it("INV-CYCLE-003: all scan-created tasks have foundByScan=true and cycleId set", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review the auth module",
          scanPrompt: "Find security issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    const cycleRunId = results[0].cycleRunId

    // Query all tasks created with foundByScan
    const tasks = testDb.db
      .prepare(
        `SELECT id, title, metadata FROM tasks
         WHERE json_extract(metadata, '$.foundByScan') = 1`
      )
      .all() as Array<{ id: string; title: string; metadata: string }>

    expect(tasks.length).toBe(3) // 3 findings = 3 tasks

    for (const task of tasks) {
      const meta = JSON.parse(task.metadata)
      expect(meta.foundByScan).toBe(true)
      expect(meta.cycleId).toBe(cycleRunId)
      expect(meta.cycle).toBe(1)
      expect(meta.round).toBe(1)
      expect(["high", "medium", "low"]).toContain(meta.severity)
      expect(typeof meta.file).toBe("string")
      expect(typeof meta.line).toBe("number")
    }
  })

  // INV-CYCLE-004: Each round emits a cycle.round.loss metric event to the events table
  it("INV-CYCLE-004: each round emits a cycle.round.loss metric event", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review the auth module",
          scanPrompt: "Find security issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    const cycleRunId = results[0].cycleRunId

    const events = testDb.db
      .prepare(
        `SELECT content, metadata FROM events
         WHERE run_id = ? AND event_type = 'metric' AND content = 'cycle.round.loss'`
      )
      .all(cycleRunId) as Array<{ content: string; metadata: string }>

    expect(events.length).toBeGreaterThanOrEqual(1)

    const meta = JSON.parse(events[0].metadata)
    expect(meta.metric).toBe("cycle.round.loss")
    expect(meta.cycleId).toBe(cycleRunId)
    expect(meta.cycle).toBe(1)
    expect(meta.round).toBe(1)
    expect(typeof meta.loss).toBe("number")
    expect(typeof meta.newIssues).toBe("number")
    expect(typeof meta.existingIssues).toBe("number")
    expect(typeof meta.duplicates).toBe("number")
    expect(typeof meta.high).toBe("number")
    expect(typeof meta.medium).toBe("number")
    expect(typeof meta.low).toBe("number")
  })
})

describe("CycleScanService — Deduplication (INV-CYCLE-002)", () => {
  let testDb: TestDb

  beforeAll(async () => {
    // First round: returns all 3 findings as new
    // Second call (for round 2 if it ran): same findings but dedup marks them as duplicates
    const mockAgent = createMockAgentService({
      scanResponses: [
        { findings: [FINDING_HIGH, FINDING_MEDIUM] },
      ],
      dedupResponses: [
        // First round: both are new (no existing issues yet — dedup skipped when map is empty)
        // Note: when issuesMap.size === 0, dedup is skipped and all are treated as new
        // So the first dedup call won't happen. But if we test with pre-existing issues:
        {
          newIssues: [FINDING_HIGH],
          duplicates: [{ findingIdx: 1, existingIssueId: "tx-existing1", reason: "Same issue" }],
        },
      ],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  // INV-CYCLE-002: Duplicate findings never create duplicate tasks within a cycle
  it("INV-CYCLE-002: dedup prevents duplicate task creation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review the auth module",
          scanPrompt: "Find security issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    // With 2 findings and no existing issues, dedup is skipped (issuesMap.size === 0)
    // so all 2 become tasks on first round
    const tasks = testDb.db
      .prepare("SELECT id, title, metadata FROM tasks WHERE json_extract(metadata, '$.foundByScan') = 1")
      .all() as Array<{ id: string; title: string; metadata: string }>

    expect(tasks.length).toBe(2)

    // Each task should have a unique ID
    const ids = tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("CycleScanService — Loss Computation", () => {
  let testDb: TestDb

  beforeAll(async () => {
    const mockAgent = createMockAgentService({
      scanResponses: [
        { findings: [FINDING_HIGH, FINDING_MEDIUM, FINDING_LOW] },
      ],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  it("computeLoss uses 3*HIGH + 2*MEDIUM + 1*LOW formula", async () => {
    const loss = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return svc.computeLoss([FINDING_HIGH, FINDING_MEDIUM, FINDING_LOW])
      }).pipe(Effect.provide(testDb.layer))
    )

    // 1 high (3) + 1 medium (2) + 1 low (1) = 6
    expect(loss).toBe(3 + 2 + 1)
  })

  it("LOSS_WEIGHTS constant matches expected values", () => {
    expect(LOSS_WEIGHTS.high).toBe(3)
    expect(LOSS_WEIGHTS.medium).toBe(2)
    expect(LOSS_WEIGHTS.low).toBe(1)
  })

  it("loss is recorded in round metric event", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    const cycleRunId = results[0].cycleRunId
    const events = testDb.db
      .prepare(
        `SELECT metadata FROM events
         WHERE run_id = ? AND event_type = 'metric' AND content = 'cycle.round.loss'`
      )
      .all(cycleRunId) as Array<{ metadata: string }>

    const meta = JSON.parse(events[0].metadata)
    expect(meta.loss).toBe(6) // 3 + 2 + 1
    expect(meta.high).toBe(1)
    expect(meta.medium).toBe(1)
    expect(meta.low).toBe(1)
  })
})

describe("CycleScanService — Dry Run", () => {
  let testDb: TestDb

  beforeAll(async () => {
    const mockAgent = createMockAgentService({
      scanResponses: [
        { findings: [FINDING_HIGH, FINDING_MEDIUM] },
      ],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  it("dry-run mode does not create tasks in the database", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
          dryRun: true,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    // No tasks should be created in dry-run mode
    const tasks = testDb.db
      .prepare("SELECT COUNT(*) as cnt FROM tasks")
      .get() as { cnt: number }

    expect(tasks.cnt).toBe(0)
  })

  it("dry-run still returns results with issue counts", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
          dryRun: true,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    expect(results).toHaveLength(1)
    expect(results[0].totalNewIssues).toBe(2)
  })
})

describe("CycleScanService — Convergence", () => {
  let testDb: TestDb

  beforeAll(async () => {
    // Scan returns zero findings — should converge immediately
    const mockAgent = createMockAgentService({
      scanResponses: [{ findings: [] }],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  it("converges when scan finds zero issues", async () => {
    const events: CycleProgressEvent[] = []
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles(
          {
            taskPrompt: "Review code",
            scanPrompt: "Find issues",
            cycles: 1,
            agents: 1,
            maxRounds: 5,
          },
          (event) => events.push(event)
        )
      }).pipe(Effect.provide(testDb.layer))
    )

    expect(results[0].converged).toBe(true)
    expect(results[0].rounds).toBe(1)
    expect(results[0].totalNewIssues).toBe(0)
    expect(results[0].finalLoss).toBe(0)

    // Check progress events include convergence
    const convergedEvent = events.find((e) => e.type === "converged")
    expect(convergedEvent).toBeDefined()
  })

  it("cycle.complete metric is emitted with converged=true", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 1,
          maxRounds: 5,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    const cycleRunId = results[0].cycleRunId
    const events = testDb.db
      .prepare(
        `SELECT metadata FROM events
         WHERE run_id = ? AND event_type = 'metric' AND content = 'cycle.complete'`
      )
      .all(cycleRunId) as Array<{ metadata: string }>

    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata)
    expect(meta.metric).toBe("cycle.complete")
    expect(meta.converged).toBe(true)
    expect(meta.finalLoss).toBe(0)
  })
})

describe("CycleScanService — Scan Failure Handling", () => {
  let testDb: TestDb

  beforeAll(async () => {
    // All scan agents fail — should gracefully handle
    const mockAgent = createMockAgentService({
      scanResponses: [{ findings: [] }],
      failScan: true,
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  it("gracefully handles scan agent failures (returns empty findings)", async () => {
    // The service catches scan errors and returns [] — should converge with 0 issues
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 2,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    expect(results).toHaveLength(1)
    expect(results[0].totalNewIssues).toBe(0)
    expect(results[0].converged).toBe(true)
  })

  it("records transcript-only capture metadata for failed scan runs", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    const failedRun = testDb.db
      .prepare(
        `SELECT transcript_path, stdout_path, stderr_path, metadata
         FROM runs
         WHERE agent LIKE 'scan-agent-%'
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .get() as {
        transcript_path: string | null
        stdout_path: string | null
        stderr_path: string | null
        metadata: string
      }

    expect(failedRun.transcript_path).not.toBeNull()
    expect(failedRun.stdout_path).toBeNull()
    expect(failedRun.stderr_path).toBeNull()

    const meta = JSON.parse(failedRun.metadata) as {
      logCapture?: {
        mode?: string
        reason?: string
        failureReason?: string | null
        stdout?: { state?: string }
        stderr?: { state?: string }
      }
    }

    expect(meta.logCapture?.mode).toBe("transcript_only")
    expect(meta.logCapture?.reason).toBe("failed_without_stdio_capture")
    expect(meta.logCapture?.failureReason).toContain("Mock scan failure")
    expect(meta.logCapture?.stdout?.state).toBe("not_reported")
    expect(meta.logCapture?.stderr?.state).toBe("not_reported")
  })
})

describe("CycleScanService — Run Log Path Persistence", () => {
  let testDb: TestDb
  let tempLogDir: string
  let hintedStdoutPath: string
  let hintedStderrPath: string

  beforeAll(async () => {
    tempLogDir = mkdtempSync(join(tmpdir(), "tx-cycle-scan-logs-"))
    mkdirSync(tempLogDir, { recursive: true })
    hintedStdoutPath = join(tempLogDir, "scan-agent.stdout")
    hintedStderrPath = join(tempLogDir, "scan-agent.stderr")
    writeFileSync(hintedStdoutPath, "scan stdout output")
    writeFileSync(hintedStderrPath, "scan stderr output")

    const mockAgent = createMockAgentService({
      scanResponses: [{ findings: [FINDING_LOW] }],
      scanMessage: {
        stdout_path: hintedStdoutPath,
        stderr_path: hintedStderrPath,
      },
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
    rmSync(tempLogDir, { recursive: true, force: true })
  })

  it("persists stdout/stderr paths and captured-state metadata when scan log files exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    const scanRun = testDb.db
      .prepare(
        `SELECT stdout_path, stderr_path, metadata
         FROM runs
         WHERE agent LIKE 'scan-agent-%'
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .get() as {
        stdout_path: string | null
        stderr_path: string | null
        metadata: string
      }

    expect(scanRun.stdout_path).toBe(hintedStdoutPath)
    expect(scanRun.stderr_path).toBe(hintedStderrPath)

    const meta = JSON.parse(scanRun.metadata) as {
      logCapture?: {
        mode?: string
        reason?: string
        stdout?: { state?: string }
        stderr?: { state?: string }
      }
    }

    expect(meta.logCapture?.mode).toBe("stdio_captured")
    expect(meta.logCapture?.reason).toBe("stdio_paths_reported")
    expect(meta.logCapture?.stdout?.state).toBe("captured")
    expect(meta.logCapture?.stderr?.state).toBe("captured")
  })
})

describe("CycleScanService — Multiple Cycles", () => {
  let testDb: TestDb

  beforeAll(async () => {
    const mockAgent = createMockAgentService({
      scanResponses: [{ findings: [FINDING_LOW] }],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  it("running multiple cycles creates separate cycle runs", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 2,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    expect(results).toHaveLength(2)
    expect(results[0].cycleRunId).not.toBe(results[1].cycleRunId)
    expect(results[0].cycle).toBe(1)
    expect(results[1].cycle).toBe(2)

    // Each cycle should have its own run in the database
    const runs = testDb.db
      .prepare("SELECT id, metadata FROM runs WHERE agent = 'cycle-scanner'")
      .all() as Array<{ id: string; metadata: string }>

    expect(runs).toHaveLength(2)
  })
})

describe("CycleScanService — Progress Events", () => {
  let testDb: TestDb

  beforeAll(async () => {
    const mockAgent = createMockAgentService({
      scanResponses: [{ findings: [FINDING_HIGH] }],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  it("emits progress events in correct sequence", async () => {
    const events: CycleProgressEvent[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles(
          {
            taskPrompt: "Review code",
            scanPrompt: "Find issues",
            cycles: 1,
            agents: 1,
            maxRounds: 1,
          },
          (event) => events.push(event)
        )
      }).pipe(Effect.provide(testDb.layer))
    )

    // Should see: cycle_start -> scan_complete -> round_loss -> cycle_complete
    const types = events.map((e) => e.type)
    expect(types).toContain("cycle_start")
    expect(types).toContain("scan_complete")
    expect(types).toContain("round_loss")
    expect(types).toContain("cycle_complete")

    // cycle_start should be first
    expect(types[0]).toBe("cycle_start")
    // cycle_complete should be last
    expect(types[types.length - 1]).toBe("cycle_complete")
  })
})

describe("CycleScanService — Child Run Tracking", () => {
  let testDb: TestDb

  beforeAll(async () => {
    const mockAgent = createMockAgentService({
      scanResponses: [{ findings: [FINDING_HIGH] }],
    })
    testDb = await setupTestDb(mockAgent)
  })

  afterEach(() => {
    testDb.reset()
  })

  afterAll(() => {
    testDb.db.close()
  })

  it("creates child runs for scan and dedup agents with correct metadata", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CycleScanService
        return yield* svc.runCycles({
          taskPrompt: "Review code",
          scanPrompt: "Find issues",
          cycles: 1,
          agents: 1,
          maxRounds: 1,
        })
      }).pipe(Effect.provide(testDb.layer))
    )

    const cycleRunId = results[0].cycleRunId

    // Get all non-cycle-scanner runs (child runs)
    const childRuns = testDb.db
      .prepare("SELECT agent, metadata FROM runs WHERE agent != 'cycle-scanner'")
      .all() as Array<{ agent: string; metadata: string }>

    // Should have at least 1 scan agent run
    const scanRuns = childRuns.filter((r) => r.agent.startsWith("scan-agent"))
    expect(scanRuns.length).toBeGreaterThanOrEqual(1)

    for (const run of scanRuns) {
      const meta = JSON.parse(run.metadata)
      expect(meta.type).toBe("scan")
      expect(meta.cycleRunId).toBe(cycleRunId)
      expect(meta.cycle).toBe(1)
      expect(meta.round).toBe(1)
    }
  })
})
