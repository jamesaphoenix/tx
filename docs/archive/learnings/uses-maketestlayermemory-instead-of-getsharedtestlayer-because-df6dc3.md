---
tags: [learning]
created: "2026-03-29T19:21:29.090Z"
file_pattern: test/integration/doc-review-service.test.ts
source_type: manual
---

# Uses makeTestLayermemory instead of getSharedTestLayer because df6dc3

Uses makeTestLayer(:memory:) instead of getSharedTestLayer() because DocReviewService+DomainEventService are not wired into layer.ts. When these services get wired into the shared layer, this test should be migrated to use getSharedTestLayer() per Rule 8. Imports services via relative paths (../../packages/core/src/services/) since barrel exports are missing.
