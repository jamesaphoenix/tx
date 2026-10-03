---
tags: [learning]
created: "2026-03-29T20:22:50.165Z"
file_pattern: scripts/ralph.sh
source_type: manual
---

# Supervision integration DD039 ralphsh calls scriptsralphsupervisionbridgets e256c0

Supervision integration (DD-039): ralph.sh calls scripts/ralph-supervision-bridge.ts via bun for all supervision operations (session create/update/end, domain events, maybe-trigger). Never puts supervision SQL in the shell script directly. Functions: create_tmux_session_for_worker, create_supervision_session, update_supervision_session, end_supervision_session, emit_supervision_event, handle_scope_drain. SUPERVISION_AVAILABLE flag guards all calls.
