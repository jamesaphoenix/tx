# tx

A lean task management system for AI agents and humans, built with Effect-TS.

## Why

AI coding agents lose context across sessions. Markdown plans go stale, git issue trackers are designed for humans, and session-scoped todo lists vanish when the conversation ends.

**tx** gives agents a persistent, queryable, dependency-aware task store that works across sessions and can be programmatically manipulated through CLI, MCP, or TypeScript API.

## Core Ideas

- **Persistent** -- Tasks survive across agent sessions and machine restarts via SQLite
- **Fast** -- Sub-100ms queries for common operations (list, ready, get)
- **Dependency-aware** -- Explicit blocking relationships so agents never work on blocked tasks
- **Ready detection** -- `tx ready` returns the highest-priority unblocked tasks, sorted by score
- **Hierarchical** -- Flexible N-level nesting (epics, milestones, tasks, subtasks)
- **Multi-interface** -- CLI for humans, MCP server for Claude Code, TypeScript API for custom agents
- **Minimal** -- Single dependency (SQLite), no external services required for core features
- **LLM-optional** -- Core commands work without an API key; LLM features (dedupe, compact, reprioritize) use Claude when available

## How It Works

```
tx add "Implement authentication" --score 800
tx add "Design auth schema" --parent tx-a1b2c3
tx block tx-d4e5f6 tx-a1b2c3
tx ready                          # returns highest-priority unblocked tasks
tx done tx-a1b2c3                 # completes task, unblocks dependents
```

Agents query `tx ready` to pick up work, create subtasks as they decompose problems, and mark tasks done to unblock the next piece of work. Humans review, reprioritize, and add context.

## Architecture

```
CLI / MCP Server / TypeScript API
         |
    Service Layer (Effect-TS)
    TaskService, ReadyService, ScoreService, HierarchyService
         |
    Repository Layer
    TaskRepository, DependencyRepository
         |
    SQLite (better-sqlite3, WAL mode)
```

All business logic uses Effect-TS for typed errors, service composition, and layer-based dependency injection. Two layer configurations:

- **AppMinimalLive** -- No LLM, used by CLI core commands, MCP server, Agent SDK
- **AppLive** -- Includes LLM, used by dedupe/compact/reprioritize

## Status Lifecycle

```
backlog -> ready -> planning -> active -> blocked -> review -> human_needs_to_review -> done
```

A task is **ready** when its status is workable and all blockers have status `done`.

## Interfaces

| Interface | Consumer | Protocol |
|-----------|----------|----------|
| CLI (`tx`) | Humans, scripts | stdin/stdout (text or JSON) |
| MCP Server | Claude Code | JSON-RPC over stdio |
| TypeScript API | Custom agents | Effect types |
| Agent SDK | Anthropic SDK | Tool definitions |

## LLM Features (optional)

These commands require `ANTHROPIC_API_KEY`:

- **`tx dedupe`** -- Find and merge semantically duplicate tasks
- **`tx compact`** -- Summarize completed tasks, extract learnings, export to CLAUDE.md
- **`tx reprioritize`** -- LLM recalculates scores based on context

## RALPH Loop — Autonomous Development

tx uses an adapted [RALPH loop](https://ghuntley.com/ralph) for autonomous development. Fresh agent instances are spawned per task — memory persists through files (CLAUDE.md, git, `.tx/tasks.db`), not conversation history.

```bash
./scripts/ralph.sh           # Run until all tasks done
./scripts/ralph.sh --max 10  # Run at most 10 iterations
```

The orchestrator picks the highest-priority task from `tx ready`, dispatches it to a specialized agent, and loops until all work is complete.

### Specialized Agents

Agents are defined as markdown files in `.claude/agents/`:

| Agent | Role |
|-------|------|
| `tx-planner` | Research codebase, create implementation plan, decompose into subtasks |
| `tx-implementer` | Write Effect-TS code for a single task, following doctrine |
| `tx-reviewer` | Review code changes against all 7 doctrine rules |
| `tx-tester` | Write integration tests with SHA256 deterministic fixtures |
| `tx-decomposer` | Break large tasks into atomic subtasks for single iterations |

Agents can also be used programmatically via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agent-sdk).

## Project Structure

```
tx/
├── CLAUDE.md              # Doctrine, PRDs, design docs
├── .claude/
│   └── agents/            # Specialized agent definitions
│       ├── tx-planner.md
│       ├── tx-implementer.md
│       ├── tx-reviewer.md
│       ├── tx-tester.md
│       └── tx-decomposer.md
├── scripts/
│   └── ralph.sh           # RALPH loop orchestrator
├── docs/
│   ├── prd/               # Product Requirements Documents
│   └── design/            # Design Documents
└── src/                   # Implementation
```

## License

MIT
