import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest"
import { Hono } from "hono"
import { createSharedTestLayer, wrapDbAsTestDatabase, type SharedTestLayerResult, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { resolve } from "path"
import { homedir } from "os"
import { tmpdir } from "os"

// Types matching the server
interface TaskRow {
  id: string
  title: string
  description: string
  status: string
  parent_id: string | null
  score: number
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: string
}

interface TaskWithDeps extends TaskRow {
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
}

interface TaskDependencySnapshot {
  blockedByMap: Map<string, string[]>
  blocksMap: Map<string, string[]>
  childrenMap: Map<string, string[]>
  statusMap: Map<string, string>
}

const WORKABLE_TASK_STATUSES = new Set<string>(["backlog", "ready", "planning"])

// Create test app with injected database
function createTestApp(db: TestDatabase, txDir: string) {
  const app = new Hono()

  // Path validation helper (mirrors server logic)
  const claudeDir = resolve(homedir(), ".claude")
  const validateTranscriptPath = (filePath: string): string | null => {
    const resolved = resolve(filePath)
    // Allow paths within the .tx directory
    if (resolved.startsWith(txDir + "/") || resolved === txDir) {
      return resolved
    }
    // Allow paths within ~/.claude directory (Claude Code transcripts)
    if (resolved.startsWith(claudeDir + "/") || resolved === claudeDir) {
      return resolved
    }
    return null
  }

  function pushToMapList(map: Map<string, string[]>, key: string, value: string): void {
    const existing = map.get(key)
    if (existing) {
      existing.push(value)
      return
    }
    map.set(key, [value])
  }

  function buildDependencySnapshot(
    allTasks?: ReadonlyArray<Pick<TaskRow, "id" | "parent_id" | "status">>
  ): TaskDependencySnapshot {
    const deps = db.db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as Array<{
      blocker_id: string
      blocked_id: string
    }>
    const blockedByMap = new Map<string, string[]>()
    const blocksMap = new Map<string, string[]>()

    for (const dep of deps) {
      pushToMapList(blockedByMap, dep.blocked_id, dep.blocker_id)
      pushToMapList(blocksMap, dep.blocker_id, dep.blocked_id)
    }

    const tasksForSnapshot = allTasks
      ?? (db.db.prepare("SELECT id, parent_id, status FROM tasks").all() as Array<{
        id: string
        parent_id: string | null
        status: string
      }>)

    const childrenMap = new Map<string, string[]>()
    const statusMap = new Map<string, string>()
    for (const task of tasksForSnapshot) {
      statusMap.set(task.id, task.status)
      if (task.parent_id) {
        pushToMapList(childrenMap, task.parent_id, task.id)
      }
    }

    return { blockedByMap, blocksMap, childrenMap, statusMap }
  }

  // Helper to enrich tasks with dependency info (mirrors server logic)
  function enrichTasksWithDeps(
    tasks: TaskRow[],
    snapshot?: TaskDependencySnapshot
  ): TaskWithDeps[] {
    const dependencySnapshot = snapshot ?? buildDependencySnapshot()

    return tasks.map(task => {
      const blockedBy = dependencySnapshot.blockedByMap.get(task.id) ?? []
      const blocks = dependencySnapshot.blocksMap.get(task.id) ?? []
      const children = dependencySnapshot.childrenMap.get(task.id) ?? []
      const allBlockersDone = blockedBy.every(id => dependencySnapshot.statusMap.get(id) === "done")
      const isReady = WORKABLE_TASK_STATUSES.has(task.status) && allBlockersDone

      return { ...task, blockedBy, blocks, children, isReady }
    })
  }

  // Cursor helpers
  function parseTaskCursor(cursor: string): { score: number; id: string } {
    const colonIndex = cursor.lastIndexOf(':')
    return {
      score: parseInt(cursor.slice(0, colonIndex), 10),
      id: cursor.slice(colonIndex + 1),
    }
  }

  function parseRunCursor(cursor: string): { startedAt: string; id: string } {
    const match = cursor.match(/^(.+):(run-.+)$/)
    if (!match) {
      return { startedAt: cursor, id: '' }
    }
    return { startedAt: match[1]!, id: match[2]! }
  }

  function buildTaskCursor(task: TaskRow): string {
    return `${task.score}:${task.id}`
  }

  function buildRunCursor(run: { started_at: string; id: string }): string {
    return `${run.started_at}:${run.id}`
  }

  // GET /api/tasks
  app.get("/api/tasks", (c) => {
    try {
      const cursor = c.req.query("cursor")
      const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100)
      const statusFilter = c.req.query("status")?.split(",").filter(Boolean)
      const search = c.req.query("search")

      const conditions: string[] = []
      const params: (string | number)[] = []

      if (statusFilter?.length) {
        conditions.push(`status IN (${statusFilter.map(() => "?").join(",")})`)
        params.push(...statusFilter)
      }

      if (search) {
        conditions.push("(title LIKE ? OR description LIKE ?)")
        params.push(`%${search}%`, `%${search}%`)
      }

      if (cursor) {
        const { score, id } = parseTaskCursor(cursor)
        conditions.push("(score < ? OR (score = ? AND id > ?))")
        params.push(score, score, id)
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

      const sql = `
        SELECT * FROM tasks
        ${whereClause}
        ORDER BY score DESC, id ASC
        LIMIT ?
      `
      params.push(limit + 1)

      const rows = db.db.prepare(sql).all(...params) as TaskRow[]
      const hasMore = rows.length > limit
      const tasks = hasMore ? rows.slice(0, limit) : rows

      const countConditions = conditions.filter((_, i) => {
        return !cursor || i < conditions.length - 1
      })
      const countParams = cursor ? params.slice(0, -4) : params.slice(0, -1)
      const countWhereClause = countConditions.length ? `WHERE ${countConditions.join(" AND ")}` : ""
      const total = (db.db.prepare(`SELECT COUNT(*) as count FROM tasks ${countWhereClause}`).get(...countParams) as { count: number }).count

      const dependencySnapshot = buildDependencySnapshot()
      const enriched = enrichTasksWithDeps(tasks, dependencySnapshot)

      const summaryRows = db.db.prepare(`SELECT status, COUNT(*) as count FROM tasks ${countWhereClause} GROUP BY status`).all(...countParams) as Array<{ status: string; count: number }>
      const byStatus = summaryRows.reduce((acc, r) => {
        acc[r.status] = r.count
        return acc
      }, {} as Record<string, number>)

      return c.json({
        tasks: enriched,
        nextCursor: hasMore && tasks.length ? buildTaskCursor(tasks[tasks.length - 1]!) : null,
        hasMore,
        total,
        summary: { total, byStatus },
      })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/tasks/ready
  app.get("/api/tasks/ready", (c) => {
    try {
      const tasks = db.db.prepare("SELECT * FROM tasks ORDER BY score DESC").all() as TaskRow[]
      const dependencySnapshot = buildDependencySnapshot(tasks)
      const ready = tasks.filter(task => {
        const blockedBy = dependencySnapshot.blockedByMap.get(task.id) ?? []
        const allBlockersDone = blockedBy.every(id => dependencySnapshot.statusMap.get(id) === "done")
        return WORKABLE_TASK_STATUSES.has(task.status) && allBlockersDone
      })
      const enriched = enrichTasksWithDeps(ready, dependencySnapshot)

      return c.json({ tasks: enriched })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/tasks/:id
  app.get("/api/tasks/:id", (c) => {
    try {
      const id = c.req.param("id")

      const task = db.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
      if (!task) {
        return c.json({ error: "Task not found" }, 404)
      }

      const dependencySnapshot = buildDependencySnapshot()
      const blockedByIds = dependencySnapshot.blockedByMap.get(id) ?? []
      const blocksIds = dependencySnapshot.blocksMap.get(id) ?? []
      const childIds = dependencySnapshot.childrenMap.get(id) ?? []

      const fetchTasksByIds = (ids: string[]): TaskWithDeps[] => {
        if (ids.length === 0) return []
        const placeholders = ids.map(() => "?").join(",")
        const tasks = db.db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids) as TaskRow[]
        return enrichTasksWithDeps(tasks, dependencySnapshot)
      }

      const blockedByTasks = fetchTasksByIds(blockedByIds)
      const blocksTasks = fetchTasksByIds(blocksIds)
      const childTasks = fetchTasksByIds(childIds)

      const [enrichedTask] = enrichTasksWithDeps([task], dependencySnapshot)

      return c.json({
        task: enrichedTask,
        blockedByTasks,
        blocksTasks,
        childTasks,
      })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/runs
  app.get("/api/runs", (c) => {
    try {
      const cursor = c.req.query("cursor")
      const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100)
      const agentFilter = c.req.query("agent")
      const statusFilter = c.req.query("status")?.split(",").filter(Boolean)

      const conditions: string[] = []
      const params: (string | number)[] = []

      if (agentFilter) {
        conditions.push("agent = ?")
        params.push(agentFilter)
      }

      if (statusFilter?.length) {
        conditions.push(`status IN (${statusFilter.map(() => "?").join(",")})`)
        params.push(...statusFilter)
      }

      if (cursor) {
        const { startedAt, id } = parseRunCursor(cursor)
        conditions.push("(started_at < ? OR (started_at = ? AND id > ?))")
        params.push(startedAt, startedAt, id)
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

      let runs: Array<{
        id: string
        task_id: string | null
        agent: string
        started_at: string
        ended_at: string | null
        status: string
        exit_code: number | null
        transcript_path: string | null
        summary: string | null
        error_message: string | null
      }> = []

      try {
        const sql = `
          SELECT id, task_id, agent, started_at, ended_at, status, exit_code, transcript_path, summary, error_message
          FROM runs
          ${whereClause}
          ORDER BY started_at DESC, id ASC
          LIMIT ?
        `
        params.push(limit + 1)
        runs = db.db.prepare(sql).all(...params) as typeof runs
      } catch {
        return c.json({ runs: [], nextCursor: null, hasMore: false })
      }

      const hasMore = runs.length > limit
      const pagedRuns = hasMore ? runs.slice(0, limit) : runs

      // Batch fetch task titles to avoid N+1 queries
      const taskIds = [...new Set(pagedRuns.map(r => r.task_id).filter((id): id is string => id !== null))]
      const taskTitleMap = new Map<string, string>()
      if (taskIds.length > 0) {
        const placeholders = taskIds.map(() => "?").join(",")
        const rows = db.db.prepare(`SELECT id, title FROM tasks WHERE id IN (${placeholders})`).all(...taskIds) as Array<{ id: string; title: string }>
        for (const row of rows) {
          taskTitleMap.set(row.id, row.title)
        }
      }

      const enriched = pagedRuns.map(run => ({
        ...run,
        taskTitle: run.task_id ? (taskTitleMap.get(run.task_id) ?? null) : null,
      }))

      return c.json({
        runs: enriched,
        nextCursor: hasMore && pagedRuns.length ? buildRunCursor(pagedRuns[pagedRuns.length - 1]!) : null,
        hasMore,
      })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/runs/:id
  app.get("/api/runs/:id", (c) => {
    try {
      const id = c.req.param("id")

      const run = db.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as {
        id: string
        task_id: string | null
        agent: string
        started_at: string
        ended_at: string | null
        status: string
        exit_code: number | null
        pid: number | null
        transcript_path: string | null
        context_injected: string | null
        summary: string | null
        error_message: string | null
        metadata: string
      } | undefined

      if (!run) {
        return c.json({ error: "Run not found" }, 404)
      }

      let transcript: string | null = null
      if (run.transcript_path) {
        const validatedPath = validateTranscriptPath(run.transcript_path)
        if (validatedPath && existsSync(validatedPath)) {
          const { readFileSync } = require("fs")
          transcript = readFileSync(validatedPath, "utf-8")
        }
      }

      return c.json({ run, transcript })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/ralph (simplified for testing - no pid/log file checking)
  app.get("/api/ralph", (c) => {
    return c.json({
      running: false,
      pid: null,
      currentIteration: 0,
      currentTask: null,
      recentActivity: [],
    })
  })

  // GET /api/stats
  app.get("/api/stats", (c) => {
    try {
      const taskCount = (db.db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }).count
      const doneCount = (db.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done'").get() as { count: number }).count
      const readyCount = (db.db.prepare(`
        SELECT COUNT(*) as count FROM tasks t
        WHERE t.status IN ('backlog', 'ready', 'planning')
        AND NOT EXISTS (
          SELECT 1 FROM task_dependencies d
          JOIN tasks blocker ON d.blocker_id = blocker.id
          WHERE d.blocked_id = t.id AND blocker.status != 'done'
        )
      `).get() as { count: number }).count

      let learningsCount = 0
      try {
        learningsCount = (db.db.prepare("SELECT COUNT(*) as count FROM learnings").get() as { count: number }).count
      } catch {
        // Table doesn't exist
      }

      let runsRunning = 0
      let runsTotal = 0
      try {
        runsRunning = (db.db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'running'").get() as { count: number }).count
        runsTotal = (db.db.prepare("SELECT COUNT(*) as count FROM runs").get() as { count: number }).count
      } catch {
        // Table doesn't exist
      }

      return c.json({
        tasks: taskCount,
        done: doneCount,
        ready: readyCount,
        learnings: learningsCount,
        runsRunning,
        runsTotal,
      })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  return app
}

// Helper to make requests to the test app
async function request(app: Hono, path: string, options?: RequestInit) {
  const url = `http://localhost${path}`
  const req = new Request(url, options)
  const res = await app.fetch(req)
  return {
    status: res.status,
    json: () => res.json(),
  }
}

const DEPENDENCY_SNAPSHOT_SQL = "select blocker_id, blocked_id from task_dependencies"

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase()
}

function countPrepareCallsByQueryShape(
  calls: ReadonlyArray<ReadonlyArray<unknown>>,
  predicate: (normalizedSql: string) => boolean
): number {
  return calls.reduce((count, call) => {
    const sql = call[0]
    if (typeof sql !== "string") {
      return count
    }
    return predicate(normalizeSql(sql)) ? count + 1 : count
  }, 0)
}

function seedDependencySnapshotFixtures(db: TestDatabase, prefix: string, pairCount = 8): string[] {
  const now = new Date().toISOString()
  const insertTask = db.db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertDep = db.db.prepare(
    `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
  )

  const blockedIds: string[] = []
  for (let i = 0; i < pairCount; i++) {
    const blockerId = fixtureId(`${prefix}-blocker-${i}`)
    const blockedId = fixtureId(`${prefix}-blocked-${i}`)

    insertTask.run(
      blockerId,
      `Perf blocker ${i}`,
      `Deterministic blocker fixture ${i}`,
      "ready",
      FIXTURES.TASK_ROOT,
      400 - i,
      now,
      now,
      null,
      "{}"
    )
    insertTask.run(
      blockedId,
      `Perf blocked ${i}`,
      `Deterministic blocked fixture ${i}`,
      "backlog",
      FIXTURES.TASK_ROOT,
      300 - i,
      now,
      now,
      null,
      "{}"
    )
    insertDep.run(blockerId, blockedId, now)
    blockedIds.push(blockedId)
  }

  return blockedIds
}

interface TaskOrderFixtureRow {
  id: string
  status: string
  score: number
}

interface TaskListQueryPlanOptions {
  statuses?: string[]
  cursor?: { score: number; id: string }
  limit?: number
}

function compareTaskListOrder(
  left: Pick<TaskOrderFixtureRow, "score" | "id">,
  right: Pick<TaskOrderFixtureRow, "score" | "id">
): number {
  if (left.score !== right.score) {
    return right.score - left.score
  }
  return left.id.localeCompare(right.id)
}

function seedTaskOrderRegressionFixtures(
  db: TestDatabase,
  prefix: string,
  planningCount = 12,
  doneCount = 8
): {
  rows: TaskOrderFixtureRow[]
  orderedPlanningIds: string[]
  orderedAllIds: string[]
  scoreById: Map<string, number>
} {
  const now = new Date().toISOString()
  const insertTask = db.db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const rows: TaskOrderFixtureRow[] = []

  for (let i = 0; i < planningCount; i++) {
    const id = fixtureId(`${prefix}-planning-${i}`)
    const score = 700 - Math.floor(i / 3) * 10
    insertTask.run(
      id,
      `Planning fixture ${i}`,
      `Planning fixture for query plan regression ${i}`,
      "planning",
      FIXTURES.TASK_ROOT,
      score,
      now,
      now,
      null,
      "{}"
    )
    rows.push({ id, status: "planning", score })
  }

  for (let i = 0; i < doneCount; i++) {
    const id = fixtureId(`${prefix}-done-${i}`)
    const score = 700 - Math.floor(i / 2) * 10
    insertTask.run(
      id,
      `Done fixture ${i}`,
      `Done fixture for query plan regression ${i}`,
      "done",
      FIXTURES.TASK_ROOT,
      score,
      now,
      now,
      now,
      "{}"
    )
    rows.push({ id, status: "done", score })
  }

  const orderedPlanningIds = [...rows]
    .filter(row => row.status === "planning")
    .sort(compareTaskListOrder)
    .map(row => row.id)

  const orderedAllIds = [...rows]
    .sort(compareTaskListOrder)
    .map(row => row.id)

  const scoreById = new Map(rows.map(row => [row.id, row.score]))

  return { rows, orderedPlanningIds, orderedAllIds, scoreById }
}

function explainTaskListQueryPlan(db: TestDatabase, options: TaskListQueryPlanOptions): string {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options.statuses?.length) {
    conditions.push(`status IN (${options.statuses.map(() => "?").join(",")})`)
    params.push(...options.statuses)
  }

  if (options.cursor) {
    conditions.push("(score < ? OR (score = ? AND id > ?))")
    params.push(options.cursor.score, options.cursor.score, options.cursor.id)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const sql = `
    EXPLAIN QUERY PLAN
    SELECT * FROM tasks
    ${whereClause}
    ORDER BY score DESC, id ASC
    LIMIT ?
  `
  params.push((options.limit ?? 20) + 1)

  const rows = db.db.prepare(sql).all(...params) as Array<{ detail: string }>
  return rows.map(row => row.detail).join(" | ")
}

interface RunsEventsQueryPlanFixtures {
  orphanActiveTaskId: string
  primaryWorker: string
  traceCutoffIso: string
}

interface RunsListQueryPlanOptions {
  statuses?: string[]
  agent?: string
  limit?: number
}

const HOT_QUERY_PLAN_INDEXES = {
  dashboardRunsOrder: "idx_runs_started_id",
  dashboardRunsStatusOrder: "idx_runs_status_started_id",
  dashboardRunsAgentOrder: "idx_runs_agent_started_id",
  watchdogOrphanActive: "idx_runs_task_status",
  watchdogWorkerBurst: "idx_runs_worker_status_started",
  traceErrorSpans: "idx_events_type_metadata_status_timestamp",
} as const

function seedRunsEventsQueryPlanFixtures(
  db: TestDatabase,
  prefix: string,
  runCount = 360,
  eventCount = 640
): RunsEventsQueryPlanFixtures {
  const now = new Date()
  const nowIso = now.toISOString()
  const primaryWorker = `${prefix}-codex-main`
  const secondaryWorker = `${prefix}-claude-main`

  const insertTask = db.db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const activeTaskIds: string[] = []
  for (let i = 0; i < 24; i++) {
    const id = fixtureId(`${prefix}-active-task-${i}`)
    insertTask.run(
      id,
      `Active fixture task ${i}`,
      `Active fixture task for runs/events query plan regression ${i}`,
      "active",
      FIXTURES.TASK_ROOT,
      350 - i,
      nowIso,
      nowIso,
      null,
      "{}"
    )
    activeTaskIds.push(id)
  }
  const orphanActiveTaskId = activeTaskIds[0]!
  const taskIdsWithRuns = activeTaskIds.slice(1)

  const insertRun = db.db.prepare(
    `INSERT INTO runs (id, task_id, agent, started_at, status, pid, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  const runIds: string[] = []
  for (let i = 0; i < runCount; i++) {
    const startedAt = new Date(now.getTime() - i * 45_000).toISOString()
    const status = i % 11 === 0
      ? "failed"
      : i % 17 === 0
        ? "cancelled"
        : i % 2 === 0
          ? "running"
          : "completed"
    const worker = i % 3 === 0 ? primaryWorker : secondaryWorker
    const runId = `run-${String(i).padStart(4, "0")}-${fixtureId(`${prefix}-run-${i}`).slice(3)}`
    const taskId = taskIdsWithRuns[i % taskIdsWithRuns.length]!

    insertRun.run(
      runId,
      taskId,
      i % 2 === 0 ? "tx-implementer" : "tx-reviewer",
      startedAt,
      status,
      20_000 + i,
      JSON.stringify({ worker, batch: i % 5 })
    )
    runIds.push(runId)
  }

  const insertEvent = db.db.prepare(
    `INSERT INTO events (timestamp, event_type, run_id, metadata, content, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  for (let i = 0; i < eventCount; i++) {
    const timestamp = new Date(now.getTime() - i * 20_000).toISOString()
    const isErrorSpan = i % 9 === 0
    insertEvent.run(
      timestamp,
      i % 2 === 0 ? "span" : "metric",
      runIds[i % runIds.length]!,
      JSON.stringify({
        status: isErrorSpan ? "error" : "ok",
        error: isErrorSpan ? `fixture-error-${i}` : undefined,
      }),
      `fixture-event-${i}`,
      i % 500
    )
  }

  return {
    orphanActiveTaskId,
    primaryWorker,
    traceCutoffIso: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
  }
}

function explainRunsListQueryPlan(db: TestDatabase, options: RunsListQueryPlanOptions): string {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options.agent) {
    conditions.push("agent = ?")
    params.push(options.agent)
  }

  if (options.statuses?.length) {
    conditions.push(`status IN (${options.statuses.map(() => "?").join(",")})`)
    params.push(...options.statuses)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const sql = `
    EXPLAIN QUERY PLAN
    SELECT id, task_id, agent, started_at, ended_at, status, exit_code, transcript_path, summary, error_message
    FROM runs
    ${whereClause}
    ORDER BY started_at DESC, id ASC
    LIMIT ?
  `
  params.push((options.limit ?? 20) + 1)

  const rows = db.db.prepare(sql).all(...params) as Array<{ detail: string }>
  return rows.map(row => row.detail).join(" | ")
}

function explainWatchdogOrphanActiveQueryPlan(db: TestDatabase): string {
  const rows = db.db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT t.id
    FROM tasks t
    WHERE t.status='active'
      AND NOT EXISTS (
        SELECT 1
        FROM runs r
        WHERE r.task_id=t.id
          AND r.status='running'
      );
  `).all() as Array<{ detail: string }>
  return rows.map(row => row.detail).join(" | ")
}

function explainWatchdogWorkerBurstQueryPlan(db: TestDatabase, worker: string, windowMinutes: number): string {
  const rows = db.db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT COUNT(*)
    FROM runs
    WHERE status IN ('failed', 'cancelled')
      AND started_at >= datetime('now', ?)
      AND json_extract(metadata, '$.worker') = ?;
  `).all(`-${windowMinutes} minutes`, worker) as Array<{ detail: string }>
  return rows.map(row => row.detail).join(" | ")
}

function explainWatchdogWorkerRunningQueryPlan(db: TestDatabase, worker: string): string {
  const rows = db.db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT COUNT(*)
    FROM runs
    WHERE status = 'running'
      AND json_extract(metadata, '$.worker') = ?;
  `).all(worker) as Array<{ detail: string }>
  return rows.map(row => row.detail).join(" | ")
}

function explainTraceErrorSpanQueryPlan(
  db: TestDatabase,
  cutoffIso: string,
  limit = 20
): string {
  const rows = db.db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT timestamp, run_id, task_id, agent, content, metadata, duration_ms
    FROM events
    WHERE event_type = ?
      AND json_extract(metadata, '$.status') = ?
      AND timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all("span", "error", cutoffIso, limit) as Array<{ detail: string }>
  return rows.map(row => row.detail).join(" | ")
}

describe("Dashboard API - GET /api/tasks", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns all tasks with TaskWithDeps fields", async () => {
    const res = await request(app, "/api/tasks")
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.tasks).toBeInstanceOf(Array)
    expect(data.tasks.length).toBe(6) // All seeded tasks
    expect(data.total).toBe(6)

    // Verify TaskWithDeps fields are populated
    for (const task of data.tasks) {
      expect(task).toHaveProperty("blockedBy")
      expect(task).toHaveProperty("blocks")
      expect(task).toHaveProperty("children")
      expect(task).toHaveProperty("isReady")
      expect(Array.isArray(task.blockedBy)).toBe(true)
      expect(Array.isArray(task.blocks)).toBe(true)
      expect(Array.isArray(task.children)).toBe(true)
      expect(typeof task.isReady).toBe("boolean")
    }
  })

  it("uses one dependency snapshot scan for /api/tasks on perf-sensitive query paths", async () => {
    const [seededBlockedId] = seedDependencySnapshotFixtures(db, "dashboard-tasks-snapshot")
    const prepareSpy = vi.spyOn(db.db, "prepare")

    try {
      const res = await request(app, "/api/tasks?limit=100")
      expect(res.status).toBe(200)
      const data = await res.json()

      const seededBlockedTask = data.tasks.find((task: TaskWithDeps) => task.id === seededBlockedId)
      expect(seededBlockedTask).toBeDefined()
      expect(seededBlockedTask?.blockedBy.length).toBe(1)
      expect(seededBlockedTask?.blocks).toEqual([])
      expect(seededBlockedTask?.children).toEqual([])
      expect(seededBlockedTask?.isReady).toBe(false)

      const snapshotScanCount = countPrepareCallsByQueryShape(
        prepareSpy.mock.calls,
        (sql) => sql === DEPENDENCY_SNAPSHOT_SQL
      )
      const dependencyTableQueryCount = countPrepareCallsByQueryShape(
        prepareSpy.mock.calls,
        (sql) => sql.includes("from task_dependencies")
      )

      expect(snapshotScanCount, "perf-sensitive path should build one dependency snapshot for /api/tasks").toBe(1)
      expect(dependencyTableQueryCount, "query shape should avoid repeated task_dependencies scans for /api/tasks").toBe(1)
    } finally {
      prepareSpy.mockRestore()
    }
  })

  it("uses task-order indexes for /api/tasks list query-plan variants without temp ORDER BY sort", () => {
    const seeded = seedTaskOrderRegressionFixtures(db, "dashboard-query-plan")
    const unfilteredCursorId = seeded.orderedAllIds[4]!
    const statusCursorId = seeded.orderedPlanningIds[4]!

    const unfilteredPlanDetails = explainTaskListQueryPlan(db, { limit: 20 })
    expect(unfilteredPlanDetails).toContain("idx_tasks_score_id")
    expect(unfilteredPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")

    const statusPlanDetails = explainTaskListQueryPlan(db, { statuses: ["planning"], limit: 20 })
    expect(statusPlanDetails).toContain("idx_tasks_status_score_id")
    expect(statusPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")

    const cursorPlanDetails = explainTaskListQueryPlan(db, {
      cursor: {
        score: seeded.scoreById.get(unfilteredCursorId)!,
        id: unfilteredCursorId,
      },
      limit: 20,
    })
    expect(cursorPlanDetails).toContain("idx_tasks_score_id")
    expect(cursorPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")

    const statusCursorPlanDetails = explainTaskListQueryPlan(db, {
      statuses: ["planning"],
      cursor: {
        score: seeded.scoreById.get(statusCursorId)!,
        id: statusCursorId,
      },
      limit: 20,
    })
    expect(statusCursorPlanDetails).toContain("idx_tasks_status_score_id")
    expect(statusCursorPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")
  })

  it("keeps cursor pagination stable for repeated scores using score:id ordering", async () => {
    const seeded = seedTaskOrderRegressionFixtures(db, "dashboard-repeat-score-pagination")
    const planningScores = seeded.orderedPlanningIds.map(id => seeded.scoreById.get(id)!)
    expect(new Set(planningScores).size).toBeLessThan(planningScores.length)

    const limit = 3
    let cursor: string | null = null
    const seenIds: string[] = []

    do {
      const path = cursor
        ? `/api/tasks?status=planning&limit=${limit}&cursor=${cursor}`
        : `/api/tasks?status=planning&limit=${limit}`

      const res = await request(app, path)
      expect(res.status).toBe(200)
      const data = await res.json()

      const pageTasks = data.tasks as TaskRow[]
      const pageIds = pageTasks.map(task => task.id)
      seenIds.push(...pageIds)

      for (let i = 1; i < pageTasks.length; i++) {
        const prev = pageTasks[i - 1]!
        const curr = pageTasks[i]!
        if (prev.score === curr.score) {
          expect(prev.id.localeCompare(curr.id)).toBeLessThan(0)
        } else {
          expect(prev.score).toBeGreaterThan(curr.score)
        }
      }

      cursor = data.nextCursor
    } while (cursor)

    expect(new Set(seenIds).size).toBe(seenIds.length)
    expect(seenIds).toEqual(seeded.orderedPlanningIds)
  })

  it("returns tasks sorted by score descending", async () => {
    const res = await request(app, "/api/tasks")
    const data = await res.json()

    for (let i = 1; i < data.tasks.length; i++) {
      expect(data.tasks[i - 1].score).toBeGreaterThanOrEqual(data.tasks[i].score)
    }
  })

  it("respects limit parameter", async () => {
    const res = await request(app, "/api/tasks?limit=2")
    const data = await res.json()

    expect(data.tasks.length).toBe(2)
    expect(data.hasMore).toBe(true)
    expect(data.nextCursor).not.toBeNull()
  })

  it("defaults to 20 when limit is non-numeric (NaN guard)", async () => {
    const res = await request(app, "/api/tasks?limit=abc")
    expect(res.status).toBe(200)

    const data = await res.json()
    // Should not error — defaults to 20
    expect(data.tasks).toBeInstanceOf(Array)
    expect(data.tasks.length).toBeLessThanOrEqual(20)
  })

  it("defaults to 20 when limit is 0", async () => {
    const res = await request(app, "/api/tasks?limit=0")
    expect(res.status).toBe(200)

    const data = await res.json()
    // parseInt("0") || 20 → 20
    expect(data.tasks).toBeInstanceOf(Array)
    expect(data.tasks.length).toBeLessThanOrEqual(20)
  })

  it("caps limit at 100", async () => {
    const res = await request(app, "/api/tasks?limit=9999")
    expect(res.status).toBe(200)

    const data = await res.json()
    // Math.min(9999, 100) → 100
    expect(data.tasks).toBeInstanceOf(Array)
  })

  it("filters by status", async () => {
    const res = await request(app, "/api/tasks?status=done")
    const data = await res.json()

    expect(data.tasks.length).toBe(1)
    expect(data.tasks[0].id).toBe(FIXTURES.TASK_DONE)
    expect(data.tasks[0].status).toBe("done")
  })

  it("filters by multiple statuses", async () => {
    const res = await request(app, "/api/tasks?status=backlog,ready")
    const data = await res.json()

    for (const task of data.tasks) {
      expect(["backlog", "ready"]).toContain(task.status)
    }
  })

  it("searches by title", async () => {
    const res = await request(app, "/api/tasks?search=JWT")
    const data = await res.json()

    expect(data.tasks.length).toBe(1)
    expect(data.tasks[0].title).toContain("JWT")
  })

  it("searches by description", async () => {
    const res = await request(app, "/api/tasks?search=Authentication")
    const data = await res.json()

    expect(data.tasks.length).toBeGreaterThan(0)
    const found = data.tasks.find((t: TaskRow) => t.description.includes("Authentication"))
    expect(found).toBeDefined()
  })

  it("cursor-based pagination works", async () => {
    // Get first page
    const res1 = await request(app, "/api/tasks?limit=3")
    const data1 = await res1.json()

    expect(data1.tasks.length).toBe(3)
    expect(data1.hasMore).toBe(true)
    expect(data1.nextCursor).not.toBeNull()

    // Get second page
    const res2 = await request(app, `/api/tasks?limit=3&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    expect(data2.tasks.length).toBe(3)
    expect(data2.hasMore).toBe(false)

    // Ensure no duplicates
    const firstPageIds = data1.tasks.map((t: TaskRow) => t.id)
    const secondPageIds = data2.tasks.map((t: TaskRow) => t.id)
    const allIds = [...firstPageIds, ...secondPageIds]
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it("returns summary with status distribution", async () => {
    const res = await request(app, "/api/tasks")
    const data = await res.json()

    expect(data.summary).toBeDefined()
    expect(data.summary.total).toBe(6)
    expect(data.summary.byStatus).toBeDefined()
    expect(typeof data.summary.byStatus).toBe("object")
  })

  it("populates blockedBy correctly for blocked task", async () => {
    const res = await request(app, "/api/tasks")
    const data = await res.json()

    const blockedTask = data.tasks.find((t: TaskWithDeps) => t.id === FIXTURES.TASK_BLOCKED)
    expect(blockedTask).toBeDefined()
    expect(blockedTask.blockedBy).toContain(FIXTURES.TASK_JWT)
    expect(blockedTask.blockedBy).toContain(FIXTURES.TASK_LOGIN)
    expect(blockedTask.blockedBy.length).toBe(2)
    expect(blockedTask.isReady).toBe(false)
  })

  it("populates blocks correctly for blocker task", async () => {
    const res = await request(app, "/api/tasks")
    const data = await res.json()

    const jwtTask = data.tasks.find((t: TaskWithDeps) => t.id === FIXTURES.TASK_JWT)
    expect(jwtTask).toBeDefined()
    expect(jwtTask.blocks).toContain(FIXTURES.TASK_BLOCKED)
    expect(jwtTask.isReady).toBe(true)
  })

  it("populates children correctly for parent task", async () => {
    const res = await request(app, "/api/tasks")
    const data = await res.json()

    const authTask = data.tasks.find((t: TaskWithDeps) => t.id === FIXTURES.TASK_AUTH)
    expect(authTask).toBeDefined()
    expect(authTask.children.length).toBe(4)
    expect(authTask.children).toContain(FIXTURES.TASK_LOGIN)
    expect(authTask.children).toContain(FIXTURES.TASK_JWT)
    expect(authTask.children).toContain(FIXTURES.TASK_BLOCKED)
    expect(authTask.children).toContain(FIXTURES.TASK_DONE)
  })
})

describe("Dashboard API - GET /api/tasks/ready", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns only ready tasks", async () => {
    const res = await request(app, "/api/tasks/ready")
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.tasks).toBeInstanceOf(Array)

    // All returned tasks should have workable status and no open blockers
    const workableStatuses = ["backlog", "ready", "planning"]
    for (const task of data.tasks) {
      expect(workableStatuses).toContain(task.status)
    }
  })

  it("uses one dependency snapshot scan for /api/tasks/ready and preserves TaskWithDeps fields", async () => {
    seedDependencySnapshotFixtures(db, "dashboard-ready-snapshot")
    const prepareSpy = vi.spyOn(db.db, "prepare")

    try {
      const res = await request(app, "/api/tasks/ready")
      expect(res.status).toBe(200)
      const data = await res.json()

      for (const task of data.tasks as TaskWithDeps[]) {
        expect(Array.isArray(task.blockedBy)).toBe(true)
        expect(Array.isArray(task.blocks)).toBe(true)
        expect(Array.isArray(task.children)).toBe(true)
        expect(typeof task.isReady).toBe("boolean")
      }

      const jwtTask = data.tasks.find((task: TaskWithDeps) => task.id === FIXTURES.TASK_JWT)
      expect(jwtTask).toBeDefined()
      expect(jwtTask?.blocks).toContain(FIXTURES.TASK_BLOCKED)
      expect(jwtTask?.isReady).toBe(true)

      const snapshotScanCount = countPrepareCallsByQueryShape(
        prepareSpy.mock.calls,
        (sql) => sql === DEPENDENCY_SNAPSHOT_SQL
      )
      const dependencyTableQueryCount = countPrepareCallsByQueryShape(
        prepareSpy.mock.calls,
        (sql) => sql.includes("from task_dependencies")
      )

      expect(snapshotScanCount, "perf-sensitive path should build one dependency snapshot for /api/tasks/ready").toBe(1)
      expect(dependencyTableQueryCount, "query shape should avoid repeated task_dependencies scans for /api/tasks/ready").toBe(1)
    } finally {
      prepareSpy.mockRestore()
    }
  })

  it("excludes tasks with open blockers", async () => {
    const res = await request(app, "/api/tasks/ready")
    const data = await res.json()

    // TASK_BLOCKED has blockers (JWT and LOGIN) that aren't done
    const blockedTask = data.tasks.find((t: TaskRow) => t.id === FIXTURES.TASK_BLOCKED)
    expect(blockedTask).toBeUndefined()
  })

  it("excludes done tasks", async () => {
    const res = await request(app, "/api/tasks/ready")
    const data = await res.json()

    const doneTask = data.tasks.find((t: TaskRow) => t.id === FIXTURES.TASK_DONE)
    expect(doneTask).toBeUndefined()
  })

  it("includes tasks when ALL blockers are done", async () => {
    // Mark both blockers as done
    db.db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id IN (?, ?)").run(
      new Date().toISOString(), FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN
    )

    const res = await request(app, "/api/tasks/ready")
    const data = await res.json()

    const blockedTask = data.tasks.find((t: TaskRow) => t.id === FIXTURES.TASK_BLOCKED)
    expect(blockedTask).toBeDefined()
  })

  it("sorts tasks by score descending", async () => {
    const res = await request(app, "/api/tasks/ready")
    const data = await res.json()

    for (let i = 1; i < data.tasks.length; i++) {
      expect(data.tasks[i - 1].score).toBeGreaterThanOrEqual(data.tasks[i].score)
    }
  })
})

describe("Dashboard API - GET /api/tasks/:id", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns task with TaskWithDeps fields", async () => {
    const res = await request(app, `/api/tasks/${FIXTURES.TASK_JWT}`)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.task).toBeDefined()
    expect(data.task.id).toBe(FIXTURES.TASK_JWT)
    expect(data.task).toHaveProperty("blockedBy")
    expect(data.task).toHaveProperty("blocks")
    expect(data.task).toHaveProperty("children")
    expect(data.task).toHaveProperty("isReady")
  })

  it("uses one dependency snapshot scan for /api/tasks/:id and keeps dependency parity fields", async () => {
    seedDependencySnapshotFixtures(db, "dashboard-show-snapshot")
    const prepareSpy = vi.spyOn(db.db, "prepare")

    try {
      const res = await request(app, `/api/tasks/${FIXTURES.TASK_AUTH}`)
      expect(res.status).toBe(200)
      const data = await res.json()

      expect(data.task.id).toBe(FIXTURES.TASK_AUTH)
      expect(data.task.blockedBy).toEqual([])
      expect(data.task.blocks).toEqual([])
      expect(data.task.children).toContain(FIXTURES.TASK_BLOCKED)
      expect(data.task.isReady).toBe(true)

      const blockedChild = data.childTasks.find((task: TaskWithDeps) => task.id === FIXTURES.TASK_BLOCKED)
      expect(blockedChild).toBeDefined()
      expect(blockedChild?.blockedBy).toEqual(expect.arrayContaining([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN]))
      expect(blockedChild?.isReady).toBe(false)

      const snapshotScanCount = countPrepareCallsByQueryShape(
        prepareSpy.mock.calls,
        (sql) => sql === DEPENDENCY_SNAPSHOT_SQL
      )
      const dependencyTableQueryCount = countPrepareCallsByQueryShape(
        prepareSpy.mock.calls,
        (sql) => sql.includes("from task_dependencies")
      )

      expect(snapshotScanCount, "perf-sensitive path should build one dependency snapshot for /api/tasks/:id").toBe(1)
      expect(dependencyTableQueryCount, "query shape should avoid repeated task_dependencies scans for /api/tasks/:id").toBe(1)
    } finally {
      prepareSpy.mockRestore()
    }
  })

  it("returns 404 for nonexistent task", async () => {
    const res = await request(app, "/api/tasks/tx-nonexist")
    expect(res.status).toBe(404)

    const data = await res.json()
    expect(data.error).toBe("Task not found")
  })

  it("returns blockedByTasks with full task data", async () => {
    const res = await request(app, `/api/tasks/${FIXTURES.TASK_BLOCKED}`)
    const data = await res.json()

    expect(data.blockedByTasks).toBeInstanceOf(Array)
    expect(data.blockedByTasks.length).toBe(2)

    // Should contain JWT and LOGIN tasks
    const blockerIds = data.blockedByTasks.map((t: TaskRow) => t.id)
    expect(blockerIds).toContain(FIXTURES.TASK_JWT)
    expect(blockerIds).toContain(FIXTURES.TASK_LOGIN)

    // Each blocker should have TaskWithDeps fields
    for (const blocker of data.blockedByTasks) {
      expect(blocker).toHaveProperty("blockedBy")
      expect(blocker).toHaveProperty("blocks")
      expect(blocker).toHaveProperty("children")
      expect(blocker).toHaveProperty("isReady")
    }
  })

  it("returns blocksTasks with full task data", async () => {
    const res = await request(app, `/api/tasks/${FIXTURES.TASK_JWT}`)
    const data = await res.json()

    expect(data.blocksTasks).toBeInstanceOf(Array)
    expect(data.blocksTasks.length).toBe(1)
    expect(data.blocksTasks[0].id).toBe(FIXTURES.TASK_BLOCKED)
    expect(data.blocksTasks[0]).toHaveProperty("isReady")
  })

  it("returns childTasks with full task data", async () => {
    const res = await request(app, `/api/tasks/${FIXTURES.TASK_AUTH}`)
    const data = await res.json()

    expect(data.childTasks).toBeInstanceOf(Array)
    expect(data.childTasks.length).toBe(4)

    const childIds = data.childTasks.map((t: TaskRow) => t.id)
    expect(childIds).toContain(FIXTURES.TASK_LOGIN)
    expect(childIds).toContain(FIXTURES.TASK_JWT)
    expect(childIds).toContain(FIXTURES.TASK_BLOCKED)
    expect(childIds).toContain(FIXTURES.TASK_DONE)
  })

  it("returns empty arrays for task with no relations", async () => {
    // JWT has no blockers, no children
    const res = await request(app, `/api/tasks/${FIXTURES.TASK_JWT}`)
    const data = await res.json()

    expect(data.task.blockedBy).toEqual([])
    expect(data.childTasks).toEqual([])
  })
})

describe("Dashboard API - GET /api/runs", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns empty array when no runs exist", async () => {
    const res = await request(app, "/api/runs")
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.runs).toEqual([])
    expect(data.hasMore).toBe(false)
    expect(data.nextCursor).toBeNull()
  })

  it("returns runs with task titles enriched", async () => {
    // Create some runs
    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-test0001", FIXTURES.TASK_JWT, "tx-implementer", now, "running", "{}")

    const res = await request(app, "/api/runs")
    const data = await res.json()

    expect(data.runs.length).toBe(1)
    expect(data.runs[0].id).toBe("run-test0001")
    expect(data.runs[0].taskTitle).toBe("JWT validation")
  })

  it("returns null taskTitle when task_id is null", async () => {
    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-test0002", null, "tx-planner", now, "completed", "{}")

    const res = await request(app, "/api/runs")
    const data = await res.json()

    expect(data.runs[0].taskTitle).toBeNull()
  })

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - i * 1000).toISOString()
      db.db.prepare(`
        INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`run-test000${i}`, null, "agent-1", ts, "running", "{}")
    }

    const res = await request(app, "/api/runs?limit=2")
    const data = await res.json()

    expect(data.runs.length).toBe(2)
    expect(data.hasMore).toBe(true)
    expect(data.nextCursor).not.toBeNull()
  })

  it("defaults to 20 when limit is non-numeric (NaN guard)", async () => {
    const res = await request(app, "/api/runs?limit=abc")
    expect(res.status).toBe(200)

    const data = await res.json()
    // Should not error — defaults to 20
    expect(data.runs).toBeInstanceOf(Array)
  })

  it("filters by agent", async () => {
    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-agent-a", null, "tx-implementer", now, "running", "{}")
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-agent-b", null, "tx-reviewer", now, "running", "{}")

    const res = await request(app, "/api/runs?agent=tx-implementer")
    const data = await res.json()

    expect(data.runs.length).toBe(1)
    expect(data.runs[0].agent).toBe("tx-implementer")
  })

  it("filters by status", async () => {
    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-stat-a", null, "agent-1", now, "running", "{}")
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-stat-b", null, "agent-1", now, "completed", "{}")

    const res = await request(app, "/api/runs?status=completed")
    const data = await res.json()

    expect(data.runs.length).toBe(1)
    expect(data.runs[0].status).toBe("completed")
  })

  it("uses runs/events hot-path indexes for dashboard, watchdog, and trace query shapes", () => {
    const seeded = seedRunsEventsQueryPlanFixtures(db, "dashboard-runs-events-hot-paths")

    const unfilteredPlanDetails = explainRunsListQueryPlan(db, { limit: 20 })
    expect(unfilteredPlanDetails).toContain(HOT_QUERY_PLAN_INDEXES.dashboardRunsOrder)
    expect(unfilteredPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")

    const statusPlanDetails = explainRunsListQueryPlan(db, { statuses: ["running"], limit: 20 })
    expect(statusPlanDetails).toContain(HOT_QUERY_PLAN_INDEXES.dashboardRunsStatusOrder)
    expect(statusPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")

    const agentPlanDetails = explainRunsListQueryPlan(db, { agent: "tx-implementer", limit: 20 })
    expect(agentPlanDetails).toContain(HOT_QUERY_PLAN_INDEXES.dashboardRunsAgentOrder)
    expect(agentPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")

    const orphanActiveRunningCount = db.db.prepare(
      "SELECT COUNT(*) as count FROM runs WHERE task_id = ? AND status = 'running'"
    ).get(seeded.orphanActiveTaskId) as { count: number }
    expect(orphanActiveRunningCount.count).toBe(0)

    const watchdogOrphanPlanDetails = explainWatchdogOrphanActiveQueryPlan(db)
    expect(watchdogOrphanPlanDetails).toContain(HOT_QUERY_PLAN_INDEXES.watchdogOrphanActive)

    const watchdogWorkerBurstPlanDetails = explainWatchdogWorkerBurstQueryPlan(db, seeded.primaryWorker, 20)
    expect(watchdogWorkerBurstPlanDetails).toContain(HOT_QUERY_PLAN_INDEXES.watchdogWorkerBurst)

    const watchdogWorkerRunningPlanDetails = explainWatchdogWorkerRunningQueryPlan(db, seeded.primaryWorker)
    expect(watchdogWorkerRunningPlanDetails).toContain(HOT_QUERY_PLAN_INDEXES.watchdogWorkerBurst)

    const traceErrorSpanPlanDetails = explainTraceErrorSpanQueryPlan(db, seeded.traceCutoffIso, 20)
    expect(traceErrorSpanPlanDetails).toContain(HOT_QUERY_PLAN_INDEXES.traceErrorSpans)
    expect(traceErrorSpanPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")
  })

  it("cursor-based pagination works", async () => {
    // Create runs with different timestamps for proper ordering
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - (4 - i) * 10000).toISOString()
      db.db.prepare(`
        INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`run-page-${i}`, null, "agent-1", ts, "running", "{}")
    }

    // Get first page
    const res1 = await request(app, "/api/runs?limit=2")
    const data1 = await res1.json()

    expect(data1.runs.length).toBe(2)
    expect(data1.hasMore).toBe(true)

    // Get second page
    const res2 = await request(app, `/api/runs?limit=2&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    // Ensure no duplicates
    const firstPageIds = data1.runs.map((r: { id: string }) => r.id)
    const secondPageIds = data2.runs.map((r: { id: string }) => r.id)
    expect(firstPageIds.some((id: string) => secondPageIds.includes(id))).toBe(false)
  })
})

describe("Dashboard API - GET /api/runs/:id", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono
  let testDir: string

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    // Create a temporary test directory for transcript files
    testDir = resolve(tmpdir(), `tx-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    app = createTestApp(db, testDir)
  })

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns 404 for nonexistent run", async () => {
    const res = await request(app, "/api/runs/run-nonexist")
    expect(res.status).toBe(404)

    const data = await res.json()
    expect(data.error).toBe("Run not found")
  })

  it("returns run details", async () => {
    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-detail01", FIXTURES.TASK_JWT, "tx-implementer", now, "running", '{"key":"value"}')

    const res = await request(app, "/api/runs/run-detail01")
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.run).toBeDefined()
    expect(data.run.id).toBe("run-detail01")
    expect(data.run.agent).toBe("tx-implementer")
    expect(data.run.task_id).toBe(FIXTURES.TASK_JWT)
    expect(data.run.status).toBe("running")
  })

  it("returns transcript content when path is valid and within .tx", async () => {
    const transcriptPath = resolve(testDir, "transcript.json")
    writeFileSync(transcriptPath, '{"messages": ["hello"]}')

    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("run-transc01", null, "agent-1", now, "completed", transcriptPath, "{}")

    const res = await request(app, "/api/runs/run-transc01")
    const data = await res.json()

    expect(data.transcript).toBe('{"messages": ["hello"]}')
  })

  it("returns null transcript when path is invalid (path traversal)", async () => {
    // Create a file outside the .tx directory
    const outsidePath = resolve(tmpdir(), "secret-file.txt")
    writeFileSync(outsidePath, "secret content")

    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("run-secur01", null, "agent-1", now, "completed", outsidePath, "{}")

    const res = await request(app, "/api/runs/run-secur01")
    const data = await res.json()

    // Path validation should reject this
    expect(data.transcript).toBeNull()

    // Clean up
    rmSync(outsidePath)
  })

  it("returns null transcript when path uses ../ traversal", async () => {
    // Create a transcript file inside testDir
    const validPath = resolve(testDir, "transcript.json")
    writeFileSync(validPath, "valid content")

    // Create a file that would be reached by traversal
    const outsidePath = resolve(tmpdir(), "outside-secret.txt")
    writeFileSync(outsidePath, "outside secret content")

    const now = new Date().toISOString()
    // Try to use path traversal to escape the .tx directory
    const traversalPath = resolve(testDir, "../outside-secret.txt")
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("run-secur02", null, "agent-1", now, "completed", traversalPath, "{}")

    const res = await request(app, "/api/runs/run-secur02")
    const data = await res.json()

    // Path traversal should be blocked
    expect(data.transcript).toBeNull()

    // Clean up
    rmSync(outsidePath)
  })

  it("returns null transcript when file doesn't exist", async () => {
    const nonexistentPath = resolve(testDir, "nonexistent.json")

    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("run-nofile1", null, "agent-1", now, "completed", nonexistentPath, "{}")

    const res = await request(app, "/api/runs/run-nofile1")
    const data = await res.json()

    expect(data.transcript).toBeNull()
  })

  it("returns null transcript when transcript_path is null", async () => {
    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("run-nopath1", null, "agent-1", now, "completed", null, "{}")

    const res = await request(app, "/api/runs/run-nopath1")
    const data = await res.json()

    expect(data.transcript).toBeNull()
  })

  it("returns transcript content when path is within ~/.claude", async () => {
    // Create a temporary file inside ~/.claude for testing
    const claudeTestDir = resolve(homedir(), ".claude", "tx-test-" + Date.now())
    mkdirSync(claudeTestDir, { recursive: true })
    const transcriptPath = resolve(claudeTestDir, "transcript.jsonl")
    writeFileSync(transcriptPath, JSON.stringify({type: "assistant", content: "hello"}))

    const now = new Date().toISOString()
    db.db.prepare(
      "INSERT INTO runs (id, task_id, agent, started_at, status, transcript_path, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("run-claude01", null, "agent-1", now, "completed", transcriptPath, "{}")

    const res = await request(app, "/api/runs/run-claude01")
    const data = await res.json()

    expect(data.transcript).toBe(JSON.stringify({type: "assistant", content: "hello"}))

    // Clean up
    rmSync(claudeTestDir, { recursive: true })
  })
})

describe("Dashboard API - GET /api/ralph", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns ralph status", async () => {
    const res = await request(app, "/api/ralph")
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toHaveProperty("running")
    expect(data).toHaveProperty("pid")
    expect(data).toHaveProperty("currentIteration")
    expect(data).toHaveProperty("currentTask")
    expect(data).toHaveProperty("recentActivity")
    expect(Array.isArray(data.recentActivity)).toBe(true)
  })
})

describe("Dashboard API - GET /api/stats", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns task counts", async () => {
    const res = await request(app, "/api/stats")
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.tasks).toBe(6) // All seeded tasks
    expect(data.done).toBe(1) // Only TASK_DONE
    expect(data.ready).toBeGreaterThan(0)
  })

  it("returns correct ready count", async () => {
    const res = await request(app, "/api/stats")
    const data = await res.json()

    // Ready tasks: ROOT (backlog, no blockers), AUTH (backlog, no blockers),
    // LOGIN (ready, no blockers), JWT (ready, no blockers)
    // NOT ready: BLOCKED (has open blockers), DONE (status is done)
    expect(data.ready).toBe(4)
  })

  it("returns learnings count (0 if table doesn't exist)", async () => {
    const res = await request(app, "/api/stats")
    const data = await res.json()

    expect(typeof data.learnings).toBe("number")
  })

  it("returns runs counts (0 if table doesn't exist)", async () => {
    const res = await request(app, "/api/stats")
    const data = await res.json()

    expect(typeof data.runsRunning).toBe("number")
    expect(typeof data.runsTotal).toBe("number")
  })

  it("counts running runs correctly", async () => {
    const now = new Date().toISOString()
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-stats-a", null, "agent-1", now, "running", "{}")
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-stats-b", null, "agent-1", now, "completed", "{}")
    db.db.prepare(`
      INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-stats-c", null, "agent-1", now, "running", "{}")

    const res = await request(app, "/api/stats")
    const data = await res.json()

    expect(data.runsRunning).toBe(2)
    expect(data.runsTotal).toBe(3)
  })

  it("updates done count when task is completed", async () => {
    // Initial state
    const res1 = await request(app, "/api/stats")
    const data1 = await res1.json()
    expect(data1.done).toBe(1)

    // Complete another task
    db.db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(
      new Date().toISOString(), FIXTURES.TASK_JWT
    )

    const res2 = await request(app, "/api/stats")
    const data2 = await res2.json()
    expect(data2.done).toBe(2)
  })
})

describe("Dashboard API - Fixture ID consistency", () => {
  it("fixture IDs are deterministic SHA256-based", () => {
    expect(FIXTURES.TASK_AUTH).toBe(fixtureId("auth"))
    expect(FIXTURES.TASK_JWT).toBe(fixtureId("jwt"))
    expect(FIXTURES.TASK_LOGIN).toBe(fixtureId("login"))
    expect(FIXTURES.TASK_BLOCKED).toBe(fixtureId("blocked"))
    expect(FIXTURES.TASK_DONE).toBe(fixtureId("done"))
    expect(FIXTURES.TASK_ROOT).toBe(fixtureId("root"))
  })

  it("fixture IDs match tx-[a-z0-9]{6,12} format", () => {
    for (const id of Object.values(FIXTURES)) {
      expect(id).toMatch(/^tx-[a-z0-9]{6,12}$/)
    }
  })
})

describe("Dashboard API - Paginated Tasks with Filters", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("cursor pagination works with status filter", async () => {
    // Add more ready tasks to test pagination with filter
    const now = new Date().toISOString()
    for (let i = 0; i < 5; i++) {
      db.db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(fixtureId(`ready-extra-${i}`), `Ready task ${i}`, `Description ${i}`, "ready", null, 400 - i * 10, now, now, "{}")
    }

    // Get first page of ready tasks with limit 2
    const res1 = await request(app, "/api/tasks?status=ready&limit=2")
    const data1 = await res1.json()

    expect(data1.tasks.length).toBe(2)
    expect(data1.hasMore).toBe(true)
    expect(data1.nextCursor).not.toBeNull()
    data1.tasks.forEach((t: TaskRow) => expect(t.status).toBe("ready"))

    // Get second page with cursor
    const res2 = await request(app, `/api/tasks?status=ready&limit=2&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    expect(data2.tasks.length).toBe(2)
    data2.tasks.forEach((t: TaskRow) => expect(t.status).toBe("ready"))

    // Ensure no duplicates between pages
    const firstPageIds = data1.tasks.map((t: TaskRow) => t.id)
    const secondPageIds = data2.tasks.map((t: TaskRow) => t.id)
    expect(firstPageIds.some((id: string) => secondPageIds.includes(id))).toBe(false)

    // Second page should have lower scores (DESC order)
    expect(data1.tasks[data1.tasks.length - 1].score).toBeGreaterThanOrEqual(data2.tasks[0].score)
  })

  it("cursor pagination works with search filter", async () => {
    // Add tasks with searchable content
    const now = new Date().toISOString()
    for (let i = 0; i < 5; i++) {
      db.db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(fixtureId(`search-${i}`), `Searchable task ${i}`, `Has keyword FINDME`, "backlog", null, 300 - i * 10, now, now, "{}")
    }

    // Get first page with search
    const res1 = await request(app, "/api/tasks?search=FINDME&limit=2")
    const data1 = await res1.json()

    expect(data1.tasks.length).toBe(2)
    expect(data1.hasMore).toBe(true)
    data1.tasks.forEach((t: TaskRow) => expect(t.description).toContain("FINDME"))

    // Get second page with cursor and same search
    const res2 = await request(app, `/api/tasks?search=FINDME&limit=2&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    expect(data2.tasks.length).toBe(2)
    data2.tasks.forEach((t: TaskRow) => expect(t.description).toContain("FINDME"))

    // Ensure no duplicates
    const allIds = [...data1.tasks.map((t: TaskRow) => t.id), ...data2.tasks.map((t: TaskRow) => t.id)]
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it("cursor pagination with combined status and search filters", async () => {
    // Add tasks with specific status and searchable content
    const now = new Date().toISOString()
    for (let i = 0; i < 4; i++) {
      db.db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(fixtureId(`combo-${i}`), `Combo task ${i}`, `Has COMBOKEY`, "planning", null, 200 - i * 10, now, now, "{}")
    }
    // Add one with different status (should be excluded)
    db.db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fixtureId("combo-done"), "Done combo", "Has COMBOKEY", "done", null, 250, now, now, "{}")

    // Get first page with combined filters
    const res1 = await request(app, "/api/tasks?status=planning&search=COMBOKEY&limit=2")
    const data1 = await res1.json()

    expect(data1.tasks.length).toBe(2)
    expect(data1.hasMore).toBe(true)
    data1.tasks.forEach((t: TaskRow) => {
      expect(t.status).toBe("planning")
      expect(t.description).toContain("COMBOKEY")
    })

    // Get second page
    const res2 = await request(app, `/api/tasks?status=planning&search=COMBOKEY&limit=2&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    expect(data2.tasks.length).toBe(2)
    expect(data2.hasMore).toBe(false)
    data2.tasks.forEach((t: TaskRow) => {
      expect(t.status).toBe("planning")
      expect(t.description).toContain("COMBOKEY")
    })

    // Total should only count filtered tasks
    expect(data1.total).toBe(4)
  })

  it("hasMore is false when on last page", async () => {
    // With 6 seeded tasks, limit=4 should give hasMore=true on first page, false on second
    const res1 = await request(app, "/api/tasks?limit=4")
    const data1 = await res1.json()

    expect(data1.tasks.length).toBe(4)
    expect(data1.hasMore).toBe(true)

    // Get second (last) page
    const res2 = await request(app, `/api/tasks?limit=4&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    expect(data2.tasks.length).toBe(2) // Remaining 2 tasks
    expect(data2.hasMore).toBe(false)
    expect(data2.nextCursor).toBeNull()
  })

  it("hasMore is false when results fit in single page", async () => {
    const res = await request(app, "/api/tasks?status=done&limit=10")
    const data = await res.json()

    expect(data.tasks.length).toBe(1) // Only one done task
    expect(data.hasMore).toBe(false)
    expect(data.nextCursor).toBeNull()
  })

  it("total count is accurate with status filter", async () => {
    const res = await request(app, "/api/tasks?status=ready")
    const data = await res.json()

    // Should have JWT and LOGIN with status 'ready'
    expect(data.total).toBe(2)
    expect(data.summary.total).toBe(2)
    expect(data.tasks.length).toBe(2)
  })

  it("total count is accurate with multiple status filters", async () => {
    const res = await request(app, "/api/tasks?status=ready,done")
    const data = await res.json()

    // 2 ready + 1 done = 3
    expect(data.total).toBe(3)
    expect(data.summary.total).toBe(3)
  })

  it("total count is accurate with search filter", async () => {
    const res = await request(app, "/api/tasks?search=JWT")
    const data = await res.json()

    expect(data.total).toBe(1)
    expect(data.tasks.length).toBe(1)
    expect(data.tasks[0].title).toContain("JWT")
  })

  it("total count remains consistent across paginated requests", async () => {
    // First page
    const res1 = await request(app, "/api/tasks?limit=2")
    const data1 = await res1.json()

    // Second page
    const res2 = await request(app, `/api/tasks?limit=2&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    // Total should be the same across pages
    expect(data1.total).toBe(6)
    expect(data2.total).toBe(6)
  })

  it("summary byStatus is accurate with filter", async () => {
    const res = await request(app, "/api/tasks?status=ready,backlog")
    const data = await res.json()

    // backlog: ROOT, AUTH, BLOCKED = 3
    // ready: JWT, LOGIN = 2
    expect(data.summary.byStatus.backlog).toBe(3)
    expect(data.summary.byStatus.ready).toBe(2)
    expect(data.summary.byStatus.done).toBeUndefined() // Not in filter
  })
})

describe("Dashboard API - Paginated Runs with Filters", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Hono

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createTestApp(db, "/tmp/.tx")

    // Seed runs for pagination testing
    // IDs must start with "run-" for cursor parser to work correctly
    const baseTime = new Date("2026-01-30T10:00:00.000Z")
    for (let i = 0; i < 8; i++) {
      const ts = new Date(baseTime.getTime() - i * 60000).toISOString() // 1 minute apart
      const status = i % 3 === 0 ? "completed" : i % 3 === 1 ? "running" : "failed"
      const agent = i % 2 === 0 ? "tx-implementer" : "tx-reviewer"
      const runId = `run-pagtest${String(i).padStart(4, '0')}`
      db.db.prepare(`
        INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(runId, null, agent, ts, status, "{}")
    }
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("cursor pagination works with agent filter", async () => {
    // Get first page of tx-implementer runs
    const res1 = await request(app, "/api/runs?agent=tx-implementer&limit=2")
    const data1 = await res1.json()

    expect(data1.runs.length).toBe(2)
    expect(data1.hasMore).toBe(true)
    data1.runs.forEach((r: { agent: string }) => expect(r.agent).toBe("tx-implementer"))

    // Get second page
    const res2 = await request(app, `/api/runs?agent=tx-implementer&limit=2&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    expect(data2.runs.length).toBe(2)
    data2.runs.forEach((r: { agent: string }) => expect(r.agent).toBe("tx-implementer"))

    // Ensure no duplicates
    const firstPageIds = data1.runs.map((r: { id: string }) => r.id)
    const secondPageIds = data2.runs.map((r: { id: string }) => r.id)
    expect(firstPageIds.some((id: string) => secondPageIds.includes(id))).toBe(false)
  })

  it("cursor pagination works with status filter", async () => {
    // Get running runs (indices 1, 4, 7 = 3 runs)
    const res1 = await request(app, "/api/runs?status=running&limit=2")
    const data1 = await res1.json()

    expect(data1.runs.length).toBe(2)
    data1.runs.forEach((r: { status: string }) => expect(r.status).toBe("running"))

    // Get second page
    const res2 = await request(app, `/api/runs?status=running&limit=2&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    // Should have 1 remaining
    expect(data2.runs.length).toBe(1)
    expect(data2.hasMore).toBe(false)
    expect(data2.runs[0].status).toBe("running")
  })

  it("cursor pagination with combined agent and status filters", async () => {
    // tx-implementer (indices 0, 2, 4, 6) with completed status (indices 0, 3, 6)
    // Intersection: 0, 6 = 2 runs
    const res = await request(app, "/api/runs?agent=tx-implementer&status=completed&limit=10")
    const data = await res.json()

    expect(data.runs.length).toBe(2)
    data.runs.forEach((r: { agent: string; status: string }) => {
      expect(r.agent).toBe("tx-implementer")
      expect(r.status).toBe("completed")
    })
    expect(data.hasMore).toBe(false)
  })

  it("hasMore is false on last page", async () => {
    // Get first page
    const res1 = await request(app, "/api/runs?limit=5")
    const data1 = await res1.json()

    expect(data1.runs.length).toBe(5)
    expect(data1.hasMore).toBe(true)

    // Get second (last) page
    const res2 = await request(app, `/api/runs?limit=5&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    expect(data2.runs.length).toBe(3)
    expect(data2.hasMore).toBe(false)
    expect(data2.nextCursor).toBeNull()
  })

  it("hasMore is false when results fit in single page", async () => {
    const res = await request(app, "/api/runs?status=completed&limit=10")
    const data = await res.json()

    // completed: indices 0, 3, 6 = 3 runs
    expect(data.runs.length).toBe(3)
    expect(data.hasMore).toBe(false)
    expect(data.nextCursor).toBeNull()
  })

  it("runs are sorted by started_at descending", async () => {
    const res = await request(app, "/api/runs?limit=10")
    const data = await res.json()

    for (let i = 1; i < data.runs.length; i++) {
      const prev = new Date(data.runs[i - 1].started_at).getTime()
      const curr = new Date(data.runs[i].started_at).getTime()
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
  })

  it("pagination maintains sort order across pages", async () => {
    const res1 = await request(app, "/api/runs?limit=4")
    const data1 = await res1.json()

    const res2 = await request(app, `/api/runs?limit=4&cursor=${data1.nextCursor}`)
    const data2 = await res2.json()

    // Last item of first page should have later started_at than first item of second page
    const lastOfFirst = new Date(data1.runs[data1.runs.length - 1].started_at).getTime()
    const firstOfSecond = new Date(data2.runs[0].started_at).getTime()
    expect(lastOfFirst).toBeGreaterThanOrEqual(firstOfSecond)
  })

  it("filters by multiple statuses", async () => {
    const res = await request(app, "/api/runs?status=running,completed")
    const data = await res.json()

    // running: 3, completed: 3 = 6 total
    expect(data.runs.length).toBe(6)
    data.runs.forEach((r: { status: string }) => {
      expect(["running", "completed"]).toContain(r.status)
    })
  })
})
