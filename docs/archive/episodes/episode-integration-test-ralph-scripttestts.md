---
tags: [episode]
created: "2026-03-29T20:41:06.145Z"
---

# Episode: Integration test: ralph-script.test.ts

## Task tx-00da433f0257
Approach: Added 19 integration tests to existing test/integration/ralph-script.test.ts covering supervision bridge functions (tmux session hook, session CRUD lifecycle, scope-drain shutdown, design-doc maybe-trigger, full worker lifecycle). Used makeBridgeTestLayer(:memory:) pattern consistent with other supervision tests. Explored codebase via subagent, then wrote tests in a single Write.
Outcome: Success — 19/19 new tests pass (33 total in file with 14 existing). Full suite: 4992 pass, 3 pre-existing failures in ralph-context-bundle-e2e.test.ts (RALPH_LOOP_PID env pollution). First run had 4 failures: 3 FK constraint violations + 1 wrong assertion string.
Decisions: (1) Per-test makeBridgeTestLayer(:memory:) — same Rule 8 deviation as other supervision tests. (2) Added tests to existing file rather than creating new file. (3) 5 test groups: tmux hook (3), session lifecycle (6), scope-drain INV-SUP-001 (4), maybe-trigger (4), full lifecycle (2).
Surprises: (1) worker_sessions has FK constraints on current_task_id→tasks and current_run_id→runs — must seed tasks/runs tables BEFORE setting these fields. Initial 3 test failures all from this. (2) maybeTrigger returns 'no_linked_tasks' not 'no_tasks' when doc has no task_doc_links rows. (3) ralph-context-bundle-e2e.test.ts has 3 pre-existing failures from RALPH_LOOP_PID env var bleeding across test files.
