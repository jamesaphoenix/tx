---
tags: [learning]
created: "2026-03-29T19:45:53.910Z"
file_pattern: "test/integration/*.test.ts"
source_type: manual
---

# DomainEventService integration tests 25 tests 7 c452a9

DomainEventService integration tests (25 tests, 7 groups) use per-test makeTestLayer(:memory:) like doc-review-service and supervision-service tests, because DomainEventService is not wired into the shared layer (layer.ts). Import DomainEventServiceLive from relative path ../../packages/core/src/services/domain-event-service.js — it is NOT in the barrel export.
