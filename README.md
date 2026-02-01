# tx

**TanStack for AI agents.** Primitives, not frameworks.

Headless infrastructure for memory, tasks, and orchestration.

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
# Store knowledge
tx learning:add "Use bcrypt for passwords, not SHA256"
tx learning:add "Redis cache invalidation has race conditions"

# Retrieve contextually
tx learning:search "authentication"
tx context tx-abc123  # Get relevant learnings for a task
```

Learnings connect to code via a knowledge graph. Working on `auth.ts` automatically surfaces learnings from related files.

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

## Three Systems

### 1. Knowledge System

```
Learning: "Always validate JWT expiry"
    ├── ANCHORED_TO → src/auth/jwt.ts:validateToken
    ├── DERIVED_FROM → session tx-run-abc123
    └── SIMILAR_TO → Learning #42 (semantic)
```

- Hybrid search (BM25 + vector + graph expansion)
- Code anchoring with symbol resolution
- Auto-invalidation when code changes

### 2. Task System

```
Epic: "User Authentication"
├── Task: "Design schema" ✓ done
├── Task: "Implement service" ● ready (unblocked)
│   └── blocks: "Write tests", "Add endpoints"
└── Task: "Write tests" ○ blocked
```

- N-level hierarchy
- Explicit dependencies with cycle detection
- Priority scoring with optional LLM reprioritization

### 3. Worker System

```
Claude Code sessions → Daemon → Extract → Score → Promote
```

- Watches `~/.claude/projects/**/*.jsonl`
- Extracts learnings with confidence scoring
- Auto-promotes high-confidence, queues others for review

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

**Stable:** Core tasks, learnings, CLI (20+ commands), MCP server (16 tools), 389+ tests

**In Progress:** Knowledge graph, daemon extraction, vector search

**Planned:** Agent swarms, anchor invalidation, real-time sync

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)**: Doctrine and quick reference
- **[docs/](docs/)**: Full documentation (17 PRDs, 17 Design Docs)

---

## License

MIT
