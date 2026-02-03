-- Version: 017
-- Migration: Add 'span' and 'metric' event types for PRD-019 execution tracing

-- SQLite doesn't support ALTER CHECK, so we need to recreate the table
-- with the updated constraint that includes 'span' and 'metric' event types

-- Step 1: Create new events table with updated CHECK constraint
CREATE TABLE events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'run_started', 'run_completed', 'run_failed',
        'task_created', 'task_updated', 'task_completed',
        'tool_call', 'tool_result',
        'user_message', 'assistant_message',
        'error', 'learning_captured',
        'commit', 'review',
        'span', 'metric'
    )),
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    agent TEXT,
    tool_name TEXT,
    content TEXT,
    metadata TEXT DEFAULT '{}',
    duration_ms INTEGER
);

-- Step 2: Copy existing data
INSERT INTO events_new (id, timestamp, event_type, run_id, task_id, agent, tool_name, content, metadata, duration_ms)
SELECT id, timestamp, event_type, run_id, task_id, agent, tool_name, content, metadata, duration_ms FROM events;

-- Step 3: Drop old table
DROP TABLE events;

-- Step 4: Rename new table
ALTER TABLE events_new RENAME TO events;

-- Step 5: Recreate indexes (dropped with old table)
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (17, datetime('now'));
