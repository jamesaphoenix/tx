---
tags: [episode]
created: "2026-03-29T19:52:33.279Z"
---

# Episode: Unit test: no-supervision-sql-outside-core ESLint rules

## Task tx-b7ad8e6d577b
Approach: Extended eslint-plugin-tx/tests/no-supervision-sql-outside-core.test.js with 30 new tests for the no-domain-events-sql-outside-core rule, covering meta, allowed paths, domain_events detection, doc_review_runs detection, non-matching strings, and custom options overrides. Did NOT create a separate test file.
Outcome: Success — 48/48 tests pass (18 original + 30 new). Clean first-run pass, no failures. 17 turns, ~116s, $1.35.
Decisions: (1) Co-located domain-events rule tests in the existing supervision-sql test file rather than creating eslint-plugin-tx/tests/no-domain-events-sql-outside-core.test.js. (2) Mirrored existing test structure/patterns from supervision rule tests.
Surprises: None — straightforward task with no issues.
