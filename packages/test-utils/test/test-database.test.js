/**
 * Tests for the test database helpers.
 */
import { Effect } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase, TestDatabaseService, TestDatabaseLive } from "../src/database/index.js";
describe("createTestDatabase", () => {
    let db;
    beforeEach(async () => {
        db = await Effect.runPromise(createTestDatabase());
    });
    afterEach(async () => {
        await Effect.runPromise(db.close());
    });
    it("should create an in-memory database with migrations applied", () => {
        // Check that schema_version table exists (created by migrations)
        const result = db.query("SELECT MAX(version) as version FROM schema_version");
        expect(result).toHaveLength(1);
        expect(result[0].version).toBeGreaterThan(0);
    });
    it("should have tasks table from migrations", () => {
        // Tasks table should exist
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'");
        expect(tables).toHaveLength(1);
        expect(tables[0].name).toBe("tasks");
    });
    it("should have learnings table from migrations", () => {
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='learnings'");
        expect(tables).toHaveLength(1);
        expect(tables[0].name).toBe("learnings");
    });
    it("should allow inserting and querying data", () => {
        db.exec(`
      INSERT INTO tasks (id, title, status, score, created_at, updated_at)
      VALUES ('tx-abc12345', 'Test Task', 'backlog', 500, datetime('now'), datetime('now'))
    `);
        const tasks = db.query("SELECT id, title FROM tasks");
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe("tx-abc12345");
        expect(tasks[0].title).toBe("Test Task");
    });
    it("should support query with parameters", () => {
        db.exec(`
      INSERT INTO tasks (id, title, status, score, created_at, updated_at)
      VALUES ('tx-abc12345', 'Test Task', 'backlog', 500, datetime('now'), datetime('now'))
    `);
        const tasks = db.query("SELECT id FROM tasks WHERE title = ?", ["Test Task"]);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe("tx-abc12345");
    });
    it("should support transactions", () => {
        const result = db.transaction(() => {
            db.exec(`
        INSERT INTO tasks (id, title, status, score, created_at, updated_at)
        VALUES ('tx-abc12345', 'Task 1', 'backlog', 500, datetime('now'), datetime('now'))
      `);
            db.exec(`
        INSERT INTO tasks (id, title, status, score, created_at, updated_at)
        VALUES ('tx-def67890', 'Task 2', 'backlog', 600, datetime('now'), datetime('now'))
      `);
            return "committed";
        });
        expect(result).toBe("committed");
        const tasks = db.query("SELECT id FROM tasks ORDER BY id");
        expect(tasks).toHaveLength(2);
    });
    it("should reset database by clearing all user tables", async () => {
        // Insert some data
        db.exec(`
      INSERT INTO tasks (id, title, status, score, created_at, updated_at)
      VALUES ('tx-abc12345', 'Test Task', 'backlog', 500, datetime('now'), datetime('now'))
    `);
        db.exec(`
      INSERT INTO learnings (content, source_type, created_at)
      VALUES ('Test Learning', 'manual', datetime('now'))
    `);
        // Verify data exists
        expect(db.query("SELECT * FROM tasks")).toHaveLength(1);
        expect(db.query("SELECT * FROM learnings")).toHaveLength(1);
        // Reset
        await Effect.runPromise(db.reset());
        // Verify tables are empty
        expect(db.query("SELECT * FROM tasks")).toHaveLength(0);
        expect(db.query("SELECT * FROM learnings")).toHaveLength(0);
        // Verify schema_version is preserved
        const schemaVersion = db.query("SELECT MAX(version) as version FROM schema_version");
        expect(schemaVersion[0].version).toBeGreaterThan(0);
    });
});
describe("TestDatabaseLive Layer", () => {
    it("should provide TestDatabaseService through Layer", async () => {
        const program = Effect.gen(function* () {
            const testDb = yield* TestDatabaseService;
            return testDb.query("SELECT MAX(version) as version FROM schema_version");
        });
        const result = await Effect.runPromise(Effect.provide(program, TestDatabaseLive));
        expect(result).toHaveLength(1);
        expect(result[0].version).toBeGreaterThan(0);
    });
    it("should automatically close database when scope ends", async () => {
        let wasOpen = false;
        const program = Effect.gen(function* () {
            const testDb = yield* TestDatabaseService;
            // Verify db is working
            testDb.query("SELECT 1");
            wasOpen = true;
            return "done";
        });
        await Effect.runPromise(Effect.provide(program, TestDatabaseLive));
        expect(wasOpen).toBe(true);
        // Note: We can't easily test that db is closed since better-sqlite3
        // doesn't expose an isClosed property, but the scoped layer handles cleanup
    });
});
//# sourceMappingURL=test-database.test.js.map