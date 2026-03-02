-- Version: 030
-- Migration: Context pins — named content blocks for agent context files

-- Context pins table (named markdown blocks synced to CLAUDE.md, AGENTS.md, etc.)
CREATE TABLE IF NOT EXISTS context_pins (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pins_updated ON context_pins(updated_at DESC);

-- Global config for pin target files (key-value store)
CREATE TABLE IF NOT EXISTS pin_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Default: sync pins to CLAUDE.md only (user configures via `tx pin targets`)
INSERT OR IGNORE INTO pin_config (key, value) VALUES ('target_files', '["CLAUDE.md"]');

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (30, datetime('now'));
