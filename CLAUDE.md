# tx

A lean task management system for AI agents and humans, built with Effect-TS.

**Full documentation**: [docs/index.md](docs/index.md)

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

## Philosophy: Primitives, Not Frameworks

**Headless agent infrastructure.** You bring the orchestration, we bring the primitives.

Like TanStack gives you headless UI primitives, tx gives you headless agent primitives:

- **No opinions on orchestration** — Serial, parallel, swarm, human-in-loop. Your call.
- **Powerful defaults** — `tx ready` just works. So does dependency resolution.
- **Escape hatches everywhere** — Raw SQL access, JSONL export, custom scoring.
- **Framework agnostic** — CLI, MCP, REST API, TypeScript SDK. Use what fits.

### The Primitive Stack

```
┌─────────────────────────────────────────────────────────┐
│  Your Orchestration (your code, your rules)             │
├─────────────────────────────────────────────────────────┤
│  tx primitives                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐  │
│  │ tx ready│ │ tx claim│ │ tx done │ │ tx context    │  │
│  └─────────┘ └─────────┘ └─────────┘ └───────────────┘  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐  │
│  │ tx block│ │ tx learn│ │ tx sync │ │ tx handoff    │  │
│  └─────────┘ └─────────┘ └─────────┘ └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

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
examples/loops/
├── simple-serial.sh       # One agent, one task at a time
├── parallel-workers.sh    # N agents pulling from ready queue
├── coordinator.sh         # One agent delegates to others
├── specialist-routing.sh  # Route tasks to agents by type
└── human-in-loop.sh       # Agent proposes, human approves
```

**You own your orchestration. tx owns the primitives.**

Frameworks lock you in. Libraries let you compose.

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

The moat isn't task management—anyone can build that. The moat is the **knowledge layer**: learnings that surface automatically, code relationships that inform task planning, and context that transfers across projects and sessions.

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

### Project Structure

```
tx/
├── CLAUDE.md              # This file — doctrine + quick ref
├── docs/
│   ├── index.md           # Full documentation index
│   ├── prd/               # PRD-001 through PRD-009
│   └── design/            # DD-001 through DD-009
├── src/
│   ├── schemas/           # Effect Schema definitions
│   ├── services/          # Business logic (Effect services)
│   ├── repositories/      # Data access layer
│   ├── cli/               # CLI commands
│   ├── mcp/               # MCP server
│   └── layers/            # Effect layer composition
├── test/
│   ├── fixtures/          # SHA256-based test fixtures
│   ├── unit/              # Unit tests
│   └── integration/       # Integration tests
└── .tx/
    ├── tasks.db           # SQLite database (gitignored)
    └── tasks.jsonl        # Git-tracked sync file
```

### CLI Commands

```bash
# Core (no API key needed)
tx init                    # Initialize database
tx add <title>             # Create task
tx list                    # List tasks
tx ready                   # List ready tasks
tx show <id>               # Show task details
tx update <id>             # Update task
tx done <id>               # Complete task
tx delete <id>             # Delete task
tx block <id> <blocker>    # Add dependency
tx unblock <id> <blocker>  # Remove dependency
tx children <id>           # List children
tx tree <id>               # Show subtree

# Sync (no API key needed)
tx sync export             # Export to JSONL
tx sync import             # Import from JSONL
tx sync status             # Show sync state

# Learnings (no API key needed)
tx learning:add <content>  # Add a learning
tx learning:search <query> # Search learnings (BM25)
tx learning:recent         # List recent learnings
tx learning:helpful <id>   # Record helpfulness
tx context <task-id>       # Get contextual learnings for task

# LLM features (requires ANTHROPIC_API_KEY)
tx dedupe                  # Find duplicates
tx compact                 # Compact old tasks
tx reprioritize            # LLM rescoring
```

### Implementation Phases

1. **Phase 1 (v0.1.0)**: Core CRUD + hierarchy + CLI + tests
2. **Phase 2 (v0.2.0)**: MCP + JSONL sync + Agent SDK
3. **Phase 3 (v0.3.0)**: LLM features (dedupe, compact, scoring)
4. **Phase 4 (v1.0.0)**: Polish + performance + full coverage

---

## Bootstrapping: tx Builds tx

**Phase 1 CLI is now stable.** All development on tx MUST use tx itself to manage work.

### IMPORTANT: Use tx, NOT Built-in Task Tools

Claude Code has built-in task tools (TaskCreate, TaskUpdate, TaskList, etc.). **DO NOT USE THESE.**

Instead, use the tx CLI commands:
- `tx add` instead of TaskCreate
- `tx ready` instead of TaskList
- `tx show` instead of TaskGet
- `tx done` instead of TaskUpdate
- `tx list` to see all tasks

The tx database is at `.tx/tasks.db`. Tasks persist across sessions and can be synced via git with `tx sync export`.

### Post-Bootstrap Workflow
```bash
# 1. Pick highest-priority unblocked task
tx ready --json | head -1

# 2. Read task details
tx show <id>

# 3. Do the work (implement, test, review)

# 4. Mark complete (may unblock other tasks)
tx done <id>

# 5. If new work discovered, add subtasks
tx add "New subtask" --parent <id> --score 700

# 6. Sync for git backup
tx sync export
git add .tx/tasks.jsonl && git commit -m "Task updates"
```

### Why Bootstrap?
- **Dogfooding** catches bugs before users do
- **Memory persists** through `.tx/tasks.db` and git-tracked `.tx/tasks.jsonl`
- **Fresh agent instances** avoid context pollution from failed attempts
- Tasks survive across sessions; conversation history does not

### RALPH Loop: Autonomous Development

Run Claude as a subprocess to iterate on tasks automatically:

```bash
# scripts/ralph.sh - orchestrates the loop
while true; do
  # Get next task
  TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
  [ -z "$TASK" ] && break

  # Spawn fresh Claude instance for this task
  claude --print "$(cat <<EOF
Read CLAUDE.md for doctrine rules.
Your task: $TASK
Run: tx show $TASK
Implement it, run tests, then: tx done $TASK
EOF
)"

  # Checkpoint
  git add -A && git commit -m "Complete $TASK"
done
```

**Key insight**: Each task gets a fresh Claude instance. No accumulated context pollution. Memory lives in files (CLAUDE.md, git, .tx/tasks.db), not conversation history.

See `.claude/agents/` for specialized agent prompts (planner, implementer, reviewer, tester).

---

## For Detailed Information

- **PRDs** (what to build): [docs/prd/](docs/prd/)
- **Design Docs** (how to build): [docs/design/](docs/design/)
- **Full index**: [docs/index.md](docs/index.md)
