import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDatabase, type TestDatabase } from "@jamesaphoenix/tx-test-utils"
import { seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  TaskRepository,
  DependencyRepositoryLive,
  TaskServiceLive,
  TaskService,
  DependencyServiceLive,
  DependencyService,
  ReadyServiceLive,
  ReadyService,
  HierarchyServiceLive,
  HierarchyService,
  ScoreServiceLive,
  ScoreService,
  AutoSyncServiceNoop,
  StaleDataError
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"

function makeTestLayer(db: TestDatabase) {
  const infra = Layer.succeed(SqliteClient, db.db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  // Base services that only depend on repos and AutoSyncService
  const baseServices = Layer.mergeAll(TaskServiceLive, DependencyServiceLive, ReadyServiceLive, HierarchyServiceLive).pipe(
    Layer.provide(Layer.merge(repos, AutoSyncServiceNoop))
  )
  // ScoreService depends on HierarchyService, so it needs baseServices
  const scoreService = ScoreServiceLive.pipe(
    Layer.provide(baseServices),
    Layer.provide(repos)
  )
  return Layer.mergeAll(baseServices, scoreService)
}

describe("Schema constraints", () => {
  it("fixture IDs are deterministic", () => {
    expect(FIXTURES.TASK_AUTH).toBe(fixtureId("auth"))
    expect(FIXTURES.TASK_JWT).toBe(fixtureId("jwt"))
    expect(FIXTURES.TASK_LOGIN).toBe(fixtureId("login"))
  })

  it("fixture IDs match tx-[a-z0-9]{8} format", () => {
    for (const id of Object.values(FIXTURES)) {
      expect(id).toMatch(/^tx-[a-z0-9]{8}$/)
    }
  })

  it("self-blocking is prevented by CHECK constraint", async () => {
    const db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    expect(() => {
      db.db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT, new Date().toISOString())
    }).toThrow()
  })

  it("duplicate dependencies are prevented by UNIQUE constraint", async () => {
    const db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    // JWT -> BLOCKED already exists from seed
    expect(() => {
      db.db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, new Date().toISOString())
    }).toThrow()
  })
})

describe("Task CRUD", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("create returns a task with valid ID and backlog status", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "New task", score: 500 })
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toMatch(/^tx-[a-z0-9]{8}$/)
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(500)
    expect(task.title).toBe("New task")
  })

  it("get returns existing task", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.get(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toBe(FIXTURES.TASK_JWT)
    expect(task.title).toBe("JWT validation")
  })

  it("get fails with TaskNotFoundError for missing ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.get("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("getWithDeps returns TaskWithDeps with dependency info", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.getWithDeps(FIXTURES.TASK_BLOCKED)
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toBe(FIXTURES.TASK_BLOCKED)
    expect(task).toHaveProperty("blockedBy")
    expect(task).toHaveProperty("blocks")
    expect(task).toHaveProperty("children")
    expect(task).toHaveProperty("isReady")
    expect(Array.isArray(task.blockedBy)).toBe(true)
    expect(task.blockedBy).toHaveLength(2)
    expect(task.blockedBy).toContain(FIXTURES.TASK_JWT)
    expect(task.blockedBy).toContain(FIXTURES.TASK_LOGIN)
  })

  it("update changes task fields", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(FIXTURES.TASK_JWT, { title: "Updated JWT", score: 999 })
      }).pipe(Effect.provide(layer))
    )

    expect(task.title).toBe("Updated JWT")
    expect(task.score).toBe(999)
  })

  it("update sets completedAt when status becomes done", async () => {
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        // JWT is in "ready" status, which can transition to "done" via review
        // Let's first move to active, then to done
        yield* svc.update(FIXTURES.TASK_JWT, { status: "active" })
        return yield* svc.update(FIXTURES.TASK_JWT, { status: "done" })
      }).pipe(Effect.provide(layer))
    )

    expect(task.status).toBe("done")
    expect(task.completedAt).not.toBeNull()
  })

  it("create fails with ValidationError for empty title", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "" })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("create fails with ValidationError for nonexistent parent", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "Test", parentId: "tx-nonexist" })
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("delete removes task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        yield* svc.remove(FIXTURES.TASK_DONE)
        return yield* svc.get(FIXTURES.TASK_DONE).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
  })

  it("list returns all tasks", async () => {
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.list()
      }).pipe(Effect.provide(layer))
    )

    expect(tasks.length).toBe(6) // All seeded tasks
  })

  it("list filters by status", async () => {
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.list({ status: "done" })
      }).pipe(Effect.provide(layer))
    )

    expect(tasks.length).toBe(1)
    expect(tasks[0].id).toBe(FIXTURES.TASK_DONE)
  })
})

