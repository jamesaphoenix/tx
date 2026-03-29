---
tags: [learning]
created: "2026-03-29T19:29:26.911Z"
file_pattern: packages/core/src/repo/supervision-repo.ts
source_type: manual
---

# SESSIONDETAILSQL had a bug tcexpiresat should da669b

SESSION_DETAIL_SQL had a bug: tc.expires_at should be tc.lease_expires_at — the task_claims column is lease_expires_at not expires_at. Also, the dist file at packages/core/dist/repo/supervision-repo.js can get stale; import from source paths in tests (../../packages/core/src/repo/...) to avoid dist cache issues.
