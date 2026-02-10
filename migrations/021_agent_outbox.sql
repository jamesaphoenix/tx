-- Migration 021: Agent Outbox Messaging (PRD-024)
--
-- Channel-based agent-to-agent messaging primitive.
-- Two-state lifecycle: pending -> acked
-- Read-only inbox with cursor-based fan-out.

CREATE TABLE IF NOT EXISTS outbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'acked')),
    correlation_id TEXT,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    acked_at TEXT,
    expires_at TEXT
);

-- Primary query path: inbox reads by channel + cursor (id > ?)
CREATE INDEX IF NOT EXISTS idx_outbox_channel_id ON outbox_messages(channel, id);
-- Filter by status (pending vs acked)
CREATE INDEX IF NOT EXISTS idx_outbox_channel_status ON outbox_messages(channel, status);
-- Request/reply pattern
CREATE INDEX IF NOT EXISTS idx_outbox_correlation ON outbox_messages(correlation_id) WHERE correlation_id IS NOT NULL;
-- Task-scoped messages
CREATE INDEX IF NOT EXISTS idx_outbox_task_id ON outbox_messages(task_id) WHERE task_id IS NOT NULL;
-- TTL cleanup
CREATE INDEX IF NOT EXISTS idx_outbox_expires ON outbox_messages(expires_at) WHERE expires_at IS NOT NULL;
