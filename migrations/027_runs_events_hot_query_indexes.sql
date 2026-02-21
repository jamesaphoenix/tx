-- Version: 027
-- Migration: Add runs/events composite + expression indexes for watchdog/dashboard trace hot paths
--
-- Targets:
-- 1) runs list/filter/sort queries:
--      ORDER BY started_at DESC, id ASC
--      optional WHERE status = ? or agent = ?
-- 2) orphan-active task checks:
--      EXISTS/NOT EXISTS on runs(task_id, status='running')
-- 3) watchdog worker burst checks:
--      json_extract(metadata, '$.worker') + status + started_at window
-- 4) trace error spans:
--      events WHERE event_type='span' AND json_extract(metadata, '$.status')='error'
--      ORDER BY timestamp DESC LIMIT ?

CREATE INDEX IF NOT EXISTS idx_runs_started_id
  ON runs(started_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_runs_status_started_id
  ON runs(status, started_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_runs_agent_started_id
  ON runs(agent, started_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_runs_task_status
  ON runs(task_id, status);

CREATE INDEX IF NOT EXISTS idx_runs_worker_status_started
  ON runs(json_extract(metadata, '$.worker'), status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_type_metadata_status_timestamp
  ON events(event_type, json_extract(metadata, '$.status'), timestamp DESC);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (27, datetime('now'));
