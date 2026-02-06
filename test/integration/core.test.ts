import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
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
  StaleDataError,
  HasChildrenError
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"
import type { Database } from "bun:sqlite"

function makeTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as any)
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

function makeRepoLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as any)
  return TaskRepositoryLive.pipe(Layer.provide(infra))
}

describe("Schema constraints", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("fixture IDs are deterministic", () => {
    expect(FIXTURES.TASK_AUTH).toBe(fixtureId("auth"))
    expect(FIXTURES.TASK_JWT).toBe(fixtureId("jwt"))
    expect(FIXTURES.TASK_LOGIN).toBe(fixtureId("login"))
  })

  it("fixture IDs match tx-[a-z0-9]{6,12} format", () => {
    for (const id of Object.values(FIXTURES)) {
      expect(id).toMatch(/^tx-[a-z0-9]{6,12}$/)
    }
  })

  it("self-blocking is prevented by CHECK constraint", () => {
    const db = shared.getDb()
    seedFixtures({ db } as any)
    expect(() => {
      db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_JWT, new Date().toISOString())
    }).toThrow()
  })

  it("duplicate dependencies are prevented by UNIQUE constraint", () => {
    const db = shared.getDb()
    seedFixtures({ db } as any)
    // JWT -> BLOCKED already exists from seed
    expect(() => {
      db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, new Date().toISOString())
    }).toThrow()
  })
})

