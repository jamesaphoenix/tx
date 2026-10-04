---
tags: [episode]
created: "2026-03-29T19:21:23.278Z"
---

# Episode: Integration test: doc-review-service.test.ts

## Task tx-576a38e26cde
Approach: Created test/integration/doc-review-service.test.ts (19 tests) covering INV-SUP-007 (getCompletionState), INV-SUP-008 (idempotent maybeTrigger), INV-SUP-009 (supersedePreviousRuns), failRun/completeRun lifecycle, config-gated triggering, and full lifecycle end-to-end. Built custom test layer with makeTestLayer() using :memory: SQLite because DocReviewService/DomainEventService are not wired into shared layer (layer.ts). Imported services via relative paths since barrel exports missing.
Outcome: Success — 19/19 tests pass. Initially 17/19 passed; 2 failures were wrong test expectations about deriveState after supersede.
Decisions: (1) Used per-test makeTestLayer(:memory:) instead of getSharedTestLayer() because new services not in shared layer — intentional Rule 8 deviation. (2) Imported DocReviewServiceLive and DomainEventServiceLive via relative paths (../../packages/core/src/services/) since not in barrel. (3) Repos imported from @jamesaphoenix/tx-core/repo sub-path export which DOES exist.
Surprises: (1) deriveState returns 'superseded' (not 'implementing') after supersedePreviousRuns — it checks latestRun.status before task progress. (2) ReviewRunResult needs {passed, findings} fields; ReviewFailureResult needs {retryable} field — agent got these wrong initially. (3) No spec-health fix was explicitly performed — the test coverage itself may be the fix.
