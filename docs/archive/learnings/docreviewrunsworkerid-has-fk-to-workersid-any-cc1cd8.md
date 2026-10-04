---
tags: [learning]
created: "2026-03-29T19:39:43.006Z"
file_pattern: test/integration/doc-review-worker.test.ts
source_type: manual
---

# docreviewrunsworkerid has FK to workersid any cc1cd8

doc_review_runs.worker_id has FK to workers(id) — any test calling DocReviewService.claimPending MUST seed a worker row first or SQLite will throw FK constraint error. Use seedWorker helper pattern from this file.
