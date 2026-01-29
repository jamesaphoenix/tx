import { Context, Effect, Layer } from "effect"
import Database from "better-sqlite3"
import { mkdirSync, existsSync } from "fs"
import { dirname } from "path"

/** The SqliteClient service provides a better-sqlite3 Database instance. */
export class SqliteClient extends Context.Tag("SqliteClient")<
  SqliteClient,
  ReturnType<typeof Database>
>() {}

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog'
        CHECK (status IN (
            'backlog', 'ready', 'planning', 'active',
            'blocked', 'review', 'human_needs_to_review', 'done'
        )),
    parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS task_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
);

CREATE TABLE IF NOT EXISTS compaction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compacted_at TEXT NOT NULL,
    task_count INTEGER NOT NULL,
    summary TEXT NOT NULL,
    task_ids TEXT NOT NULL,
    learnings_exported_to TEXT
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_score ON tasks(score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_deps_blocker ON task_dependencies(blocker_id);
CREATE INDEX IF NOT EXISTS idx_deps_blocked ON task_dependencies(blocked_id);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, datetime('now'));
`

export const makeSqliteClient = (dbPath: string): Effect.Effect<Database.Database> =>
  Effect.sync(() => {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")
    db.exec(MIGRATION_001)
    return db
  })

export const SqliteClientLive = (dbPath: string) =>
  Layer.effect(
    SqliteClient,
    makeSqliteClient(dbPath)
  )
