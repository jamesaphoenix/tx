-- Version: 014
-- Migration: Daemon tracked projects for opt-in project monitoring (PRD-015)

-- Tracked projects for the daemon to watch for JSONL transcript processing
-- Users explicitly opt-in projects via `tx daemon track <path>`
CREATE TABLE IF NOT EXISTS daemon_tracked_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path TEXT NOT NULL UNIQUE,
    project_id TEXT,
    source_type TEXT DEFAULT 'claude' CHECK (source_type IN ('claude', 'cursor', 'windsurf', 'other')),
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

-- Index for efficient enabled project queries
CREATE INDEX IF NOT EXISTS idx_daemon_tracked_projects_enabled
    ON daemon_tracked_projects(enabled) WHERE enabled = 1;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (14, datetime('now'));
