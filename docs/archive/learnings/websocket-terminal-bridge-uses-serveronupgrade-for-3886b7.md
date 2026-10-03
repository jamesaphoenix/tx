---
tags: [learning]
created: "2026-03-29T20:12:00.332Z"
file_pattern: apps/dashboard/server/index.ts
source_type: manual
---

# WebSocket terminal bridge uses serveronupgrade for 3886b7

WebSocket terminal bridge uses server.on('upgrade') for RFC 6455 handshake (not Hono middleware). Control mode: spawn('tmux', ['attach-session', '-t', session]) with bidirectional stdin/stdout piping. Observe mode: periodic tmux capture-pane polling (read-only, INV-SUP-005). Always call markDetached on socket close for cleanup.
