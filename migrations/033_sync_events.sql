-- Version: 033
-- Migration: Event-sourced sync foundation

CREATE TABLE IF NOT EXISTS sync_events (
  event_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 2,
  payload TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(stream_id, seq)
);

CREATE TABLE IF NOT EXISTS sync_streams (
  stream_id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seq INTEGER NOT NULL DEFAULT 0,
  last_event_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_watermark (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_ts_event ON sync_events(ts, event_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_entity ON sync_events(entity_id);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (33, datetime('now'));
