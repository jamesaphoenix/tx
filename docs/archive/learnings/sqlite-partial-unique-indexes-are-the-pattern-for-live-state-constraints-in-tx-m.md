---
created: "2026-03-29T18:37:49.593Z"
---

# SQLite partial unique indexes are the pattern for live-state constraints in tx migrations. Examples: 'CREATE UNIQUE INDEX idx_worker_sessions_live_worker ON worker_sessions(worker_id) WHERE ended_at IS NULL' ensures at most one live session per worker. 'CREATE UNIQUE INDEX idx_doc_review_runs_active ON doc_review_runs(doc_id, doc_version, task_snapshot_hash) WHERE status IN ("pending", "running")' ensures at most one active review per doc version. This pattern replaces application-level uniqueness checks.


