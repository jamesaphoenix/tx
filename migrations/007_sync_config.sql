-- Version: 007
-- Migration: Sync config table for JSONL sync daemon settings

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

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (7, datetime('now'));
