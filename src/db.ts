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

const MIGRATION_002 = `
-- Learnings table (append-only event log)
CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('compaction', 'run', 'manual', 'claude_md')),
    source_ref TEXT,
    created_at TEXT NOT NULL,
    keywords TEXT,
    category TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    outcome_score REAL,
    embedding BLOB
);

-- FTS5 for BM25 keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    content, keywords, category,
    content='learnings', content_rowid='id',
    tokenize='porter unicode61'
);

-- Triggers to sync FTS on insert
CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts(rowid, content, keywords, category)
    VALUES (new.id, new.content, new.keywords, new.category);
END;

-- Triggers to sync FTS on delete
CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, keywords, category)
    VALUES ('delete', old.id, old.content, old.keywords, old.category);
END;

-- Triggers to sync FTS on update
CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, keywords, category)
    VALUES ('delete', old.id, old.content, old.keywords, old.category);
    INSERT INTO learnings_fts(rowid, content, keywords, category)
    VALUES (new.id, new.content, new.keywords, new.category);
END;

-- Config for retrieval weights
CREATE TABLE IF NOT EXISTS learnings_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO learnings_config (key, value) VALUES
    ('bm25_weight', '0.4'),
    ('vector_weight', '0.4'),
    ('recency_weight', '0.2');

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_source_type ON learnings(source_type);
CREATE INDEX IF NOT EXISTS idx_learnings_usage ON learnings(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_outcome ON learnings(outcome_score DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, datetime('now'));
`

const MIGRATION_003 = `
-- File learnings table (path-based knowledge storage)
CREATE TABLE IF NOT EXISTS file_learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_pattern TEXT NOT NULL,
    note TEXT NOT NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

-- Index for file pattern lookups
CREATE INDEX IF NOT EXISTS idx_file_learnings_pattern ON file_learnings(file_pattern);
CREATE INDEX IF NOT EXISTS idx_file_learnings_created ON file_learnings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_learnings_task ON file_learnings(task_id);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (3, datetime('now'));
`

const getSchemaVersion = (db: Database.Database): number => {
  try {
    const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number } | undefined
    return row?.version ?? 0
  } catch {
    return 0
  }
}

const applyMigrations = (db: Database.Database): void => {
  const currentVersion = getSchemaVersion(db)

  if (currentVersion < 1) {
    db.exec(MIGRATION_001)
  }
  if (currentVersion < 2) {
    db.exec(MIGRATION_002)
  }
  if (currentVersion < 3) {
    db.exec(MIGRATION_003)
  }
}

export const makeSqliteClient = (dbPath: string): Effect.Effect<Database.Database> =>
  Effect.sync(() => {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    return db
  })

export const SqliteClientLive = (dbPath: string) =>
  Layer.effect(
    SqliteClient,
    makeSqliteClient(dbPath)
  )
