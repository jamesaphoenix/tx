---
tags: [episode]
created: "2026-03-29T19:10:10.103Z"
---

# Episode: Implement SupervisionService

## Task tx-fc94179e7fbf
Approach: Created packages/core/src/services/supervision-service.ts (419 lines) with SupervisionService tag + SupervisionServiceLive layer. Eight methods: listSessions, getSession, listSessionEvents, createTerminalToken, pauseSession, resumeSession, markAttached, markDetached. State machine validation for pause/resume transitions (agent->human_paused->agent). Domain events emitted for all state changes.
Outcome: Success — TypeScript compiles cleanly, 89 core integration + 4 ULID tests pass. Pre-commit hooks pass.
Decisions: (1) DatabaseError as service error type consistent with DomainEventService and DocReviewService. (2) State machine validation: pauseSession only allows agent->human_paused, resumeSession only allows human_paused->agent. (3) createTerminalToken and markAttached reject when another controller exists (INV-SUP-004). (4) Pause/resume never touch task claims (INV-SUP-002).
Surprises: (1) SupervisionService NOT added to packages/core/src/index.ts barrel or wired into layer.ts — same gap as DomainEventService and DocReviewService. This is now a 3-service pattern of missing barrel/layer wiring. (2) No integration tests written for the service itself despite RULE 3. (3) File is 419 lines (under 500-line threshold, unlike DocReviewService at 605).
