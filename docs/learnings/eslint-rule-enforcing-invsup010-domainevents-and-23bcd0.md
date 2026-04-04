---
tags: [learning]
created: "2026-03-29T19:49:09.450Z"
file_pattern: eslint-plugin-tx/rules/no-domain-events-sql-outside-core.js
source_type: manual
---

# ESLint rule enforcing INVSUP010 domainevents and 23bcd0

ESLint rule enforcing INV-SUP-010: domain_events and doc_review_runs SQL must stay in packages/core/src/repo/. Pattern copied from no-supervision-sql-outside-core.js. No dedicated test file exists yet — needs eslint-plugin-tx/tests/no-domain-events-sql-outside-core.test.js.
