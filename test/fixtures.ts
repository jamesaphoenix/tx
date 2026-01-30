import Database from "better-sqlite3"
import { createHash } from "crypto"
import type { TaskId } from "../src/schema.js"

// Deterministic SHA256-based IDs for reproducible tests (Rule 3)
export const fixtureId = (name: string): TaskId => {
  const hash = createHash("sha256")
    .update(`fixture:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}` as TaskId
}

export const FIXTURES = {
  TASK_AUTH:    fixtureId("auth"),
  TASK_LOGIN:   fixtureId("login"),
  TASK_JWT:     fixtureId("jwt"),
  TASK_BLOCKED: fixtureId("blocked"),
  TASK_DONE:    fixtureId("done"),
  TASK_ROOT:    fixtureId("root"),
} as const

const MIGRATION_SQL = `
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

const MIGRATION_002_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_source_type ON learnings(source_type);
CREATE INDEX IF NOT EXISTS idx_learnings_usage ON learnings(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_outcome ON learnings(outcome_score DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, datetime('now'));
`

export function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  db.exec(MIGRATION_SQL)
  db.exec(MIGRATION_002_SQL)
  return db
}

export function seedFixtures(db: InstanceType<typeof Database>): void {
  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const insertDep = db.prepare(
    `INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
  )

  // Root task (no parent)
  insert.run(FIXTURES.TASK_ROOT, "Root project", "The root task", "backlog", null, 1000, now, now, null, "{}")

  // Auth task (parent: root)
  insert.run(FIXTURES.TASK_AUTH, "Implement auth", "Authentication system", "backlog", FIXTURES.TASK_ROOT, 800, now, now, null, "{}")

  // Login task (parent: auth, ready status)
  insert.run(FIXTURES.TASK_LOGIN, "Login page", "Build login UI", "ready", FIXTURES.TASK_AUTH, 600, now, now, null, "{}")

  // JWT task (parent: auth, ready status, no blockers)
  insert.run(FIXTURES.TASK_JWT, "JWT validation", "Validate JWT tokens", "ready", FIXTURES.TASK_AUTH, 700, now, now, null, "{}")

  // Blocked task (parent: auth, blocked by JWT and LOGIN)
  insert.run(FIXTURES.TASK_BLOCKED, "Integration tests", "Test everything", "backlog", FIXTURES.TASK_AUTH, 500, now, now, null, "{}")

  // Done task (parent: auth)
  insert.run(FIXTURES.TASK_DONE, "Setup project", "Initial setup", "done", FIXTURES.TASK_AUTH, 900, now, now, now, "{}")

  // Dependencies: TASK_BLOCKED is blocked by TASK_JWT and TASK_LOGIN
  insertDep.run(FIXTURES.TASK_JWT, FIXTURES.TASK_BLOCKED, now)
  insertDep.run(FIXTURES.TASK_LOGIN, FIXTURES.TASK_BLOCKED, now)
}
