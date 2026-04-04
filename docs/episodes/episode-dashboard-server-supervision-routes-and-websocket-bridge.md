---
tags: [episode]
created: "2026-03-29T20:11:45.892Z"
---

# Episode: Dashboard server supervision routes and websocket bridge

## Task tx-3ccc4b5dede6
Approach: Added supervision HTTP routes (7 endpoints) and WebSocket terminal bridge to apps/dashboard/server/index.ts. Created withSupervision() helper to bridge Effect layer into Hono route handlers via Effect.runPromise. WebSocket uses node:child_process spawn for tmux attach (control mode) and tmux capture-pane polling (observe mode). Routes delegate to core SupervisionService — no direct SQL (INV-SUP-010).
Outcome: Success — compiles cleanly, committed. Multiple TypeScript fix iterations needed (4-5 rounds of edits).
Decisions: (1) withSupervision<A>() generic helper wraps Effect.gen + Effect.provide(layer) + Effect.runPromise for each route. (2) Error mapping: 404 not-found, 409 invalid transitions/controller conflicts, 503 tmux unavailable. (3) WebSocket upgrade handled via server 'upgrade' event, not Hono middleware. (4) Lazy Effect layer via getSupervisionLayer() using makeMinimalLayer from core.
Surprises: (1) Context name collision — dashboard server/index.ts already has a local Context type; importing Effect's Context caused TS conflicts. Tried EffectContext alias (unused error), then namespace import (not recognized). Resolved by avoiding Context import entirely and typing withSupervision's fn param directly. (2) Duplex/Socket type mismatch in HTTP upgrade handler — node:stream.Duplex vs node:net.Socket needed explicit cast. (3) Effect.provide(layer) with any return type in fn param didn't satisfy R constraints — simplified by removing generic constraint. (4) head param in upgrade callback was unused — had to prefix with underscore.
