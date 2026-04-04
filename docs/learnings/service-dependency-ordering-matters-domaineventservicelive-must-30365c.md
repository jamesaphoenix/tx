---
tags: [learning]
created: "2026-03-29T19:58:51.299Z"
file_pattern: packages/core/src/layer.ts
source_type: manual
---

# Service dependency ordering matters DomainEventServiceLive must 30365c

Service dependency ordering matters: DomainEventServiceLive must be provided BEFORE SupervisionServiceLive and DocReviewServiceLive (both depend on DomainEventService). DocReviewServiceLive also needs DocRepository and SqliteClient. ReviewRuntimeNoop is the default layer for DocReviewService.
