# tx

**Primitives, not frameworks.** Headless infrastructure for AI agents.

Memory, tasks, and orchestration — you own the loop.

```bash
npm install -g @jamesaphoenix/tx
tx init
```

---

## The Problem

Your agents lose context between sessions. Tasks collide when multiple agents work in parallel. Learnings vanish into conversation history. You're rebuilding the same infrastructure every project.

## The Solution

Composable primitives that handle the hard parts. You keep control of the orchestration.

```
┌─────────────────────────────────────────────────────────┐
│  Your Orchestration (your code, your rules)             │
├─────────────────────────────────────────────────────────┤
│  tx primitives                                          │
│                                                         │
│   tx ready     tx done      tx context    tx learn      │
│   tx claim     tx block     tx handoff    tx sync       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Primitives

### Memory

Learnings that persist and surface when relevant.

```bash
# Store knowledge (with optional file path)
tx learning:add "Use bcrypt for passwords, not SHA256" --file src/auth/hash.ts
tx learning:add "Redis cache invalidation has race conditions"

# Retrieve via search or task context
tx learning:search "authentication"
tx context tx-abc123  # Get relevant learnings for a task
```

Learnings can be tagged with file paths for organization. Hybrid search (BM25 + vector) finds relevant knowledge.

### Tasks

Dependency-aware task management. Agents only see work they can actually do.

```bash
# Create with dependencies
tx add "Implement auth service" --score 800
tx add "Design auth schema" --score 900
tx block tx-impl tx-schema  # impl waits for schema

# Work on what's ready
tx ready                    # Only unblocked tasks
tx done tx-schema           # Completes → unblocks dependents
```

Full hierarchy support. Epics contain milestones contain tasks contain subtasks.

### Coordination

Primitives for multi-agent workflows without prescribing the pattern.

```bash
tx claim tx-abc123           # Prevent collisions
tx checkpoint tx-abc123 \
  --note "API done, UI next"  # Save progress
tx handoff tx-abc123 \
  --to reviewer              # Transfer with context
```

---

## Your Loop, Your Rules

We ship **example loops**, not **the loop**:

```bash
# Simple: one agent, one task
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  claude "Work on task $task, then run: tx done $task"
done
```

```bash
# Parallel: N agents pulling from queue
for i in {1..5}; do
  (while task=$(tx claim --next); do
    claude "Complete $task" && tx done $task
  done) &