describe("Task CRUD", () => {
  let shared: SharedTestLayerResult
  let layer: ReturnType<typeof makeTestLayer>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
    layer = makeTestLayer(shared.getDb())
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("create returns a task with valid ID and backlog status", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.create({ title: "New task", score: 500 })
      }).pipe(Effect.provide(layer))
    )

    expect(task.id).toMatch(/^tx-[a-z0-9]{6,12}$/)
    expect(task.status).toBe("backlog")
    expect(task.score).toBe(500)
    expect(task.title).toBe("New task")
  })

  it("get returns existing task", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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

  it("update rejects self-referencing parentId", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(FIXTURES.TASK_JWT, { parentId: FIXTURES.TASK_JWT }).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
      expect((result.left as any).reason).toContain("own parent")
    }
  })

  it("update rejects direct parent-child cycle", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    // TASK_AUTH is parent of TASK_JWT. Setting AUTH's parent to JWT would create a cycle.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(FIXTURES.TASK_AUTH, { parentId: FIXTURES.TASK_JWT }).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
      expect((result.left as any).reason).toContain("cycle")
    }
  })

  it("update rejects deep parent-child cycle", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    // Hierarchy: ROOT -> AUTH -> JWT
    // Setting ROOT's parent to JWT would create ROOT->JWT->...->AUTH->...->ROOT cycle
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(FIXTURES.TASK_ROOT, { parentId: FIXTURES.TASK_JWT }).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ValidationError")
      expect((result.left as any).reason).toContain("cycle")
    }
  })

  it("update allows valid parentId change (no cycle)", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    // Moving JWT from under AUTH to directly under ROOT is valid
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.update(FIXTURES.TASK_JWT, { parentId: FIXTURES.TASK_ROOT })
      }).pipe(Effect.provide(layer))
    )

    expect(task.parentId).toBe(FIXTURES.TASK_ROOT)
  })

  it("delete removes task", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        yield* svc.remove(FIXTURES.TASK_DONE)
        return yield* svc.get(FIXTURES.TASK_DONE).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
  })

  it("delete fails with HasChildrenError when task has children", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.remove(FIXTURES.TASK_AUTH).pipe(Effect.either)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(HasChildrenError)
      const err = result.left as HasChildrenError
      expect(err.id).toBe(FIXTURES.TASK_AUTH)
      expect(err.childIds.length).toBeGreaterThan(0)
    }
  })

  it("delete with cascade removes task and all descendants", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        // TASK_AUTH has children: LOGIN, JWT, BLOCKED, DONE
        yield* svc.remove(FIXTURES.TASK_AUTH, { cascade: true })
        // All descendants should be gone
        const authResult = yield* svc.get(FIXTURES.TASK_AUTH).pipe(Effect.either)
        const loginResult = yield* svc.get(FIXTURES.TASK_LOGIN).pipe(Effect.either)
        const jwtResult = yield* svc.get(FIXTURES.TASK_JWT).pipe(Effect.either)
        return { authResult, loginResult, jwtResult }
      }).pipe(Effect.provide(layer))
    )

    expect(result.authResult._tag).toBe("Left")
    expect(result.loginResult._tag).toBe("Left")
    expect(result.jwtResult._tag).toBe("Left")
  })

  it("cascade delete removes descendants beyond depth 10", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        // Build a chain of 15 nested tasks: depth0 -> depth1 -> ... -> depth14
        const ids: TaskId[] = []
        let parentId: string | undefined = undefined
        for (let i = 0; i < 15; i++) {
          const task = yield* svc.create({ title: `depth-${i}`, parentId, score: 100 })
          ids.push(task.id)
          parentId = task.id
        }
        // Cascade delete from root — should remove ALL 15 tasks, not just first 10
        yield* svc.remove(ids[0], { cascade: true })
        // Verify every task is gone, including those beyond depth 10
        const results: string[] = []
        for (const id of ids) {
          const r = yield* svc.get(id).pipe(Effect.either)
          results.push(r._tag)
        }
        return results
      }).pipe(Effect.provide(layer))
    )

    // All 15 tasks should be deleted (Left = not found)
    expect(result).toHaveLength(15)
    for (const tag of result) {
      expect(tag).toBe("Left")
    }
  })

  it("list returns all tasks", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TaskService
        return yield* svc.list()
      }).pipe(Effect.provide(layer))
    )

    expect(tasks.length).toBe(6) // All seeded tasks
  })

  it("list filters by status", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
  let shared: SharedTestLayerResult
  let layer: ReturnType<typeof makeTestLayer>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
    layer = makeTestLayer(shared.getDb())
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("returns tasks with workable status and no open blockers", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    expect(ready.find(t => t.id === FIXTURES.TASK_DONE)).toBeUndefined()
  })

  it("includes tasks when ALL blockers are done", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
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
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady(1)
      }).pipe(Effect.provide(layer))
    )

    expect(ready).toHaveLength(1)
  })

  it("excludes tasks with active claims (thundering herd prevention)", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()

    // Verify JWT is in the ready list before claiming
    const readyBefore = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )
    const jwtBefore = readyBefore.find(t => t.id === FIXTURES.TASK_JWT)
    expect(jwtBefore).toBeDefined()

    // Insert a worker (required by FK constraint on task_claims)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`
    ).run("worker-other", "other-worker", "localhost", 99999, "idle", now, now)

    // Simulate another worker claiming JWT by inserting an active claim directly
    const leaseExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    db.prepare(
      `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
       VALUES (?, ?, ?, ?, 0, 'active')`
    ).run(FIXTURES.TASK_JWT, "worker-other", now, leaseExpires)

    // getReady should now exclude the claimed task
    const readyAfter = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )
    expect(readyAfter.find(t => t.id === FIXTURES.TASK_JWT)).toBeUndefined()

    // Other unclaimed tasks should still appear
    expect(readyAfter.length).toBeGreaterThan(0)
  })

  it("includes tasks with released/expired claims", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()

    // Insert a worker (required by FK constraint on task_claims)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, capabilities, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')`
    ).run("worker-done", "done-worker", "localhost", 99998, "idle", now, now)

    // Insert a released claim on JWT (not active — should not exclude)
    const leaseExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    db.prepare(
      `INSERT INTO task_claims (task_id, worker_id, claimed_at, lease_expires_at, renewed_count, status)
       VALUES (?, ?, ?, ?, 0, 'released')`
    ).run(FIXTURES.TASK_JWT, "worker-done", now, leaseExpires)

    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.getReady()
      }).pipe(Effect.provide(layer))
    )

    // JWT should still appear because the claim is released, not active
    expect(ready.find(t => t.id === FIXTURES.TASK_JWT)).toBeDefined()
  })

  it("isReady returns Ready for unblocked workable tasks", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.isReady(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Ready")
  })

  it("isReady returns Blocked for blocked tasks", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ReadyService
        return yield* svc.isReady(FIXTURES.TASK_BLOCKED)
      }).pipe(Effect.provide(layer))
    )

    expect(result._tag).toBe("Blocked")
  })
})

