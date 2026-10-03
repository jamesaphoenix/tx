---
name: tx-tasks
description: Create tx tasks with a clear outcome, acceptance criteria and optional document links or dependencies.
---

# Create tasks

Run tx from the project's main repository root so existing task state stays shared.
Read project instructions for any shell wrapper needed to invoke tx.

```bash
tx task add "Fix trial reminder timing" --description "Use the saved trial deadline. Acceptance: ending and expired reminders use the actual date."
```

Use the returned task ID. Add a parent or dependency only when the work needs one:

```bash
tx task add "Test reminder boundaries" --parent <task-id> --description "Cover the deadline and subscription upgrade."
tx task dep block <dependent-id> <blocker-id>
tx doc attach <task-id> <doc-ref>
```

Link existing specs when relevant. This guide creates tasks; it does not require
queue execution, agents or an orchestration loop. Use `tx task add --help`,
`tx task dep block --help` and `tx doc attach --help` for current options.
