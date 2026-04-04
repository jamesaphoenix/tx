---
tags: [episode]
created: "2026-03-29T19:32:30.285Z"
---

# Episode: Integration test: supervision-service.test.ts

## Task tx-8bd7664c02a1
Approach: Created test/integration/supervision-service.test.ts (40 tests) covering INV-SUP-002 (claim-preserving pause), INV-SUP-003 (pause only changes controlMode), INV-SUP-004 (single write controller). Built custom test layer with makeTestLayer() using :memory: SQLite because SupervisionService/DomainEventService not wired into shared layer (layer.ts). Also fixed tc.expires_at -> tc.lease_expires_at bug in supervision-repo.ts.
Outcome: Success — 40/40 tests pass after fix. First run had 20/40 failures, ALL caused by the tc.expires_at column name bug in SESSION_DETAIL_SQL — every test that touched getSessionDetail or listSessions failed. Fixed the repo bug, then all 40 passed. Also verified 89 core tests + 19 doc-review tests still pass.
Decisions: (1) Used per-test makeTestLayer(:memory:) — same Rule 8 deviation as doc-review-service tests. (2) Fixed supervision-repo.ts bug inline rather than filing separate task. (3) Seven test groups: session detail (7), pause/resume state machine (9), terminal token INV-SUP-004 (7), claim-preserving pause INV-SUP-002/003 (4), single write controller (4), attach/detach events (7), session events query (2).
Surprises: (1) The tc.expires_at bug caused 20/40 test failures — it was latent because existing 89 core tests never invoke getSessionDetail with active claims. (2) markDetached behavior: detach only clears controller when the viewer IS the active controller, otherwise it's a no-op for controller field. (3) Multiple test iterations needed to fix event assertion expectations around domain event payloads.
