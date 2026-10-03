---
tags: [episode]
created: "2026-03-29T19:58:46.125Z"
---

# Episode: Core layer wiring and exports

## Task tx-07227ad9884c
Approach: Wired 3 new repos (DomainEventRepository, SupervisionRepository, DocReviewRepository) and 3 new services (DomainEventService, SupervisionService, DocReviewService) into packages/core/src/layer.ts, services/index.ts, and index.ts. Added ReviewRuntimeNoop as default layer for DocReviewService.
Outcome: Success — 196 tests pass (89 core + 25 domain-event + 40 supervision + 19 doc-review + 19 doc-review-worker + 4 ULID). No regressions.
Decisions: (1) Service dependency ordering: DomainEventService first (no service deps), then SupervisionService+DocReviewService (both depend on DomainEventService). (2) ReviewRuntimeNoop used as default layer. (3) Re-exports from layer.ts rather than adding separate export lines in index.ts. (4) Had to detect and remove duplicate exports — ReviewRuntime/PiReviewRuntime already exported from services section.
Surprises: (1) Edit string-not-found on first attempt to add imports — import block structure didn't match expected pattern. (2) tx done parent validation prevents marking parent done before children — had to complete subtasks tx-0da19c815a30 and tx-609d7a34ce1a first. (3) Repo exports are complex: repo/index.ts already exports new repos, but index.ts doesn't re-export from repo/index.ts — layer.ts re-exports became the path.
