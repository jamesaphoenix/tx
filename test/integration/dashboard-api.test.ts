import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest"
import { createDashboardServer } from "../../apps/dashboard/server/index.js"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import {mkdtempSync, rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import { createSharedTestLayer, wrapDbAsTestDatabase, type SharedTestLayerResult, type TestDatabase } from "@jamesaphoenix/tx/testing"
import { seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"

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

// Exercise the actual dashboard HTTP implementation, using the shared SQLite fixture.
async function request(app: Server, path: string, options?: RequestInit) {
  if (!app.listening) await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
  const port = (app.address() as AddressInfo).port
  return fetch(`http://127.0.0.1:${port}${path}`, {...options, signal:AbortSignal.timeout(5_000)})
}

async function closeServer(app: Server): Promise<void> {
  if (!app.listening) return
  await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()))
}

const DEPENDENCY_SNAPSHOT_SQL = "select blocker_id, blocked_id from task_dependencies"

describe("Dashboard API settings persistence", () => {
  let shared: SharedTestLayerResult
  let app: Server
  let root: string
  beforeAll(async () => { shared = await createSharedTestLayer() })
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(),"tx-dashboard-settings-"))
    app = createDashboardServer({db:shared.getDb(),contentRoot:root})
  })
  afterEach(async () => { await closeServer(app); rmSync(root,{recursive:true,force:true}); await shared.reset() })
  afterAll(async () => { await shared.close() })

  it("persists auto-add statuses including an explicitly empty selection across restarts", async () => {
    for (const statuses of [["planning","ready"], []]) {
      const saved = await request(app,"/api/settings", {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({dashboard:{cycles:{autoAddStatuses:statuses}}})})
      expect(saved.status, await saved.text()).toBe(200)
      await closeServer(app)
      app = createDashboardServer({db:shared.getDb(),contentRoot:root})
      const loaded = await request(app,"/api/settings")
      expect((await loaded.json()).dashboard.cycles.autoAddStatuses).toEqual(statuses)
    }
  })

  it.each(["ready", [null], ["made-up"]])("rejects malformed cycle status selections without writing them: %j", async (statuses) => {
    const saved = await request(app,"/api/settings", {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({dashboard:{cycles:{carryStatuses:statuses}}})})
    expect(saved.status).toBe(400)
    const loaded = await request(app,"/api/settings")
    expect((await loaded.json()).dashboard.cycles.carryStatuses).toContain("active")
  })

  it("keeps cycles opt-in and auto-adds matching tasks beyond the first page", async () => {
    seedFixtures(wrapDbAsTestDatabase(shared.getDb()))
    for (let i = 0; i < 25; i++) shared.getDb().prepare("INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES(?,?,?,datetime('now'),datetime('now'))").run(fixtureId(`cycle-auto-${i}`),`Ready task ${i}`,"ready")
    const before = await request(app,"/api/cycles")
    expect((await before.json()).cycles).toEqual([])
    const created = await request(app,"/api/cycles",{method:"POST"})
    expect(created.status).toBe(201)
    const cycle = await created.json()
    expect(cycle.taskCount).toBe(30)
    const detail = await request(app,`/api/cycles/${cycle.id}`)
    expect((await detail.json()).tasks).toHaveLength(30)
    const disabled = await request(app,"/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({dashboard:{cycles:{autoAddStatuses:[]}}})})
    expect(disabled.status).toBe(200)
    const newTask = await request(app,"/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Unscheduled work",status:"active"})})
    expect(newTask.status).toBe(201)
    const task = await newTask.json()
    expect(shared.getDb().prepare("SELECT * FROM cycle_tasks WHERE task_id=?").all(task.id)).toEqual([])
    const after = await request(app,"/api/cycles")
    expect((await after.json()).cycles).toHaveLength(1)
  })

  it("rolls back a new cycle when automatic task membership cannot be saved", async () => {
    seedFixtures(wrapDbAsTestDatabase(shared.getDb()))
    shared.getDb().exec("CREATE TRIGGER reject_cycle_task BEFORE INSERT ON cycle_tasks BEGIN SELECT RAISE(FAIL, 'Membership unavailable'); END")
    const created = await request(app,"/api/cycles",{method:"POST"})
    expect(created.status).toBe(500)
    expect(shared.getDb().prepare("SELECT * FROM cycles").all()).toEqual([])
    shared.getDb().exec("DROP TRIGGER reject_cycle_task")
  })
})

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

