---
tags: [learning]
created: "2026-03-29T19:02:53.653Z"
file_pattern: packages/core/src/services/doc-review-service.ts
source_type: manual
---

# DocReviewService uses SqliteClient directly for the 1ef4be

DocReviewService uses SqliteClient directly for the task_doc_links+tasks JOIN query to derive completion state (INV-SUP-007). Dependencies: DocReviewRepository, DomainEventService, DocRepository, SqliteClient. The maybeTrigger method computes a SHA256 snapshot hash of sorted task_id:status pairs to enforce INV-SUP-008 (one active run per snapshot). supersedePreviousRuns queries doc_review_runs directly via SqliteClient for passing runs.
