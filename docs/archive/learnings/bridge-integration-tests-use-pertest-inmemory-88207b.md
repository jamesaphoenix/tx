---
tags: [learning]
created: "2026-03-29T20:39:03.611Z"
file_pattern: test/integration/ralph-script.test.ts
source_type: manual
---

# Bridge integration tests use pertest inmemory 88207b

Bridge integration tests use per-test in-memory SQLite via makeBridgeTestLayer() (Rule 8 deviation). Worker_sessions FK constraints require seeding tasks table BEFORE setting currentTaskId and runs table BEFORE setting currentRunId. maybeTrigger returns 'no_linked_tasks' (not 'no_tasks') when a doc has no task_doc_links rows.
