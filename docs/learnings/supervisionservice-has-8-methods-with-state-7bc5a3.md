---
tags: [learning]
created: "2026-03-29T19:10:13.476Z"
file_pattern: packages/core/src/services/supervision-service.ts
source_type: manual
---

# SupervisionService has 8 methods with state 7bc5a3

SupervisionService has 8 methods with state machine validation for pause/resume (agent->human_paused->agent). Dependencies: SupervisionRepository, DomainEventService. Emits domain events: worker.pause_requested, worker.paused, worker.resumed, worker.session_attached, worker.session_detached. NOT yet exported from index.ts or wired into layer.ts — must be added before downstream consumers can use it.
