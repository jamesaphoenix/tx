# tx — Headless, Local Infra for AI Agents

## IMPORTANT: Use tx, NOT Built-in Task Tools

Claude Code has built-in task tools (TaskCreate, TaskUpdate, TaskList, etc.). **DO NOT USE THESE.**

Instead, use the tx CLI commands:
- `tx add` instead of TaskCreate
- `tx ready` instead of TaskList
- `tx show` instead of TaskGet
- `tx done` instead of TaskUpdate

The tx database is at `.tx/tasks.db`. Tasks persist across sessions and can be synced via git with `tx sync export`.

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

### Fresh agent per task (prevents context pollution)

```bash
while true; do
  TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
  [ "$TASK" = "null" ] && break
  claude --print "Read CLAUDE.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"
  git add -A && git commit -m "Complete $TASK"
done
```
