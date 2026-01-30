# tx

A lean task management system for AI agents and humans, built with Effect-TS.

## Vision

**The problem:** AI coding agents lose context across sessions. They repeat mistakes, forget learnings, and can't coordinate on complex multi-step work. Current solutions (markdown plans, git issues, session todos) are designed for humans, not agents.

**tx's approach:** Give agents a persistent, queryable, dependency-aware system that:
- **Remembers what worked** — Learnings persist across sessions and surface when relevant
- **Tracks what failed** — Attempts record approaches tried, preventing repeated failures
- **Coordinates work** — Dependencies ensure agents never work on blocked tasks
- **Enables autonomy** — RALPH loop runs agents unattended until tasks complete

**Where we're going:**
- Multi-agent orchestration with specialized agents (planner, implementer, reviewer, tester)
- Semantic search over learnings using local embeddings (node-llama-cpp)
- Real-time dashboard for monitoring agent progress
- TypeScript SDK for building custom agents
- Git-backed JSONL sync for team collaboration

## Quick Start

```bash
npm install -g @jamesaphoenix/tx

# Initialize
tx init

# Create tasks
tx add "Implement user authentication" --score 800
tx add "Design auth schema" --parent tx-a1b2c3

# Work on tasks
tx ready                    # Get highest-priority unblocked tasks
tx done tx-a1b2c3           # Complete task, unblocks dependents

# Track learnings
tx learning:add "Use bcrypt for password hashing, not SHA256"
tx context tx-d4e5f6        # Get relevant learnings for a task

# Sync for git backup
tx sync export
git add .tx/tasks.jsonl && git commit -m "Task updates"
```

## Core Features

### Task Management
- **Persistent** — SQLite storage survives sessions and restarts
- **Dependency-aware** — Explicit blocking prevents work on blocked tasks
- **Hierarchical** — N-level nesting (epics → milestones → tasks → subtasks)
- **Priority scoring** — `tx ready` returns highest-priority unblocked work

### Learnings System
- **Capture knowledge** — `tx learning:add` stores insights that persist
- **Contextual retrieval** — `tx context <task-id>` finds relevant learnings via BM25
- **File patterns** — `tx learn` attaches learnings to file paths/globs
- **Outcome tracking** — Mark learnings as helpful to improve future retrieval

### Attempt Tracking
- **Record approaches** — `tx try <id> "approach" --failed "reason"`
- **Prevent repetition** — See what was already tried before starting work
- **Learn from failure** — Failed attempts inform future approaches

### Multi-Interface
| Interface | Consumer | Protocol |
|-----------|----------|----------|
| CLI (`tx`) | Humans, scripts | stdin/stdout |
| MCP Server | Claude Code | JSON-RPC over stdio |
| API Server | Web apps, agents | REST/HTTP |
| Agent SDK | Custom agents | TypeScript |
| Dashboard | Humans | Web UI |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Interfaces                           │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│   CLI    │   MCP    │   API    │  Agent   │   Dashboard    │
│          │  Server  │  Server  │   SDK    │                │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴───────┬────────┘
     │          │          │          │             │
     └──────────┴──────────┴──────────┴─────────────┘
                           │
              ┌────────────┴────────────┐
              │      @tx/core           │
              │  Effect-TS Services     │
              │  TaskService            │
              │  LearningService        │
              │  ReadyService           │
              │  SyncService            │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │    Repository Layer     │
              │  TaskRepository         │
              │  LearningRepository     │
              │  DependencyRepository   │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │   SQLite + JSONL Sync   │
              │  .tx/tasks.db (local)   │
              │  .tx/*.jsonl (git)      │
              └─────────────────────────┘
```

### Planned Monorepo Structure

```
tx/
├── packages/
│   ├── core/              # Effect-TS services, repos, schemas
│   └── types/             # Shared TypeScript types (zero deps)
├── apps/
│   ├── cli/               # tx command
│   ├── mcp-server/        # Claude Code integration
│   ├── api-server/        # REST/HTTP API
│   ├── dashboard/         # Web monitoring UI
│   └── agent-sdk/         # TypeScript SDK for custom agents
├── migrations/            # SQL schema (versioned, immutable)
└── scripts/               # RALPH loop, CI checks
```

## RALPH Loop — Autonomous Development

tx uses the [RALPH pattern](https://ghuntley.com/ralph) for autonomous development. Fresh agent instances handle single tasks — memory persists through files, not conversation history.

```bash
./scripts/ralph.sh           # Run until all tasks done
./scripts/ralph.sh --max 10  # Run at most 10 iterations
```

### Specialized Agents

| Agent | Role |
|-------|------|
| `tx-planner` | Research codebase, create implementation plan |
| `tx-implementer` | Write code for a single task |
| `tx-reviewer` | Review against doctrine rules |
| `tx-tester` | Write integration tests |
| `tx-decomposer` | Break large tasks into subtasks |

### Claude Code Hooks

tx includes hooks for autonomous operation:

- **Stop hook** — Blocks exit until task is marked done + tests pass
- **PostToolUse hook** — Injects recovery context on test/lint failures
- **PreToolUse hook** — Blocks dangerous commands (rm -rf, force push)
- **SessionStart hook** — Loads relevant task context and learnings

### Context-Efficient Output

Based on [HumanLayer's backpressure pattern](https://humanlayer.dev/blog/context-efficient-backpressure):

```bash
./scripts/check.sh --test
#  ✓ Tests — 389 passed (5s)     # Success: minimal output

./scripts/check.sh --test
#  ✗ Tests (5s)                   # Failure: FULL output, ALL errors
#  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  FAIL src/api.test.ts
#  ... every error shown ...
```

## Status Lifecycle

```
backlog → ready → planning → active → blocked → review → human_needs_to_review → done
```

A task is **ready** when: status is workable AND all blockers have status `done`.

## Git-Backed Persistence

```
.tx/
├── tasks.db           # SQLite (gitignored, local source of truth)
├── tasks.jsonl        # Git-tracked for backup/sharing
├── learnings.jsonl    # Git-tracked
└── runs.jsonl         # Agent run history
```

```bash
tx sync export         # Export SQLite → JSONL
tx sync import         # Import JSONL → SQLite
tx sync status         # Show sync state
```

## LLM Features (Optional)

Requires `ANTHROPIC_API_KEY`:

- **`tx dedupe`** — Find and merge duplicate tasks
- **`tx compact`** — Summarize completed tasks, extract learnings
- **`tx reprioritize`** — LLM recalculates priority scores

## Current Status

**Done:**
- Core task management (CRUD, dependencies, hierarchy)
- Learnings system (add, search, context)
- Attempt tracking
- CLI with 20+ commands
- MCP server with 16 tools
- JSONL sync for tasks
- Dashboard (basic)
- 389 passing tests

**In Progress:**
- Vector similarity search (embeddings)
- Monorepo refactoring
- Extended JSONL sync (learnings, attempts)
- Dashboard UX improvements

**Planned:**
- API server (REST/HTTP)
- Agent SDK
- Real-time WebSocket updates
- Multi-agent coordination

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Doctrine rules, quick reference
- **[docs/prd/](docs/prd/)** — Product Requirements Documents
- **[docs/design/](docs/design/)** — Technical Design Documents
- **[docs/index.md](docs/index.md)** — Full documentation index

## Development

```bash
# Install
npm install

# Build
npm run build

# Test
npm test

# Context-efficient checks (for agents)
./scripts/check.sh --all

# Run RALPH loop
./scripts/ralph.sh
```

## License

MIT
