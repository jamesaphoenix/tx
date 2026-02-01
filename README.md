# tx

**TanStack for AI agents.** Primitives, not frameworks.

Headless infrastructure for memory, tasks, and orchestration.

| System | What it does |
|--------|--------------|
| **Knowledge** | Graph RAG, learnings, contextual retrieval, code anchoring |
| **Tasks** | Dependencies, hierarchy, ready detection, multi-agent orchestration |
| **Workers** | Background daemon, auto-extraction, invalidation, agent swarms |

## The Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   CAPTURE           CONNECT            COORDINATE         SURFACE          │
│                                                                             │
│   Claude Code   →   Knowledge      →   Task Graph    →   Runtime           │
│   transcripts       Graph               + Workers        Injection          │
│                                                                             │
│   - JSONL watch     - File anchors      - Dependencies   - Claude hooks    │
│   - LLM extract     - Symbol links      - Ready detect   - BM25 + vector   │
│   - Auto-promote    - Co-change edges   - Agent swarm    - Graph expand    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Memory that compounds. Tasks that coordinate. Workers that automate.**

## Why tx?

| | Native Tasks | Manual CLAUDE.md | tx |
|---|--------------|------------------|-----|
| **Persistence** | Account-scoped | File grows forever | Git-native, branch-scoped |
| **Knowledge** | None | Static dump | Graph RAG, contextual retrieval |
| **Automation** | None | None | Background daemon, auto-extraction |
| **Multi-agent** | Single conversation | Manual handoff | Shared task graph, RALPH loop |
| **Code awareness** | None | None | Symbol anchoring, co-change analysis |

## Primitives, Not Frameworks

**Headless agent infrastructure.** You bring the orchestration, we bring the primitives.

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

Like TanStack gives you headless UI primitives, tx gives you headless agent primitives:

- **No opinions on orchestration** — Serial, parallel, swarm, human-in-loop. Your call.
- **Powerful defaults** — `tx ready` just works. So does dependency resolution.
- **Escape hatches everywhere** — Raw SQL access, JSONL export, custom scoring.
- **Framework agnostic** — CLI, MCP, REST API, TypeScript SDK. Use what fits.

We ship **example loops**, not **the loop**:

```bash
examples/loops/
├── simple-serial.sh       # One agent, one task at a time
├── parallel-workers.sh    # N agents pulling from ready queue
├── coordinator.sh         # One agent delegates to others
├── specialist-routing.sh  # Route tasks by type
└── human-in-loop.sh       # Agent proposes, human approves
```

**Frameworks lock you in. Libraries let you compose.**

## Quick Start

```bash
npm install -g @jamesaphoenix/tx

tx init
```

### Use Case: I want persistent memory

```bash
# Add learnings manually
tx learning:add "Use bcrypt for passwords, not SHA256"
tx learning:add "Redis caching has race conditions on invalidation"

# Search learnings
tx learning:search "authentication"

# Get contextual learnings for a task
tx context tx-abc123
```

### Use Case: I want task management

```bash
# Create tasks with dependencies
tx add "Implement user authentication" --score 800
tx add "Design auth schema" --parent tx-a1b2c3
tx block tx-impl tx-schema  # impl blocked by schema

# Work on what's ready
tx ready                    # Highest-priority unblocked tasks
tx done tx-schema           # Complete → unblocks dependents
```

### Use Case: I want automation

```bash
# Start the background daemon (watches Claude Code transcripts)
tx daemon start

# Daemon automatically:
# - Extracts learnings from sessions
# - Scores confidence (high/medium/low)
# - Auto-promotes high-confidence learnings
# - Queues others for review

tx daemon review            # Review pending candidates
tx daemon status            # Check daemon health
```

## Three Systems

### 1. Knowledge System

Learnings connected to code via a knowledge graph.

