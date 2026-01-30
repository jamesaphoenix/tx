-- Version: 006
-- Migration: Events table for append-only activity tracking

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

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (6, datetime('now'));
