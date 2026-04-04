---
created: "2026-03-29T18:21:42.937Z"
---

# Supervision types (WorkerSession, WorkerSessionDetail, DesignDocProgress, DocReviewRun, SupervisionTerminalToken, ActorRef, etc.) live in packages/types/src/supervision.ts. Domain event types (DomainEventEnvelope, 12 worker event payloads, 7 design-doc event payloads, SupervisionDomainEvent typed union) live in packages/types/src/domain-event.ts. Both reference DD-039 spec. All exported via packages/types/src/index.ts in grouped sections.


