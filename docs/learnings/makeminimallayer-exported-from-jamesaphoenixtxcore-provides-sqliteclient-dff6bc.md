---
tags: [learning]
created: "2026-03-29T20:24:56.654Z"
file_pattern: packages/core/src/layer.ts
source_type: manual
---

# makeMinimalLayer exported from jamesaphoenixtxcore provides SqliteClient dff6bc

makeMinimalLayer (exported from @jamesaphoenix/tx-core) provides SqliteClient + all repos including SupervisionRepository but does NOT include service layers (SupervisionService, DomainEventService, DocReviewService). For scripts that need services, compose them manually on top of makeMinimalLayer — see scripts/ralph-supervision-bridge.ts and apps/dashboard/server/index.ts as patterns.
