---
tags: [learning]
created: "2026-03-29T20:22:52.428Z"
file_pattern: scripts/ralph-supervision-bridge.ts
source_type: manual
---

# TypeScript bridge for ralphsh supervision operations 200fe8

TypeScript bridge for ralph.sh supervision operations. Uses makeMinimalLayer from @jamesaphoenix/tx-core with SupervisionRepository and DomainEventService. Subcommands: session-create, session-update, session-end, session-heartbeat, publish-event, maybe-trigger. All operations route through Effect services, no direct SQL.
