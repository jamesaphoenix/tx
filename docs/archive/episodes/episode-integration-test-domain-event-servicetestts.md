---
tags: [episode]
created: "2026-03-29T19:45:44.875Z"
---

# Episode: Integration test: domain-event-service.test.ts

## Task tx-5e533d57fca5
Approach: Created test/integration/domain-event-service.test.ts (25 tests) across 7 groups: append/query by stream (4), append/query by aggregate (3), event ordering guarantees (4), envelope field round-trip (7), event type validation (3), cross-stream/aggregate queries (2), full lifecycle sequence (1). Used per-test makeTestLayer(:memory:) with SHA256 fixture IDs. Imported DomainEventServiceLive via relative path since not in barrel exports.
Outcome: Success — 25/25 tests pass after fix. First run had 24/25 — 1 failure in ULID monotonicity test. Agent fixed by changing strict ordering assertion (e1.id < e2.id) to non-decreasing (e1.id <= e2.id) with renamed test to 'events have unique ULIDs with non-decreasing timestamp prefix'. Also had to fix unused import caught by pre-commit lint.
Decisions: (1) Per-test makeTestLayer(:memory:) — same Rule 8 deviation as other new service tests. (2) DomainEventServiceLive imported via relative path (../../packages/core/src/services/) since not in barrel. (3) Tests validate all 12 worker.* and all 7 design_doc.* event types. (4) SHA256 fixture IDs used per Rule 3.
Surprises: (1) ULIDs generated within same millisecond do NOT guarantee lexicographic ordering — random suffix can make later-generated ULIDs sort before earlier ones. Test had to be weakened to check timestamp prefix non-decreasing + uniqueness rather than strict monotonicity. (2) DomainEventRepo is imported from @jamesaphoenix/tx-core/repo sub-path export (works), but DomainEventServiceLive must use relative path.
