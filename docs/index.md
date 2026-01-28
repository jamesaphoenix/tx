# tx Documentation Index

> A lean task management system for AI agents and humans, built with Effect-TS

**Package Name**: `tx`
**CLI Alias**: `tx`
**Version**: 0.1.0 (MVP)

---

## Quick Links

- [Main Plan](../PLAN.md) - Full PRD & Design Documentation
- [Claude Code Instructions](../CLAUDE.md) - Project-specific agent instructions

---

## Product Requirements Documents (PRDs)

| PRD | Title | Status | Priority |
|-----|-------|--------|----------|
| [PRD-001](./prd/PRD-001-core-task-management.md) | Core Task Management System | Draft | P0 |
| [PRD-002](./prd/PRD-002-hierarchical-task-structure.md) | Hierarchical Task Structure | Draft | P0 |
| [PRD-003](./prd/PRD-003-dependency-blocking-system.md) | Dependency & Blocking System | Draft | P0 |
| [PRD-004](./prd/PRD-004-task-scoring-prioritization.md) | Task Scoring & Prioritization | Draft | P1 |
| [PRD-005](./prd/PRD-005-llm-deduplication.md) | LLM-Powered Deduplication | Draft | P2 |
| [PRD-006](./prd/PRD-006-task-compaction-learnings.md) | Task Compaction & Learnings Export | Draft | P2 |
| [PRD-007](./prd/PRD-007-multi-interface-integration.md) | Multi-Interface Integration | Draft | P0 |
| [PRD-008](./prd/PRD-008-observability-opentelemetry.md) | Observability & OpenTelemetry | Draft | P1 |

---

## Design Documents (DDs)

| DD | Title | Status | Depends On |
|----|-------|--------|------------|
| [DD-001](./design/DD-001-data-model-storage.md) | Data Model & Storage Architecture | Draft | - |
| [DD-002](./design/DD-002-effect-ts-service-layer.md) | Effect-TS Service Layer Design | Draft | DD-001 |
| [DD-003](./design/DD-003-cli-implementation.md) | CLI Implementation | Draft | DD-002 |
| [DD-004](./design/DD-004-ready-detection-algorithm.md) | Ready Detection Algorithm | Draft | DD-001, DD-002 |
| [DD-005](./design/DD-005-mcp-agent-sdk-integration.md) | MCP Server & Agent SDK Integration | Draft | DD-002 |
| [DD-006](./design/DD-006-llm-integration.md) | LLM Integration (Deduplication + Compaction) | Draft | DD-002 |
| [DD-007](./design/DD-007-testing-strategy.md) | Testing Strategy | Draft | All |
| [DD-008](./design/DD-008-opentelemetry-integration.md) | OpenTelemetry Integration | Draft | DD-002 |

---

## Dependency Graph

```
PRD-001 (Core)
    ├── PRD-002 (Hierarchy)
    ├── PRD-003 (Dependencies)
    │       └── PRD-004 (Scoring)
    ├── PRD-007 (Interfaces)
    │       ├── DD-003 (CLI)
    │       └── DD-005 (MCP/SDK)
    ├── PRD-008 (Observability)
    │       └── DD-008 (OpenTelemetry)
    └── DD-001 (Data Model)
            └── DD-002 (Services)
                    ├── DD-004 (Ready Detection)
                    ├── DD-006 (LLM)
                    └── DD-008 (OpenTelemetry)

PRD-005 (Deduplication) ──► DD-006
PRD-006 (Compaction) ──► DD-006

DD-007 (Testing) ◄── All
```

---

## Implementation Phases

### Phase 1: MVP (v0.1.0)
- PRD-001: Core Task Management ✓
- PRD-002: Hierarchical Structure ✓
- PRD-003: Dependencies ✓
- PRD-008: Observability (OTEL foundation) ✓
- DD-001: Data Model ✓
- DD-002: Service Layer ✓
- DD-003: CLI ✓
- DD-007: Testing ✓
- DD-008: OpenTelemetry (TelemetryNoop + TelemetryAuto) ✓

### Phase 2: Integrations (v0.2.0)
- PRD-007: Multi-Interface ✓
- DD-005: MCP/Agent SDK (AppMinimalLive, text-only MCP responses) ✓

### Phase 3: LLM Features (v0.3.0)
- PRD-004: Scoring ✓
- PRD-005: Deduplication ✓
- PRD-006: Compaction & Learnings ✓
- DD-006: LLM Integration (ANTHROPIC_API_KEY optional) ✓

### Phase 4: Polish (v1.0.0)
- Performance optimization
- Full test coverage
- Documentation

---

## Key Architectural Decisions

| Decision | Choice | Document |
|----------|--------|----------|
| Storage | SQLite (single file, WAL mode) | [DD-001](./design/DD-001-data-model-storage.md) |
| Framework | Effect-TS | [DD-002](./design/DD-002-effect-ts-service-layer.md) |
| ID Format | `tx-[a-z0-9]{8}` via `crypto.randomBytes` | [DD-001](./design/DD-001-data-model-storage.md) |
| CLI Parser | @effect/cli | [DD-003](./design/DD-003-cli-implementation.md) |
| MCP Protocol | JSON-RPC over stdio (text content only) | [DD-005](./design/DD-005-mcp-agent-sdk-integration.md) |
| LLM Provider | Anthropic Claude (optional) | [DD-006](./design/DD-006-llm-integration.md) |
| ANTHROPIC_API_KEY | Optional — core commands work without it | [DD-002](./design/DD-002-effect-ts-service-layer.md), [DD-006](./design/DD-006-llm-integration.md) |
| Layer Architecture | `AppMinimalLive` (no LLM) vs `AppLive` (with LLM) | [DD-002](./design/DD-002-effect-ts-service-layer.md) |
| Telemetry | OpenTelemetry (optional peer deps, zero-cost noop) | [DD-008](./design/DD-008-opentelemetry-integration.md) |
| Learnings Export | CLAUDE.md / configurable file | [PRD-006](./prd/PRD-006-task-compaction-learnings.md) |
| Test Fixtures | SHA256-based deterministic | [DD-007](./design/DD-007-testing-strategy.md) |

---

## Critical Requirements

### Must Return Full Dependency Info
All APIs (CLI, MCP, SDK) must return `TaskWithDeps` including:
- `blockedBy: TaskId[]`
- `blocks: TaskId[]`
- `children: TaskId[]`
- `isReady: boolean`

See [DD-005](./design/DD-005-mcp-agent-sdk-integration.md) for details.

### Learnings Must Be Exported
Compaction summaries must be written to `CLAUDE.md` or configurable file, not just stored in database.

See [PRD-006](./prd/PRD-006-task-compaction-learnings.md) for details.

### Integration Tests Required
All core paths must have integration tests using SHA256-based deterministic fixtures.

See [DD-007](./design/DD-007-testing-strategy.md) for details.

### ANTHROPIC_API_KEY Is Optional
Core commands, MCP server, and Agent SDK must work without `ANTHROPIC_API_KEY`. Only LLM-powered features (dedupe, compact, reprioritize) require it.

See [DD-002](./design/DD-002-effect-ts-service-layer.md), [DD-006](./design/DD-006-llm-integration.md) for details.

### Telemetry Must Not Block Operations
OpenTelemetry is optional. When not configured, `TelemetryNoop` provides zero-cost passthrough. Telemetry failures must never propagate to callers.

See [PRD-008](./prd/PRD-008-observability-opentelemetry.md), [DD-008](./design/DD-008-opentelemetry-integration.md) for details.
