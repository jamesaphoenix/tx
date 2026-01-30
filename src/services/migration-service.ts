import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"

/**
 * Describes a single database migration.
 */
export interface Migration {
  readonly version: number
  readonly description: string
  readonly sql: string
}

/**
 * Information about an applied migration.
 */
export interface AppliedMigration {
  readonly version: number
  readonly appliedAt: Date
}

/**
 * Migration status including current version and pending migrations.
 */
export interface MigrationStatus {
  readonly currentVersion: number
  readonly latestVersion: number
  readonly pendingCount: number
  readonly appliedMigrations: readonly AppliedMigration[]
  readonly pendingMigrations: readonly Migration[]
}

/**
 * All migrations in version order.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: "Initial schema - tasks, dependencies, compaction_log",
    sql: `
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
  },
  {
    version: 2,
    description: "Learnings table with FTS5 for BM25 search",
    sql: `
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
  },
  {
    version: 3,
    description: "File learnings table for path-based knowledge",
    sql: `
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
  },
  {
    version: 4,
    description: "Attempts table for tracking task attempt outcomes",
    sql: `
-- Attempts table (track failed/succeeded approaches per task)
CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    approach TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('failed', 'succeeded')),
    reason TEXT,
    created_at TEXT NOT NULL
);

-- Index for task_id lookups
CREATE INDEX IF NOT EXISTS idx_attempts_task_id ON attempts(task_id);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (4, datetime('now'));
`
  },
  {
    version: 5,
    description: "Runs table for tracking Claude agent sessions",
    sql: `
-- Runs table (track each Claude agent session)
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,                -- run-<sha8>
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    agent TEXT NOT NULL,                -- tx-implementer, tx-decomposer, etc.
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'timeout', 'cancelled')),
    exit_code INTEGER,
    pid INTEGER,                        -- OS process ID
    transcript_path TEXT,               -- Path to conversation .jsonl file
    context_injected TEXT,              -- Path to context.md that was injected
    summary TEXT,                       -- LLM-generated summary of what happened
    error_message TEXT,                 -- If failed, why
    metadata TEXT DEFAULT '{}'          -- JSON: git_sha, branch, iteration, etc.
);

-- Link learnings to runs (which run produced this learning?)
-- Note: learnings table already exists, just adding the column
ALTER TABLE learnings ADD COLUMN run_id TEXT REFERENCES runs(id) ON DELETE SET NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent);
CREATE INDEX IF NOT EXISTS idx_learnings_run ON learnings(run_id);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (5, datetime('now'));
`
  },
  {
    version: 6,
    description: "Events table for append-only activity tracking",
    sql: `
-- Events table (append-only log of all activity for replay/analysis)
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'run_started', 'run_completed', 'run_failed',
        'task_created', 'task_updated', 'task_completed',
        'tool_call', 'tool_result',
        'user_message', 'assistant_message',
        'error', 'learning_captured',
        'commit', 'review'
    )),
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    agent TEXT,
    tool_name TEXT,
    content TEXT,
    metadata TEXT DEFAULT '{}',
    duration_ms INTEGER
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (6, datetime('now'));
`
  },
  {
    version: 7,
    description: "Sync config table for JSONL sync daemon settings",
    sql: `
-- Sync config table (key-value store for sync settings)
CREATE TABLE IF NOT EXISTS sync_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Default values
INSERT OR IGNORE INTO sync_config (key, value, updated_at) VALUES
    ('auto_sync', 'false', datetime('now')),
    ('last_export', '', datetime('now')),
    ('last_import', '', datetime('now'));

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (7, datetime('now'));
`
  }
]

/**
 * Get the latest migration version.
 */
export const getLatestVersion = (): number => {
  if (MIGRATIONS.length === 0) return 0
  return MIGRATIONS[MIGRATIONS.length - 1].version
}

/**
 * MigrationService manages database schema migrations.
 * Follows Effect-TS patterns per DD-002.
 */
export class MigrationService extends Context.Tag("MigrationService")<
  MigrationService,
  {
    /**
     * Get the current migration status.
     * Returns current version, latest version, and pending migrations.
     */
    readonly getStatus: () => Effect.Effect<MigrationStatus, DatabaseError>

    /**
     * Apply all pending migrations.
     * Returns the number of migrations applied.
     * Note: Migrations are also applied automatically when the database is opened.
     */
    readonly run: () => Effect.Effect<number, DatabaseError>

    /**
     * Get the current schema version from the database.
     */
    readonly getCurrentVersion: () => Effect.Effect<number, DatabaseError>

    /**
     * Get all applied migrations.
     */
    readonly getAppliedMigrations: () => Effect.Effect<readonly AppliedMigration[], DatabaseError>
  }
>() {}

export const MigrationServiceLive = Layer.effect(
  MigrationService,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    const getCurrentVersion = (): Effect.Effect<number, DatabaseError> =>
      Effect.try({
        try: () => {
          try {
            const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number } | undefined
            return row?.version ?? 0
          } catch {
            // Table doesn't exist yet
            return 0
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const getAppliedMigrations = (): Effect.Effect<readonly AppliedMigration[], DatabaseError> =>
      Effect.try({
        try: () => {
          try {
            const rows = db.prepare("SELECT version, applied_at FROM schema_version ORDER BY version").all() as Array<{ version: number; applied_at: string }>
            return rows.map(row => ({
              version: row.version,
              appliedAt: new Date(row.applied_at)
            }))
          } catch {
            // Table doesn't exist yet
            return []
          }
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    return {
      getCurrentVersion,

      getAppliedMigrations,

      getStatus: () =>
        Effect.gen(function* () {
          const currentVersion = yield* getCurrentVersion()
          const latestVersion = getLatestVersion()
          const appliedMigrations = yield* getAppliedMigrations()
          const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion)

          return {
            currentVersion,
            latestVersion,
            pendingCount: pendingMigrations.length,
            appliedMigrations,
            pendingMigrations
          }
        }),

      run: () =>
        Effect.gen(function* () {
          const currentVersion = yield* getCurrentVersion()
          const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion)

          for (const migration of pendingMigrations) {
            yield* Effect.try({
              try: () => db.exec(migration.sql),
              catch: (cause) => new DatabaseError({ cause })
            })
          }

          return pendingMigrations.length
        })
    }
  })
)