describe("Ready detection", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("returns tasks with workable status and no open blockers", async () => {
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    for (const task of ready) {
      expect(["backlog", "ready", "planning"]).toContain(task.status)
      expect(task.isReady).toBe(true)
    }
  })

  it("excludes tasks with open blockers", async () => {
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    // TASK_BLOCKED has blockers (JWT and LOGIN) that aren't done
    expect(ready.find(t => t.id === FIXTURES.TASK_BLOCKED)).toBeUndefined()
  })

  it("excludes done tasks", async () => {
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    expect(ready.find(t => t.id === FIXTURES.TASK_DONE)).toBeUndefined()
  })

  it("includes tasks when ALL blockers are done", async () => {
    // Mark both blockers as done
    db.db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id IN (?, ?)").run(
      new Date().toISOString(), FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN
    )

    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    const blocked = ready.find(t => t.id === FIXTURES.TASK_BLOCKED)
    expect(blocked).toBeDefined()
    expect(blocked!.isReady).toBe(true)
  })

  it("excludes if only SOME blockers are done", async () => {
    // Only mark JWT as done, LOGIN still not done
    db.db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(
      new Date().toISOString(), FIXTURES.TASK_JWT
    )

    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    expect(ready.find(t => t.id === FIXTURES.TASK_BLOCKED)).toBeUndefined()
  })

  it("populates blockedBy, blocks, children", async () => {
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    // JWT should be ready and has blocks info
    const jwt = ready.find(t => t.id === FIXTURES.TASK_JWT)
    expect(jwt).toBeDefined()
    expect(jwt!.blockedBy).toEqual([])
    expect(jwt!.blocks).toContain(FIXTURES.TASK_BLOCKED)
  })

  it("sorts by score descending", async () => {
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    for (let i = 1; i < ready.length; i++) {
      expect(ready[i - 1].score).toBeGreaterThanOrEqual(ready[i].score)
    }
  })

  it("respects limit parameter", async () => {
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady(1)
      }).pipe(Effect.provide(layer))
    )

    expect(ready).toHaveLength(1)
  })

  it("isReady returns true for unblocked workable tasks", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.isReady(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(true)
  })

  it("isReady returns false for blocked tasks", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.isReady(FIXTURES.TASK_BLOCKED)
      }).pipe(Effect.provide(layer))
    )

    expect(result).toBe(false)
  })
})

describe("Dependency operations", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("addBlocker creates a dependency", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        // AUTH blocks LOGIN (in addition to existing deps)
        yield* svc.addBlocker(FIXTURES.TASK_LOGIN, FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(layer))
    )

    const rows = db.db.prepare(
      "SELECT * FROM task_dependencies WHERE blocked_id = ? AND blocker_id = ?"
    ).all(FIXTURES.TASK_LOGIN, FIXTURES.TASK_AUTH) as any[]
    expect(rows.length).toBe(1)
  })

  it("removeBlocker removes a dependency", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.removeBlocker(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    const rows = db.db.prepare(
      "SELECT * FROM task_dependencies WHERE blocked_id = ? AND blocker_id = ?"
    ).all(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT) as any[]
    expect(rows.length).toBe(0)
  })

  it("addBlocker fails with ValidationError for self-blocking", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
    }
  })

  it("addBlocker fails with CircularDependencyError for direct cycle", async () => {
    // JWT blocks BLOCKED (already exists). Now try BLOCKED blocks JWT.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("CircularDependencyError")
    }
  })

  it("addBlocker fails for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.addBlocker("tx-nonexist" as TaskId, FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("addBlocker allows valid non-cyclic dependency", async () => {
    // ROOT blocks AUTH (no cycle since AUTH doesn't block ROOT)
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(FIXTURES.TASK_AUTH, FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    const rows = db.db.prepare(
      "SELECT * FROM task_dependencies WHERE blocked_id = ? AND blocker_id = ?"
    ).all(FIXTURES.TASK_AUTH, FIXTURES.TASK_ROOT) as any[]
    expect(rows.length).toBe(1)
  })

  it("addBlocker is idempotent for existing dependency", async () => {
    // JWT -> BLOCKED already exists from seed; calling again should succeed without error
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    // Verify only one row exists (no duplicates)
    const rows = db.db.prepare(
      "SELECT * FROM task_dependencies WHERE blocked_id = ? AND blocker_id = ?"
    ).all(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT) as any[]
    expect(rows.length).toBe(1)
  })

  it("removeBlocker fails with DependencyNotFoundError for non-existent dependency", async () => {
    // AUTH -> LOGIN dependency does not exist in seed data
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        return yield* svc.removeBlocker(FIXTURES.TASK_LOGIN, FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("DependencyNotFoundError")
    }
  })
})

