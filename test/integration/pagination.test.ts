/**
 * Database Integration Tests for Cursor-Based Pagination
 *
 * Tests cursor-based pagination at the database level with SHA256 fixtures.
 * Creates 50+ tasks with varying scores to test edge cases.
 *
 * Reference: DD-007 Integration Test Architecture
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"
import { Database } from "bun:sqlite"
import { createTestDb, fixtureId } from "../fixtures.js"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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

interface RunRow {
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
}

// -----------------------------------------------------------------------------
// Pagination Fixtures
// -----------------------------------------------------------------------------

// Generate pagination-specific fixture IDs
const paginationFixtureId = (name: string): string => fixtureId(`pagination-${name}`)
const runFixtureId = (name: string): string => `run-${fixtureId(name).slice(3)}`

/**
 * Seeds 50+ tasks with varying scores for pagination testing.
 * Creates tasks with different statuses, some with same scores (for boundary testing).
 */
export function seedPaginationFixtures(db: Database): {
  taskIds: string[]
  runIds: string[]
} {
  const now = new Date().toISOString()
  const taskIds: string[] = []
  const runIds: string[] = []

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const insertRun = db.prepare(
    `INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  // Create 50 tasks with varying scores
  const statuses = ["backlog", "ready", "planning", "active", "done"]

  for (let i = 0; i < 50; i++) {
    const id = paginationFixtureId(`task-${String(i).padStart(3, "0")}`)
    const status = statuses[i % statuses.length]!
    // Scores: 1000, 990, 980, ... with some duplicates
    // Every 5 tasks share the same score to test boundary conditions
    const score = 1000 - Math.floor(i / 5) * 10
    const completedAt = status === "done" ? now : null

    insertTask.run(
      id,
      `Task ${i}: Score ${score}`,
      `Description for task ${i} with score ${score}`,
      status,
      null,
      score,
      now,
      now,
      completedAt,
      "{}"
    )
    taskIds.push(id)
  }

  // Add some tasks with specific searchable content
  for (let i = 0; i < 10; i++) {
    const id = paginationFixtureId(`searchable-${i}`)
    const score = 500 - i * 10
    insertTask.run(
      id,
      `Searchable feature ${i}`,
      `This task contains PAGINATE_KEYWORD for search testing`,
      "backlog",
      null,
      score,
      now,
      now,
      null,
      "{}"
    )
    taskIds.push(id)
  }

  // Create 30 runs with varying timestamps and agents
  const agents = ["tx-implementer", "tx-reviewer", "tx-planner"]
  const runStatuses = ["running", "completed", "failed"]
  const baseTime = new Date("2026-01-30T10:00:00.000Z")

  for (let i = 0; i < 30; i++) {
    const id = runFixtureId(`run-${String(i).padStart(3, "0")}`)
    const agent = agents[i % agents.length]!
    const status = runStatuses[i % runStatuses.length]!
    // Stagger timestamps by 1 minute each
    const startedAt = new Date(baseTime.getTime() - i * 60000).toISOString()

    insertRun.run(
      id,
      null,
      agent,
      startedAt,
      status,
      "{}"
    )
    runIds.push(id)
  }

  // Add some runs with same timestamp to test ID ordering
  const sameTimeRuns: string[] = []
  const sameTimestamp = new Date(baseTime.getTime() - 100 * 60000).toISOString()
  for (let i = 0; i < 5; i++) {
    const id = runFixtureId(`same-time-${i}`)
    insertRun.run(id, null, "tx-implementer", sameTimestamp, "completed", "{}")
    sameTimeRuns.push(id)
    runIds.push(id)
  }

  return { taskIds, runIds }
}

// -----------------------------------------------------------------------------
// Test App Factory
// -----------------------------------------------------------------------------

function createPaginationTestApp(db: Database) {
  const app = new Hono()

  // Cursor helpers
  function parseTaskCursor(cursor: string): { score: number; id: string } {
    const colonIndex = cursor.lastIndexOf(":")
    return {
      score: parseInt(cursor.slice(0, colonIndex), 10),
      id: cursor.slice(colonIndex + 1)
    }
  }

  function parseRunCursor(cursor: string): { startedAt: string; id: string } {
    const match = cursor.match(/^(.+):(run-.+)$/)
    if (!match) {
      return { startedAt: cursor, id: "" }
    }
    return { startedAt: match[1]!, id: match[2]! }
  }

  function buildTaskCursor(task: TaskRow): string {
    return `${task.score}:${task.id}`
  }

  function buildRunCursor(run: RunRow): string {
    return `${run.started_at}:${run.id}`
  }

  // Enrich tasks with deps info
  function enrichTasksWithDeps(tasks: TaskRow[]): TaskWithDeps[] {
    const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as Array<{
      blocker_id: string
      blocked_id: string
    }>

    const blockedByMap = new Map<string, string[]>()
    const blocksMap = new Map<string, string[]>()

    for (const dep of deps) {
      const existing = blockedByMap.get(dep.blocked_id) ?? []
      blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id])

      const existingBlocks = blocksMap.get(dep.blocker_id) ?? []
      blocksMap.set(dep.blocker_id, [...existingBlocks, dep.blocked_id])
    }

    const allTasks = db.prepare("SELECT id, parent_id, status FROM tasks").all() as Array<{
      id: string
      parent_id: string | null
      status: string
    }>

    const childrenMap = new Map<string, string[]>()
    const statusMap = new Map<string, string>()
    for (const task of allTasks) {
      statusMap.set(task.id, task.status)
      if (task.parent_id) {
        const existing = childrenMap.get(task.parent_id) ?? []
        childrenMap.set(task.parent_id, [...existing, task.id])
      }
    }

    const workableStatuses = ["backlog", "ready", "planning"]

    return tasks.map(task => {
      const blockedBy = blockedByMap.get(task.id) ?? []
      const blocks = blocksMap.get(task.id) ?? []
      const children = childrenMap.get(task.id) ?? []
      const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done")
      const isReady = workableStatuses.includes(task.status) && allBlockersDone

      return { ...task, blockedBy, blocks, children, isReady }
    })
  }

  // GET /api/tasks - paginated task list
  app.get("/api/tasks", (c) => {
    try {
      const cursor = c.req.query("cursor")
      const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100)
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

      const rows = db.prepare(sql).all(...params) as TaskRow[]
      const hasMore = rows.length > limit
      const tasks = hasMore ? rows.slice(0, limit) : rows

      // Count total without cursor for accurate total
      const countConditions = cursor
        ? conditions.slice(0, -1) // Remove cursor condition for total count
        : conditions
      const countParams = cursor
        ? params.slice(0, -4) // Remove cursor params (score, score, id) and limit
        : params.slice(0, -1) // Just remove limit
      const countWhereClause = countConditions.length ? `WHERE ${countConditions.join(" AND ")}` : ""
      const total = (db.prepare(`SELECT COUNT(*) as count FROM tasks ${countWhereClause}`).get(...countParams) as { count: number }).count

      const enriched = enrichTasksWithDeps(tasks)

      return c.json({
        tasks: enriched,
        nextCursor: hasMore && tasks.length > 0 ? buildTaskCursor(tasks[tasks.length - 1]!) : null,
        hasMore,
        total
      })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  // GET /api/runs - paginated run list
  app.get("/api/runs", (c) => {
    try {
      const cursor = c.req.query("cursor")
      const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100)
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

      const sql = `
        SELECT * FROM runs
        ${whereClause}
        ORDER BY started_at DESC, id ASC
        LIMIT ?
      `
      params.push(limit + 1)

      const rows = db.prepare(sql).all(...params) as RunRow[]
      const hasMore = rows.length > limit
      const runs = hasMore ? rows.slice(0, limit) : rows

      // Count total without cursor
      const countConditions = cursor ? conditions.slice(0, -1) : conditions
      const countParams = cursor ? params.slice(0, -4) : params.slice(0, -1)
      const countWhereClause = countConditions.length ? `WHERE ${countConditions.join(" AND ")}` : ""
      const total = (db.prepare(`SELECT COUNT(*) as count FROM runs ${countWhereClause}`).get(...countParams) as { count: number }).count

      return c.json({
        runs,
        nextCursor: hasMore && runs.length > 0 ? buildRunCursor(runs[runs.length - 1]!) : null,
        hasMore,
        total
      })
    } catch (e) {
      return c.json({ error: String(e) }, 500)
    }
  })

  return app
}

// Helper to make requests
async function request(app: Hono, path: string) {
  const req = new Request(`http://localhost${path}`)
  const res = await app.fetch(req)
  return {
    status: res.status,
    json: () => res.json()
  }
}

// -----------------------------------------------------------------------------
// Task Pagination Tests
// -----------------------------------------------------------------------------

describe("Database Pagination - Tasks", () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    seedPaginationFixtures(db)
    app = createPaginationTestApp(db)
  })

  describe("Ordering", () => {
    it("returns items ordered by score DESC, id ASC", async () => {
      const res = await request(app, "/api/tasks?limit=60")
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.tasks.length).toBe(60)

      for (let i = 1; i < data.tasks.length; i++) {
        const prev = data.tasks[i - 1]
        const curr = data.tasks[i]

        if (prev.score === curr.score) {
          // Same score: id should be ascending
          expect(prev.id.localeCompare(curr.id)).toBeLessThan(0)
        } else {
          // Different scores: score should be descending
          expect(prev.score).toBeGreaterThan(curr.score)
        }
      }
    })

    it("first page returns exactly limit items", async () => {
      const res = await request(app, "/api/tasks?limit=10")
      const data = await res.json()

      expect(data.tasks.length).toBe(10)
      expect(data.hasMore).toBe(true)
    })
  })

  describe("Cursor Navigation", () => {
    it("cursor 'score:id' returns items after that position", async () => {
      // Get first page
      const res1 = await request(app, "/api/tasks?limit=10")
      const data1 = await res1.json()

      expect(data1.nextCursor).not.toBeNull()
      const lastTask = data1.tasks[data1.tasks.length - 1]

      // Get second page using cursor
      const res2 = await request(app, `/api/tasks?limit=10&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      // First item of second page should come after last item of first page
      const firstOfSecond = data2.tasks[0]

      if (lastTask.score === firstOfSecond.score) {
        expect(lastTask.id.localeCompare(firstOfSecond.id)).toBeLessThan(0)
      } else {
        expect(lastTask.score).toBeGreaterThan(firstOfSecond.score)
      }

      // No duplicates between pages
      const page1Ids = new Set(data1.tasks.map((t: TaskWithDeps) => t.id))
      for (const task of data2.tasks) {
        expect(page1Ids.has(task.id)).toBe(false)
      }
    })

    it("can paginate through all tasks without duplicates", async () => {
      const allIds = new Set<string>()
      let cursor: string | null = null
      let pageCount = 0
      const pageSize = 15

      do {
        const url = cursor
          ? `/api/tasks?limit=${pageSize}&cursor=${cursor}`
          : `/api/tasks?limit=${pageSize}`
        const res = await request(app, url)
        const data = await res.json()

        // Check no duplicates
        for (const task of data.tasks) {
          expect(allIds.has(task.id)).toBe(false)
          allIds.add(task.id)
        }

        cursor = data.nextCursor
        pageCount++

        // Safety: prevent infinite loop
        if (pageCount > 10) break
      } while (cursor)

      // Should have collected all 60 tasks (50 + 10 searchable)
      expect(allIds.size).toBe(60)
    })
  })

  describe("Status Filter with Cursor", () => {
    it("filters by single status correctly", async () => {
      const res = await request(app, "/api/tasks?status=backlog&limit=20")
      const data = await res.json()

      data.tasks.forEach((t: TaskWithDeps) => {
        expect(t.status).toBe("backlog")
      })
    })

    it("cursor pagination works with status filter", async () => {
      // First page of backlog tasks
      const res1 = await request(app, "/api/tasks?status=backlog&limit=5")
      const data1 = await res1.json()

      expect(data1.tasks.length).toBe(5)
      expect(data1.hasMore).toBe(true)
      data1.tasks.forEach((t: TaskWithDeps) => expect(t.status).toBe("backlog"))

      // Second page
      const res2 = await request(app, `/api/tasks?status=backlog&limit=5&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      expect(data2.tasks.length).toBe(5)
      data2.tasks.forEach((t: TaskWithDeps) => expect(t.status).toBe("backlog"))

      // No duplicates
      const page1Ids = new Set(data1.tasks.map((t: TaskWithDeps) => t.id))
      for (const task of data2.tasks) {
        expect(page1Ids.has(task.id)).toBe(false)
      }
    })

    it("filters by multiple statuses correctly", async () => {
      const res = await request(app, "/api/tasks?status=backlog,ready&limit=30")
      const data = await res.json()

      data.tasks.forEach((t: TaskWithDeps) => {
        expect(["backlog", "ready"]).toContain(t.status)
      })
    })
  })

  describe("Search Filter with Cursor", () => {
    it("filters by search term correctly", async () => {
      const res = await request(app, "/api/tasks?search=PAGINATE_KEYWORD&limit=20")
      const data = await res.json()

      expect(data.tasks.length).toBe(10) // All 10 searchable tasks
      data.tasks.forEach((t: TaskWithDeps) => {
        expect(t.description).toContain("PAGINATE_KEYWORD")
      })
    })

    it("cursor pagination works with search filter", async () => {
      // First page
      const res1 = await request(app, "/api/tasks?search=PAGINATE_KEYWORD&limit=4")
      const data1 = await res1.json()

      expect(data1.tasks.length).toBe(4)
      expect(data1.hasMore).toBe(true)

      // Second page
      const res2 = await request(app, `/api/tasks?search=PAGINATE_KEYWORD&limit=4&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      expect(data2.tasks.length).toBe(4)

      // Third page (last)
      const res3 = await request(app, `/api/tasks?search=PAGINATE_KEYWORD&limit=4&cursor=${data2.nextCursor}`)
      const data3 = await res3.json()

      expect(data3.tasks.length).toBe(2) // Remaining 2
      expect(data3.hasMore).toBe(false)

      // All have the keyword
      const allTasks = [...data1.tasks, ...data2.tasks, ...data3.tasks]
      allTasks.forEach((t: TaskWithDeps) => {
        expect(t.description).toContain("PAGINATE_KEYWORD")
      })
    })
  })

  describe("hasMore and nextCursor", () => {
    it("hasMore is true when more items exist", async () => {
      const res = await request(app, "/api/tasks?limit=10")
      const data = await res.json()

      expect(data.hasMore).toBe(true)
      expect(data.nextCursor).not.toBeNull()
    })

    it("hasMore is false on last page", async () => {
      // Get to last page
      let cursor: string | null = null
      let data: { hasMore: boolean; nextCursor: string | null; tasks: TaskWithDeps[] }

      do {
        const url = cursor ? `/api/tasks?limit=20&cursor=${cursor}` : "/api/tasks?limit=20"
        const res = await request(app, url)
        data = await res.json()
        if (data.hasMore) {
          cursor = data.nextCursor
        }
      } while (data.hasMore)

      expect(data.hasMore).toBe(false)
      expect(data.nextCursor).toBeNull()
    })

    it("nextCursor is null on last page", async () => {
      // With filter that gives small result
      const res = await request(app, "/api/tasks?status=done&limit=100")
      const data = await res.json()

      // Should have ~10 done tasks (50 tasks / 5 statuses = 10 per status)
      expect(data.tasks.length).toBe(10)
      expect(data.hasMore).toBe(false)
      expect(data.nextCursor).toBeNull()
    })

    it("hasMore is false when results fit in single page", async () => {
      const res = await request(app, "/api/tasks?search=PAGINATE_KEYWORD&limit=100")
      const data = await res.json()

      expect(data.tasks.length).toBe(10)
      expect(data.hasMore).toBe(false)
      expect(data.nextCursor).toBeNull()
    })
  })

  describe("Total Count", () => {
    it("total count is accurate without filters", async () => {
      const res = await request(app, "/api/tasks?limit=10")
      const data = await res.json()

      expect(data.total).toBe(60) // 50 + 10 searchable
    })

    it("total count is accurate with status filter", async () => {
      const res = await request(app, "/api/tasks?status=backlog&limit=5")
      const data = await res.json()

      // 50 tasks with 5 statuses = 10 per status, plus 10 searchable (all backlog)
      expect(data.total).toBe(20)
    })

    it("total count is accurate with search filter", async () => {
      const res = await request(app, "/api/tasks?search=PAGINATE_KEYWORD&limit=5")
      const data = await res.json()

      expect(data.total).toBe(10)
    })

    it("total count remains consistent across paginated requests", async () => {
      const res1 = await request(app, "/api/tasks?limit=10")
      const data1 = await res1.json()

      const res2 = await request(app, `/api/tasks?limit=10&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      expect(data1.total).toBe(data2.total)
    })

    it("total count is accurate with combined filters", async () => {
      // Add a specific searchable ready task for this test
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(paginationFixtureId("ready-searchable"), "Ready searchable", "Contains COMBO_TEST", "ready", null, 999, now, now, "{}")

      const res = await request(app, "/api/tasks?status=ready&search=COMBO_TEST&limit=10")
      const data = await res.json()

      expect(data.total).toBe(1)
      expect(data.tasks[0].title).toBe("Ready searchable")
    })
  })

  describe("Edge Cases - Same Score Boundary", () => {
    it("handles cursor at boundary between same-score items", async () => {
      // Our fixtures have 5 tasks per score level (e.g., 5 tasks with score 1000)
      // This tests that ID ordering works correctly within same-score groups

      // Get first page
      const res1 = await request(app, "/api/tasks?limit=3")
      const data1 = await res1.json()

      // All first 3 items should have score 1000
      expect(data1.tasks[0].score).toBe(1000)
      expect(data1.tasks[1].score).toBe(1000)
      expect(data1.tasks[2].score).toBe(1000)

      // Cursor should be at the 3rd item (still score 1000)
      const cursor = data1.nextCursor
      expect(cursor).toMatch(/^1000:/)

      // Get second page
      const res2 = await request(app, `/api/tasks?limit=3&cursor=${cursor}`)
      const data2 = await res2.json()

      // Should still get items with score 1000 (remaining 2) and then score 990
      expect(data2.tasks.length).toBe(3)

      // First 2 should be score 1000, last should be 990
      expect(data2.tasks[0].score).toBe(1000)
      expect(data2.tasks[1].score).toBe(1000)
      expect(data2.tasks[2].score).toBe(990)

      // Verify no duplicates
      const page1Ids = new Set(data1.tasks.map((t: TaskWithDeps) => t.id))
      for (const task of data2.tasks) {
        expect(page1Ids.has(task.id)).toBe(false)
      }
    })

    it("maintains correct ordering within same-score groups", async () => {
      // Get tasks with score 1000 specifically
      const res = await request(app, "/api/tasks?limit=10")
      const data = await res.json()

      // Filter to just score 1000 items
      const score1000 = data.tasks.filter((t: TaskWithDeps) => t.score === 1000)
      expect(score1000.length).toBe(5)

      // IDs should be in ascending order
      for (let i = 1; i < score1000.length; i++) {
        expect(score1000[i - 1].id.localeCompare(score1000[i].id)).toBeLessThan(0)
      }
    })

    it("cursor works correctly when all remaining items have same score", async () => {
      // Create a scenario where cursor lands in middle of same-score group
      // and all remaining items have that same score

      // Get first 2 items (both score 1000)
      const res1 = await request(app, "/api/tasks?limit=2")
      const data1 = await res1.json()
      expect(data1.tasks[0].score).toBe(1000)
      expect(data1.tasks[1].score).toBe(1000)

      // Use cursor to get next items
      const res2 = await request(app, `/api/tasks?limit=3&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      // Should get remaining 3 items with score 1000
      const score1000Items = data2.tasks.filter((t: TaskWithDeps) => t.score === 1000)
      expect(score1000Items.length).toBe(3)
    })
  })

  describe("TaskWithDeps Fields", () => {
    it("enriches tasks with blockedBy, blocks, children, isReady", async () => {
      const res = await request(app, "/api/tasks?limit=5")
      const data = await res.json()

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
  })
})

// -----------------------------------------------------------------------------
// Run Pagination Tests
// -----------------------------------------------------------------------------

describe("Database Pagination - Runs", () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    seedPaginationFixtures(db)
    app = createPaginationTestApp(db)
  })

  describe("Ordering", () => {
    it("returns items in chronological order (started_at DESC, id ASC)", async () => {
      const res = await request(app, "/api/runs?limit=35")
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.runs.length).toBe(35)

      for (let i = 1; i < data.runs.length; i++) {
        const prev = data.runs[i - 1]
        const curr = data.runs[i]
        const prevTime = new Date(prev.started_at).getTime()
        const currTime = new Date(curr.started_at).getTime()

        if (prevTime === currTime) {
          // Same timestamp: id should be ascending
          expect(prev.id.localeCompare(curr.id)).toBeLessThan(0)
        } else {
          // Different timestamps: should be descending
          expect(prevTime).toBeGreaterThan(currTime)
        }
      }
    })
  })

  describe("Cursor Navigation", () => {
    it("cursor 'started_at:id' returns items after that position", async () => {
      // Get first page
      const res1 = await request(app, "/api/runs?limit=10")
      const data1 = await res1.json()

      expect(data1.nextCursor).not.toBeNull()

      // Get second page
      const res2 = await request(app, `/api/runs?limit=10&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      // No duplicates
      const page1Ids = new Set(data1.runs.map((r: RunRow) => r.id))
      for (const run of data2.runs) {
        expect(page1Ids.has(run.id)).toBe(false)
      }

      // Second page items should come after first page items chronologically
      const lastOfFirst = data1.runs[data1.runs.length - 1]
      const firstOfSecond = data2.runs[0]
      const lastTime = new Date(lastOfFirst.started_at).getTime()
      const firstTime = new Date(firstOfSecond.started_at).getTime()

      if (lastTime === firstTime) {
        expect(lastOfFirst.id.localeCompare(firstOfSecond.id)).toBeLessThan(0)
      } else {
        expect(lastTime).toBeGreaterThan(firstTime)
      }
    })

    it("can paginate through all runs without duplicates", async () => {
      const allIds = new Set<string>()
      let cursor: string | null = null
      let pageCount = 0

      do {
        const url = cursor ? `/api/runs?limit=10&cursor=${cursor}` : "/api/runs?limit=10"
        const res = await request(app, url)
        const data = await res.json()

        for (const run of data.runs) {
          expect(allIds.has(run.id)).toBe(false)
          allIds.add(run.id)
        }

        cursor = data.nextCursor
        pageCount++

        if (pageCount > 10) break
      } while (cursor)

      // 30 regular runs + 5 same-time runs = 35
      expect(allIds.size).toBe(35)
    })
  })

  describe("Agent Filter with Pagination", () => {
    it("filters by agent correctly", async () => {
      const res = await request(app, "/api/runs?agent=tx-implementer&limit=20")
      const data = await res.json()

      data.runs.forEach((r: RunRow) => {
        expect(r.agent).toBe("tx-implementer")
      })
    })

    it("cursor pagination works with agent filter", async () => {
      // First page
      const res1 = await request(app, "/api/runs?agent=tx-implementer&limit=5")
      const data1 = await res1.json()

      expect(data1.tasks?.length ?? data1.runs.length).toBeGreaterThan(0)
      data1.runs.forEach((r: RunRow) => expect(r.agent).toBe("tx-implementer"))

      if (data1.hasMore) {
        // Second page
        const res2 = await request(app, `/api/runs?agent=tx-implementer&limit=5&cursor=${data1.nextCursor}`)
        const data2 = await res2.json()

        data2.runs.forEach((r: RunRow) => expect(r.agent).toBe("tx-implementer"))

        // No duplicates
        const page1Ids = new Set(data1.runs.map((r: RunRow) => r.id))
        for (const run of data2.runs) {
          expect(page1Ids.has(run.id)).toBe(false)
        }
      }
    })
  })

  describe("Status Filter with Pagination", () => {
    it("filters by status correctly", async () => {
      const res = await request(app, "/api/runs?status=completed&limit=20")
      const data = await res.json()

      data.runs.forEach((r: RunRow) => {
        expect(r.status).toBe("completed")
      })
    })

    it("cursor pagination works with status filter", async () => {
      // First page
      const res1 = await request(app, "/api/runs?status=running&limit=4")
      const data1 = await res1.json()

      data1.runs.forEach((r: RunRow) => expect(r.status).toBe("running"))

      if (data1.hasMore) {
        // Second page
        const res2 = await request(app, `/api/runs?status=running&limit=4&cursor=${data1.nextCursor}`)
        const data2 = await res2.json()

        data2.runs.forEach((r: RunRow) => expect(r.status).toBe("running"))

        // No duplicates
        const page1Ids = new Set(data1.runs.map((r: RunRow) => r.id))
        for (const run of data2.runs) {
          expect(page1Ids.has(run.id)).toBe(false)
        }
      }
    })

    it("filters by multiple statuses correctly", async () => {
      const res = await request(app, "/api/runs?status=running,completed&limit=30")
      const data = await res.json()

      data.runs.forEach((r: RunRow) => {
        expect(["running", "completed"]).toContain(r.status)
      })
    })
  })

  describe("Combined Filters", () => {
    it("agent and status filter work together with pagination", async () => {
      const res = await request(app, "/api/runs?agent=tx-implementer&status=completed&limit=20")
      const data = await res.json()

      data.runs.forEach((r: RunRow) => {
        expect(r.agent).toBe("tx-implementer")
        expect(r.status).toBe("completed")
      })
    })
  })

  describe("hasMore and nextCursor", () => {
    it("hasMore is true when more items exist", async () => {
      const res = await request(app, "/api/runs?limit=10")
      const data = await res.json()

      expect(data.hasMore).toBe(true)
      expect(data.nextCursor).not.toBeNull()
    })

    it("hasMore is false on last page", async () => {
      let cursor: string | null = null
      let data: { hasMore: boolean; nextCursor: string | null; runs: RunRow[] }

      do {
        const url = cursor ? `/api/runs?limit=15&cursor=${cursor}` : "/api/runs?limit=15"
        const res = await request(app, url)
        data = await res.json()
        if (data.hasMore) {
          cursor = data.nextCursor
        }
      } while (data.hasMore)

      expect(data.hasMore).toBe(false)
      expect(data.nextCursor).toBeNull()
    })

    it("hasMore is false when results fit in single page", async () => {
      const res = await request(app, "/api/runs?status=failed&limit=50")
      const data = await res.json()

      // 30 runs with 3 statuses = 10 per status
      expect(data.runs.length).toBe(10)
      expect(data.hasMore).toBe(false)
      expect(data.nextCursor).toBeNull()
    })
  })

  describe("Total Count", () => {
    it("total count is accurate without filters", async () => {
      const res = await request(app, "/api/runs?limit=10")
      const data = await res.json()

      expect(data.total).toBe(35) // 30 + 5 same-time
    })

    it("total count is accurate with agent filter", async () => {
      const res = await request(app, "/api/runs?agent=tx-implementer&limit=5")
      const data = await res.json()

      // 30 runs / 3 agents = 10 per agent, plus 5 same-time (all tx-implementer)
      expect(data.total).toBe(15)
    })

    it("total count is accurate with status filter", async () => {
      const res = await request(app, "/api/runs?status=completed&limit=5")
      const data = await res.json()

      // 30 runs / 3 statuses = 10 per status, plus 5 same-time (all completed)
      expect(data.total).toBe(15)
    })

    it("total count remains consistent across paginated requests", async () => {
      const res1 = await request(app, "/api/runs?limit=10")
      const data1 = await res1.json()

      const res2 = await request(app, `/api/runs?limit=10&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      expect(data1.total).toBe(data2.total)
    })
  })

  describe("Edge Cases - Same Timestamp Boundary", () => {
    it("handles cursor at boundary between same-timestamp items", async () => {
      // We have 5 runs with the same timestamp
      // Get to that area with a specific query
      const res1 = await request(app, "/api/runs?limit=32")
      const data1 = await res1.json()

      // Continue from cursor
      const res2 = await request(app, `/api/runs?limit=5&cursor=${data1.nextCursor}`)
      const data2 = await res2.json()

      // No duplicates
      const page1Ids = new Set(data1.runs.map((r: RunRow) => r.id))
      for (const run of data2.runs) {
        expect(page1Ids.has(run.id)).toBe(false)
      }
    })

    it("maintains correct ID ordering within same-timestamp groups", async () => {
      // Find runs with same timestamp
      const res = await request(app, "/api/runs?limit=40")
      const data = await res.json()

      // Group by timestamp
      const byTimestamp = new Map<string, RunRow[]>()
      for (const run of data.runs) {
        const ts = run.started_at
        const existing = byTimestamp.get(ts) ?? []
        byTimestamp.set(ts, [...existing, run])
      }

      // For each timestamp group with multiple runs, verify ID ascending order
      for (const [_ts, runs] of byTimestamp) {
        if (runs.length > 1) {
          for (let i = 1; i < runs.length; i++) {
            expect(runs[i - 1]!.id.localeCompare(runs[i]!.id)).toBeLessThan(0)
          }
        }
      }
    })
  })
})

// -----------------------------------------------------------------------------
// Fixture ID Verification
// -----------------------------------------------------------------------------

describe("Pagination Fixture IDs", () => {
  it("fixture IDs are deterministic SHA256-based", () => {
    const id1 = paginationFixtureId("task-001")
    const id2 = paginationFixtureId("task-001")
    expect(id1).toBe(id2)
  })

  it("fixture IDs match tx-[a-z0-9]{8} format", () => {
    const id = paginationFixtureId("test")
    expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
  })

  it("run fixture IDs match run-[a-z0-9]{8} format", () => {
    const id = runFixtureId("test")
    expect(id).toMatch(/^run-[a-z0-9]{8}$/)
  })
})
