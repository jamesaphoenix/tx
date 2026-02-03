# @jamesaphoenix/tx

**TanStack for AI agents.** Headless primitives for memory, tasks, and orchestration.

## Installation

```bash
npm install @jamesaphoenix/tx better-sqlite3 effect
```

## Quick Start

```typescript
import { createTx } from '@jamesaphoenix/tx'

// Initialize tx
const tx = createTx()

// Create a task
const task = await tx.add({
  title: 'Implement feature X',
  status: 'ready'
})

// Get next workable task
const next = await tx.ready()

// Complete a task
await tx.done(task.id)
```

## CLI Usage

```bash
# Install globally
npm install -g @jamesaphoenix/tx

# Create tasks
tx add "Implement feature X"

# Get next ready task
tx ready

# Complete a task
tx done <task-id>

# View task tree
tx tree <task-id>
```

## Philosophy: Primitives, Not Frameworks

tx provides headless infrastructure for AI agent orchestration. You own your orchestration logic - tx owns the primitives.

| Primitive | Purpose |
|-----------|---------|
| `tx ready` | Get next workable task (unblocked, highest priority) |
| `tx claim <id>` | Mark task as being worked by an agent |
| `tx done <id>` | Complete task, potentially unblocking others |
| `tx block <id> <blocker>` | Declare dependencies |
| `tx handoff <id> --to <agent>` | Transfer task with context |

## Documentation

Full documentation: [github.com/jamesaphoenix/tx](https://github.com/jamesaphoenix/tx)

## License

MIT