describe("Hierarchy operations", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("getChildren returns direct children", async () => {
    const children = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getChildren(FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(layer))
    )

    // AUTH has children: LOGIN, JWT, BLOCKED, DONE
    expect(children).toHaveLength(4)
    const ids = children.map(c => c.id)
    expect(ids).toContain(FIXTURES.TASK_LOGIN)
    expect(ids).toContain(FIXTURES.TASK_JWT)
    expect(ids).toContain(FIXTURES.TASK_BLOCKED)
    expect(ids).toContain(FIXTURES.TASK_DONE)
  })

  it("getChildren returns empty array for leaf nodes", async () => {
    const children = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getChildren(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(children).toHaveLength(0)
  })

  it("getChildren fails for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getChildren("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("getAncestors returns path from task to root", async () => {
    const ancestors = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getAncestors(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    // JWT -> AUTH -> ROOT
    expect(ancestors).toHaveLength(2)
    expect(ancestors[0].id).toBe(FIXTURES.TASK_AUTH)
    expect(ancestors[1].id).toBe(FIXTURES.TASK_ROOT)
  })

  it("getAncestors returns empty array for root task", async () => {
    const ancestors = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getAncestors(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    expect(ancestors).toHaveLength(0)
  })

  it("getAncestors fails for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getAncestors("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("getTree returns full subtree structure", async () => {
    const tree = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getTree(FIXTURES.TASK_AUTH)
      }).pipe(Effect.provide(layer))
    )

    expect(tree.task.id).toBe(FIXTURES.TASK_AUTH)
    expect(tree.children).toHaveLength(4)
    // All children should be leaf nodes (no grandchildren in test data)
    for (const child of tree.children) {
      expect(child.children).toHaveLength(0)
    }
  })

  it("getTree returns single node for leaf task", async () => {
    const tree = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getTree(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(tree.task.id).toBe(FIXTURES.TASK_JWT)
    expect(tree.children).toHaveLength(0)
  })

  it("getTree fails for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getTree("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("getDepth returns 0 for root task", async () => {
    const depth = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getDepth(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    expect(depth).toBe(0)
  })

  it("getDepth returns correct depth for nested task", async () => {
    const depth = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getDepth(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    // JWT -> AUTH -> ROOT (depth of 2)
    expect(depth).toBe(2)
  })

  it("getDepth fails for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getDepth("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("getRoots returns tasks with no parent", async () => {
    const roots = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getRoots()
      }).pipe(Effect.provide(layer))
    )

    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe(FIXTURES.TASK_ROOT)
  })
})

describe("Score calculations", () => {
  let db: TestDatabase
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    layer = makeTestLayer(db)
  })

  it("calculate returns base score for root task with no blockers", async () => {
    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_ROOT)
        return yield* scoreSvc.calculate(task)
      }).pipe(Effect.provide(layer))
    )

    // ROOT: base=1000, depth=0 (no penalty), no blocking bonus, fresh task
    // Expected: 1000 + 0 + 0 - 0 = 1000
    expect(score).toBe(1000)
  })

  it("calculate adds blocking bonus for tasks that block others", async () => {
    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_JWT)
        return yield* scoreSvc.calculate(task)
      }).pipe(Effect.provide(layer))
    )

    // JWT: base=700, depth=2 (penalty=20), blocks BLOCKED (+25), fresh
    // Expected: 700 + 25 - 20 = 705
    expect(score).toBe(705)
  })

  it("calculate applies depth penalty for nested tasks", async () => {
    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_LOGIN)
        return yield* scoreSvc.calculate(task)
      }).pipe(Effect.provide(layer))
    )

    // LOGIN: base=600, depth=2 (penalty=20), blocks BLOCKED (+25), fresh
    // Expected: 600 + 25 - 20 = 605
    expect(score).toBe(605)
  })

  it("calculate applies blocked penalty for blocked status", async () => {
    // Update a task to blocked status
    db.db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(FIXTURES.TASK_JWT)

    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_JWT)
        return yield* scoreSvc.calculate(task)
      }).pipe(Effect.provide(layer))
    )

    // JWT: base=700, depth=2 (penalty=20), blocks BLOCKED (+25), blocked (-1000), fresh
    // Expected: 700 + 25 - 20 - 1000 = -295
    expect(score).toBe(-295)
  })

  it("calculateById returns score by task ID", async () => {
    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreSvc = yield* ScoreService
        return yield* scoreSvc.calculateById(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    expect(score).toBe(1000)
  })

  it("calculateById fails with TaskNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreSvc = yield* ScoreService
        return yield* scoreSvc.calculateById("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("getBreakdown returns detailed score breakdown", async () => {
    const breakdown = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_JWT)
        return yield* scoreSvc.getBreakdown(task)
      }).pipe(Effect.provide(layer))
    )

    expect(breakdown.baseScore).toBe(700)
    expect(breakdown.blockingCount).toBe(1) // blocks BLOCKED
    expect(breakdown.blockingBonus).toBe(25)
    expect(breakdown.depth).toBe(2) // JWT -> AUTH -> ROOT
    expect(breakdown.depthPenalty).toBe(20)
    expect(breakdown.blockedPenalty).toBe(0)
    expect(breakdown.finalScore).toBe(705)
  })

  it("getBreakdownById returns breakdown by task ID", async () => {
    const breakdown = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreSvc = yield* ScoreService
        return yield* scoreSvc.getBreakdownById(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    expect(breakdown.baseScore).toBe(1000)
    expect(breakdown.depth).toBe(0)
    expect(breakdown.finalScore).toBe(1000)
  })

  it("getBreakdownById fails with TaskNotFoundError for nonexistent ID", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreSvc = yield* ScoreService
        return yield* scoreSvc.getBreakdownById("tx-nonexist" as TaskId)
      }).pipe(Effect.provide(layer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("calculate handles task with multiple blocking relationships", async () => {
    // LOGIN blocks BLOCKED (in addition to JWT)
    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_LOGIN)
        return yield* scoreSvc.calculate(task)
      }).pipe(Effect.provide(layer))
    )

    // LOGIN: base=600, depth=2 (penalty=20), blocks BLOCKED (+25), fresh
    // Expected: 600 + 25 - 20 = 605
    expect(score).toBe(605)
  })

  it("calculate gives higher score to tasks blocking more work", async () => {
    // TASK_AUTH has children but doesn't block anything
    // TASK_JWT blocks TASK_BLOCKED
    const authScore = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_AUTH)
        return yield* scoreSvc.calculate(task)
      }).pipe(Effect.provide(layer))
    )

    const jwtScore = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const scoreSvc = yield* ScoreService
        const task = yield* taskSvc.get(FIXTURES.TASK_JWT)
        return yield* scoreSvc.calculate(task)
      }).pipe(Effect.provide(layer))
    )

    // AUTH: base=800, depth=1 (penalty=10), blocks nothing, fresh = 790
    // JWT: base=700, depth=2 (penalty=20), blocks 1 (+25), fresh = 705
    expect(authScore).toBe(790)
    expect(jwtScore).toBe(705)
    // AUTH has higher score due to higher base score despite no blocking bonus
  })
})

