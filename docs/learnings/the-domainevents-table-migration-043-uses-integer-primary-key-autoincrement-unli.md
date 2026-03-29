---
created: "2026-03-29T18:37:39.754Z"
---

# The domain_events table (migration 043) uses INTEGER PRIMARY KEY AUTOINCREMENT — unlike most tx tables that use TEXT PRIMARY KEY with tx-xxx or mem-xxx format. This is intentional: domain events are an append-only ledger where monotonic ordering by insertion sequence matters. The event_id TEXT UNIQUE column holds the logical event identifier.


