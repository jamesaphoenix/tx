---
tags: [learning]
created: "2026-03-29T20:24:50.999Z"
file_pattern: packages/core/src/services/doc-review-service.ts
source_type: manual
---

# ReviewTriggerCause is a string literal union eb80c9

ReviewTriggerCause is a string literal union ('scope_drained' | 'manual' | 'task_completed'), NOT an object. maybeTrigger(docRef, cause) takes the string directly. Common mistake: passing {type: 'scope_drain', workerId: '...'} instead of just 'scope_drained'.
