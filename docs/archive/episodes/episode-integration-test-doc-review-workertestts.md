---
tags: [episode]
created: "2026-03-29T19:39:40.354Z"
---

# Episode: Integration test: doc-review-worker.test.ts

## Task tx-083ba22ab15e
Approach: Created test/integration/doc-review-worker.test.ts (19 tests) across 5 groups: claim pending (3), review execution lifecycle (7), ReviewRuntime stub contract (4), concurrent claim prevention (3), full worker lifecycle (2). Used per-test makeTestLayer(:memory:) with ReviewRuntime stub. Created seedTriggeredReviewRun helper for multi-step test setup.
Outcome: Success — 19/19 tests pass + 148 existing tests pass. Initial run had FK constraint failures because doc_review_runs.worker_id references workers(id) but no worker rows were seeded. Fixed by seeding workers in seedTriggeredReviewRun and individual test helpers. Required 3 test iterations: first had FK failures across most claim tests, second had 1 remaining failure in 'multiple pending runs' test that also needed worker seeding.
Decisions: (1) Per-test makeTestLayer(:memory:) — same Rule 8 deviation as doc-review-service and supervision-service tests. (2) ReviewRuntime stub created inline via Effect Layer providing executeReview that records calls for assertion. (3) Imported ReviewRuntime from relative path since not in barrel exports.
Surprises: (1) doc_review_runs.worker_id has FK to workers(id) — claimPending fails with FK constraint if worker rows aren't seeded. This is not obvious from the service API. (2) Worker seeding needed in EVERY test path that calls claimPending, not just the main helper.
