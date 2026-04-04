---
tags: [learning]
created: "2026-03-29T19:39:45.048Z"
file_pattern: packages/core/src/services/doc-review-service.ts
source_type: manual
---

# claimPending internally updates docreviewrunsworkerid which has a10bae

claimPending internally updates doc_review_runs.worker_id which has FK to workers(id). Callers and tests must ensure a valid worker row exists before calling claimPending, or it fails with FK constraint violation.
