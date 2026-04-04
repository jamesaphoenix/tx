---
tags: [learning]
created: "2026-03-29T18:55:42.528Z"
file_pattern: packages/core/src/services/domain-event-service.ts
source_type: manual
---

# DomainEventServicepublish validates eventType against SupervisionEventTypeSchema via 0c3fe3

DomainEventService.publish validates eventType against SupervisionEventTypeSchema via Schema.decodeUnknownEither, returns DatabaseError (not DomainEventError) on failure. The service generates event_id via ULID and occurred_at as ISO timestamp before delegating to DomainEventRepo.append. Not yet exported from packages/core/src/index.ts — must be added before downstream consumers can use it.
