-- Version: 016
-- Migration: Add stderr_path and stdout_path to runs table for PRD-019 execution tracing

-- Add stderr capture path (optional, orchestrator decides whether to capture)
ALTER TABLE runs ADD COLUMN stderr_path TEXT;

-- Add stdout capture path (optional, orchestrator decides whether to capture)
ALTER TABLE runs ADD COLUMN stdout_path TEXT;

-- Note: transcript_path already exists from migration 005

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (16, datetime('now'));
