# tx System Design & Invariants

**Kind**: overview

## Problem Definition

AI agents need headless infrastructure for memory, tasks, and orchestration.
Existing frameworks dictate the orchestration flow, but developers need
primitives they can compose into their own patterns.

tx provides the TanStack model for agent infrastructure: headless primitives
(ready, claim, done, block, context, learn) that work with any orchestration
pattern — serial, parallel, swarm, or human-in-loop.

## Subsystems

## Task Management
- Boundary: packages/core/src/services/task-service.ts
- Primitives: ready, claim, done, block, handoff, checkpoint
- Status lifecycle: backlog -> ready -> planning -> active -> blocked -> review -> done

## Memory / Knowledge Graph
- Boundary: packages/core/src/services/learning-service.ts
- Learnings with semantic search (embeddings + BM25)
- File-learnings anchored to code paths
- Context retrieval for prompt injection

## Sync & Persistence
- Boundary: packages/core/src/services/sync-service.ts
- JSONL git-backed export/import
- Claude Code sync (one-way push to team directory)
- Auto-sync on task mutations

## Docs as Primitives
- Boundary: packages/core/src/services/doc-service.ts
- YAML source of truth with DB metadata layer
- Typed doc-doc links (overview->prd->design DAG)
- Invariants extracted from YAML
- Auto-render on every mutation

## Orchestration
- Boundary: packages/core/src/services/orchestrator-service.ts
- Worker registration and heartbeat
- Task claiming with lease-based locking
- Signal handling for graceful shutdown

## Object Model

## Task
- Table: tasks
- Lifecycle: backlog -> ready -> active -> done
- Dependencies via task_deps (blocker_id, blocked_id)
- Hierarchy via parent_id (tree structure)
- SHA256-based IDs: tx-[a-z0-9]{6,8}

## Learning
- Table: learnings
- Content with optional embeddings for semantic search
- File-learnings anchored to glob patterns

## Doc
- Table: docs
- YAML on disk, metadata in DB
- Versioning chain via parent_doc_id
- Status: changing (editable) or locked (immutable)

## Invariant
- Table: invariants
- Extracted from doc YAML
- Enforcement: integration_test, linter, or llm_as_judge
- Audit trail via invariant_checks

## Storage Schema

## tasks
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY (tx-[a-z0-9]{6,8}) |
| title | TEXT | NOT NULL |
| status | TEXT | CHECK constraint on valid statuses |
| parent_id | TEXT | FK tasks(id) |
| score | INTEGER | Priority score (higher = more important) |

## learnings
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PRIMARY KEY |
| content | TEXT | NOT NULL |
| embedding | BLOB | Optional vector embedding |

## docs
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| hash | TEXT | SHA256 of YAML content |
| kind | TEXT | overview, prd, or design |
| name | TEXT | Unique slug |
| status | TEXT | changing or locked |

## Invariants

| ID | Rule | Enforcement | Reference |
|-----|------|-------------|-----------|
| INV-SYS-001 | Every API response MUST include full dependency information (TaskWithDeps) | integration_test | test/integration/core.test.ts |
| INV-SYS-002 | No circular dependencies, no self-blocking | integration_test | test/integration/core.test.ts |
| INV-SYS-003 | All business logic MUST use Effect-TS patterns | linter | - |
| INV-SYS-004 | Tests use singleton database - NEVER create DB per test | integration_test | test/integration/core.test.ts |

## Failure Modes

| ID | Description | Mitigation |
|-----|-------------|------------|
| FM-SYS-001 | Database locked under high concurrency | WAL mode enabled; retry with exponential backoff |
| FM-SYS-002 | Embedding service unavailable | EmbeddingServiceNoop fallback; BM25 search still works |
| FM-SYS-003 | ANTHROPIC_API_KEY not set for LLM features | Core commands work without key; LLM features fail gracefully |

## Edge Cases

| ID | Description |
|-----|-------------|
| EC-SYS-001 | Task with all blockers done becomes ready automatically |
| EC-SYS-002 | Deleting a parent task with children (blocked unless cascade: true) |
| EC-SYS-003 | Concurrent claims on the same task (lease-based locking prevents conflicts) |

## Constraints

- SQLite with WAL mode (local-first, no server required)
- Effect-TS for all service code (typed errors, composable effects)
- JSONL for git-friendly persistence
- SHA256-based task IDs for deterministic testing
- Optional peer dependencies for LLM, embeddings, and telemetry

## Cross-Cutting Concerns

- Error handling: Data.TaggedError with explicit union types
- Telemetry: Optional OpenTelemetry (OTEL_EXPORTER_* env vars)
- Testing: Vitest with shared singleton database layer
- CLI: @effect/cli with conventional commits

## Data Retention

- Tasks: retained until explicitly deleted
- Learnings: retained indefinitely with optional compaction
- Docs: all versions retained; locked docs immutable
- Runs: retained with stdout/stderr/context capture
- Invariant checks: last 20 per invariant
