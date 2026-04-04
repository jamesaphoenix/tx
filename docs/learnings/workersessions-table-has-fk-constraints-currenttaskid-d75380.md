---
tags: [learning]
created: "2026-03-29T20:41:13.279Z"
file_pattern: packages/core/src/repo/supervision-repo.ts
source_type: manual
---

# workersessions table has FK constraints currenttaskid d75380

worker_sessions table has FK constraints: current_task_id references tasks(id), current_run_id references runs(id). Any test that sets currentTaskId or currentRunId must seed the tasks/runs tables FIRST or the insert/update will fail with FOREIGN KEY constraint error.
