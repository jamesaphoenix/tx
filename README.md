# tx

**Primitives, not frameworks.** Headless infrastructure for AI agents.

Memory, tasks, and orchestration. You own the loop.

```bash
npm install -g @jamesaphoenix/tx-cli
tx init
```

Agent onboarding (optional, both supported):

```bash
tx init --claude            # CLAUDE.md + .claude/skills
tx init --codex             # AGENTS.md + .codex/agents
tx init --claude --codex    # scaffold both
```

Watchdog onboarding (optional, default off):

```bash
tx init --watchdog                         # scaffold watchdog assets with runtime auto-detect
tx init --watchdog --watchdog-runtime codex
tx init --watchdog --watchdog-runtime both
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
│   tx claim     tx block     tx sync       tx trace      │
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
tx learning:add "Redis cache invalidation has race conditions" -c database

# Attach learnings to file paths
tx learn "src/auth/*.ts" "Services must use Effect-TS patterns"

# Retrieve via search or task context
tx learning:search "authentication"
tx context tx-abc123  # Get relevant learnings for a task
tx recall "src/auth/hash.ts"  # Recall learnings for a file
```

Hybrid search (BM25 + vector with RRF fusion) finds relevant knowledge.

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

Lease-based claims prevent parallel agents from colliding.

```bash
tx claim tx-abc123 worker-1          # Claim with 30-min lease
tx claim tx-abc123 worker-1 --lease 60  # Custom lease duration
tx claim:renew tx-abc123 worker-1    # Extend lease
tx claim:release tx-abc123 worker-1  # Release early
```

### Attempts

Track what approaches have been tried on a task.

```bash
tx try tx-abc123 "Used Redux" --failed "Too complex for this use case"
tx try tx-abc123 "Used Zustand" --succeeded
tx attempts tx-abc123  # See all attempts
```

### Docs

Structured documentation as primitives. YAML-based with versioning, locking, and linking.

```bash
tx doc add prd auth-system --title "Auth System PRD"
tx doc render           # Generate markdown from YAML
tx doc lock auth-system # Lock doc (immutable)
tx doc link auth-prd auth-dd  # Link PRD to DD
tx doc drift            # Detect stale docs
```

### Invariants

Track and verify project invariants across sessions.

```bash
tx invariant list                          # List all invariants
tx invariant show INV-001                  # Show details
tx invariant record INV-001 --passed       # Record check result
tx invariant sync                          # Sync from CLAUDE.md
```

### Cycle Scan

Sub-agent swarm scanning for codebase analysis.

```bash
tx cycle --task-prompt "Review auth" --scan-prompt "Find bugs"
```

---

## Your Loop, Your Rules

We ship **example loops**, not **the loop**:

```bash
# Simple: one agent, one task
AGENT_CMD=${AGENT_CMD:-codex}  # or: claude
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  "$AGENT_CMD" "Work on task $task, then run: tx done $task"
done
```

```bash
# Parallel: N agents with claims
AGENT_CMD=${AGENT_CMD:-codex}  # or: claude
for i in {1..5}; do
  (while task=$(tx ready --json --limit 1 | jq -r '.[0].id // empty'); do
    [ -z "$task" ] && break
    tx claim "$task" "worker-$i" || continue
    "$AGENT_CMD" "Complete $task" && tx done "$task"
  done) &
done
wait
```

```bash
# Human-in-loop: agent proposes, human approves
AGENT_CMD=${AGENT_CMD:-codex}  # or: claude
task=$(tx ready --json --limit 1 | jq -r '.[0].id')
"$AGENT_CMD" "Plan implementation for $task" > plan.md
read -p "Approve? [y/n] " && "$AGENT_CMD" "Execute plan.md"
tx done $task
```

**The flow is yours.** Serial, parallel, swarm, human-in-loop. Your call.

---

## Watchdog (Opt-In)

Use watchdog when you want detached, self-healing RALPH loops that can survive terminal closes and reconcile stale runs/tasks automatically.

Use it for:
- Long-running unattended execution
- Automatic stalled-run reaping and orphan task reset
- Background supervision through launchd/systemd

Skip it for:
- Short interactive sessions
- One-off local runs you supervise manually

Quick start:

```bash
tx init --watchdog --watchdog-runtime auto
./scripts/watchdog-launcher.sh start
./scripts/watchdog-launcher.sh status
```

