---
tags: [learning]
created: "2026-03-29T19:58:54.097Z"
file_pattern: packages/core/src/index.ts
source_type: manual
---

# Export paths are layered repoindexts exports 76b210

Export paths are layered: repo/index.ts exports *RepositoryLive, services/index.ts exports *ServiceLive, and layer.ts re-exports both for downstream consumers. index.ts re-exports from layer.js (not from repo or services directly for the new supervision/domain-event/doc-review modules). Check for duplicates when adding exports — ReviewRuntime/PiReviewRuntime were already exported from services barrel.
