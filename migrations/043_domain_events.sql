-- Version: 043
-- Migration: Canonical domain event ledger for supervision and review lifecycle
-- Implements DD-039 domain event architecture (append-only business event store)

CREATE TABLE IF NOT EXISTS domain_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    occurred_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    correlation_id TEXT,
    causation_id TEXT,
    actor_type TEXT,
    actor_id TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_domain_events_stream
    ON domain_events(stream_type, stream_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate
    ON domain_events(aggregate_type, aggregate_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_type_time
    ON domain_events(event_type, occurred_at DESC, id DESC);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (43, datetime('now'));
