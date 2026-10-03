---
tags: [learning]
created: "2026-03-29T18:55:55.759Z"
file_pattern: packages/types/src/domain-event.ts
source_type: manual
---

# DomainEventError is defined as a plain 2b38e2

DomainEventError is defined as a plain Error class with _tag property for discrimination, NOT as Data.TaggedError like the rest of the codebase uses. This inconsistency means services using it (DomainEventService) cannot use Effect.catchTag directly against DomainEventError — they surface DatabaseError instead.
