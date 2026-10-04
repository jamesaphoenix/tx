---
tags: [learning]
created: "2026-03-29T19:10:22.226Z"
file_pattern: packages/core/src/services/supervision-service.ts
source_type: manual
---

# SupervisionService enforces INVSUP002 pauseresume never touch 547137

SupervisionService enforces INV-SUP-002 (pause/resume never touch task claims), INV-SUP-003 (pause only changes controlMode to human_paused), and INV-SUP-004 (createTerminalToken/markAttached reject when another controller exists). No integration tests yet cover these invariants — RULE 3 gap.