done
wait
```

```bash
# Human-in-loop: agent proposes, human approves
task=$(tx ready --limit 1)
claude "Plan implementation for $task" > plan.md
read -p "Approve? [y/n] " && claude "Execute plan.md"
tx done $task
```

**The flow is yours.** Serial, parallel, swarm, human-in-loop. Your call.

---

## Why tx?

|  | Native Tasks | CLAUDE.md | tx |
|---|---|---|---|
| **Persistence** | Session-scoped | File grows forever | Git-native, branch-aware |
| **Multi-agent** | Collisions | Manual coordination | Claim, block, handoff |
| **Knowledge** | Lost each session | Static dump | Graph RAG, contextual retrieval |
| **Orchestration** | None | None | Primitives for any pattern |

---

## Design Principles

- **No opinions on orchestration.** Serial, parallel, swarm, human-in-loop. Your call.
- **Powerful defaults.** `tx ready` just works. So does dependency resolution.
- **Escape hatches everywhere.** Raw SQL access, JSONL export, custom scoring.
- **Framework agnostic.** CLI, MCP, REST API, TypeScript SDK. Use what fits.
- **Local-first.** SQLite + git. No server required. Works offline.

---

## Non-Goals

- **Not an agent framework.** You bring your own orchestration.
- **Not a hosted memory product.** Local-first, your data stays yours.
- **Not a prompt library.** Primitives, not templates.
- **Not a replacement for your issue tracker.** (Unless you want it to be.)

---

## Three Systems

### 1. Knowledge System

**Working today:**
- Learnings stored with file path tags
- Basic hybrid search (BM25 + vector)
- Retrieval by task ID via `tx context`

```bash
tx learning:add "Use bcrypt for passwords" --file src/auth/hash.ts
tx learning:search "authentication"
tx context tx-abc123  # Get learnings relevant to a task
```

**Research in progress:**
- Symbol anchoring (AST-based code references, not just file paths)
- Knowledge graph expansion (automatic relationship discovery)
- Auto-invalidation when code changes

### 2. Task System

**Working today:**
- N-level hierarchy (epics → tasks → subtasks)
- Explicit dependencies with cycle detection
- Priority scoring
- Claim/release with lease expiry

```
Epic: "User Authentication"
├── Task: "Design schema" ✓ done
├── Task: "Implement service" ● ready (unblocked)
│   └── blocks: "Write tests", "Add endpoints"
└── Task: "Write tests" ○ blocked
```

**Research in progress:**
- LLM-based reprioritization
- Automatic task decomposition

### 3. Worker System

**Working today:**
- `runWorker()` with execute/captureIO hooks
- Lease-based claims (prevents collisions)
- Automatic lease renewal
- Coordinator reconciliation (dead worker recovery)

```typescript
runWorker({
  execute: async (task, ctx) => {
    await ctx.renewLease()  // For long tasks
    return { success: true }
  }
})
```

**Research in progress:**
- Daemon watching `~/.claude/projects/**/*.jsonl`
- Automatic learning extraction from sessions
- Confidence scoring for auto-promotion

---

## Worker Orchestration (TypeScript SDK)

For programmatic control, the TypeScript SDK provides `runWorker()` — a headless worker that executes tasks using your hooks.

### Two Hooks. That's It.

```typescript
import { runWorker } from "@jamesaphoenix/tx-core"

runWorker({
  name: "my-worker",
  execute: async (task, ctx) => {
    // YOUR LOGIC HERE
    console.log(`Working on: ${task.title}`)

    // Use ctx.renewLease() for long tasks
    await ctx.renewLease()

    // Return success or failure
    return { success: true, output: "Done!" }
  },
  captureIO: (runId, task) => ({
    transcriptPath: `.tx/runs/${runId}.jsonl`,
    stderrPath: `.tx/runs/${runId}.stderr`
  })
})
```

| Hook | Required | Purpose |
|------|----------|---------|
| `execute` | Yes | Your task execution logic |
| `captureIO` | No | Paths for transcript/stderr/stdout capture |

### WorkerContext

The `ctx` object provides tx primitives:

```typescript
interface WorkerContext {
  workerId: string              // This worker's ID
  runId: string                 // Unique ID for this execution
  renewLease: () => Promise<void>  // Extend lease for long tasks
  log: (message: string) => void   // Log with worker prefix
  state: Record<string, unknown>   // Mutable state within task
}
```

### Custom Context

Pass your own primitives via generics:

```typescript
interface MyContext {
  llm: AnthropicClient
  db: Database
}

runWorker<MyContext>({
  context: {
    llm: new Anthropic(),
    db: myDatabase
  },
  execute: async (task, ctx) => {
    // ctx.llm and ctx.db available here
    const response = await ctx.llm.messages.create(...)
    return { success: true }
  }
})
```

### Claims and Leases

Workers use a lease-based system to prevent collisions:

```
Worker A claims task → Lease expires in 30 min → Renew or lose it
Worker B tries to claim same task → Rejected (already claimed)
Worker A dies → Lease expires → Coordinator reclaims task
```

Key points:
- **Claims are atomic** — only one worker can claim a task
- **Leases expire** — prevents stuck tasks from dead workers
- **Auto-renewal** — `runWorker()` renews automatically; use `ctx.renewLease()` for extra-long tasks
- **Coordinator reconciles** — dead workers detected, orphaned tasks recovered

### Example Worker Loops

#### Basic: One Worker

```typescript
import { Effect, Layer } from "effect"
import { runWorker, makeMinimalLayer, SqliteClientLive } from "@jamesaphoenix/tx-core"

