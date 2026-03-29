---
tags: [learning]
created: "2026-03-29T19:32:35.361Z"
file_pattern: packages/core/src/repo/supervision-repo.ts
source_type: manual
---

# SESSIONDETAILSQL joins taskclaims any test that 445cc4

SESSION_DETAIL_SQL joins task_claims — any test that touches getSessionDetail with active claims will fail if column names are wrong. The 89 core integration tests do NOT cover this path (they never invoke getSessionDetail with claims data), so column reference bugs in supervision-repo SQL are latent until supervision-service-specific tests exercise them.
