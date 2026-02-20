# tx — Headless, Local Infra for AI Agents

## IMPORTANT: tx Is Canonical, Native Task List Is Allowed

Claude Code native task tools (TaskCreate, TaskUpdate, TaskList, etc.) may be used as a local working list.

Task-layer source of truth policy:
- `tx` is the **primary canonical source of truth** for task state.
- Native task lists are convenience views only.
- If pulling work from a queue, use `tx ready` as the primary place to get work.
- Every create/update/complete/block action in native tasks **must be mirrored back to `tx`**.

Required sync behavior:
- Mirror native creates to `tx add` (use `--parent` for subtasks).
- Mirror native state updates to `tx update`, `tx block`, `tx unblock`, `tx done`, or `tx reset`.
- Before handoff, commit, or session end, run `tx sync export`.
- If native tasks and `tx` diverge, reconcile to `tx` and refresh from `tx` (`tx list`, `tx ready`, `tx show`).

The tx database is at `.tx/tasks.db`. Tasks persist across sessions and sync to git via `tx sync export`.

## Quick Reference

### Core Primitives

| Command | Purpose |
|---------|---------|
| `tx ready` | Get next workable task (unblocked, highest priority) |
| `tx done <id>` | Complete task, potentially unblocking others |
| `tx add <title>` | Create a new task (`--parent`, `--score`, `--description`) |
| `tx show <id>` | Show task details with dependencies |
| `tx block <id> <blocker>` | Declare task dependencies |
| `tx context <id>` | Get relevant learnings + history for prompt injection |

### Memory & Learnings

| Command | Purpose |
|---------|---------|
| `tx learning:add <content>` | Record knowledge for future agents |
| `tx learning:search <q>` | Search learnings (BM25 + recency) |
| `tx learn <path> <note>` | Attach a learning to a file path or glob |
| `tx recall [path]` | Query file-specific learnings by path |

### Messaging (Agent Outbox)

| Command | Purpose |
|---------|---------|
| `tx send <channel> <msg>` | Send a message to an agent channel |
| `tx inbox <channel>` | Read messages (read-only, cursor-based) |
| `tx ack <id>` | Acknowledge a message |

### Worker Coordination

| Command | Purpose |
|---------|---------|
| `tx claim <id> <worker>` | Claim a task with a lease |
| `tx claim:release <id> <w>` | Release a claim |
| `tx claim:renew <id> <w>` | Renew a lease |

### Sync & Data

| Command | Purpose |
|---------|---------|
| `tx sync export` | SQLite to git-friendly JSONL |
| `tx sync import` | JSONL to SQLite |
| `tx compact` | Compact done tasks + export learnings |

## Example Orchestration Loops

### Simple: one agent, one task at a time

```bash
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  [ "$task" = "null" ] && break
  claude "Work on task $task. Run tx show $task first, implement it, then tx done $task"
done
```

### Parallel: N agents pulling from a shared queue

```bash
for i in {1..5}; do
  (while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
    [ "$task" = "null" ] && break
    claude "Complete $task" && tx done $task
  done) &
done
wait
```

### Human-in-the-loop: agent proposes, human approves

```bash
task=$(tx ready --limit 1 --json | jq -r '.[0].id')
claude "Plan implementation for $task" > plan.md
read -p "Approve? [y/n] " answer
[ "$answer" = "y" ] && claude "Execute plan.md" && tx done $task
```

Do not bypass hooks in this workflow. Keep git verification enabled for commits and pushes.

### Fresh agent per task (prevents context pollution)

```bash
while true; do
  TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
  [ "$TASK" = "null" ] && break
  claude --print "Read CLAUDE.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"
  git add -A && git commit -m "Complete $TASK"
done
```

## Design Doc Testing Strategy Quality Bar

For `docs/design/DD-*.md`, the `## Testing Strategy` section must be concrete and testable.

- Include requirement-to-test traceability (every requirement maps to one or more tests).
- Include at least 8 numbered integration scenarios with setup, action, and assertions.
- Include failure-path testing (timeouts, malformed input, partial failures, retries/idempotency where relevant).
- Name exact test files to add or update.
- Use concrete expected outcomes (DB rows, API responses, emitted events/metrics, task state transitions).
- Do not write vague bullets like "add tests" or "cover edge cases".

Use this prompt pattern when drafting:

```text
Write ONLY the "Testing Strategy" section for <DD-NNN>.
1) Add a traceability matrix:
   Requirement | Test Type | Test Name | Assertions | File Path
2) Include Unit, Integration, Edge Cases, Failure Injection, Performance.
3) Integration tests must use getSharedTestLayer() and fixtureId(name).
4) Provide at least 8 numbered integration scenarios with Setup / Action / Assert.
5) Use specific files, inputs, and expected outcomes; no vague statements.
```
