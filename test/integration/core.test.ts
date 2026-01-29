import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDb, seedFixtures, FIXTURES, fixtureId } from "../fixtures.js"
import { SqliteClient } from "../../src/db.js"
import { TaskRepositoryLive } from "../../src/repo/task-repo.js"
import { DependencyRepositoryLive } from "../../src/repo/dep-repo.js"
import { TaskServiceLive, TaskService } from "../../src/services/task-service.js"
import { DependencyServiceLive, DependencyService } from "../../src/services/dep-service.js"
import { ReadyServiceLive, ReadyService } from "../../src/services/ready-service.js"
import { HierarchyServiceLive, HierarchyService } from "../../src/services/hierarchy-service.js"
import type { TaskId } from "../../src/schema.js"
import type Database from "better-sqlite3"

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  return Layer.mergeAll(TaskServiceLive, DependencyServiceLive, ReadyServiceLive, HierarchyServiceLive).pipe(
    Layer.provide(repos)
  )
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

  it("self-blocking is prevented by CHECK constraint", () => {
    const db = createTestDb()
    seedFixtures(db)
    expect(() => {
      db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT, new Date().toISOString())
    }).toThrow()
  })

  it("duplicate dependencies are prevented by UNIQUE constraint", () => {
    const db = createTestDb()
    seedFixtures(db)
    // JWT -> BLOCKED already exists from seed
    expect(() => {
      db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, new Date().toISOString())
    }).toThrow()
  })
})

describe("Task CRUD", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
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
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
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
    db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id IN (?, ?)").run(
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
    db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(
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
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
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

    const rows = db.prepare(
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

    const rows = db.prepare(
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

    const rows = db.prepare(
      "SELECT * FROM task_dependencies WHERE blocked_id = ? AND blocker_id = ?"
    ).all(FIXTURES.TASK_AUTH, FIXTURES.TASK_ROOT) as any[]
    expect(rows.length).toBe(1)
  })
})

describe("Hierarchy operations", () => {
  let db: InstanceType<typeof Database>
  let layer: ReturnType<typeof makeTestLayer>

  beforeEach(() => {
    db = createTestDb()
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
