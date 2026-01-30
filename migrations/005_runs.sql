-- Version: 005
-- Migration: Runs table for tracking Claude agent sessions

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

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (5, datetime('now'));
