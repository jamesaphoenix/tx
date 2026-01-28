# tx

A lean task management system for AI agents and humans, built with Effect-TS.

---

## DOCTRINE — INVIOLABLE RULES

These rules are non-negotiable. Any code that violates them is broken and must be fixed before merge.

### RULE 1: Every API response MUST include full dependency information

Every function, CLI command, MCP tool, and SDK method that returns task data MUST return `TaskWithDeps`, which includes:

- `blockedBy: TaskId[]` — task IDs that block this task
- `blocks: TaskId[]` — task IDs this task blocks
- `children: TaskId[]` — direct child task IDs
- `isReady: boolean` — whether this task can be worked on

**NEVER** return a bare `Task` to any external consumer. Internal service-to-service calls may use `Task`, but anything that exits the system (CLI output, MCP response, SDK return, JSON export) MUST use `TaskWithDeps`.

Hardcoding dependency fields (e.g., `blocking: 0`) is a bug. Query the actual data.

Reference: [DD-005](docs/design/DD-005-mcp-agent-sdk-integration.md), [PRD-007](docs/prd/PRD-007-multi-interface-integration.md)

### RULE 2: Compaction MUST export learnings to a file agents can read

When `tx compact` runs, the generated learnings MUST be appended to a markdown file (default: `CLAUDE.md`, configurable via `--output`). Storing learnings only in the `compaction_log` database table is insufficient — no agent reads raw SQLite.

The export format:

```markdown
## Agent Learnings (YYYY-MM-DD)

- Learning bullet point 1
- Learning bullet point 2
```

The `compaction_log` table MUST also record `learnings_exported_to` so we can audit where learnings went.

Reference: [PRD-006](docs/prd/PRD-006-task-compaction-learnings.md), [DD-006](docs/design/DD-006-llm-integration.md)

### RULE 3: All core paths MUST have integration tests with SHA256 fixtures

Unit tests are not sufficient. The following MUST have integration tests against a real in-memory SQLite database:

- Task CRUD (create, get, getWithDeps, update, delete)
- Ready detection (correct filtering, blockedBy populated, blocks populated)
- Dependency operations (add blocker, remove blocker, cycle prevention, self-block prevention)
- Hierarchy operations (children, ancestors, tree)
- MCP tool responses (every tool returns TaskWithDeps with correct data)

Test fixtures MUST use deterministic SHA256-based IDs via `fixtureId(name)` so tests are reproducible across runs. Do not use random IDs in tests.

Reference: [DD-007](docs/design/DD-007-testing-strategy.md)

### RULE 4: No circular dependencies, no self-blocking

The system MUST prevent:
- A task blocking itself (`CHECK (blocker_id != blocked_id)`)
- Circular dependency chains (A blocks B blocks A) — enforced via BFS cycle detection at insert time

If cycle detection is bypassed or missing, the ready detection algorithm will loop or return incorrect results.

Reference: [DD-004](docs/design/DD-004-ready-detection-algorithm.md), [PRD-003](docs/prd/PRD-003-dependency-blocking-system.md)

### RULE 5: Effect-TS patterns are mandatory

All business logic MUST use Effect-TS:
- Services use `Context.Tag` + `Layer.effect`
- Errors use `Data.TaggedError` with union types
- All operations return `Effect<T, E>`
- Layer composition follows the pattern in DD-002

Do not bypass Effect with raw try/catch or untyped Promises in service code.

Reference: [DD-002](docs/design/DD-002-effect-ts-service-layer.md)

### RULE 6: Telemetry MUST NOT block operations

OpenTelemetry is optional. When OTEL is not configured, the system MUST use `TelemetryNoop` — a zero-cost passthrough that does nothing. When OTEL is configured, telemetry errors MUST be caught and logged, never propagated to the caller.

- `TelemetryAuto` auto-detects `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER` env vars
- If neither is set → `TelemetryNoop` (zero overhead)
- If set → `TelemetryLive` (full OTEL SDK)
- OTEL packages (`@opentelemetry/*`) are **optional peer dependencies** — the system MUST work without them installed

Reference: [PRD-008](docs/prd/PRD-008-observability-opentelemetry.md), [DD-008](docs/design/DD-008-opentelemetry-integration.md)

### RULE 7: ANTHROPIC_API_KEY is optional for core commands

The Anthropic API key is **only required for LLM-powered features** (`tx dedupe`, `tx compact`, `tx reprioritize`). All core commands (`tx add`, `tx list`, `tx ready`, `tx done`, `tx show`, `tx update`, `tx delete`, `tx block`, `tx unblock`, `tx children`, `tx tree`, `tx init`) MUST work without it.

