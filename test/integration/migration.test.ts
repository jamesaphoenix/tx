import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { Database } from "bun:sqlite"
import {
  SqliteClient,
  getSchemaVersion,
  applyMigrations,
  MigrationService,
  MigrationServiceLive,
  MIGRATIONS,
  getLatestVersion
} from "@jamesaphoenix/tx-core"
import { fixtureId } from "@jamesaphoenix/tx-test-utils"

const ASSIGNMENT_MIGRATION_VERSION = 24
const ASSIGNMENT_MIGRATION_BACKFILL_MARKER = "migration:024_task_assignment"

function makeTestLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as Database)
  return MigrationServiceLive.pipe(Layer.provide(infra))
}

function applyMigrationsThroughVersion(db: Database, maxVersionInclusive: number) {
  for (const migration of MIGRATIONS) {
    if (migration.version > maxVersionInclusive) {
      break
    }

    db.exec("BEGIN IMMEDIATE")
    try {
      db.exec(migration.sql)
      db.exec(`INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (${migration.version}, datetime('now'))`)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
}

function createPreAssignmentMigrationDb(): Database {
  const db = new Database(":memory:")
  db.run("PRAGMA foreign_keys = ON")
  applyMigrationsThroughVersion(db, ASSIGNMENT_MIGRATION_VERSION - 1)
  return db
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
      db.run("PRAGMA foreign_keys = ON")

      applyMigrations(db)

      const version = getSchemaVersion(db)
      expect(version).toBe(getLatestVersion())
    })

    it("creates all required tables", () => {
      const db = new Database(":memory:")
      db.run("PRAGMA foreign_keys = ON")

      applyMigrations(db)

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'"
      ).all() as Array<{ name: string }>
      const tableNames = tables.map(t => t.name)

      const expectedTables = [
        // Migration 001 — core
        "tasks", "task_dependencies", "compaction_log", "schema_version",
        // Migration 002 — learnings
        "learnings", "learnings_config",
        // Migration 003 — file learnings
        "file_learnings",
        // Migration 004 — attempts
        "attempts",
        // Migration 005 — runs
        "runs",
        // Migration 006/017 — events (rebuilt with span/metric types)
        "events",
        // Migration 007 — sync config
        "sync_config",
        // Migration 008 — learning anchors
        "learning_anchors",
        // Migration 009 — learning edges
        "learning_edges",
        // Migration 010 — learning candidates
        "learning_candidates",
        // Migration 011 — processed hashes + file progress
        "processed_hashes", "file_progress",
        // Migration 012 — invalidation log
        "invalidation_log",
        // Migration 014 — daemon tracked projects
        "daemon_tracked_projects",
        // Migration 015 — worker orchestration
        "workers", "task_claims", "orchestrator_state",
        // Migration 021 — agent outbox
        "outbox_messages",
        // Migration 022 — docs as primitives
        "docs", "doc_links", "task_doc_links", "invariants", "invariant_checks",
        // Migration 023 — task labels
        "task_labels", "task_label_assignments",
        // Migration 025 — run heartbeat state
        "run_heartbeat_state",
      ]

      for (const table of expectedTables) {
        expect(tableNames, `missing table: ${table}`).toContain(table)
      }

      // Ensure the list stays in sync — fail if new tables appear without being added here
      const knownTables = new Set(expectedTables)
      const unknownTables = tableNames.filter(t => !knownTables.has(t))
      expect(unknownTables, `unexpected tables found — add them to expectedTables: ${unknownTables.join(", ")}`).toEqual([])
    })

    it("creates all required indexes", () => {
      const db = new Database(":memory:")
      db.run("PRAGMA foreign_keys = ON")

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

      // Index from migration 19 (tasks updated_at for sync dirty detection)
      expect(indexNames).toContain("idx_tasks_updated")

      // Indexes from migration 26 (task list ordering for dashboard polling)
      expect(indexNames).toContain("idx_tasks_score_id")
      expect(indexNames).toContain("idx_tasks_status_score_id")

      // Indexes from migration 24 (task assignment)
      expect(indexNames).toContain("idx_tasks_assignee_type")
      expect(indexNames).toContain("idx_tasks_assignee_type_id")

      // Indexes from migration 25 (run heartbeat state)
      expect(indexNames).toContain("idx_run_heartbeat_check_at")
      expect(indexNames).toContain("idx_run_heartbeat_activity_at")
    })

    it("uses composite task-order indexes without temp B-tree for dashboard task list query shapes", () => {
      const db = new Database(":memory:")
      db.run("PRAGMA foreign_keys = ON")
      applyMigrations(db)

      const insertTask = db.prepare(
        "INSERT INTO tasks (id, title, status, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      const nowIso = new Date().toISOString()

      // Seed enough rows with repeated scores to exercise ORDER BY tie-breaking.
      for (let i = 0; i < 120; i++) {
        const status = i < 90 ? "done" : "ready"
        const score = 100 - (i % 10)
        insertTask.run(
          fixtureId(`migration-026-task-${i}`),
          `Task ${i}`,
          status,
          score,
          nowIso,
          nowIso
        )
      }

      const unfilteredPlan = db.prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM tasks ORDER BY score DESC, id ASC LIMIT ?"
      ).all(20) as Array<{ detail: string }>
      const unfilteredPlanDetails = unfilteredPlan.map(row => row.detail).join(" | ")

      expect(unfilteredPlanDetails).toContain("idx_tasks_score_id")
      expect(unfilteredPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")

      const filteredPlan = db.prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE status IN (?) ORDER BY score DESC, id ASC LIMIT ?"
      ).all("ready", 20) as Array<{ detail: string }>
      const filteredPlanDetails = filteredPlan.map(row => row.detail).join(" | ")

      expect(filteredPlanDetails).toContain("idx_tasks_status_score_id")
      expect(filteredPlanDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY")
    })

    it("is idempotent (running twice is safe)", () => {
      const db = new Database(":memory:")
      db.run("PRAGMA foreign_keys = ON")

      applyMigrations(db)
      applyMigrations(db) // Should not throw

      const version = getSchemaVersion(db)
      expect(version).toBe(getLatestVersion())
    })

    it("only applies pending migrations", () => {
      const db = new Database(":memory:")
      db.run("PRAGMA foreign_keys = ON")

      // Apply only first migration manually
      db.exec(MIGRATIONS[0].sql)
      expect(getSchemaVersion(db)).toBe(1)

      // Now apply all migrations - should only apply 2+
      applyMigrations(db)

      expect(getSchemaVersion(db)).toBe(getLatestVersion())
    })

    it("rolls back on migration failure (no partial state)", () => {
      // Create a fresh DB with only migration 1 to test rollback
      const freshDb = new Database(":memory:")
      freshDb.run("PRAGMA foreign_keys = ON")
      freshDb.exec(MIGRATIONS[0].sql)
      expect(getSchemaVersion(freshDb)).toBe(1)

      // Intercept exec to fail during the second migration's SQL
      const origExec = freshDb.exec.bind(freshDb)
      let migrationExecCount = 0
      freshDb.exec = ((sql: string) => {
        // Let BEGIN IMMEDIATE and COMMIT/ROLLBACK through
        if (sql === "BEGIN IMMEDIATE" || sql === "COMMIT" || sql === "ROLLBACK") {
          return origExec(sql)
        }
        migrationExecCount++
        if (migrationExecCount === 1) {
          // First migration SQL (version 2) — make it fail partway
          // by injecting invalid SQL after the real SQL
          throw new Error("Simulated migration failure")
        }
        return origExec(sql)
      }) as typeof freshDb.exec

      // applyMigrations should throw
      expect(() => applyMigrations(freshDb)).toThrow("Simulated migration failure")

      // Restore exec for verification
      freshDb.exec = origExec

      // Schema version should still be 1 (migration 2 was rolled back)
      expect(getSchemaVersion(freshDb)).toBe(1)

      // The learnings table (from migration 2) should NOT exist
      const tables = freshDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='learnings'"
      ).all()
      expect(tables).toHaveLength(0)
    })

    describe("migration 024 task assignment", () => {
      it("adds assignment columns and indexes when migrating from version 23", () => {
        const db = createPreAssignmentMigrationDb()
        expect(getSchemaVersion(db)).toBe(ASSIGNMENT_MIGRATION_VERSION - 1)

        applyMigrations(db)

        const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>
        const columnNames = taskColumns.map((column) => column.name)

        expect(columnNames).toContain("assignee_type")
        expect(columnNames).toContain("assignee_id")
        expect(columnNames).toContain("assigned_at")
        expect(columnNames).toContain("assigned_by")

        const indexes = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_tasks_assignee_type', 'idx_tasks_assignee_type_id')"
        ).all() as Array<{ name: string }>
        const indexNames = indexes.map((index) => index.name)

        expect(indexNames).toContain("idx_tasks_assignee_type")
        expect(indexNames).toContain("idx_tasks_assignee_type_id")
      })

      it("backfills legacy tasks with agent assignment defaults", () => {
        const db = createPreAssignmentMigrationDb()
        const now = new Date().toISOString()
        const legacyTaskA = fixtureId("migration-024-backfill-legacy-task-a")
        const legacyTaskB = fixtureId("migration-024-backfill-legacy-task-b")

        db.prepare(
          "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(legacyTaskA, "Legacy task A", "backlog", now, now)
        db.prepare(
          "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(legacyTaskB, "Legacy task B", "active", now, now)

        applyMigrations(db)

        const rows = db.prepare(
          `SELECT id, assignee_type, assignee_id, assigned_at, assigned_by
           FROM tasks
           WHERE id IN (?, ?)
           ORDER BY id`
        ).all(legacyTaskA, legacyTaskB) as Array<{
          id: string
          assignee_type: string | null
          assignee_id: string | null
          assigned_at: string | null
          assigned_by: string | null
        }>

        expect(rows).toHaveLength(2)
        for (const row of rows) {
          expect(row.assignee_type).toBe("agent")
          expect(row.assignee_id).toBeNull()
          expect(row.assigned_by).toBe(ASSIGNMENT_MIGRATION_BACKFILL_MARKER)
          expect(row.assigned_at).toBeTruthy()
        }
      })

      it("is idempotent when migration application is retried", () => {
        const db = createPreAssignmentMigrationDb()
        const now = new Date().toISOString()
        const legacyTask = fixtureId("migration-024-idempotent-legacy-task")

        db.prepare(
          "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(legacyTask, "Legacy idempotency task", "ready", now, now)

        applyMigrations(db)

        const selectAssignment = db.prepare(
          "SELECT assignee_type, assignee_id, assigned_at, assigned_by FROM tasks WHERE id = ?"
        )

        const assignmentAfterFirstRun = selectAssignment.get(legacyTask) as {
          assignee_type: string | null
          assignee_id: string | null
          assigned_at: string | null
          assigned_by: string | null
        }

        applyMigrations(db)

        const assignmentAfterSecondRun = selectAssignment.get(legacyTask) as {
          assignee_type: string | null
          assignee_id: string | null
          assigned_at: string | null
          assigned_by: string | null
        }
        const migrationVersionRows = db.prepare(
          "SELECT COUNT(*) as count FROM schema_version WHERE version = ?"
        ).get(ASSIGNMENT_MIGRATION_VERSION) as { count: number }

        expect(assignmentAfterFirstRun.assignee_type).toBe("agent")
        expect(assignmentAfterFirstRun.assignee_id).toBeNull()
        expect(assignmentAfterFirstRun.assigned_by).toBe(ASSIGNMENT_MIGRATION_BACKFILL_MARKER)
        expect(assignmentAfterSecondRun).toEqual(assignmentAfterFirstRun)
        expect(migrationVersionRows.count).toBe(1)
      })
    })
  })

  describe("MigrationService", () => {
    let db: Database
    let layer: ReturnType<typeof makeTestLayer>

    beforeEach(() => {
      db = new Database(":memory:")
      db.run("PRAGMA foreign_keys = ON")
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
        partialDb.run("PRAGMA foreign_keys = ON")
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
        partialDb.run("PRAGMA foreign_keys = ON")
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

      it("rolls back on failure and leaves schema version unchanged", async () => {
        const partialDb = new Database(":memory:")
        partialDb.run("PRAGMA foreign_keys = ON")
        partialDb.exec(MIGRATIONS[0].sql)
        expect(getSchemaVersion(partialDb)).toBe(1)

        // Intercept exec to fail during the second migration
        const origExec = partialDb.exec.bind(partialDb)
        let migrationExecCount = 0
        partialDb.exec = ((sql: string) => {
          if (sql === "BEGIN IMMEDIATE" || sql === "COMMIT" || sql === "ROLLBACK") {
            return origExec(sql)
          }
          migrationExecCount++
          if (migrationExecCount === 1) {
            throw new Error("Simulated service migration failure")
          }
          return origExec(sql)
        }) as typeof partialDb.exec

        const partialLayer = makeTestLayer(partialDb)

        const result = await Effect.runPromiseExit(
          Effect.gen(function* () {
            const svc = yield* MigrationService
            return yield* svc.run()
          }).pipe(Effect.provide(partialLayer))
        )

        // Should have failed
        expect(result._tag).toBe("Failure")

        // Restore exec for verification
        partialDb.exec = origExec

        // Schema version should still be 1
        expect(getSchemaVersion(partialDb)).toBe(1)

        // learnings table should not exist
        const tables = partialDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='learnings'"
        ).all()
        expect(tables).toHaveLength(0)
      })
    })
  })

  describe("Schema constraints", () => {
    let db: Database

    beforeEach(() => {
      db = new Database(":memory:")
      db.run("PRAGMA foreign_keys = ON")
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

    describe("task ID format validation (migration 020)", () => {
      const now = new Date().toISOString()

      it("rejects task ID without tx- prefix", () => {
        expect(() => {
          db.prepare(
            "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          ).run("bad-id", "Test", "backlog", now, now)
        }).toThrow("Task ID must match format")
      })

      it("rejects empty task ID", () => {
        expect(() => {
          db.prepare(
            "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          ).run("", "Test", "backlog", now, now)
        }).toThrow("Task ID must match format")
      })

      it("rejects task ID with tx- prefix but too few characters", () => {
        expect(() => {
          db.prepare(
            "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          ).run("tx-abc", "Test", "backlog", now, now)
        }).toThrow("Task ID must match format")
      })

      it("rejects task ID with uppercase characters", () => {
        expect(() => {
          db.prepare(
            "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          ).run("tx-ABCDEF", "Test", "backlog", now, now)
        }).toThrow("Task ID must match format")
      })

      it("rejects task ID with special characters after prefix", () => {
        expect(() => {
          db.prepare(
            "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          ).run("tx-abc!@#", "Test", "backlog", now, now)
        }).toThrow("Task ID must match format")
      })

      it("accepts valid 8-char hex ID (deterministicId format)", () => {
        const result = db.prepare(
          "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run("tx-a1b2c3d4", "Test", "backlog", now, now)
        expect(result.changes).toBe(1)
      })

      it("accepts valid 12-char hex ID (generateTaskId format)", () => {
        const result = db.prepare(
          "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run("tx-a1b2c3d4e5f6", "Test", "backlog", now, now)
        expect(result.changes).toBe(1)
      })

      it("accepts valid 6-char minimum ID", () => {
        const result = db.prepare(
          "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run("tx-abcdef", "Test", "backlog", now, now)
        expect(result.changes).toBe(1)
      })

      it("rejects malformed ID on direct SQL insert (JSONL import attack vector)", () => {
        expect(() => {
          db.prepare(
            "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          ).run("malicious-id-injection", "Malicious", "backlog", now, now)
        }).toThrow("Task ID must match format")
      })
    })
  })
})