describe("Dependency operations", () => {
  let shared: SharedTestLayerResult
  let layer: ReturnType<typeof makeTestLayer>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
    layer = makeTestLayer(shared.getDb())
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("addBlocker creates a dependency", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
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
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
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

  it("addBlocker is idempotent for existing dependency", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
    // JWT -> BLOCKED already exists from seed; calling again should succeed without error
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DependencyService
        yield* svc.addBlocker(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    // Verify only one row exists (no duplicates)
    const rows = db.prepare(
      "SELECT * FROM task_dependencies WHERE blocked_id = ? AND blocker_id = ?"
    ).all(FIXTURES.TASK_BLOCKED, FIXTURES.TASK_JWT) as any[]
    expect(rows.length).toBe(1)
  })

  it("removeBlocker fails with DependencyNotFoundError for non-existent dependency", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
  let shared: SharedTestLayerResult
  let layer: ReturnType<typeof makeTestLayer>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
    layer = makeTestLayer(shared.getDb())
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("getChildren returns direct children", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const children = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getChildren(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(children).toHaveLength(0)
  })

  it("getChildren fails for nonexistent task", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const ancestors = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getAncestors(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    expect(ancestors).toHaveLength(0)
  })

  it("getAncestors fails for nonexistent task", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const tree = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getTree(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(layer))
    )

    expect(tree.task.id).toBe(FIXTURES.TASK_JWT)
    expect(tree.children).toHaveLength(0)
  })

  it("getTree respects maxDepth and truncates deep children", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    // Fixture hierarchy: Root → Auth → {Login, JWT, Blocked, Done} (3 levels)
    // With maxDepth=2, SQL CTE fetches root (depth 1) and auth (depth 2)
    // Auth's children (depth 3) should NOT be fetched
    const tree = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getTree(FIXTURES.TASK_ROOT, 2)
      }).pipe(Effect.provide(layer))
    )

    expect(tree.task.id).toBe(FIXTURES.TASK_ROOT)
    // Auth is at depth 2, should be included
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].task.id).toBe(FIXTURES.TASK_AUTH)
    // Auth's children (Login, JWT, etc.) are at depth 3, should be truncated
    expect(tree.children[0].children).toHaveLength(0)
  })

  it("getTree with maxDepth=1 returns only the root node", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const tree = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getTree(FIXTURES.TASK_ROOT, 1)
      }).pipe(Effect.provide(layer))
    )

    expect(tree.task.id).toBe(FIXTURES.TASK_ROOT)
    // maxDepth=1 means only root is fetched, no children
    expect(tree.children).toHaveLength(0)
  })

  it("getTree fails for nonexistent task", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const depth = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* HierarchyService
        return yield* svc.getDepth(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    expect(depth).toBe(0)
  })

  it("getDepth returns correct depth for nested task", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
  let shared: SharedTestLayerResult
  let layer: ReturnType<typeof makeTestLayer>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
    layer = makeTestLayer(shared.getDb())
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("calculate returns base score for root task with no blockers", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    // Update a task to blocked status
    shared.getDb().prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(FIXTURES.TASK_JWT)

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
    seedFixtures({ db: shared.getDb() } as any)
    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreSvc = yield* ScoreService
        return yield* scoreSvc.calculateById(FIXTURES.TASK_ROOT)
      }).pipe(Effect.provide(layer))
    )

    expect(score).toBe(1000)
  })

  it("calculateById fails with TaskNotFoundError for nonexistent ID", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
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
  let shared: SharedTestLayerResult
  let repoLayer: Layer.Layer<TaskRepository, never, never>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
    repoLayer = makeRepoLayer(shared.getDb())
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("updateMany succeeds when tasks are not stale", async () => {
    seedFixtures({ db: shared.getDb() } as any)
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
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
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
    db.prepare("UPDATE tasks SET title = 'Externally modified', updated_at = ? WHERE id = ?")
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
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
    // Fetch multiple tasks
    const tasks = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findByIds([FIXTURES.TASK_JWT, FIXTURES.TASK_LOGIN])
      }).pipe(Effect.provide(repoLayer))
    )

    // Externally modify only the second task
    const futureTime = new Date(Date.now() + 10000).toISOString()
    db.prepare("UPDATE tasks SET title = 'Externally modified LOGIN', updated_at = ? WHERE id = ?")
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

  it("update with expectedUpdatedAt fails with StaleDataError when task was modified externally", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    const db = shared.getDb()
    // Fetch the task
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(repoLayer))
    )

    const originalUpdatedAt = task!.updatedAt

    // Simulate external modification
    const futureTime = new Date(Date.now() + 10000).toISOString()
    db.prepare("UPDATE tasks SET title = 'Externally modified', updated_at = ? WHERE id = ?")
      .run(futureTime, FIXTURES.TASK_JWT)

    // Try to update with the stale expectedUpdatedAt
    const updatedTask = {
      ...task!,
      title: "My update attempt",
      updatedAt: new Date()
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.update(updatedTask, originalUpdatedAt)
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

  it("update with expectedUpdatedAt succeeds when task is not stale", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    // Fetch the task
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(repoLayer))
    )

    const originalUpdatedAt = task!.updatedAt

    // Update with correct expectedUpdatedAt (no external modification)
    const updatedTask = {
      ...task!,
      title: "Legitimate update",
      updatedAt: new Date()
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.update(updatedTask, originalUpdatedAt)
      }).pipe(Effect.provide(repoLayer), Effect.either)
    )

    expect(result._tag).toBe("Right")

    // Verify the update was applied
    const verifyTask = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(repoLayer))
    )

    expect(verifyTask?.title).toBe("Legitimate update")
  })

  it("update with expectedUpdatedAt fails with TaskNotFoundError for missing task", async () => {
    seedFixtures({ db: shared.getDb() } as any)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.update({
          id: "tx-nonexistent" as any,
          title: "Ghost",
          description: "",
          status: "backlog",
          parentId: null,
          score: 0,
          updatedAt: new Date(),
          createdAt: new Date(),
          completedAt: null,
          metadata: {}
        }, new Date())
      }).pipe(Effect.provide(repoLayer), Effect.either)
    )

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("TaskNotFoundError")
    }
  })

  it("update without expectedUpdatedAt still works (backward compatible)", async () => {
    seedFixtures({ db: shared.getDb() } as any)
    // Fetch the task
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(repoLayer))
    )

    // Update without optimistic locking
    const updatedTask = {
      ...task!,
      title: "No-lock update",
      updatedAt: new Date()
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.update(updatedTask)
      }).pipe(Effect.provide(repoLayer), Effect.either)
    )

    expect(result._tag).toBe("Right")

    const verifyTask = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(FIXTURES.TASK_JWT)
      }).pipe(Effect.provide(repoLayer))
    )

    expect(verifyTask?.title).toBe("No-lock update")
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