- `AppMinimalLive`: No LLM — used by CLI core commands, MCP server, Agent SDK
- `AppLive`: Includes LLM — used only by dedupe/compact/reprioritize commands
- MCP server MUST start and serve core tools without `ANTHROPIC_API_KEY`
- Agent SDK MUST use `AppMinimalLive` — never require the API key
- LLM commands without the key MUST fail with a clear error message:
  `"ANTHROPIC_API_KEY environment variable is not set. Set it to enable LLM-powered features: export ANTHROPIC_API_KEY=sk-ant-..."`

Reference: [DD-002](docs/design/DD-002-effect-ts-service-layer.md), [DD-006](docs/design/DD-006-llm-integration.md)

---

## Project Structure

```
tx/
├── CLAUDE.md              # This file — agent doctrine + instructions
├── PLAN.md                # Full consolidated PRD + design documentation
├── docs/
│   ├── index.md           # Hierarchical index with dependency graph
│   ├── prd/               # Product Requirements Documents (WHAT)
│   │   ├── PRD-001-core-task-management.md
│   │   ├── PRD-002-hierarchical-task-structure.md
│   │   ├── PRD-003-dependency-blocking-system.md
│   │   ├── PRD-004-task-scoring-prioritization.md
│   │   ├── PRD-005-llm-deduplication.md
│   │   ├── PRD-006-task-compaction-learnings.md
│   │   ├── PRD-007-multi-interface-integration.md
│   │   └── PRD-008-observability-opentelemetry.md
│   └── design/            # Design Documents (HOW)
│       ├── DD-001-data-model-storage.md
│       ├── DD-002-effect-ts-service-layer.md
│       ├── DD-003-cli-implementation.md
│       ├── DD-004-ready-detection-algorithm.md
│       ├── DD-005-mcp-agent-sdk-integration.md
│       ├── DD-006-llm-integration.md
│       ├── DD-007-testing-strategy.md
│       └── DD-008-opentelemetry-integration.md
└── src/                   # Implementation (to be created)
```

## Key Technical Decisions

| Decision | Choice | Reference |
|----------|--------|-----------|
| Storage | SQLite via better-sqlite3 (WAL mode) | [DD-001](docs/design/DD-001-data-model-storage.md) |
| Framework | Effect-TS (services, layers, errors) | [DD-002](docs/design/DD-002-effect-ts-service-layer.md) |
| CLI | @effect/cli | [DD-003](docs/design/DD-003-cli-implementation.md) |
| MCP | @modelcontextprotocol/sdk (text content only, no structuredContent) | [DD-005](docs/design/DD-005-mcp-agent-sdk-integration.md) |
| IDs | `crypto.randomBytes` → SHA256 `tx-[a-z0-9]{8}` (32-bit entropy) | [DD-001](docs/design/DD-001-data-model-storage.md) |
| Testing | Vitest + SHA256 deterministic fixtures | [DD-007](docs/design/DD-007-testing-strategy.md) |
| LLM | Anthropic Claude Sonnet for dedupe/compact (optional) | [DD-006](docs/design/DD-006-llm-integration.md) |
| ANTHROPIC_API_KEY | Optional — core commands work without it | [DD-002](docs/design/DD-002-effect-ts-service-layer.md), [DD-006](docs/design/DD-006-llm-integration.md) |
| Telemetry | OpenTelemetry (optional peer deps, zero-cost when disabled) | [DD-008](docs/design/DD-008-opentelemetry-integration.md) |
| Layer split | `AppMinimalLive` (no LLM) vs `AppLive` (with LLM) | [DD-002](docs/design/DD-002-effect-ts-service-layer.md) |

## Status Lifecycle

```
backlog → ready → planning → active → blocked → review → human_needs_to_review → done
```

A task is **ready** when: status is workable AND all blockers have status `done`. See [DD-004](docs/design/DD-004-ready-detection-algorithm.md).

## Implementation Phases

1. **Phase 1 (v0.1.0)**: Core CRUD + hierarchy + dependencies + CLI + integration tests + OTEL foundation
2. **Phase 2 (v0.2.0)**: MCP server (TaskWithDeps responses, text-only content) + JSON export + Agent SDK
3. **Phase 3 (v0.3.0)**: LLM features (dedupe, compact with learnings export, scoring) — requires ANTHROPIC_API_KEY
4. **Phase 4 (v1.0.0)**: Performance optimization + full test coverage + documentation

## Package Info

- **Name**: `tx`
- **CLI Alias**: `tx`
- **Entry**: `src/cli.ts`
- **MCP Server**: `src/mcp/server.ts`
- **DB Location**: `.tx/tasks.db`
