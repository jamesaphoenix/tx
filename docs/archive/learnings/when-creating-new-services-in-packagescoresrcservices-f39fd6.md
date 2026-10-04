---
tags: [learning]
created: "2026-03-29T19:04:46.678Z"
file_pattern: "packages/core/src/services/*.ts"
source_type: manual
---

# When creating new services in packagescoresrcservices f39fd6

When creating new services in packages/core/src/services/, you must also export them from packages/core/src/index.ts AND wire DocReviewServiceLive into packages/core/src/layer.ts. Both DomainEventService and DocReviewService were missed during initial creation — neither was added to the barrel export or the layer composition.
