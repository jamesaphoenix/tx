# PRD-001: Core Task Management System

**Status**: Draft
**Priority**: P0 (Must Have)
**Owner**: TBD
**Last Updated**: 2025-01-28

---

## Problem Statement

AI coding agents struggle with long-horizon tasks because they lose context across sessions. Current approaches have significant limitations:

1. **Markdown-based plans** lack structure, can't be queried, and become stale
2. **Git issue trackers** (GitHub Issues, Linear) are designed for humans, not agents - they're slow to query and lack programmatic access patterns
3. **Beads** (the closest solution) ties tasks to git worktrees, which is heavyweight for subtasks and milestones
4. **Claude Code's built-in TodoWrite** is session-scoped and doesn't persist across conversations

Agents need a **persistent, queryable, dependency-aware** task store that works across sessions and can be programmatically manipulated.

---

## Target Users

| User Type | Primary Actions | Frequency |
|-----------|-----------------|-----------|
| AI Agents (primary) | Create tasks, query ready tasks, update status, mark complete | High (every session) |
| Human Engineers | Review tasks, reprioritize, approve, add context | Medium (daily) |
| CI/CD Systems | Query task status, trigger workflows | Low (on events) |

---

## Goals

1. **Persistence**: Tasks survive across agent sessions and machine restarts
2. **Speed**: Sub-100ms queries for common operations (list, ready, get)
3. **Programmatic**: JSON output, typed API, MCP integration
4. **Minimal**: Single dependency (SQLite), no external services required
5. **Composable**: Works with any agent framework (Claude Code, Agent SDK, custom)

---

## Non-Goals

- Real-time collaboration (sync is explicit, not live)
- Web UI (CLI and API only for v1)
- Multi-project management (one DB per project)
- Integration with external issue trackers (no GitHub/Linear sync)

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Task creation latency | <50ms | P95 via CLI |
| Ready query latency | <100ms | P95 with 1000 tasks |
| Agent task completion rate | +20% | A/B vs markdown plans |
| Context retention | 100% | Tasks persist across sessions |

---

## User Stories

### US-001: Query Ready Tasks
```
As an AI agent,
I want to query tasks that are ready to work on,
So that I can pick the highest-priority unblocked task.
```
**Acceptance Criteria**:
- `tx ready` returns tasks sorted by score
- Only tasks with no open blockers are returned
- Response includes `blockedBy`, `blocks`, `isReady` fields

### US-002: Create Subtasks
```
As an AI agent,
I want to create subtasks as I decompose work,
So that I can track granular progress without losing the big picture.
```
**Acceptance Criteria**:
- `tx add "Task" --parent=tx-xxx` creates a child task
- Parent-child relationship is queryable
- Unlimited nesting depth supported

### US-003: View Active Tasks
```
As a human engineer,
I want to see all active tasks sorted by priority,
So that I can adjust scores and ensure agents work on the right things.
```
**Acceptance Criteria**:
- `tx list --status=active` shows active tasks
- Tasks are sorted by score by default
- Score can be updated via `tx score <id> <value>`

### US-004: Pause for Human Review
```
As a human engineer,
I want to mark tasks as "human_needs_to_review",
So that agents pause and wait for my input on sensitive changes.
```
**Acceptance Criteria**:
- `tx update <id> --status=human_needs_to_review` pauses task
- Task does not appear in `tx ready` output
- Agent can query for tasks needing review

---

## Requirements

### Must Have (P0)

| ID | Requirement | Validation |
|----|-------------|------------|
| R-001 | Create, read, update, delete tasks | Integration tests |
| R-002 | Flexible parent-child hierarchy (N-level nesting) | Unit tests |
| R-003 | Status lifecycle: backlog → ready → planning → active → blocked → review → human_needs_to_review → done | Schema validation |
| R-004 | Blocking/blocked-by relationships between tasks | Integration tests |
| R-005 | Ready detection: find tasks with no open blockers | Integration tests |
| R-006 | CLI interface with JSON output | E2E tests |
| R-007 | SQLite persistence | Integration tests |

### Should Have (P1)

