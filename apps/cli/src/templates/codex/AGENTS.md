# tx — Headless, Local Infra for AI Agents

## Task Management

Use the `tx` CLI for all task management. The database is at `.tx/tasks.db`.

### Core Commands

| Command | Purpose |
|---------|---------|
| `tx ready` | Get next workable task (unblocked, highest priority) |
| `tx done <id>` | Complete task, potentially unblocking others |
| `tx add <title>` | Create a new task (`--parent`, `--score`, `--description`) |
| `tx show <id>` | Show task details with dependencies |
| `tx block <id> <blocker>` | Declare task dependencies |
| `tx context <id>` | Get relevant learnings + history |

### Memory & Learnings

| Command | Purpose |
|---------|---------|
| `tx learning:add <content>` | Record knowledge for future agents |
| `tx learning:search <q>` | Search learnings (BM25 + recency) |
| `tx learn <path> <note>` | Attach a learning to a file path or glob |
| `tx recall [path]` | Query file-specific learnings by path |

### Messaging

| Command | Purpose |
|---------|---------|
| `tx send <channel> <msg>` | Send a message to an agent channel |
| `tx inbox <channel>` | Read messages |
| `tx ack <id>` | Acknowledge a message |

### Worker Coordination

| Command | Purpose |
|---------|---------|
| `tx claim <id> <worker>` | Claim a task with a lease |
| `tx claim:release <id> <w>` | Release a claim |

### Sync

| Command | Purpose |
|---------|---------|
| `tx sync export` | SQLite to git-friendly JSONL |
| `tx sync import` | JSONL to SQLite |
| `tx compact` | Compact done tasks + export learnings |

## Example Orchestration

### Simple: one task at a time

```bash
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  [ "$task" = "null" ] && break
  codex "Work on task $task. Run tx show $task first, implement it, then tx done $task"
done
```

### Parallel: N agents pulling from a shared queue

```bash
for i in {1..5}; do
  (while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
    [ "$task" = "null" ] && break
    codex "Complete $task" && tx done $task
  done) &
done
wait
```

### Human-in-the-loop

```bash
task=$(tx ready --limit 1 --json | jq -r '.[0].id')
codex "Plan implementation for $task" > plan.md
read -p "Approve? [y/n] " answer
[ "$answer" = "y" ] && codex "Execute plan.md" && tx done $task
```
