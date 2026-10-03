---
tags: [episode]
created: "2026-03-29T19:04:35.924Z"
---

# Episode: Implement DocReviewService

## Task tx-2680967cc2b6
Approach: Created packages/core/src/services/doc-review-service.ts (605 lines) with DocReviewService tag + DocReviewServiceLive layer. Seven methods: getCompletionState (derives from task_doc_links JOIN tasks + review run state), maybeTrigger (config gate + task check + SHA256 snapshot hash + idempotent insert + domain events), claimPending (delegate to repo), startRun/completeRun/failRun (status transitions + domain events), supersedePreviousRuns (mark passing runs superseded).
Outcome: Success — TypeScript compiles, 89 core integration + 4 ULID tests pass.
Decisions: (1) Uses SqliteClient directly for task_doc_links+tasks JOIN query rather than going through DocRepository — DocRepository doesn't expose a task-completion-by-doc method. (2) SHA256 of sorted taskId:status pairs for snapshot hash (INV-SUP-008). (3) DatabaseError as service error type consistent with DomainEventService. (4) DocReviewConfig type with sensible defaults for DD-039 config section. (5) Uses node:crypto createHash for SHA256.
Surprises: (1) DocReviewService NOT added to packages/core/src/index.ts barrel — same gap as DomainEventService. (2) DocReviewServiceLive NOT wired into layer.ts — downstream consumers cannot use it until wired. (3) File is 605 lines (exceeds lint warning threshold of 500) — no enforcement, just a warning. (4) No integration tests were written for the service itself despite RULE 3 requiring SHA256 fixture tests.
