# tx

**TanStack for AI agents.** Primitives, not frameworks.

Headless infrastructure for memory, tasks, and orchestration.

**Full documentation**: [docs/index.md](docs/index.md)

---

## Philosophy: Primitives, Not Frameworks

**This is the core design principle. Everything else flows from it.**

### Why Primitives?

The orchestration flow is where developers create value. It encodes their domain knowledge:
- How their codebase works
- What their agents are good at
- Where humans need to intervene
- How they handle failures

**If you dictate the flow, you're not a tool—you're a competitor.** You're saying "our orchestration is better than yours." But you don't know their domain, their constraints, or whether they need 3 agents or 30.

### The TanStack Model

TanStack won by saying: "Here's headless table logic. Style it yourself."

tx says: "Here's headless agent infrastructure. Orchestrate it yourself."

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

### Design Principles

- **No opinions on orchestration** — Serial, parallel, swarm, human-in-loop. Your call.
- **Powerful defaults** — `tx ready` just works. So does dependency resolution.
- **Escape hatches everywhere** — Raw SQL access, JSONL export, custom scoring.
- **Framework agnostic** — CLI, MCP, REST API, TypeScript SDK. Use what fits.
- **Local-first** — SQLite + git. No server required. Works offline.

### Core Primitives

| Primitive | Purpose |
|-----------|---------|
| `tx ready` | Get next workable task (unblocked, highest priority) |
| `tx claim <id>` | Mark task as being worked by an agent (prevents collision) |
| `tx done <id>` | Complete task, potentially unblocking others |
| `tx block <id> <blocker>` | Declare dependencies |
| `tx handoff <id> --to <agent>` | Transfer task with context |
| `tx checkpoint <id> --note "..."` | Save progress without completing |
| `tx context <id>` | Get relevant learnings + history for prompt injection |
| `tx learning:add` | Record knowledge for future agents |
| `tx sync export` | Persist to git-friendly JSONL |

### Example Loops (not THE loop)

We ship example orchestration patterns, not a required workflow:

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

**You own your orchestration. tx owns the primitives.**

**Frameworks lock you in. Libraries let you compose.**

### Three-Layer Architecture

```
┌─────────────────────────────────────────┐
│  Agent Orchestration                    │  ← Your code (examples provided)
├─────────────────────────────────────────┤
│  Task Management                        │  ← tx core (ready, block, done)
├─────────────────────────────────────────┤
│  Memory / Knowledge Graph               │  ← tx learnings + context
├─────────────────────────────────────────┤
│  Storage (Git + SQLite)                 │  ← Persistence layer
└─────────────────────────────────────────┘
```

### The Moat

The moat isn't task management—anyone can build that.

The moat is the **knowledge layer**:
- Learnings that surface automatically when relevant
- Code relationships that inform task planning
- Context that transfers across projects and sessions

This is what compounds. This is what makes agents smarter over time.

---

## DOCTRINE — INVIOLABLE RULES

These rules are non-negotiable. Any code that violates them is broken and must be fixed before merge.

### RULE 1: Every API response MUST include full dependency information

Every function, CLI command, MCP tool, and SDK method that returns task data MUST return `TaskWithDeps`:

```typescript
interface TaskWithDeps extends Task {
  blockedBy: TaskId[]   // task IDs that block this task
  blocks: TaskId[]      // task IDs this task blocks
  children: TaskId[]    // direct child task IDs
  isReady: boolean      // whether this task can be worked on
}
```

**NEVER** return a bare `Task` to external consumers. Hardcoding `blocks: []` is a bug.

→ [DD-005](docs/design/DD-005-mcp-agent-sdk-integration.md), [PRD-007](docs/prd/PRD-007-multi-interface-integration.md)

### RULE 2: Compaction MUST export learnings to a file agents can read

`tx compact` MUST append learnings to a markdown file (default: `CLAUDE.md`). Storing only in `compaction_log` table is insufficient.

```markdown
## Agent Learnings (YYYY-MM-DD)
- Learning bullet point 1
- Learning bullet point 2
```

→ [PRD-006](docs/prd/PRD-006-task-compaction-learnings.md), [DD-006](docs/design/DD-006-llm-integration.md)

### RULE 3: All core paths MUST have integration tests with SHA256 fixtures

Unit tests are insufficient. Integration tests MUST use:
- Real in-memory SQLite database
- Deterministic SHA256-based IDs via `fixtureId(name)`
- Coverage: CRUD, ready detection, dependencies, hierarchy, MCP tools

