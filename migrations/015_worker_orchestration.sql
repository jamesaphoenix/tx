-- Version: 015
-- Migration: Worker orchestration system (PRD-018)
-- Implements k8s-style worker orchestration with heartbeats, leases, and reconciliation

-- Workers table: registered worker processes
CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    pid INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'starting'
        CHECK (status IN ('starting', 'idle', 'busy', 'stopping', 'dead')),
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
    current_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    capabilities TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}'
);

-- Task claims table: lease-based task ownership
CREATE TABLE IF NOT EXISTS task_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
    lease_expires_at TEXT NOT NULL,
    renewed_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'released', 'expired', 'completed'))
);

-- Orchestrator state table: singleton state for the orchestrator
-- Uses CHECK constraint to enforce singleton (only id=1 allowed)
CREATE TABLE IF NOT EXISTS orchestrator_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'stopped'
        CHECK (status IN ('stopped', 'starting', 'running', 'stopping')),
    pid INTEGER,
    started_at TEXT,
    last_reconcile_at TEXT,
    worker_pool_size INTEGER NOT NULL DEFAULT 1,
    reconcile_interval_seconds INTEGER NOT NULL DEFAULT 60,
    heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 30,
    lease_duration_minutes INTEGER NOT NULL DEFAULT 30,
    metadata TEXT NOT NULL DEFAULT '{}'
);

-- Indexes for workers
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
CREATE INDEX IF NOT EXISTS idx_workers_last_heartbeat ON workers(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_workers_current_task ON workers(current_task_id) WHERE current_task_id IS NOT NULL;

-- Indexes for task_claims
CREATE INDEX IF NOT EXISTS idx_claims_task_id ON task_claims(task_id);
CREATE INDEX IF NOT EXISTS idx_claims_worker_id ON task_claims(worker_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON task_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_expires ON task_claims(lease_expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_claims_active_task ON task_claims(task_id, status) WHERE status = 'active';

-- Insert initial orchestrator state (singleton row)
INSERT OR IGNORE INTO orchestrator_state (id, status) VALUES (1, 'stopped');

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (15, datetime('now'));
