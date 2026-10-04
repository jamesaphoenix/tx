---
tags: [episode]
created: "2026-03-29T20:24:45.873Z"
---

# Episode: Ralph shell integration points

## Task tx-b94d74a9ae0e
Approach: Created scripts/ralph-supervision-bridge.ts (TypeScript bridge using makeMinimalLayer + SupervisionRepository + DomainEventService) and added 8 new functions to ralph.sh for supervision lifecycle. Bridge handles session-create/update/end/heartbeat, publish-event, maybe-trigger. ralph.sh calls bridge via bun, never puts supervision SQL in shell.
Outcome: Success — all 1173 tests pass (89 core + 40 supervision + 25 domain-event + 19 doc-review + 1014 ESLint). No test failures encountered during implementation.
Decisions: (1) TypeScript bridge pattern over direct SQL in bash — keeps SQL in Effect services, bridge is a thin CLI wrapper. (2) SUPERVISION_AVAILABLE flag gates all calls so ralph.sh works without supervision tables. (3) Dedicated tmux session per worker (ralph-worker-N) for dashboard terminal attach. (4) ReviewTriggerCause is a string literal not an object — had to fix maybeTrigger call from {type:'scope_drain',workerId:'ralph'} to just 'scope_drained'. (5) handle_scope_drain emits 3 domain events (scope_drained, shutdown_requested, shutdown_completed) and triggers maybeTrigger for design-doc scopes.
Surprises: (1) ReviewTriggerCause type mismatch — initially coded as object but it's a string literal union ('scope_drained'|'manual'|'task_completed'). (2) No compilation or test failures at all — unusually clean implementation. (3) Agent already recorded its own learnings via tx memory learn before completing.