describe("Task Repository updateMany with staleness detection", () => {
  let db: TestDatabase
  let repoLayer: Layer.Layer<TaskRepository, never, never>

  beforeEach(async () => {
    db = await Effect.runPromise(createTestDatabase())
    seedFixtures(db)
    const infra = Layer.succeed(SqliteClient, db.db as any)
    repoLayer = TaskRepositoryLive.pipe(Layer.provide(infra))
  })

  it("updateMany succeeds when tasks are not stale", async () => {
    // First fetch the tasks
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findByIds([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
      }).pipe(Effect.provide(repoLayer))
    )

    // Update them with new values
    const now = new Date()
    const updatedTasks = tasks.map(t => ({
      ...t,
      title: `Updated: ${t.title}`,
      updatedAt: now
    }))

    // This should succeed since data is not stale
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        yield* repo.updateMany(updatedTasks)
      }).pipe(Effect.provide(repoLayer))
    )

    // Verify the updates were applied
    const verifyTasks = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findByIds([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
      }).pipe(Effect.provide(repoLayer))
    )

    expect(verifyTasks[0].title).toContain("Updated:")
    expect(verifyTasks[1].title).toContain("Updated:")
  })

  it("updateMany fails with StaleDataError when task was modified externally", async () => {
    // First fetch the task
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findByIds([FIXTURES.TASK_JWT])
      }).pipe(Effect.provide(repoLayer))
    )

    const originalTask = tasks[0]

    // Simulate external modification by directly updating the database
    // This sets updated_at to a future time
    const futureTime = new Date(Date.now() + 10000).toISOString()
    db.db.prepare("UPDATE tasks SET title = 'Externally modified', updated_at = ? WHERE id = ?")
      .run(futureTime, FIXTURES.TASK_JWT)

    // Now try to updateMany with the stale data
    const updatedTask = {
      ...originalTask,
      title: "My update attempt",
      updatedAt: new Date()
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.updateMany([updatedTask])
      }).pipe(Effect.provide(repoLayer), Effect.either)
    )

    // Should fail with StaleDataError
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as StaleDataError)._tag).toBe("StaleDataError")
      expect((result.left as StaleDataError).taskId).toBe(FIXTURES.TASK_JWT)
    }

    // Verify the external modification is preserved
    const verifyTask = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(repoLayer))
    )

    expect(verifyTask?.title).toBe("Externally modified")
  })

  it("updateMany detects staleness on second task in batch", async () => {
    // Fetch multiple tasks
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findByIds([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
      }).pipe(Effect.provide(repoLayer))
    )

    // Externally modify only the second task
    const futureTime = new Date(Date.now() + 10000).toISOString()
    db.db.prepare("UPDATE tasks SET title = 'Externally modified LOGIN', updated_at = ? WHERE id = ?")
      .run(futureTime, FIXTURES.TASK_LOGIN)

    // Try to update both tasks
    const now = new Date()
    const updatedTasks = tasks.map(t => ({
      ...t,
      title: `Batch update: ${t.title}`,
      updatedAt: now
    }))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.updateMany(updatedTasks)
      }).pipe(Effect.provide(repoLayer), Effect.either)
    )

    // Should fail with StaleDataError for LOGIN
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as StaleDataError)._tag).toBe("StaleDataError")
      expect((result.left as StaleDataError).taskId).toBe(FIXTURES.TASK_LOGIN)
    }

    // Verify no updates were applied (transaction rolled back)
    const verifyTasks = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findByIds([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
      }).pipe(Effect.provide(repoLayer))
    )

    // JWT should NOT have been updated due to rollback
    expect(verifyTasks.find(t => t.id === FIXTURES.TASK_JWT)?.title).toBe("JWT validation")
    // LOGIN should have the external modification
    expect(verifyTasks.find(t => t.id === FIXTURES.TASK_LOGIN)?.title).toBe("Externally modified LOGIN")
  })

  it("updateMany succeeds with empty array", async () => {
    // This should be a no-op
    await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        yield* repo.updateMany([])
      }).pipe(Effect.provide(repoLayer))
    )
    // No error means success
  })

  it("updateMany fails with TaskNotFoundError for nonexistent task", async () => {
    const fakeTask = {
      id: "tx-nonexist" as TaskId,
      title: "Fake task",
      description: "",
      status: "backlog" as const,
      parentId: null,
      score: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      metadata: {}
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.updateMany([fakeTask])
      }).pipe(Effect.provide(repoLayer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })
})
