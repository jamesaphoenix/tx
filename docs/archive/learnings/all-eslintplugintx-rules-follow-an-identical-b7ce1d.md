---
tags: [learning]
created: "2026-03-29T19:49:14.196Z"
file_pattern: "eslint-plugin-tx/rules/*.js"
source_type: manual
---

# All eslintplugintx rules follow an identical b7ce1d

All eslint-plugin-tx rules follow an identical structure: path-based gating via isAllowedPath, string extraction via getStringValue (handles both Literal and TemplateLiteral), case-insensitive table name matching via containsTableReference, and Schema-defined options. To add a new SQL ownership boundary rule, copy no-supervision-sql-outside-core.js and change tablePatterns + error messageId.
