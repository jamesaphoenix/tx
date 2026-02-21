# tx Documentation Index

A lean task management system for AI agents and humans, built with Effect-TS.

## Product Requirements Documents (PRDs)

| PRD                                                   | Title                         | Status  |
| ----------------------------------------------------- | ----------------------------- | ------- |
| [PRD-001](prd/PRD-001-core-task-management.md)        | Core Task Management System   | Phase 1 |
| [PRD-002](prd/PRD-002-hierarchical-task-structure.md) | Hierarchical Task Structure   | Phase 1 |
| [PRD-003](prd/PRD-003-dependency-blocking-system.md)  | Dependency & Blocking System  | Phase 1 |
| [PRD-004](prd/PRD-004-task-scoring-prioritization.md) | Task Scoring & Prioritization | Phase 1 |
| [PRD-005](prd/PRD-005-llm-deduplication.md)           | LLM-Powered Deduplication     | Phase 3 |
| [PRD-006](prd/PRD-006-task-compaction-learnings.md)   | Task Compaction & Learnings   | Phase 3 |
| [PRD-007](prd/PRD-007-multi-interface-integration.md) | Multi-Interface Integration   | Phase 2 |
| [PRD-008](prd/PRD-008-observability-opentelemetry.md) | Observability & OpenTelemetry | Phase 1 |
| [PRD-009](prd/PRD-009-jsonl-git-sync.md)              | JSONL Git-Backed Sync         | Phase 2 |
| [PRD-010](prd/PRD-010-contextual-learnings-system.md) | Contextual Learnings System   | Phase 2 |
| [PRD-011](prd/PRD-011-claude-code-hooks.md)           | Claude Code Hooks Integration | Phase 2 |
| [PRD-012](prd/PRD-012-bun-single-binary.md)           | Bun Single Binary Distribution| Phase 2 |
| [PRD-013](prd/PRD-013-dashboard-ux.md)                | Dashboard UX Improvements     | Phase 2 |
| [PRD-014](prd/PRD-014-graph-schema-edges.md)          | Graph Schema & Edges          | Phase 2 |
| [PRD-015](prd/PRD-015-jsonl-daemon-promotion.md)      | JSONL Daemon Promotion        | Phase 2 |
| [PRD-016](prd/PRD-016-graph-expansion-retrieval.md)   | Graph Expansion & Retrieval   | Phase 2 |
| [PRD-017](prd/PRD-017-invalidation-maintenance.md)    | Invalidation & Maintenance    | Phase 2 |
| [PRD-018](prd/PRD-018-worker-orchestration.md)        | Worker Orchestration          | Phase 2 |
| [PRD-019](prd/PRD-019-execution-tracing.md)           | Execution Tracing System      | Phase 2 |
| [PRD-020](prd/PRD-020-run-observability.md)            | Run Observability & Logging   | Phase 2 |
| [PRD-021](prd/PRD-021-platform-sync.md)               | Platform Sync                 | Phase 2 |
| [PRD-022](prd/PRD-022-agent-outbox.md)                | Agent Outbox Messaging        | Phase 2 |
| [PRD-024](prd/PRD-024-dashboard-keyboard-shortcuts.md)| Dashboard Keyboard Shortcuts  | Phase 2 |
| [PRD-025](prd/PRD-025-task-assignment-settings.md)    | Assignment Defaults & Settings| Phase 2 |
| [PRD-026](prd/PRD-026-watchdog-onboarding-contract.md)| Watchdog Onboarding Contract  | Phase 2 |

## Design Documents (DDs)

| DD                                                   | Title                       | Implements       |
| ---------------------------------------------------- | --------------------------- | ---------------- |
| [DD-001](design/DD-001-data-model-storage.md)        | Data Model & Storage        | PRD-001, PRD-002 |
| [DD-002](design/DD-002-effect-ts-service-layer.md)   | Effect-TS Service Layer     | All              |
| [DD-003](design/DD-003-cli-implementation.md)        | CLI Implementation          | PRD-007          |
| [DD-004](design/DD-004-ready-detection-algorithm.md) | Ready Detection Algorithm   | PRD-003          |
| [DD-005](design/DD-005-mcp-agent-sdk-integration.md) | MCP & Agent SDK Integration | PRD-007          |
| [DD-006](design/DD-006-llm-integration.md)           | LLM Integration             | PRD-005, PRD-006 |
| [DD-007](design/DD-007-testing-strategy.md)          | Testing Strategy            | All              |
| [DD-008](design/DD-008-opentelemetry-integration.md) | OpenTelemetry Integration   | PRD-008          |
| [DD-009](design/DD-009-jsonl-git-sync.md)            | JSONL Git Sync              | PRD-009          |
| [DD-010](design/DD-010-learnings-search-retrieval.md)| Learnings Search & Retrieval| PRD-010          |
| [DD-011](design/DD-011-claude-code-hooks.md)         | Claude Code Hooks           | PRD-011          |
| [DD-012](design/DD-012-dashboard-ux.md)              | Dashboard UX Architecture   | PRD-013          |
| [DD-013](design/DD-013-test-utilities.md)            | Test Utilities              | All              |
| [DD-014](design/DD-014-graph-schema-edges.md)        | Graph Schema & Edges        | PRD-014          |
| [DD-015](design/DD-015-jsonl-daemon-promotion.md)    | JSONL Daemon Promotion      | PRD-015          |
| [DD-016](design/DD-016-graph-expansion-retrieval.md) | Graph Expansion & Retrieval | PRD-016          |
| [DD-017](design/DD-017-invalidation-maintenance.md)  | Invalidation & Maintenance  | PRD-017          |
| [DD-018](design/DD-018-worker-orchestration.md)      | Worker Orchestration        | PRD-018          |
| [DD-019](design/DD-019-execution-tracing.md)         | Execution Tracing System    | PRD-019          |
| [DD-020](design/DD-020-run-observability.md)          | Run Observability & Logging | PRD-020          |
| [DD-021](design/DD-021-platform-sync.md)             | Platform Sync               | PRD-021          |
| [DD-022](design/DD-022-agent-outbox.md)              | Agent Outbox Messaging      | PRD-022          |
| [DD-024](design/DD-024-dashboard-keyboard-shortcuts.md) | Dashboard Keyboard Shortcuts | PRD-024      |
| [DD-025](design/DD-025-task-assignment-settings.md)  | Assignment Defaults & Settings | PRD-025       |
| [DD-026](design/DD-026-watchdog-onboarding-contract.md) | Watchdog Onboarding Contract | PRD-026       |

