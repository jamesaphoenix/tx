---
tags: [learning]
created: "2026-03-29T20:11:51.792Z"
file_pattern: apps/dashboard/server/index.ts
source_type: manual
---

# Dashboard serverindexts has a local Context 04f0e8

Dashboard server/index.ts has a local 'Context' type that conflicts with Effect's Context import. Do NOT import Context from 'effect' — instead type Effect service params directly or use Context.Tag.Service<T> inline. Also, the HTTP upgrade handler's socket param is Duplex (from node:stream), not net.Socket — cast explicitly when passing to WebSocket.