→ [DD-007](docs/design/DD-007-testing-strategy.md)

### RULE 4: No circular dependencies, no self-blocking

Enforce at database level:
- `CHECK (blocker_id != blocked_id)` — no self-blocking
- BFS cycle detection at insert time — no A→B→A chains

→ [DD-004](docs/design/DD-004-ready-detection-algorithm.md), [PRD-003](docs/prd/PRD-003-dependency-blocking-system.md)

### RULE 5: Effect-TS patterns are mandatory

All business logic MUST use Effect-TS:
- Services: `Context.Tag` + `Layer.effect`
- Errors: `Data.TaggedError` with union types
- Operations: return `Effect<T, E>`
- No raw try/catch or untyped Promises in service code

→ [DD-002](docs/design/DD-002-effect-ts-service-layer.md)

### RULE 6: Telemetry MUST NOT block operations

- OTEL packages are **optional peer dependencies**
- `TelemetryAuto`: auto-detect from `OTEL_EXPORTER_*` env vars
- No config → `TelemetryNoop` (zero overhead)
- Telemetry errors: catch and log, never propagate

→ [PRD-008](docs/prd/PRD-008-observability-opentelemetry.md), [DD-008](docs/design/DD-008-opentelemetry-integration.md)

### RULE 7: ANTHROPIC_API_KEY is optional for core commands

LLM features (`tx dedupe`, `tx compact`, `tx reprioritize`) require the key. Core commands do not.

| Layer | LLM | Used By |
|-------|-----|---------|
| `AppMinimalLive` | No | CLI core, MCP, Agent SDK |
| `AppLive` | Yes | dedupe, compact, reprioritize |

→ [DD-002](docs/design/DD-002-effect-ts-service-layer.md), [DD-006](docs/design/DD-006-llm-integration.md)

---

## Quick Reference

### Status Lifecycle

```
backlog → ready → planning → active → blocked → review → human_needs_to_review → done
```

A task is **ready** when: status is workable AND all blockers have status `done`.

### Key Technical Decisions

| Decision | Choice | Doc |
|----------|--------|-----|
| Storage | SQLite (better-sqlite3, WAL) | [DD-001](docs/design/DD-001-data-model-storage.md) |
| Sync | JSONL git-backed | [DD-009](docs/design/DD-009-jsonl-git-sync.md) |
| Framework | Effect-TS | [DD-002](docs/design/DD-002-effect-ts-service-layer.md) |
| CLI | @effect/cli | [DD-003](docs/design/DD-003-cli-implementation.md) |
| MCP | @modelcontextprotocol/sdk | [DD-005](docs/design/DD-005-mcp-agent-sdk-integration.md) |
| IDs | SHA256-based `tx-[a-z0-9]{6,8}` | [DD-001](docs/design/DD-001-data-model-storage.md) |
| Testing | Vitest + SHA256 fixtures | [DD-007](docs/design/DD-007-testing-strategy.md) |

### CLI Commands

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

## Bootstrapping: tx Builds tx

**All development on tx MUST use tx itself to manage work.**

### IMPORTANT: Use tx, NOT Built-in Task Tools

Claude Code has built-in task tools (TaskCreate, TaskUpdate, TaskList, etc.). **DO NOT USE THESE.**

Instead, use the tx CLI commands:
- `tx add` instead of TaskCreate
- `tx ready` instead of TaskList
- `tx show` instead of TaskGet
- `tx done` instead of TaskUpdate

The tx database is at `.tx/tasks.db`. Tasks persist across sessions and can be synced via git with `tx sync export`.

### Why Bootstrap?

- **Dogfooding** catches bugs before users do
- **Memory persists** through `.tx/tasks.db` and git-tracked `.tx/tasks.jsonl`
- **Fresh agent instances** avoid context pollution from failed attempts
- Tasks survive across sessions; conversation history does not

### RALPH Loop

One example orchestration pattern (not THE pattern):

```bash
while true; do
  TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
  [ -z "$TASK" ] && break

  claude --print "Read CLAUDE.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"

  git add -A && git commit -m "Complete $TASK"
done
```

**Key insight**: Each task gets a fresh Claude instance. No accumulated context pollution. Memory lives in files, not conversation history.

---

## For Detailed Information

- **PRDs** (what to build): [docs/prd/](docs/prd/)
- **Design Docs** (how to build): [docs/design/](docs/design/)
- **Full index**: [docs/index.md](docs/index.md)