const layer = makeMinimalLayer.pipe(
  Layer.provide(SqliteClientLive(".tx/tasks.db"))
)

Effect.runPromise(
  runWorker({
    execute: async (task, ctx) => {
      ctx.log(`Processing: ${task.title}`)
      // ... your logic
      return { success: true }
    }
  }).pipe(Effect.provide(layer))
)
```

#### With Claude Code

```typescript
import { spawn } from "child_process"

runWorker({
  execute: async (task, ctx) => {
    return new Promise((resolve) => {
      const proc = spawn("claude", [
        "--print",
        `Work on task ${task.id}: ${task.title}`
      ])

      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          error: code !== 0 ? `Exit code ${code}` : undefined
        })
      })
    })
  }
})
```

#### Parallel Workers

```typescript
// Start N workers (each in its own process or fiber)
for (let i = 0; i < 5; i++) {
  Effect.fork(
    runWorker({
      name: `worker-${i}`,
      execute: async (task, ctx) => {
        // Workers automatically coordinate via claims
        return { success: true }
      }
    })
  )
}
```

#### Long-Running Tasks

```typescript
runWorker({
  execute: async (task, ctx) => {
    for (let step = 0; step < 100; step++) {
      // Periodic lease renewal for tasks > 30 min
      if (step % 10 === 0) {
        await ctx.renewLease()
      }

      // Track progress in mutable state
      ctx.state.progress = step

      await doExpensiveWork(step)
    }
    return { success: true }
  }
})
```

---

## Interfaces

| Interface | Use Case |
|-----------|----------|
| **CLI** | Scripts, terminal workflows, RALPH loops |
| **MCP Server** | Claude Code integration (16 tools) |
| **REST API** | Custom dashboards, external integrations |
| **TypeScript SDK** | Programmatic access from your agents |
| **Dashboard** | Visual monitoring and management |

---

## Quick Reference

```bash
# Tasks
tx add <title>              # Create
tx ready                    # List unblocked
tx done <id>                # Complete
tx block <id> <blocker>     # Add dependency
tx tree <id>                # Show hierarchy

# Memory
tx learning:add <content>   # Store
tx learning:search <query>  # Find
tx context <task-id>        # Contextual retrieval

# Coordination
tx claim <id>               # Prevent collisions
tx handoff <id> --to <agent>
tx checkpoint <id> --note "..."

# Sync
tx sync export              # SQLite → JSONL (git-friendly)
tx sync import              # JSONL → SQLite
```

---

## Storage

```
.tx/
├── tasks.db           # SQLite (gitignored)
├── tasks.jsonl        # Git-tracked
├── learnings.jsonl    # Git-tracked
└── runs.jsonl         # Git-tracked
```

Local SQLite for speed. JSONL for git sync. Branch your knowledge with your code.

---

## Status

**Shipping now (concrete, tested):**
- Core task primitives: add, ready, done, block, claim, handoff
- Dependency management with cycle detection
- Worker orchestration via `runWorker()` with claims/leases
- Learnings with file path tagging
- Hybrid search (BM25 + vector)
- CLI (20+ commands), MCP server (16 tools)
- 389+ tests

**Research in progress (not yet stable):**
- Symbol anchoring (AST-based code references)
- Knowledge graph expansion
- Auto-invalidation when code changes
- Daemon-based learning extraction
- LLM reprioritization

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)**: Doctrine and quick reference
- **[docs/](docs/)**: Full documentation (17 PRDs, 17 Design Docs)

### Docs Site

Run the documentation site locally:

```bash
cd apps/docs
npm run dev    # Development server at http://localhost:3000
npm run build  # Production build
npm run start  # Serve production build
```

The docs site is built with [Fumadocs](https://fumadocs.vercel.app/) and Next.js, featuring full-text search, syntax highlighting, and automatic navigation from the markdown files in `docs/`.

---

## License

MIT
