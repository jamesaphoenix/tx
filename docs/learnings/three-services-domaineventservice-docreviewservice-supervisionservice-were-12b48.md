---
tags: [learning]
created: "2026-03-29T19:10:16.107Z"
file_pattern: "packages/core/src/services/*.ts"
source_type: manual
---

# Three services DomainEventService DocReviewService SupervisionService were 12b484

Three services (DomainEventService, DocReviewService, SupervisionService) were all created without being exported from packages/core/src/index.ts or wired into packages/core/src/layer.ts. This is a systemic gap — the implementer agent pattern consistently misses barrel exports and layer wiring. These must be added as a follow-up before any downstream consumer can use them.
