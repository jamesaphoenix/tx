-- Version: 038
-- Migration: Process registry for multi-worker PID hierarchy tracking
-- Maps orchestrator -> worker -> agent -> tool process relationships in SQLite

CREATE TABLE IF NOT EXISTS process_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid INTEGER NOT NULL,
    parent_pid INTEGER,
    worker_id TEXT REFERENCES workers(id) ON DELETE CASCADE,
    run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('orchestrator', 'worker', 'agent', 'tool', 'renewal')),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    last_heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
    command_hint TEXT,
    UNIQUE(pid, started_at)
);

CREATE INDEX IF NOT EXISTS idx_process_registry_pid ON process_registry(pid);
CREATE INDEX IF NOT EXISTS idx_process_registry_worker ON process_registry(worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_registry_run ON process_registry(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_registry_role ON process_registry(role);
CREATE INDEX IF NOT EXISTS idx_process_registry_alive ON process_registry(ended_at) WHERE ended_at IS NULL;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (38, datetime('now'));
