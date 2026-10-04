---
tags: [episode]
created: "2026-03-29T19:49:04.687Z"
---

# Episode: Implement tx/no-domain-events-sql-outside-core ESLint rule

## Task tx-77491f50e01c
Approach: Created eslint-plugin-tx/rules/no-domain-events-sql-outside-core.js by copying the pattern from no-supervision-sql-outside-core.js. Detects domain_events and doc_review_runs table references in string literals and template literals. Registered in eslint-plugin-tx/index.js with recommended config. Verified existing tests still pass and rule loads correctly.
Outcome: Success — rule created, registered, and loads. Completed in 11 turns (~73s). No dedicated test file created for the new rule.
Decisions: (1) Followed existing no-supervision-sql-outside-core pattern exactly — same structure, same allowed paths (packages/core/src/repo/, migrations/, test/). (2) Targets two tables: domain_events and doc_review_runs. (3) Error message directs users to DomainEventService or DocReviewService. (4) Enforces INV-SUP-010 boundary.
Surprises: (1) No test file was created for the new rule (eslint-plugin-tx/tests/no-domain-events-sql-outside-core.test.js) — the supervision rule has tests but the agent didn't create corresponding ones. (2) Task completed very quickly since it was a near-copy of the existing rule.