describe("Dashboard API - GET /api/tasks", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Server

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createDashboardServer({db:db.db, contentRoot:"/tmp"})
  })

  afterEach(async () => {
    await closeServer(app)
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

  it("creates the task, labels and explicit cycle together with complete dependency fields", async () => {
    db.db.exec("INSERT INTO cycles(id,name,start_date,end_date) VALUES('cycle-compose','Composition','2026-10-04','2026-10-11')")
    const label = db.db.prepare("INSERT INTO task_labels(name,color) VALUES('Existing composition label','#123456')").run().lastInsertRowid
    const res = await request(app,"/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      title:"Composed task",status:"done",parentId:FIXTURES.TASK_AUTH,
      labels:[{labelId:Number(label)},{name:"New composition label",color:"#abcdef"},{labelId:Number(label)}],cycleId:"cycle-compose",
    })})
    expect(res.status,await res.clone().text()).toBe(201)
    const task = await res.json()
    expect(task).toMatchObject({title:"Composed task",status:"done",parentId:FIXTURES.TASK_AUTH,blockedBy:[],blocks:[],children:[],isReady:false})
    expect(task.completedAt).toEqual(expect.any(String))
    expect(task.labels.map((label: {name:string}) => label.name).sort()).toEqual(["Existing composition label","New composition label"])
    expect(db.db.prepare("SELECT cycle_id FROM cycle_tasks WHERE task_id=?").all(task.id)).toEqual([{cycle_id:"cycle-compose"}])
  })

  it("rolls back composition, including new labels, if a cycle attachment fails",async () => {
    db.db.exec("INSERT INTO cycles(id,name,start_date,end_date) VALUES('cycle-compose','Composition','2026-10-04','2026-10-11')")
    db.db.exec("CREATE TRIGGER reject_composition BEFORE INSERT ON cycle_tasks BEGIN SELECT RAISE(ABORT,'attachment failed'); END")
    try {
      const res = await request(app,"/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        title:"Rolled back composition",labels:[{name:"Rolled back label"}],cycleId:"cycle-compose",
      })})
      expect(res.status).toBe(500)
      expect(db.db.prepare("SELECT id FROM tasks WHERE title='Rolled back composition'").all()).toEqual([])
      expect(db.db.prepare("SELECT id FROM task_labels WHERE name='Rolled back label'").all()).toEqual([])
      expect(db.db.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({n:6})
    } finally {db.db.exec("DROP TRIGGER reject_composition")}
  })

  it.each([{labels:[{labelId:999999}]},{cycleId:"missing-cycle"},{labels:null},{labels:[{name:42}]},
    {labels:[{name:"  "}]},{labels:[{name:"Bad color",color:"red"}]},{labels:[{labelId:1,name:"Ambiguous"}]},{cycleId:42},
  ])("rejects invalid composition without leaving tasks or labels: %j",async fields => {
    const before = db.db.prepare("SELECT count(*) AS n FROM task_labels").get()
    const res = await request(app,"/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Invalid composition",...fields})})
    expect(res.status,await res.text()).toBe(400)
    expect(db.db.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({n:6})
    expect(db.db.prepare("SELECT count(*) AS n FROM task_labels").get()).toEqual(before)
  })

  it("rejects requests from unrelated browser origins before mutating tasks", async () => {
    const res = await request(app, `/api/tasks/${FIXTURES.TASK_JWT}`, {
      method:"PATCH", headers:{Origin:"https://unrelated.example", "Content-Type":"application/json"},
      body:JSON.stringify({title:"Unexpected remote edit"}),
    })
    expect(res.status).toBe(403)
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*")
    const row = db.db.prepare("SELECT title FROM tasks WHERE id = ?").get(FIXTURES.TASK_JWT) as {title:string}
    expect(row.title).not.toBe("Unexpected remote edit")
  })

  it.each([
    {title:123}, {description:[]}, {metadata:[]}, {status:123},
    {assigneeId:{}}, {assignedAt:123}, {parentId:123},
  ])("rejects malformed task fields across create and update: %j", async (fields) => {
    const before = db.db.prepare("SELECT * FROM tasks WHERE id=?").get(FIXTURES.TASK_JWT)
    for (const [method,path] of [["POST","/api/tasks"],["PATCH",`/api/tasks/${FIXTURES.TASK_JWT}`]]) {
      const res = await request(app,path!,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Valid title",...fields})})
      expect(res.status, await res.text()).toBe(400)
    }
    expect(db.db.prepare("SELECT * FROM tasks WHERE id=?").get(FIXTURES.TASK_JWT)).toEqual(before)
    expect(db.db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({n:6})
  })

  it("rejects rebound hostnames and opaque origins", async () => {
    const res = await request(app, "/api/tasks", {headers:{Host:"remote.example:3001"}})
    expect(res.status).toBe(403)
    const opaque = await request(app, "/api/tasks", {headers:{Origin:"null"}})
    expect(opaque.status).toBe(403)
  })

  it("allows local dashboard preflight without granting wildcard CORS", async () => {
    const origin = "http://localhost:5173"
    const res = await request(app, "/api/tasks", {method:"OPTIONS", headers:{Origin:origin}})
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin)
    expect(res.headers.get("Vary")).toContain("Origin")
    const tasks = await request(app, "/api/tasks", {headers:{Origin:origin}})
    expect(tasks.status).toBe(200)
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
  let app: Server

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createDashboardServer({db:db.db, contentRoot:"/tmp"})
  })

  afterEach(async () => {
    await closeServer(app)
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
  let app: Server

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createDashboardServer({db:db.db, contentRoot:"/tmp"})
  })

  afterEach(async () => {
    await closeServer(app)
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

describe("Dashboard API - GET /api/stats", () => {
  let shared: SharedTestLayerResult
  let db: TestDatabase
  let app: Server

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createDashboardServer({db:db.db, contentRoot:"/tmp"})
  })

  afterEach(async () => {
    await closeServer(app)
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

  it("omits retired execution and memory metrics", async () => {
    const res = await request(app, "/api/stats")
    const data = await res.json()
    expect(data).not.toHaveProperty("learnings")
    expect(data).not.toHaveProperty("runsRunning")
    expect(data).not.toHaveProperty("runsTotal")
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
  let app: Server

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  beforeEach(async () => {
    db = wrapDbAsTestDatabase(shared.getDb())
    seedFixtures(db)
    app = createDashboardServer({db:db.db, contentRoot:"/tmp"})
  })

  afterEach(async () => {
    await closeServer(app)
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
