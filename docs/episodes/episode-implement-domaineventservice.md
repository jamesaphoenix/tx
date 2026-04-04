---
tags: [episode]
created: "2026-03-29T18:56:08.209Z"
---

# Episode: Implement DomainEventService

## Task tx-6693bfb2343b
Approach: Created packages/core/src/services/domain-event-service.ts with DomainEventService tag + DomainEventServiceLive layer. Three methods: publish (generates ULID event_id, ISO timestamp, validates eventType via Schema.decodeUnknownEither against SupervisionEventTypeSchema, delegates to DomainEventRepo.append), listByStream and listByAggregate (thin delegates to repo).
Outcome: Success — TypeScript compiles, core integration tests (89) and ULID tests (4) pass.
Decisions: (1) Used DatabaseError as service error type rather than DomainEventError because DomainEventError is a plain Error class not Data.TaggedError. (2) Used Schema.decodeUnknownEither for sync validation of eventType rather than Effect.tryPromise.
Surprises: (1) DomainEventService was NOT exported from packages/core/src/index.ts — gap for downstream consumers. (2) Single-file tsc type-checking via rootNames produces noisy 'not listed within file list' warnings that are harmless but confusing. (3) DomainEventError inconsistency with Data.TaggedError pattern used everywhere else in the codebase.
