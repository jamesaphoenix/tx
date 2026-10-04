---
tags: [learning]
created: "2026-03-29T19:32:32.005Z"
file_pattern: test/integration/supervision-service.test.ts
source_type: manual
---

# Uses makeTestLayermemory instead of getSharedTestLayer because e1a0f0

Uses makeTestLayer(:memory:) instead of getSharedTestLayer() because SupervisionService and DomainEventService are not wired into the shared layer (layer.ts). Same pattern as doc-review-service.test.ts. Has 40 tests covering 7 areas: session CRUD, pause/resume state machine, terminal tokens (INV-SUP-004), claim-preserving pause (INV-SUP-002/003), single write controller, attach/detach events, session events query.