describe("Task Repository recoverTaskStatus (atomic TOCTOU fix)", () => {
  let shared: SharedTestLayerResult
  let repoLayer: Layer.Layer<TaskRepository, never, never>

  beforeAll(async () => {
    shared = await createSharedTestLayer()
    repoLayer = makeRepoLayer(shared.getDb())
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  it("sets active task to ready when no blockers exist", async () => {
    const db = shared.getDb()
    const taskId = fixtureId("recover-no-blockers")
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(taskId, "No blockers", "", "active", null, 500, now, now, null, "{}")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.recoverTaskStatus(taskId, "active")
      }).pipe(Effect.provide(repoLayer))
    )

    expect(result).toBe(true)

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(taskId)
      }).pipe(Effect.provide(repoLayer))
    )
    expect(task!.status).toBe("ready")
  })

  it("sets active task to ready when all blockers are done", async () => {
    const db = shared.getDb()
    const taskId = fixtureId("recover-done-blockers")
    const blockerId = fixtureId("recover-blocker-done")
    const now = new Date().toISOString()

    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(blockerId, "Done blocker", "", "done", null, 500, now, now, now, "{}")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(taskId, "Blocked task", "", "active", null, 500, now, now, null, "{}")
    db.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
    ).run(blockerId, taskId, now)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.recoverTaskStatus(taskId, "active")
      }).pipe(Effect.provide(repoLayer))
    )

    expect(result).toBe(true)

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(taskId)
      }).pipe(Effect.provide(repoLayer))
    )
    expect(task!.status).toBe("ready")
  })

  it("sets active task to blocked when blockers are not done", async () => {
    const db = shared.getDb()
    const taskId = fixtureId("recover-pending-blockers")
    const blockerId = fixtureId("recover-blocker-pending")
    const now = new Date().toISOString()

    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(blockerId, "Pending blocker", "", "ready", null, 500, now, now, null, "{}")
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(taskId, "Blocked task", "", "active", null, 500, now, now, null, "{}")
    db.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
    ).run(blockerId, taskId, now)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.recoverTaskStatus(taskId, "active")
      }).pipe(Effect.provide(repoLayer))
    )

    expect(result).toBe(true)

    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(taskId)
      }).pipe(Effect.provide(repoLayer))
    )
    expect(task!.status).toBe("blocked")
  })

  it("returns false when task status does not match expectedStatus", async () => {
    const db = shared.getDb()
    const taskId = fixtureId("recover-wrong-status")
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(taskId, "Ready task", "", "ready", null, 500, now, now, null, "{}")

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.recoverTaskStatus(taskId, "active")
      }).pipe(Effect.provide(repoLayer))
    )

    expect(result).toBe(false)

    // Status should be unchanged
    const task = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.findById(taskId)
      }).pipe(Effect.provide(repoLayer))
    )
    expect(task!.status).toBe("ready")
  })

  it("returns false when task does not exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* TaskRepository
        return yield* repo.recoverTaskStatus("tx-nonexist", "active")
      }).pipe(Effect.provide(repoLayer))
    )

    expect(result).toBe(false)
  })
})
