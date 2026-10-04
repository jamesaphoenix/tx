---
tags: [learning]
created: "2026-03-29T19:21:31.797Z"
file_pattern: packages/core/src/services/doc-review-service.ts
source_type: manual
---

# deriveState checks latestRunstatus BEFORE task progress 31505d

deriveState checks latestRun.status BEFORE task progress — if the latest run has status 'superseded', getCompletionState returns 'superseded' even if tasks have reverted to in-progress statuses. A new trigger (maybeTrigger) must be called to create a fresh pending run before task progress is reflected in the completion state.
