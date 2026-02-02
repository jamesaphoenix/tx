import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import Database from "better-sqlite3"
import {
  SqliteClient,
  getSchemaVersion,
  applyMigrations,
  MigrationService,
  MigrationServiceLive,
  MIGRATIONS,
  getLatestVersion
} from "@tx/core"

function makeTestLayer(db: InstanceType<typeof Database>) {
  const infra = Layer.succeed(SqliteClient, db as ReturnType<typeof Database>)
  return MigrationServiceLive.pipe(Layer.provide(infra))
}

describe("Migration system", () => {
  describe("MIGRATIONS constant", () => {
    it("contains at least one migration", () => {
      expect(MIGRATIONS.length).toBeGreaterThan(0)
    })

    it("migrations are in ascending version order", () => {
      for (let i = 1; i < MIGRATIONS.length; i++) {
        expect(MIGRATIONS[i].version).toBeGreaterThan(MIGRATIONS[i - 1].version)
      }
    })

    it("first migration is version 1", () => {
      expect(MIGRATIONS[0].version).toBe(1)
    })

    it("each migration has description and sql", () => {
      for (const m of MIGRATIONS) {
        expect(m.description).toBeTruthy()
        expect(m.sql).toBeTruthy()
      }
    })
  })

  describe("getLatestVersion", () => {
    it("returns the version of the last migration", () => {
      const latest = getLatestVersion()
      expect(latest).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
    })
  })

  describe("applyMigrations", () => {
    it("applies all migrations to a fresh database", () => {
      const db = new Database(":memory:")
      db.pragma("foreign_keys = ON")

      applyMigrations(db)

      const version = getSchemaVersion(db)
      expect(version).toBe(getLatestVersion())
    })

    it("creates all required tables", () => {
      const db = new Database(":memory:")
      db.pragma("foreign_keys = ON")

      applyMigrations(db)

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).all() as Array<{ name: string }>
      const tableNames = tables.map(t => t.name)

      // Core tables from migration 1
      expect(tableNames).toContain("tasks")
      expect(tableNames).toContain("task_dependencies")
      expect(tableNames).toContain("compaction_log")
      expect(tableNames).toContain("schema_version")

      // Tables from migration 2
      expect(tableNames).toContain("learnings")
      expect(tableNames).toContain("learnings_config")

      // Tables from migration 3
      expect(tableNames).toContain("file_learnings")

      // Tables from migration 8
      expect(tableNames).toContain("learning_anchors")

      // Tables from migration 9
      expect(tableNames).toContain("learning_edges")
    })

    it("creates all required indexes", () => {
      const db = new Database(":memory:")
      db.pragma("foreign_keys = ON")

      applyMigrations(db)

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
      ).all() as Array<{ name: string }>
      const indexNames = indexes.map(i => i.name)

      // Core indexes from migration 1
      expect(indexNames).toContain("idx_tasks_status")
      expect(indexNames).toContain("idx_tasks_parent")
      expect(indexNames).toContain("idx_tasks_score")
      expect(indexNames).toContain("idx_tasks_created")
      expect(indexNames).toContain("idx_deps_blocker")
      expect(indexNames).toContain("idx_deps_blocked")

      // Indexes from migration 2
      expect(indexNames).toContain("idx_learnings_created")
      expect(indexNames).toContain("idx_learnings_source_type")

      // Indexes from migration 3
      expect(indexNames).toContain("idx_file_learnings_pattern")

      // Indexes from migration 8 (learning_anchors)
      expect(indexNames).toContain("idx_learning_anchors_learning_id")
      expect(indexNames).toContain("idx_learning_anchors_file_path")
      expect(indexNames).toContain("idx_learning_anchors_status")

      // Indexes from migration 9 (learning_edges)
      expect(indexNames).toContain("idx_learning_edges_source")
      expect(indexNames).toContain("idx_learning_edges_target")
      expect(indexNames).toContain("idx_learning_edges_type")
      expect(indexNames).toContain("idx_learning_edges_active")
    })

    it("is idempotent (running twice is safe)", () => {
      const db = new Database(":memory:")
      db.pragma("foreign_keys = ON")

      applyMigrations(db)
      applyMigrations(db) // Should not throw

      const version = getSchemaVersion(db)
      expect(version).toBe(getLatestVersion())
    })

    it("only applies pending migrations", () => {
      const db = new Database(":memory:")
      db.pragma("foreign_keys = ON")

      // Apply only first migration manually
      db.exec(MIGRATIONS[0].sql)
      expect(getSchemaVersion(db)).toBe(1)

      // Now apply all migrations - should only apply 2+
      applyMigrations(db)

      expect(getSchemaVersion(db)).toBe(getLatestVersion())
    })
  })

  describe("MigrationService", () => {
    let db: InstanceType<typeof Database>
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = new Database(":memory:")
      db.pragma("foreign_keys = ON")
      // Apply all migrations so the service can query schema_version
      applyMigrations(db)
      layer = makeTestLayer(db)
    })

    describe("getCurrentVersion", () => {
      it("returns the current schema version", async () => {
        const version = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.getCurrentVersion()
          }).pipe(Effect.provide(layer))
        )

        expect(version).toBe(getLatestVersion())
      })

      it("returns 0 for a database without schema_version table", async () => {
        const freshDb = new Database(":memory:")
        const freshLayer = makeTestLayer(freshDb)

        const version = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.getCurrentVersion()
          }).pipe(Effect.provide(freshLayer))
        )

        expect(version).toBe(0)
      })
    })

    describe("getAppliedMigrations", () => {
      it("returns all applied migrations", async () => {
        const applied = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.getAppliedMigrations()
          }).pipe(Effect.provide(layer))
        )

        expect(applied.length).toBe(MIGRATIONS.length)
        for (let i = 0; i < applied.length; i++) {
          expect(applied[i].version).toBe(MIGRATIONS[i].version)
          expect(applied[i].appliedAt).toBeInstanceOf(Date)
        }
      })

      it("returns empty array for fresh database", async () => {
        const freshDb = new Database(":memory:")
        const freshLayer = makeTestLayer(freshDb)

        const applied = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.getAppliedMigrations()
          }).pipe(Effect.provide(freshLayer))
        )

        expect(applied).toEqual([])
      })
    })

    describe("getStatus", () => {
      it("returns correct status for fully migrated database", async () => {
        const status = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.getStatus()
          }).pipe(Effect.provide(layer))
        )

        expect(status.currentVersion).toBe(getLatestVersion())
        expect(status.latestVersion).toBe(getLatestVersion())
        expect(status.pendingCount).toBe(0)
        expect(status.appliedMigrations.length).toBe(MIGRATIONS.length)
        expect(status.pendingMigrations).toEqual([])
      })

      it("returns correct status for partially migrated database", async () => {
        // Create a database with only first migration
        const partialDb = new Database(":memory:")
        partialDb.pragma("foreign_keys = ON")
        partialDb.exec(MIGRATIONS[0].sql)

        const partialLayer = makeTestLayer(partialDb)

        const status = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.getStatus()
          }).pipe(Effect.provide(partialLayer))
        )

        expect(status.currentVersion).toBe(1)
        expect(status.latestVersion).toBe(getLatestVersion())
        expect(status.pendingCount).toBe(MIGRATIONS.length - 1)
        expect(status.appliedMigrations.length).toBe(1)
        expect(status.pendingMigrations.length).toBe(MIGRATIONS.length - 1)
      })
    })

    describe("run", () => {
      it("applies pending migrations and returns count", async () => {
        // Create a database with only first migration
        const partialDb = new Database(":memory:")
        partialDb.pragma("foreign_keys = ON")
        partialDb.exec(MIGRATIONS[0].sql)

        const partialLayer = makeTestLayer(partialDb)

        const count = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.run()
          }).pipe(Effect.provide(partialLayer))
        )

        expect(count).toBe(MIGRATIONS.length - 1)

        // Verify migrations were actually applied
        const version = getSchemaVersion(partialDb)
        expect(version).toBe(getLatestVersion())
      })

      it("returns 0 when no pending migrations", async () => {
        const count = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.run()
          }).pipe(Effect.provide(layer))
        )

        expect(count).toBe(0)
      })
    })
  })

  describe("Schema constraints", () => {
    let db: InstanceType<typeof Database>

    beforeEach(() => {
      db = new Database(":memory:")
      db.pragma("foreign_keys = ON")
      applyMigrations(db)
    })

    it("enforces status CHECK constraint", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run("tx-test01", "Test", "invalid_status", new Date().toISOString(), new Date().toISOString())
      }).toThrow()
    })

    it("enforces self-blocking CHECK constraint", () => {
      const now = new Date().toISOString()
      db.prepare(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run("tx-aaaaaa", "Test", "backlog", now, now)

      expect(() => {
        db.prepare(
          "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
        ).run("tx-aaaaaa", "tx-aaaaaa", now)
      }).toThrow()
    })

    it("enforces unique dependency constraint", () => {
      const now = new Date().toISOString()
      db.prepare(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run("tx-aaaaaa", "Test A", "backlog", now, now)
      db.prepare(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run("tx-bbbbbb", "Test B", "backlog", now, now)

      db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run("tx-aaaaaa", "tx-bbbbbb", now)

      expect(() => {
        db.prepare(
          "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
        ).run("tx-aaaaaa", "tx-bbbbbb", now)
      }).toThrow()
    })

    it("cascades dependency deletion when blocker is deleted", () => {
      const now = new Date().toISOString()
      db.prepare(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run("tx-aaaaaa", "Test A", "backlog", now, now)
      db.prepare(
        "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run("tx-bbbbbb", "Test B", "backlog", now, now)
      db.prepare(
        "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).run("tx-aaaaaa", "tx-bbbbbb", now)

      db.prepare("DELETE FROM tasks WHERE id = ?").run("tx-aaaaaa")

      const deps = db.prepare(
        "SELECT * FROM task_dependencies WHERE blocker_id = ?"
      ).all("tx-aaaaaa")
      expect(deps).toHaveLength(0)
    })

    it("orphans children when parent is deleted (SET NULL)", () => {
      const now = new Date().toISOString()
      db.prepare(
        "INSERT INTO tasks (id, title, status, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("tx-parent", "Parent", "backlog", null, now, now)
      db.prepare(
        "INSERT INTO tasks (id, title, status, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("tx-child1", "Child", "backlog", "tx-parent", now, now)

      db.prepare("DELETE FROM tasks WHERE id = ?").run("tx-parent")

      const child = db.prepare(
        "SELECT parent_id FROM tasks WHERE id = ?"
      ).get("tx-child1") as { parent_id: string | null }
      expect(child.parent_id).toBeNull()
    })

    it("enforces learning_edges edge_type CHECK constraint", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)"
        ).run("INVALID_TYPE", "learning", "1", "file", "src/foo.ts")
      }).toThrow()
    })

    it("enforces learning_edges source_type CHECK constraint", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)"
        ).run("ANCHORED_TO", "invalid_source", "1", "file", "src/foo.ts")
      }).toThrow()
    })

    it("enforces learning_edges target_type CHECK constraint", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)"
        ).run("ANCHORED_TO", "learning", "1", "invalid_target", "src/foo.ts")
      }).toThrow()
    })

    it("enforces learning_edges weight range CHECK constraint", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id, weight) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("ANCHORED_TO", "learning", "1", "file", "src/foo.ts", 1.5)
      }).toThrow()

      expect(() => {
        db.prepare(
          "INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id, weight) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("ANCHORED_TO", "learning", "1", "file", "src/foo.ts", -0.1)
      }).toThrow()
    })

    it("allows valid learning_edges insertions", () => {
      const result = db.prepare(
        "INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id, weight, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("ANCHORED_TO", "learning", "1", "file", "src/foo.ts", 0.8, '{"reason": "test"}')

      expect(result.changes).toBe(1)

      const edge = db.prepare("SELECT * FROM learning_edges WHERE id = ?").get(result.lastInsertRowid) as {
        edge_type: string
        source_type: string
        source_id: string
        target_type: string
        target_id: string
        weight: number
        metadata: string
        invalidated_at: string | null
      }
      expect(edge.edge_type).toBe("ANCHORED_TO")
      expect(edge.source_type).toBe("learning")
      expect(edge.weight).toBe(0.8)
      expect(edge.invalidated_at).toBeNull()
    })

    it("supports soft deletion via invalidated_at", () => {
      const result = db.prepare(
        "INSERT INTO learning_edges (edge_type, source_type, source_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)"
      ).run("SIMILAR_TO", "learning", "1", "learning", "2")

      const edgeId = result.lastInsertRowid

      db.prepare(
        "UPDATE learning_edges SET invalidated_at = datetime('now') WHERE id = ?"
      ).run(edgeId)

      const edge = db.prepare("SELECT invalidated_at FROM learning_edges WHERE id = ?").get(edgeId) as {
        invalidated_at: string | null
      }
      expect(edge.invalidated_at).not.toBeNull()
    })
  })
})