```
Learning: "Always validate JWT expiry before processing"
    │
    ├── ANCHORED_TO → src/auth/jwt-service.ts (symbol: validateToken)
    ├── DERIVED_FROM → Run tx-run-abc123 (provenance)
    └── SIMILAR_TO → Learning #42 (semantic cluster)
```

**Features:**
- **Hybrid search** — BM25 + vector similarity + graph expansion
- **Code anchoring** — Link learnings to files, symbols, line ranges
- **Graph traversal** — Working on `auth.ts` surfaces learnings from related `jwt.ts`
- **Invalidation** — Auto-detect when anchored code changes

```bash
tx learning:add "Use constant-time comparison for signatures"
tx graph:link 42 src/crypto.ts --anchor-type symbol
tx graph:neighbors 42 --depth 2
```

### 2. Task System

Dependency-aware task management for multi-agent workflows.

```
Epic: "User Authentication"
├── Task: "Design schema" (done)
├── Task: "Implement service" (ready - unblocked)
│   ├── blocked-by: "Design schema" ✓
│   └── blocks: "Write tests", "Add API endpoints"
└── Task: "Write tests" (blocked)
```

**Features:**
- **N-level hierarchy** — Epics → Milestones → Tasks → Subtasks
- **Explicit dependencies** — `tx block` / `tx unblock`
- **Ready detection** — Only surface unblocked work
- **Priority scoring** — Configurable, LLM-assisted reprioritization

```bash
tx add "Implement auth" --score 800
tx block tx-impl tx-schema
tx ready --json              # Returns only unblocked tasks
tx tree tx-epic              # Show full hierarchy
```

### 3. Worker System

Background automation that keeps knowledge current.

```
~/.claude/projects/**/*.jsonl
         ↓
   [Daemon watches]
         ↓
   Parse → Extract → Score → Promote
         ↓
   Learning with provenance edges
```

**Features:**
- **JSONL daemon** — Watches Claude Code transcripts
- **LLM extraction** — Identifies learnings from sessions
- **Confidence scoring** — High confidence auto-promotes
- **Agent swarms** — Parallel verification after refactors
- **Self-healing** — Updates anchors when code drifts

```bash
tx daemon start              # Start background watcher
tx daemon process            # One-shot processing
tx graph:verify              # Verify all anchors
tx graph:verify --swarm      # Parallel verification
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Interfaces                                      │
├──────────┬──────────┬──────────┬──────────┬──────────────┬─────────────────┤
│   CLI    │   MCP    │   API    │  Agent   │  Dashboard   │     Daemon      │
│          │  Server  │  Server  │   SDK    │              │                 │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬───────┴────────┬────────┘
     │          │          │          │            │                │
     └──────────┴──────────┴──────────┴────────────┴────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │           @tx/core                │
                    │        Effect-TS Services         │
                    ├───────────────────────────────────┤
                    │  TaskService    LearningService   │
                    │  GraphService   DaemonService     │
                    │  ReadyService   SyncService       │
                    └─────────────────┬─────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │         Repository Layer          │
                    ├───────────────────────────────────┤
                    │  TaskRepo       LearningRepo      │
                    │  GraphRepo      CandidateRepo     │
                    │  DependencyRepo AnchorRepo        │
                    └─────────────────┬─────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │       SQLite + JSONL Sync         │
                    │   .tx/tasks.db (local truth)      │
                    │   .tx/*.jsonl (git-tracked)       │
                    └───────────────────────────────────┘
```

### Monorepo Structure

```
tx/
├── packages/
│   ├── core/              # Effect-TS services, repos, schemas
│   └── types/             # Shared TypeScript types
├── apps/
│   ├── cli/               # tx command
│   ├── mcp-server/        # Claude Code integration
│   ├── api-server/        # REST/HTTP API
│   ├── dashboard/         # Web monitoring UI
│   └── agent-sdk/         # TypeScript SDK
├── migrations/            # SQL schema (versioned)
└── scripts/               # RALPH loop, CI checks
```

