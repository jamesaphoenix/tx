---
tags: [learning]
created: "2026-03-29T19:59:02.836Z"
file_pattern: packages/core/src/services/doc-review-service.ts
source_type: manual
---

# DocReviewServiceLive requires ReviewRuntime tag interface for 5ea0ab

DocReviewServiceLive requires ReviewRuntime tag (interface for running the actual review). ReviewRuntimeNoop is the no-op default wired into layer.ts. Downstream consumers that want real review execution must provide their own ReviewRuntime layer.
