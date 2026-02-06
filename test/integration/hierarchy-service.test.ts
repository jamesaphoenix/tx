import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect, Layer } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  TaskRepositoryLive,
  DependencyRepositoryLive,
  TaskServiceLive,
  DependencyServiceLive,
  ReadyServiceLive,
  HierarchyServiceLive,
  HierarchyService,
  AutoSyncServiceNoop,
} from "@jamesaphoenix/tx-core"
import type { TaskId } from "@jamesaphoenix/tx-types"
import type { Database } from "bun:sqlite"

function makeTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as any)
  const repos = Layer.mergeAll(TaskRepositoryLive, DependencyRepositoryLive).pipe(
    Layer.provide(infra)
  )
  return Layer.mergeAll(TaskServiceLive, DependencyServiceLive, ReadyServiceLive, HierarchyServiceLive).pipe(
    Layer.provide(Layer.merge(repos, AutoSyncServiceNoop))
  )
}

// Helper to insert a raw task row via SQL (bypasses service validation)
function insertRawTask(
  db: Database,
  id: string,
  title: string,
  parentId: string | null,
  status = "backlog"
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, "", status, parentId, 100, now, now, null, "{}")
}

describe("HierarchyService edge cases", () => {
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

  describe("circular parent relationships", () => {
    it("handles A.parent = B, B.parent = A without infinite loop in getTree", async () => {
      const db = shared.getDb()
      const idA = fixtureId("circleA")
      const idB = fixtureId("circleB")

      // Insert A with parent B, then B with parent A (circular)
      // Insert B first (no parent), then A (parent=B), then update B's parent to A
      insertRawTask(db, idA, "Task A", null)
      insertRawTask(db, idB, "Task B", idA)
      // Now create the circular reference: A -> B -> A
      db.prepare("UPDATE tasks SET parent_id = ? WHERE id = ?").run(idB, idA)

      // getTree should not hang — visited set prevents infinite recursion
      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(idA)
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(idA)
      // The tree should be finite (visited set breaks the cycle)
    })

    it("handles A.parent = B, B.parent = A without infinite loop in getDepth", async () => {
      const db = shared.getDb()
      const idA = fixtureId("depthcA")
      const idB = fixtureId("depthcB")

      insertRawTask(db, idA, "Task A", null)
      insertRawTask(db, idB, "Task B", idA)
      db.prepare("UPDATE tasks SET parent_id = ? WHERE id = ?").run(idB, idA)

      // getDepth uses getAncestorChain which has a SQL CTE depth limit of 100
      // and also has t.id != ? guard to prevent self-joins
      const depth = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getDepth(idA)
        }).pipe(Effect.provide(layer))
      )

      // Should return a finite number, not hang
      expect(typeof depth).toBe("number")
      expect(depth).toBeGreaterThanOrEqual(0)
    })

    it("handles three-node cycle A → B → C → A in getTree", async () => {
      const db = shared.getDb()
      const idA = fixtureId("tri3cycA")
      const idB = fixtureId("tri3cycB")
      const idC = fixtureId("tri3cycC")

      // Create A → B → C chain first
      insertRawTask(db, idA, "Task A", null)
      insertRawTask(db, idB, "Task B", idA)
      insertRawTask(db, idC, "Task C", idB)
      // Close the cycle: A.parent = C
      db.prepare("UPDATE tasks SET parent_id = ? WHERE id = ?").run(idC, idA)

      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(idA)
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(idA)
      // Tree terminates — visited set prevents revisiting
    })

    it("handles self-referencing parent (A.parent = A) in getTree", async () => {
      const db = shared.getDb()
      const idA = fixtureId("selfref1")

      insertRawTask(db, idA, "Self-referencing", null)
      db.prepare("UPDATE tasks SET parent_id = ? WHERE id = ?").run(idA, idA)

      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(idA)
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(idA)
      // Self-referencing task should not appear as its own child
      // The getDescendants CTE joins on t.parent_id = d.id
      // If A.parent_id = A, the CTE starts with A (depth 1),
      // then looks for tasks where parent_id = A... which is A itself
      // The visited set in buildNode prevents infinite recursion
    })
  })

  describe("deep hierarchies", () => {
    it("handles chain of 50 tasks with default maxDepth=10", async () => {
      const db = shared.getDb()
      // Create a chain: task0 → task1 → task2 → ... → task49
      const ids: TaskId[] = []
      for (let i = 0; i < 50; i++) {
        const id = fixtureId(`deep${i.toString().padStart(3, "0")}`)
        ids.push(id)
        const parentId = i === 0 ? null : ids[i - 1]
        insertRawTask(db, id, `Deep task ${i}`, parentId)
      }

      // Default maxDepth=10, so tree from root should only have 10 levels
      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(ids[0])
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(ids[0])

      // Count actual depth of the returned tree
      let depth = 0
      let node = tree
      while (node.children.length > 0) {
        depth++
        node = node.children[0]
      }
      // With maxDepth=10, the SQL CTE fetches up to depth 10
      // so we get the root + 9 descendants = chain of 10 nodes (depth 9)
      expect(depth).toBeLessThanOrEqual(10)
    })

    it("handles chain of 50 tasks with explicit maxDepth=50", async () => {
      const db = shared.getDb()
      const ids: TaskId[] = []
      for (let i = 0; i < 50; i++) {
        const id = fixtureId(`xdep${i.toString().padStart(3, "0")}`)
        ids.push(id)
        const parentId = i === 0 ? null : ids[i - 1]
        insertRawTask(db, id, `Deep task ${i}`, parentId)
      }

      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(ids[0], 50)
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(ids[0])

      // Count the full chain depth
      let depth = 0
      let node = tree
      while (node.children.length > 0) {
        depth++
        node = node.children[0]
      }
      // All 50 tasks should be returned (depth 49)
      expect(depth).toBe(49)
    })

    it("getDepth returns correct value for deeply nested task", async () => {
      const db = shared.getDb()
      const ids: TaskId[] = []
      for (let i = 0; i < 20; i++) {
        const id = fixtureId(`gdep${i.toString().padStart(3, "0")}`)
        ids.push(id)
        const parentId = i === 0 ? null : ids[i - 1]
        insertRawTask(db, id, `Deep task ${i}`, parentId)
      }

      // The deepest task (index 19) has 19 ancestors
      const depth = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getDepth(ids[19])
        }).pipe(Effect.provide(layer))
      )

      expect(depth).toBe(19)
    })
  })

  describe("orphaned subtrees", () => {
    // Orphaned data can occur from JSONL imports or direct DB manipulation.
    // We disable FK constraints temporarily to simulate this scenario.
    function insertOrphanTask(
      db: Database,
      id: string,
      title: string,
      parentId: string | null,
      status = "backlog"
    ): void {
      const now = new Date().toISOString()
      db.run("PRAGMA foreign_keys = OFF")
      db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, title, "", status, parentId, 100, now, now, null, "{}")
      db.run("PRAGMA foreign_keys = ON")
    }

    it("handles task with parent_id pointing to non-existent task", async () => {
      const db = shared.getDb()
      const orphanId = fixtureId("orphan01")
      const fakeParent = fixtureId("fakeprt1")

      insertOrphanTask(db, orphanId, "Orphaned task", fakeParent)

      // getTree should still work — the task exists, it just has a dangling parent_id
      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(orphanId)
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(orphanId)
      expect(tree.children).toHaveLength(0)
    })

    it("orphaned task has depth based on ancestor chain length", async () => {
      const db = shared.getDb()
      const orphanId = fixtureId("orphan02")
      const fakeParent = fixtureId("fakeprt2")

      insertOrphanTask(db, orphanId, "Orphaned task", fakeParent)

      // getDepth walks up the ancestor chain. The CTE starts with the task
      // and joins on t.id = a.parent_id. Since fakeParent doesn't exist,
      // the chain stops at the orphan itself (length 1 → depth 0)
      const depth = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getDepth(orphanId)
        }).pipe(Effect.provide(layer))
      )

      expect(depth).toBe(0)
    })

    it("orphaned subtree with children still builds correctly", async () => {
      const db = shared.getDb()
      const parentId = fixtureId("orphprnt")
      const childId = fixtureId("orphchld")
      const fakeGrandparent = fixtureId("fakegp01")

      // Parent references non-existent grandparent, but child references parent
      insertOrphanTask(db, parentId, "Orphaned parent", fakeGrandparent)
      insertRawTask(db, childId, "Child of orphan", parentId)

      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getTree(parentId)
        }).pipe(Effect.provide(layer))
      )

      expect(tree.task.id).toBe(parentId)
      expect(tree.children).toHaveLength(1)
      expect(tree.children[0].task.id).toBe(childId)
    })

    it("getRoots does not include orphaned tasks (they have a parent_id)", async () => {
      const db = shared.getDb()
      const orphanId = fixtureId("orphrt01")
      const rootId = fixtureId("realrt01")
      const fakeParent = fixtureId("fakert01")

      insertRawTask(db, rootId, "Real root", null)
      insertOrphanTask(db, orphanId, "Orphan with fake parent", fakeParent)

      const roots = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          return yield* svc.getRoots()
        }).pipe(Effect.provide(layer))
      )

      // Only the real root (parent_id = null) should appear
      const rootIds = roots.map((r) => r.id)
      expect(rootIds).toContain(rootId)
      expect(rootIds).not.toContain(orphanId)
    })
  })

  describe("large tree performance", () => {
    it("builds tree efficiently with 10,000 tasks", async () => {
      const db = shared.getDb()
      const rootId = fixtureId("bigroot1")
      insertRawTask(db, rootId, "Big root", null)

      // Create 10,000 tasks distributed across 100 groups of 100
      // Each group has a parent directly under root, with 99 children
      const insertStmt = db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const now = new Date().toISOString()

      const insertAll = db.transaction(() => {
        for (let group = 0; group < 100; group++) {
          const groupParentId = fixtureId(`bg${group.toString().padStart(4, "0")}`)
          insertStmt.run(groupParentId, `Group ${group}`, "", "backlog", rootId, 100, now, now, null, "{}")

          for (let child = 0; child < 99; child++) {
            const childId = fixtureId(`bc${group.toString().padStart(3, "0")}${child.toString().padStart(3, "0")}`)
            insertStmt.run(childId, `Child ${group}-${child}`, "", "backlog", groupParentId, 50, now, now, null, "{}")
          }
        }
      })
      insertAll()

      const start = performance.now()

      const tree = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* HierarchyService
          // Use maxDepth=5 to ensure we get all 3 levels (root → group → child)
          return yield* svc.getTree(rootId, 5)
        }).pipe(Effect.provide(layer))
      )

      const elapsed = performance.now() - start

      expect(tree.task.id).toBe(rootId)
      expect(tree.children).toHaveLength(100) // 100 group parents

      // Count total nodes in tree
      let totalNodes = 0
      const countNodes = (node: typeof tree): void => {
        totalNodes++
        for (const child of node.children) {
          countNodes(child)
        }
      }
      countNodes(tree)

      // 1 root + 100 groups + 9900 children = 10001
      expect(totalNodes).toBe(10001)

      // Should complete in reasonable time (< 5 seconds even on slow CI)
      expect(elapsed).toBeLessThan(5000)
    })
  })
})