| ID | Requirement | Validation |
|----|-------------|------------|
| R-008 | Priority scoring (numeric, LLM-updateable) | Unit tests |
| R-009 | MCP server for Claude Code integration | MCP tests |
| R-010 | Task metadata (arbitrary key-value pairs) | Unit tests |
| R-011 | Export to JSON/JSONL | Integration tests |

### Nice to Have (P2)

| ID | Requirement | Validation |
|----|-------------|------------|
| R-012 | LLM-based deduplication | Manual testing |
| R-013 | LLM-based compaction/summarization with CLAUDE.md output | Manual testing |
| R-014 | Agent SDK integration | Integration tests |
| R-015 | Git-backed export for version control | Manual testing |
| R-016 | OpenTelemetry observability (traces, metrics, logs) | Integration tests |
| R-017 | Structured JSON logging for all operations | Unit tests |
| R-018 | DB corruption detection and recovery | Integration tests |

---

## Technical Constraints

- **Storage**: SQLite only (no external DB), WAL mode enabled
- **Runtime**: Node.js 18+ or Bun
- **Framework**: Effect-TS for all business logic
- **CLI**: @effect/cli for command parsing
- **Observability**: OpenTelemetry (optional, zero-cost when disabled)
- **ANTHROPIC_API_KEY**: Optional — core CRUD, ready detection, CLI all work without it. Only LLM features (dedupe, compact, reprioritize) require it. If set as env var, use it automatically.
- **Logging**: Structured JSON logging via OTEL or console fallback

---

## Build System

| Tool | Config File | Purpose |
|------|-------------|---------|
| TypeScript | `tsconfig.json` | Type checking, ES2022 target |
| tsup | `tsup.config.ts` | Bundling CLI + library |
| Vitest | `vitest.config.ts` | Testing |
| ESLint | `eslint.config.js` | Linting |

### package.json Structure

```json
{
  "name": "tx",
  "version": "0.1.0",
  "type": "module",
  "bin": { "tx": "./dist/cli.js" },
  "exports": {
    ".": "./dist/index.js",
    "./mcp": "./dist/mcp/server.js"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/ test/"
  },
  "peerDependencies": {
    "@opentelemetry/api": "^1.7",
    "@opentelemetry/sdk-node": "^0.48"
  },
  "peerDependenciesMeta": {
    "@opentelemetry/api": { "optional": true },
    "@opentelemetry/sdk-node": { "optional": true }
  }
}
```

---

## Dependencies

| Dependency | Version | Purpose | Required |
|------------|---------|---------|----------|
| effect | ^3.0 | Core framework | Yes |
| @effect/cli | ^0.40 | CLI parsing | Yes |
| @effect/sql | ^0.20 | Database access | Yes |
| better-sqlite3 | ^11.0 | SQLite driver | Yes |
| @anthropic-ai/sdk | ^0.30 | LLM features | Optional |
| @opentelemetry/api | ^1.7 | Observability | Optional |
| @opentelemetry/sdk-node | ^0.48 | OTEL SDK | Optional |
| zod | ^3.22 | MCP input validation | Yes |
| @modelcontextprotocol/sdk | ^1.0 | MCP server | Yes |

---

## Error Recovery

| Scenario | Recovery Strategy |
|----------|------------------|
| DB file corrupted | Detect via PRAGMA integrity_check; log error; suggest re-init |
| DB file locked | Retry with exponential backoff (3 attempts) |
| Migration failure | Roll back transaction; report version mismatch |
| LLM API unavailable | Graceful degradation — skip LLM features, log warning |
| OTEL exporter down | Noop — telemetry failures never block operations |

---

## Related Documents

- [PRD-002: Hierarchical Task Structure](./PRD-002-hierarchical-task-structure.md)
- [PRD-003: Dependency & Blocking System](./PRD-003-dependency-blocking-system.md)
- [PRD-008: Observability & OpenTelemetry](./PRD-008-observability-opentelemetry.md)
- [DD-001: Data Model & Storage](../design/DD-001-data-model-storage.md)
- [DD-002: Effect-TS Service Layer](../design/DD-002-effect-ts-service-layer.md)