## Multi-Agent Orchestration

### RALPH Loop

Fresh agent instances handle single tasks. Memory persists through files, not conversation history.

```bash
./scripts/ralph.sh           # Run until all tasks done
./scripts/ralph.sh --max 10  # Run at most 10 iterations
```

```
while tasks remain:
    task = tx ready --limit 1
    spawn claude --task $task
    # Agent reads learnings, does work, marks done
    # New learnings captured for next agent
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

Dynamic context injection via hooks:

```
.claude/settings.json
├── SessionStart     → Inject recent learnings
├── UserPromptSubmit → Search learnings for task/prompt
├── PostToolUse      → Capture learnings from failures
├── Stop             → Extract learnings before session ends
└── PreCompact       → Preserve context before summarization
```

**Result:** Agents start with relevant context. Knowledge compounds. Failures become learnings.

## Git-Backed Persistence

```
.tx/
├── tasks.db           # SQLite (gitignored, local truth)
├── tasks.jsonl        # Git-tracked
├── learnings.jsonl    # Git-tracked
├── runs.jsonl         # Git-tracked
└── daemon.pid         # Daemon process ID
```

```bash
tx sync export         # SQLite → JSONL
tx sync import         # JSONL → SQLite
tx sync status         # Show sync state
```

## CLI Reference

### Tasks
```bash
tx add <title>              # Create task
tx list                     # List all tasks
tx ready                    # List ready (unblocked) tasks
tx show <id>                # Show task details
tx done <id>                # Complete task
tx delete <id>              # Delete task
tx block <id> <blocker>     # Add dependency
tx unblock <id> <blocker>   # Remove dependency
tx tree <id>                # Show subtree
```

### Learnings
```bash
tx learning:add <content>   # Add a learning
tx learning:search <query>  # Search (BM25 + vector)
tx learning:recent          # Recent learnings
tx context <task-id>        # Contextual learnings for task
```

### Graph
```bash
tx graph:link <id> <file>   # Link learning to file
tx graph:show <id>          # Show learning's graph
tx graph:neighbors <id>     # Find connected nodes
tx graph:verify             # Verify all anchors
tx graph:analyze-imports    # Build import graph
```

### Daemon
```bash
tx daemon start             # Start background daemon
tx daemon stop              # Stop daemon
tx daemon status            # Check daemon health
tx daemon review            # Review pending candidates
tx daemon promote <id>      # Manually promote candidate
```

### Sync
```bash
tx sync export              # Export to JSONL
tx sync import              # Import from JSONL
tx sync status              # Show sync state
```

### LLM Features (requires ANTHROPIC_API_KEY)
```bash
tx dedupe                   # Find duplicate tasks
tx compact                  # Summarize completed tasks
tx reprioritize             # LLM-based rescoring
```

## Current Status

**Stable:**
- Core task management (CRUD, dependencies, hierarchy)
- Learnings system (add, search, context)
- Attempt tracking
- CLI (20+ commands)
- MCP server (16 tools)
- JSONL sync for tasks
- Dashboard (basic)
- 389+ passing tests

**In Progress:**
- Graph RAG (knowledge graph, anchoring)
- JSONL daemon (telemetry extraction)
- Dashboard UX improvements
- Vector similarity search

**Planned:**
- Agent swarm verification
- Real-time WebSocket updates
- Cross-file graph expansion
- Anchor invalidation system

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Doctrine rules, quick reference
- **[docs/index.md](docs/index.md)** — Full documentation index
- **[docs/prd/](docs/prd/)** — Product Requirements (17 PRDs)
- **[docs/design/](docs/design/)** — Technical Design (17 DDs)

## Development

```bash
npm install                 # Install dependencies
npm run build               # Build all packages
npm test                    # Run tests
./scripts/check.sh --all    # Context-efficient checks
./scripts/ralph.sh          # Run RALPH loop
```

## License

MIT
