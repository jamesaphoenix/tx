-- Version: 044
-- Migration: Worker supervision sessions for Ralph dashboard (DD-039)
-- Adds a first-class supervision snapshot alongside the existing workers table

CREATE TABLE IF NOT EXISTS worker_sessions (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    scope_mode TEXT NOT NULL CHECK (scope_mode IN ('all', 'design-doc')),
    scope_ref TEXT,
    orchestrator TEXT NOT NULL CHECK (orchestrator IN ('ralph')),
    runtime TEXT NOT NULL CHECK (runtime IN ('claude', 'codex', 'custom', 'pi')),
    terminal_backend TEXT NOT NULL CHECK (terminal_backend IN ('tmux')),
    tmux_session_name TEXT,
    tmux_window_name TEXT,
    tmux_pane_id TEXT,
    control_mode TEXT NOT NULL CHECK (
        control_mode IN ('agent', 'human_paused', 'human_attached', 'detached', 'ended')
    ),
    current_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    current_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    active_terminal_controller TEXT,
    started_at TEXT NOT NULL,
    last_heartbeat_at TEXT NOT NULL,
    ended_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
);

-- At most one live session per worker
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_sessions_live_worker
    ON worker_sessions(worker_id)
    WHERE ended_at IS NULL;

-- Live sessions ordered by heartbeat freshness
CREATE INDEX IF NOT EXISTS idx_worker_sessions_live
    ON worker_sessions(ended_at, last_heartbeat_at DESC);

-- Scope filtering for design-doc scoped sessions
CREATE INDEX IF NOT EXISTS idx_worker_sessions_scope
    ON worker_sessions(scope_mode, scope_ref)
    WHERE ended_at IS NULL;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (44, datetime('now'));