Detailed rollout, detached service setup, rollback, and troubleshooting:
- [Watchdog Runbook](https://txdocs.dev/docs/watchdog-runbook)

## Why tx?

|  | Native Tasks | CLAUDE.md | tx |
|---|---|---|---|
| **Persistence** | Session-scoped | File grows forever | Git-native, branch-aware |
| **Multi-agent** | Collisions | Manual coordination | Claim with lease expiry |
| **Knowledge** | Lost each session | Static dump | Hybrid search, contextual retrieval |
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

## Interfaces

| Interface | Use Case |
|-----------|----------|
| **CLI** | Scripts, terminal workflows, agent loops |
| **MCP Server** | Claude Code integration (42 tools) |
| **REST API** | Custom dashboards, external integrations |
| **TypeScript SDK** | Programmatic access from your agents |
| **Dashboard** | Visual monitoring and management |

---

## Quick Reference

```bash
# Tasks
tx add <title>              # Create task
tx list                     # List all tasks
tx ready                    # List unblocked tasks
tx show <id>                # View details
tx update <id>              # Update task fields
tx done <id>                # Complete task
tx reset <id>               # Reset to backlog
tx delete <id>              # Delete task
tx block <id> <blocker>     # Add dependency
tx unblock <id> <blocker>   # Remove dependency
tx children <id>            # List child tasks
tx tree <id>                # Show hierarchy

# Context & Learnings
tx learning:add <content>   # Store knowledge
tx learning:search <query>  # Search learnings
tx learning:recent          # Recent learnings
tx learning:helpful         # Mark as helpful
tx learning:embed           # Generate embeddings
tx context <task-id>        # Contextual retrieval
tx learn <path> <note>      # Attach to file
tx recall [path]            # Query by file

# Coordination
tx claim <id> <worker>      # Lease-based claim
tx claim:renew <id> <worker>  # Extend lease
tx claim:release <id> <worker>  # Release early
tx try <id> <approach>      # Record attempt
tx attempts <id>            # List attempts

# Docs
tx doc add <type> <slug>    # Create doc
tx doc edit <slug>          # Edit doc
tx doc show <slug>          # Show doc
tx doc list                 # List docs
tx doc render               # Generate markdown
tx doc lock <slug>          # Lock (immutable)
tx doc version <slug>       # Create version
tx doc link <from> <to>     # Link docs
tx doc attach <slug> <task> # Attach to task
tx doc patch <slug>         # Apply patch
tx doc validate             # Validate all docs
tx doc drift                # Detect stale docs

# Invariants
tx invariant list           # List invariants
tx invariant show <id>      # Show details
tx invariant record <id>    # Record check result
tx invariant sync           # Sync from CLAUDE.md

# Sync
tx sync export              # SQLite → JSONL (git-friendly)
tx sync import              # JSONL → SQLite
tx sync status              # Show sync status
tx sync auto                # Auto-sync on change
tx sync compact             # Compact JSONL files
tx sync claude --team <name>  # Push to Claude Code team
tx sync codex               # Push to Codex

# Traces
tx trace list               # Recent runs
tx trace show <id>          # Show trace details
tx trace transcript <id>    # View transcript
tx trace stderr <id>        # View stderr
tx trace errors             # Recent errors

# Bulk
tx bulk done <ids...>       # Complete multiple tasks
tx bulk score <ids...>      # Score multiple tasks
tx bulk reset <ids...>      # Reset multiple tasks
tx bulk delete <ids...>     # Delete multiple tasks

# Cycle
tx cycle                    # Sub-agent swarm scan

# Utilities
tx stats                    # Queue metrics
tx validate                 # Database health checks
tx migrate status           # Migration status
tx doctor                   # System diagnostics
tx dashboard                # Launch dashboard
tx mcp-server               # Start MCP server
```

---

## Storage

```
.tx/
├── tasks.db           # SQLite (gitignored)
├── tasks.jsonl        # Git-tracked
├── learnings.jsonl    # Git-tracked
├── runs.jsonl         # Git-tracked
└── docs/              # YAML doc sources
```

Local SQLite for speed. JSONL for git sync. Branch your knowledge with your code.

---

## Packages

| Package | Description |
|---------|-------------|
| [`@jamesaphoenix/tx`](https://www.npmjs.com/package/@jamesaphoenix/tx) | Public SDK |
| [`@jamesaphoenix/tx-cli`](https://www.npmjs.com/package/@jamesaphoenix/tx-cli) | CLI |
| [`@jamesaphoenix/tx-core`](https://www.npmjs.com/package/@jamesaphoenix/tx-core) | Core service layer (Effect-TS) |
| [`@jamesaphoenix/tx-types`](https://www.npmjs.com/package/@jamesaphoenix/tx-types) | Shared type definitions |
| [`@jamesaphoenix/tx-agent-sdk`](https://www.npmjs.com/package/@jamesaphoenix/tx-agent-sdk) | TypeScript Agent SDK |
| [`@jamesaphoenix/tx-mcp-server`](https://www.npmjs.com/package/@jamesaphoenix/tx-mcp-server) | MCP server (42 tools) |
| [`@jamesaphoenix/tx-api-server`](https://www.npmjs.com/package/@jamesaphoenix/tx-api-server) | REST API server |

---

## Documentation

- **[txdocs.dev](https://txdocs.dev)**: Documentation
- **[CLAUDE.md](https://github.com/jamesaphoenix/tx/blob/main/CLAUDE.md)**: Doctrine and quick reference
- **[AGENTS.md](https://github.com/jamesaphoenix/tx/blob/main/AGENTS.md)**: Codex onboarding and quick reference
- **[PRDs](https://txdocs.dev/docs/prd)** and **[Design Docs](https://txdocs.dev/docs/design)**: Product and architecture specs

---

## License

MIT
