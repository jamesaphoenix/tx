# tx

**Institutional memory for AI agents.** Not a task manager — a knowledge system.

## Why tx?

Claude Code now has native task tools. Soon it'll have persistent tasks. Why build tx?

| Native Tasks | tx |
|--------------|-----|
| Persistent todos | **Institutional memory** |
| Task CRUD | Tasks + Learnings + Attempts |
| Single agent | Multi-agent orchestration |
| Account-scoped | Git-native (branch-scoped) |
| Vendor lock-in | Open source, self-hosted |

**tx isn't competing with task managers. It's building agent infrastructure.**

### What Makes tx Different

**1. Learnings System** — Knowledge that surfaces when relevant
```bash
tx learning:add "Use bcrypt for passwords, not SHA256"
tx context tx-abc123  # Retrieves learnings relevant to THIS task
```

**2. Attempt Tracking** — Never repeat failed approaches
```bash
tx try tx-abc123 "Tried Redis caching" --failed "Race condition on invalidation"
# Next agent sees what was already tried
```

**3. Multi-Agent Orchestration** — Specialized agents, shared task graph
```
Planner → Implementer → Reviewer → Tester
   ↓           ↓            ↓          ↓
   └───────── All share .tx/tasks.db ──┘
```

**4. Git-Native Collaboration** — Tasks travel with branches
```bash
tx sync export
git checkout -b feature/auth
# Tasks, learnings, attempts all version-controlled
```

**5. Dynamic Context Injection** — Learnings auto-surface via Claude Code hooks
```
┌─────────────────────────────────────────────────────────┐
│  User prompt: "Work on tx-abc123"                       │
│                      ↓                                  │
│  [Hook] tx context tx-abc123 → relevant learnings       │
│                      ↓                                  │
│  Agent sees: task + learnings + failed attempts         │
└─────────────────────────────────────────────────────────┘
```

### The Real Value

Tasks are the organizing principle. The value is:
- **Learnings that compound** — Every session makes future sessions smarter
- **Failed attempts that persist** — No more "let me try that approach" → "oh, that was tried"
- **Context retrieval** — BM25 + vector search finds what's relevant
- **Compaction** — LLM extracts wisdom from completed work

**Memory that outlives conversations.**

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

### Claude Code Hooks — Dynamic Context Injection

tx hooks into Claude Code to automatically inject relevant knowledge:

```
.claude/settings.json
├── SessionStart     → Inject recent learnings on session start
├── UserPromptSubmit → Search learnings based on prompt/task ID
├── PostToolUse      → Capture learnings from failures
├── Stop             → Extract learnings before session ends
└── PreCompact       → Preserve context before summarization
```

**How it works:**

```bash
# 1. Session starts → recent learnings injected
[Hook: SessionStart]
$ tx learning:recent -n 5
→ "## Recent Learnings from Past Sessions
   - [manual] Use bcrypt for passwords
   - [failure] Redis caching has race conditions"

# 2. User mentions task → contextual learnings injected
[Hook: UserPromptSubmit]
User: "Work on tx-abc123"
$ tx context tx-abc123
→ "## Relevant Learnings for Task tx-abc123
   - [manual] (score: 85%) Auth tokens expire in 24h
   - [attempt] (score: 72%) JWT approach failed: no refresh"

# 3. Command fails → learning captured
[Hook: PostToolUse]
$ npm test → FAIL
→ tx learning:add --source failure "Test failed: missing mock for DB"

# 4. Session ends → learnings extracted
[Hook: Stop]
→ tx learning:add "Completed auth flow using bcrypt + JWT refresh"
```

**The result:** Agents start each session with relevant context. Knowledge compounds across sessions. Failures become learnings.

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