## Implementation Phases

### Phase 1 (v0.1.0) - MVP

- Core CRUD + hierarchy + dependencies
- CLI with JSON output
- Integration tests with SHA256 fixtures
- OpenTelemetry foundation (optional)

### Phase 2 (v0.2.0) - Integrations

- MCP server with full dependency info
- JSONL git-backed sync
- JSON/JSONL export
- Agent SDK integration
- **Contextual learnings system** (BM25 + vector search)
- **Claude Code hooks** for automatic learning injection
- **Bun single binary** distribution

### Phase 3 (v0.3.0) - LLM Features

- Deduplication (requires ANTHROPIC_API_KEY)
- Compaction with learnings export
- LLM-based reprioritization

### Phase 4 (v1.0.0) - Polish

- Performance optimization
- Full test coverage (80%+)
- Documentation

## Key Technical Decisions

| Decision  | Choice                               | Reference |
| --------- | ------------------------------------ | --------- |
| Storage   | SQLite via better-sqlite3 (WAL mode) | DD-001    |
| Sync      | JSONL git-backed (bidirectional)     | DD-009    |
| Framework | Effect-TS                            | DD-002    |
| CLI       | @effect/cli                          | DD-003    |
| MCP       | @modelcontextprotocol/sdk            | DD-005    |
| IDs       | SHA256-based `tx-[a-z0-9]{6,8}`      | DD-001    |
| Testing   | Vitest + SHA256 fixtures             | DD-007    |
| LLM       | Anthropic Claude (optional)          | DD-006    |
| Telemetry | OpenTelemetry (optional)             | DD-008    |

## Dependency Graph

```
PRD-001 (Core) ──────┬──────────────────────────────────────►  DD-001 (Data Model)
                     │
PRD-002 (Hierarchy) ─┤
                     │
PRD-003 (Deps) ──────┼──────────────────────────────────────►  DD-004 (Ready Detection)
                     │
PRD-004 (Scoring) ───┤
                     │
                     └──────────────────────────────────────►  DD-002 (Effect-TS Layer)
                                                                    │
PRD-007 (Interfaces) ───────────────────────────────────────►  DD-003 (CLI)
        │                                                           │
        └───────────────────────────────────────────────────►  DD-005 (MCP/SDK)
                                                                    │
PRD-005 (Dedupe) ────┬──────────────────────────────────────►  DD-006 (LLM)
                     │
PRD-006 (Compact) ───┘

PRD-008 (Observability) ────────────────────────────────────►  DD-008 (OTEL)

PRD-009 (JSONL Sync) ───────────────────────────────────────►  DD-009 (Git Sync)
                                                                    │
                                    DD-007 (Testing) ◄──────────────┘

PRD-010 (Learnings) ───────────────────────────────────────►  DD-010 (Search/Retrieval)
        │
PRD-011 (Hooks) ───────────────────────────────────────────►  DD-011 (Claude Code Hooks)
        │
PRD-012 (Bun Binary) ──────────────────────────────────────►  DD-003 (CLI)

PRD-019 (Tracing) ────────────────────────────────────────►  DD-019 (Execution Tracing)
        │
        └─────────────────────────────────────────────────►  DD-002 (Effect-TS Layer)
```

## CI/CD Pipeline

The project uses GitHub Actions for continuous integration and deployment.

### Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| [ci.yml](.github/workflows/ci.yml) | Push/PR to main, nightly | Run all checks (types, lint, build, tests) |
| [publish.yml](.github/workflows/publish.yml) | Release published | Publish packages to npm |
| [release.yml](.github/workflows/release.yml) | Tag push (v*) | Build cross-platform binaries |

### CI Checks

The main CI workflow runs `./scripts/check-ci.sh` which executes:

1. **Build** - Compile TypeScript packages in dependency order
2. **TypeScript** - Type checking across all packages
3. **ESLint** - Linting for packages and root tests
4. **Tests (packages)** - Run tests in each package
5. **Tests (root)** - Run integration and unit tests

### Slow Tests

Expensive tests (downloads, stress tests) run:
- Nightly at 3am UTC
- On commits containing `[slow]` tag

### Local Development

```bash
# Quick checks (types + lint)
./scripts/check.sh --quick

# Full checks (types + lint + build + tests)
./scripts/check.sh --all

# Individual checks
./scripts/check.sh --types
./scripts/check.sh --lint
./scripts/check.sh --build
./scripts/check.sh --test
```

### Git Hooks (Husky)

- **pre-commit**: Fast checks (types + lint)
- **pre-push**: Full checks (types + lint + build + tests)

### Dependency Updates

Dependabot is configured to:
- Check npm dependencies weekly (Monday)
- Check GitHub Actions weekly
- Group minor/patch updates to reduce noise
