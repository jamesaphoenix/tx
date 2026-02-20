# tx

**Headless, Local Infra for AI Agents.** Primitives, not frameworks.

**Full documentation**: [docs/index.md](docs/index.md) | **Published docs**: [apps/docs/](apps/docs/)

---

## Monorepo Structure

Turborepo monorepo with 6 apps and 4 packages. All packages use `@jamesaphoenix/*` scope.

### Apps

| App | Package | Description |
|-----|---------|-------------|
| `apps/cli` | `@jamesaphoenix/tx-cli` | CLI — primary interface for tx |
| `apps/api-server` | `@jamesaphoenix/tx-api-server` | REST/HTTP API (`@effect/platform`) |
| `apps/mcp-server` | `@jamesaphoenix/tx-mcp-server` | Model Context Protocol server for AI agents |
| `apps/agent-sdk` | `@jamesaphoenix/tx-agent-sdk` | TypeScript SDK for building custom agents |
| `apps/dashboard` | `@jamesaphoenix/tx-dashboard` | Web UI for task visualization (Vite + React) |
| `apps/docs` | `@jamesaphoenix/tx-docs` | Published docs site (Next.js + Fumadocs) |

### Packages

| Package | Name | Description |
|---------|------|-------------|
| `packages/core` | `@jamesaphoenix/tx-core` | Core business logic (Effect-TS services and repositories) |
| `packages/types` | `@jamesaphoenix/tx-types` | Shared TypeScript types (Effect Schema definitions) |
| `packages/tx` | `@jamesaphoenix/tx` | Public API bundle (re-exports core + types) |
| `packages/test-utils` | `@jamesaphoenix/tx-test-utils` | Test utilities, factories, fixtures, and helpers |

---

## Philosophy: Primitives, Not Frameworks

**This is the core design principle. Everything else flows from it.**

### Why Primitives?

The orchestration flow is where developers create value. It encodes their domain knowledge:
- How their codebase works
- What their agents are good at
- Where humans need to intervene
- How they handle failures

**If you dictate the flow, you're not a tool. You're a competitor.** You're saying "our orchestration is better than yours." But you don't know their domain, their constraints, or whether they need 3 agents or 30.

### The TanStack Model

TanStack won by saying: "Here's headless table logic. Style it yourself."

tx says: "Here's headless agent infrastructure. Orchestrate it yourself."

```
┌─────────────────────────────────────────────────────────┐
│  Your Orchestration (your code, your rules)             │
├─────────────────────────────────────────────────────────┤
│  tx primitives                                          │
│                                                         │
│   tx ready     tx done      tx context    tx learn      │
│   tx send      tx block     tx inbox      tx sync       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Design Principles

- **No opinions on orchestration.** Serial, parallel, swarm, human-in-loop. Your call.
- **Powerful defaults.** `tx ready` just works. So does dependency resolution.
- **Escape hatches everywhere.** Raw SQL access, JSONL export, custom scoring.
- **Framework agnostic.** CLI, MCP, REST API, TypeScript SDK. Use what fits.
- **Local-first.** SQLite + git. No server required. Works offline.

### Core Primitives

| Primitive | Purpose |
|-----------|---------|
| `tx ready` | Get next workable task (unblocked, highest priority) |
| `tx done <id>` | Complete task, potentially unblocking others |
| `tx block <id> <blocker>` | Declare dependencies |
| `tx context <id>` | Get relevant learnings + history for prompt injection |
| `tx learning:add` | Record knowledge for future agents |
| `tx send <channel> <content>` | Send a message to an agent channel |
| `tx inbox <channel>` | Read messages (read-only, cursor-based) |
| `tx ack <id>` | Acknowledge a message |
| `tx try <id> <approach>` | Record an attempt on a task |
| `tx claim <id> <worker>` | Claim a task with a lease for worker coordination |
| `tx learn <path> <note>` | Attach a learning to a file path or glob |
| `tx recall [path]` | Query file-specific learnings by path |
| `tx sync export` | Persist to git-friendly JSONL |
| `tx sync codex` | One-way push tasks to Codex team directory |

### Example Loops (not THE loop)

We ship example orchestration patterns, not a required workflow:

```bash
# Simple: one agent, one task
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  codex "Work on task $task, then run: tx done $task"
done
```

```bash
# Parallel: N agents pulling from queue
for i in {1..5}; do
  (while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
    codex "Complete $task" && tx done $task
  done) &
done
wait
```

```bash
# Human-in-loop: agent proposes, human approves
task=$(tx ready --limit 1)
codex "Plan implementation for $task" > plan.md
read -p "Approve? [y/n] " && codex "Execute plan.md"
tx done $task
```

**You own your orchestration. tx owns the primitives.**

**Frameworks lock you in. Libraries let you compose.**

### Three-Layer Architecture

```
┌─────────────────────────────────────────┐
│  Agent Orchestration                    │  ← Your code (examples provided)
├─────────────────────────────────────────┤
│  Task Management                        │  ← tx core (ready, block, done)
├─────────────────────────────────────────┤
│  Memory                                 │  ← tx learnings + context
├─────────────────────────────────────────┤
│  Storage (Git + SQLite)                 │  ← Persistence layer
└─────────────────────────────────────────┘
```

### The Moat

The moat isn't task management. Anyone can build that.

The moat is the **knowledge layer**:
- Learnings that surface automatically when relevant
- Code relationships that inform task planning
- Context that transfers across projects and sessions

This compounds. Agents get smarter over time.

---

## DOCTRINE: INVIOLABLE RULES

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

`tx compact` MUST append learnings to a markdown file (default: `AGENTS.md`). Storing only in `compaction_log` table is insufficient.

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

### RULE 8: Tests use singleton database - NEVER create DB per test

Integration tests MUST use the singleton test database pattern:
- ONE database for the entire test suite (managed by `vitest.setup.ts`)
- Tests get the layer via `getSharedTestLayer()` from `@jamesaphoenix/tx-test-utils`
- Global `afterEach` resets all tables for isolation
- NEVER create `makeAppLayer(":memory:")` inside a test

```typescript
// CORRECT - use singleton
import { getSharedTestLayer } from "@jamesaphoenix/tx-test-utils"

it("test", async () => {
  const { layer } = await getSharedTestLayer()
  const result = await Effect.runPromise(
    myEffect.pipe(Effect.provide(layer))
  )
})

// WRONG - creates new DB per test (causes 54GB memory usage)
it("test", async () => {
  const layer = makeAppLayer(":memory:")  // NO!
  // ...
})
```

**Why?** Creating a new DB per test caused 920 DBs → 54GB RAM. Singleton pattern: 1 DB → <1GB RAM.

### RULE 9: Use Conventional Commits for all git commits

All git commits MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `style:` — Code style (formatting, semicolons, etc.)
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `perf:` — Performance improvement
- `test:` — Adding or updating tests
- `chore:` — Build process, dependencies, tooling
- `ci:` — CI/CD configuration

**Examples:**
```bash
feat(cli): add tx send command for agent messaging
fix(api): prevent path traversal in sync routes
refactor(core): extract shared validation utilities
test(mcp): add integration tests for sync tools
```

**Do NOT use:**
- `ralph:` prefix
- Generic messages like "updates" or "changes"
- Messages without a type prefix

### RULE 10: Use Effect Schema and Effect HTTP server for all type definitions and API routes

All domain types MUST be defined using Effect Schema (`import { Schema } from "effect"`):

```typescript
// CORRECT: Schema-based type definition
import { Schema } from "effect"

export const TaskSchema = Schema.Struct({
  id: TaskIdSchema,
  title: Schema.String,
  status: TaskStatusSchema,
})
export type Task = typeof TaskSchema.Type

// WRONG: Plain TypeScript interface
export interface Task {
  id: TaskId
  title: string
  status: TaskStatus
}
```

**Schema rules:**
- All types MUST be defined as `Schema.Struct` (or other Schema combinators)
- Plain TypeScript interfaces for domain types are NOT allowed
- `Zod` schemas are NOT allowed anywhere in the codebase
- Database row types (internal) MAY remain as interfaces

**API server rules:**
- API server MUST use `@effect/platform` `HttpApi`, `HttpApiEndpoint`, `HttpApiGroup`
- `Hono` framework is NOT allowed
- Route handlers use `HttpApiBuilder.group` with Effect.gen
- Error types use `HttpApiSchema.annotations({ status: N })` for HTTP status mapping

→ No PRD/DD yet (architectural migration in progress)

---

## Common Pitfalls (Bug Scan Findings)

### Hook Scripts Must Be Bash 3.2 Compatible (macOS)

**Issue**: macOS ships with Bash 3.2. Negative substring offsets like `${var:1:-1}` are a Bash 4+ feature and will error on macOS.

**Bad**:
```bash
ESCAPED=$(echo "$TEXT" | jq -Rs '.')
echo "${ESCAPED:1:-1}"  # FAILS on Bash 3.2
```

**Good**:
```bash
ESCAPED=$(echo "$TEXT" | jq -Rs '.' | sed 's/^"//;s/"$//')
echo "${ESCAPED}"
```

**Rule**: All `.codex/hooks/*.sh` scripts must work with Bash 3.2. Avoid: `${var:offset:-N}`, `&>>`, associative arrays (`declare -A`), `|&`, `coproc`.

### API Server Body Size Limits

**Issue**: If the API server (REST or MCP over HTTP) does not enforce body size limits, it's vulnerable to denial-of-service via memory exhaustion.

**Mitigation**:
```typescript
// Express example
app.use(express.json({ limit: '1mb' }))

// Hono example
app.use('*', bodyLimit({ maxSize: 1024 * 1024 }))
```

**Defaults to set**:
- JSON body: 1MB max
- File uploads: 10MB max (if supported)
- Reject requests exceeding limits with 413 Payload Too Large

### X-Forwarded-For Trust Issues

**Issue**: Trusting `X-Forwarded-For` header without validation allows IP spoofing. Attackers can bypass rate limiting or logging by setting arbitrary source IPs.

**Scenarios where this matters**:
- Rate limiting by IP
- Audit logging
- Geo-blocking

**Mitigation**:
```typescript
// Only trust X-Forwarded-For from known proxies
const trustedProxies = ['10.0.0.0/8', '172.16.0.0/12']
app.set('trust proxy', trustedProxies)

// Or: never trust, use direct connection IP
const clientIp = req.socket.remoteAddress
```

**Rule**: If running behind a reverse proxy (nginx, CloudFlare, etc.), configure `trust proxy` with explicit CIDR ranges. Never use `trust proxy: true` in production.

### Proper Error Typing with Effect

**Issue**: Using `as any` or `unknown` for error types defeats Effect-TS's typed error handling.

**Bad patterns**:
```typescript
// WRONG: Loses type information
const doThing = (): Effect<Result, any> => ...

// WRONG: Error union collapses to unknown
const combined = Effect.all([effectA, effectB]) // if one returns unknown error
```

**Correct patterns**:
```typescript
// CORRECT: Explicit tagged error union
type MyErrors = DatabaseError | ValidationError | NotFoundError

const doThing = (): Effect<Result, MyErrors> => ...

// CORRECT: Each error type extends Data.TaggedError
class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly id: string
}> {}

// CORRECT: Handle each error case explicitly
pipe(
  doThing(),
  Effect.catchTag("NotFoundError", (e) => ...),
  Effect.catchTag("DatabaseError", (e) => ...),
)
```

**Also see**: DD-002 section on Effect.sync vs Effect.try for related guidance.

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
| Dashboard | Vite + React | `apps/dashboard` |
| Docs Site | Next.js + Fumadocs | `apps/docs` |

### CLI Commands

Run `tx help` for the full list or `tx help <command>` for details.

```bash
# Tasks
tx init                    # Initialize database
tx add <title>             # Create task (--parent, --score, --description)
tx list                    # List tasks (--status, --limit)
tx ready                   # List unblocked tasks
tx show <id>               # Show task details
tx update <id>             # Update task fields
tx done <id>               # Mark complete
tx reset <id>              # Reset to ready
tx delete <id>             # Delete task

# Dependencies & Hierarchy
tx block <id> <blocker>    # Add blocking dependency
tx unblock <id> <blocker>  # Remove dependency
tx children <id>           # List child tasks
tx tree <id>               # Show task subtree

# Attempts
tx try <id> <approach>     # Record an attempt (--failed|--succeeded)
tx attempts <id>           # List attempts

# Memory & Learnings
tx learning:add <content>  # Add a learning
tx learning:search <q>     # Search (BM25 + recency)
tx learning:recent         # Recent learnings
tx learning:helpful <id>   # Record helpfulness
tx learning:embed          # Compute vector embeddings
tx context <task-id>       # Contextual learnings for a task
tx learn <path> <note>     # Attach learning to file/glob
tx recall [path]           # Query file learnings

# Messages (Agent Outbox)
tx send <channel> <msg>    # Send to channel
tx inbox <channel>         # Read messages
tx ack <id>                # Acknowledge message
tx ack:all <channel>       # Acknowledge all on channel
tx outbox:pending <ch>     # Count pending messages
tx outbox:gc               # Garbage collect old messages

# Docs & Invariants
tx doc <sub>               # add, edit, show, list, render, lock, version, link, attach, patch, validate, drift
tx invariant <sub>         # list, show, record, sync

# Claims (Worker Leasing)
tx claim <task> <worker>   # Claim with lease (--lease minutes)
tx claim:release <t> <w>   # Release claim
tx claim:renew <t> <w>     # Renew lease

# Traces (Run Debugging)
tx trace list              # Recent runs
tx trace show <run-id>     # Metrics events for a run
tx trace transcript <id>   # Raw JSONL transcript
tx trace stderr <id>       # Stderr output
tx trace errors            # Recent errors across runs

# Sync & Data
tx sync export             # SQLite → JSONL (git-friendly)
tx sync import             # JSONL → SQLite
tx sync status             # Show sync status
tx sync codex             # Push to Codex team dir
tx compact                 # Compact done tasks + export learnings
tx history                 # View compaction history
tx migrate status          # Database migration status

# Bulk Operations
tx bulk done <id...>       # Complete multiple tasks
tx bulk score <n> <id...>  # Set score for multiple tasks
tx bulk reset <id...>      # Reset multiple tasks
tx bulk delete <id...>     # Delete multiple tasks

# Cycle (Sub-Agent Swarm)
tx cycle                   # Issue discovery with sub-agent swarms

# Tools
tx stats                   # Queue metrics and health
tx validate                # Database health checks (--fix)
tx doctor                  # System diagnostics
tx dashboard               # Start API server + dashboard UI
```

### Cycle vs Teams vs Sub-agents — Disambiguation

**"cycle"**: Use `tx cycle` (the CLI command). This dispatches sub-agent swarms internally via `AgentService` for automated issue discovery. Do NOT use Codex's built-in TeamCreate, SendMessage, or any team tools. Run `/cycle` to guide the user through the options.

**"team" or "teams"**: Use Codex's built-in team tools (TeamCreate, SendMessage, Task tool with `team_name`). This is for coordinating multiple Codex agents working on separate tasks.

**"sub-agents"**: Launch sub-agents as you normally would. This does NOT mean `tx cycle` or Codex teams.

**Key difference**: `tx cycle` is a self-contained swarm for automated issue discovery. Codex teams are for multi-agent collaboration on implementation tasks. "Sub-agents" is just a pattern — the user picks the tool.

---

## Development Tooling

### Use bun, not npm

All package management and script execution MUST use `bun`:

```bash
bun install              # NOT npm install
bun run build            # NOT npm run build
bun run test             # NOT npm run test
```

### Running the tx CLI

**ALWAYS** run the CLI via the source TypeScript file, **NEVER** via node_modules or dist paths:

```bash
# CORRECT - use tsx or bun to run source
bun run dev -- add "My task"           # via package.json script
tsx apps/cli/src/cli.ts add "My task"  # direct execution
bun apps/cli/src/cli.ts add "My task"  # bun direct execution

# WRONG - never use these
node ./node_modules/.bin/tx add "My task"
./apps/cli/dist/cli.js add "My task"
```

This ensures you're always testing the latest source code, not stale builds.

---

## Bootstrapping: tx Builds tx

**All development on tx MUST use tx itself to manage work.**

### IMPORTANT: tx Is Canonical; Native Task Tools Are Secondary

Codex built-in task tools (TaskCreate, TaskUpdate, TaskList, etc.) may be used as a local/native working list.

Task-layer source of truth policy:
- `tx` is the **primary canonical source of truth** for task state.
- Native task lists are convenience views, not the source of truth.
- If pulling work from a queue, use `tx ready` as the primary place to get work.
- Every create/update/complete/block action in native task tools **must be mirrored back to `tx`**.
- Mirror creates with `tx add` (and `--parent` for subtasks).
- Mirror updates with `tx update`, `tx block`, `tx unblock`, `tx done`, and `tx reset`.
- If native tasks and `tx` diverge, reconcile to `tx` and refresh from `tx` (`tx list`, `tx ready`, `tx show`).
- Before handoff, commit, or session end, run `tx sync export`.

The tx database is at `.tx/tasks.db`. Tasks persist across sessions and can be synced via git with `tx sync export`.

### Why Bootstrap?

- **Dogfooding** catches bugs before users do
- **Memory persists** through `.tx/tasks.db` and git-tracked `.tx/tasks.jsonl`
- **Fresh agent instances** avoid context pollution from failed attempts
- Tasks survive across sessions; conversation history does not

### RALPH Loop

One example orchestration pattern (not THE pattern):

```bash
while true; do
  TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
  [ -z "$TASK" ] && break

  codex --print "Read AGENTS.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"

  git add -A && git commit -m "Complete $TASK"
done
```

Do not bypass hooks in this workflow. Commits and pushes must run with verification enabled.

**Key insight**: Each task gets a fresh Codex instance. No accumulated context pollution. Memory lives in files, not conversation history.

---

## Development Process: PRD/DD First

**All non-trivial features MUST have documentation before implementation.**

### Why Documentation First?

- **Prevents wasted effort** — catch design issues before writing code
- **Creates reviewable artifacts** — PRDs and DDs can be reviewed independently
- **Enables parallelism** — multiple agents can implement from the same spec
- **Builds institutional knowledge** — docs persist beyond conversation context

### The Process

```
1. Problem identified → Create PRD (what to build, why, acceptance criteria)
2. PRD approved → Create DD (how to build, technical decisions, file changes)
3. DD approved → Implementation (code follows the spec)
4. Implementation complete → Update docs if design changed
```

### Plans MUST Become PRD + Design Doc

When a plan is requested (via `/plan`, plan mode, or explicit request), the output
MUST be split into a PRD and a Design Doc — not a single monolithic plan file.

- The PRD captures **what** and **why** (requirements, acceptance criteria)
- The DD captures **how** (architecture, file changes, testing strategy, open questions)
- Optionally reference the source plan file: `plan.md`, `codex-plan.md`, or `.codex/plan.md`
- Optionally reference relevant AGENTS.md DOCTRINE rules in the DD's References section

**Do NOT** leave plans as standalone `plan.md` files. They must be formalized into PRD + DD.

### PRD Structure (docs/prd/PRD-NNN-*.md)

```markdown
# PRD-NNN: Feature Name

## Problem
What's broken or missing?

## Solution
High-level approach (not implementation details)

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Acceptance Criteria
How do we know it's done?

## Out of Scope
What this PRD explicitly does NOT cover
```

### DD Structure (docs/design/DD-NNN-*.md)

```markdown
# DD-NNN: Feature Name

## Overview
Technical approach summary

## Design

### Data Model
Schema changes, new tables, migrations

### Service Layer
New services, interface changes

### API/CLI Changes
New commands, endpoints, MCP tools

## Implementation Plan

| Phase | Files | Changes |
|-------|-------|---------|
| 1 | file.ts | Add X |
| 2 | other.ts | Modify Y |

## Testing Strategy (REQUIRED — must be detailed and comprehensive)

This section is mandatory and must be thorough. Testing strategy is a first-class concern, not an afterthought.

### Unit Tests
- List specific functions/methods to unit test
- Mock boundaries: what gets mocked vs real
- Expected coverage targets

### Integration Tests
- Must use real in-memory SQLite with `getSharedTestLayer()`
- Must use SHA256-based deterministic IDs via `fixtureId(name)`
- List specific integration test scenarios (CRUD, edge cases, error paths)
- Cover cross-service interactions

### Edge Cases
- Boundary conditions to test
- Error recovery scenarios
- Concurrent access / race conditions (if applicable)

### Performance (if applicable)
- Benchmarks to establish
- Acceptable latency/throughput thresholds

### Minimum Quality Bar (MUST)
- A DD testing strategy is incomplete unless it includes:
- Requirement-to-test traceability (each requirement maps to one or more tests)
- At least 8 numbered integration scenarios with concrete setup, action, and assertions
- Failure-path and recovery coverage (timeouts, malformed input, partial failure, retries/idempotency when relevant)
- File-level test plan (exact test files to create or modify)
- Observable assertions (DB rows, API responses, emitted events/metrics, status transitions)
- Avoid vague bullets like "add tests" or "cover edge cases" without concrete inputs and expected outputs.

### Prompting Template for DD Testing Strategy
When generating or revising a DD, use this prompt shape:

```text
Write ONLY the "Testing Strategy" section for <DD-NNN>.

Requirements:
1. Provide a traceability matrix with columns:
   Requirement | Test Type | Test Name | Assertions | File Path
2. Include sections for Unit Tests, Integration Tests, Edge Cases, Failure Injection, and Performance.
3. Integration tests must use getSharedTestLayer() and fixtureId(name).
4. Provide at least 8 numbered integration scenarios, each with Setup / Action / Assert.
5. Include non-functional thresholds where applicable (latency, throughput, memory).
6. Do not use vague bullets; every test must name concrete files, inputs, and expected outcomes.
```

## Open Questions (REQUIRED)
- [ ] Unresolved design decisions
- [ ] Alternatives considered but not yet decided
- [ ] Dependencies on external teams/systems

## Migration
How existing data/users transition

## References (optional)
- Plan file: `plan.md` or `codex-plan.md` (if originated from a planning session)
- AGENTS.md section: Link to relevant DOCTRINE rules
```

### Linking Convention

- PRDs reference related DDs: `→ [DD-NNN](docs/design/DD-NNN-*.md)`
- DDs reference their PRD: `→ [PRD-NNN](docs/prd/PRD-NNN-*.md)`
- AGENTS.md DOCTRINE rules link to both PRD and DD
- Implementation PRs reference both documents

### When to Skip

Skip PRD/DD for:
- Bug fixes with obvious solutions
- Typo corrections
- Single-line changes
- Test additions for existing features

Create PRD/DD for:
- New CLI commands
- New services
- Schema changes
- Multi-file features
- Anything touching the DOCTRINE rules

---

## For Detailed Information

### Internal Design Docs (PRDs & DDs)

- **PRDs** (what to build): [docs/prd/](docs/prd/)
- **Design Docs** (how to build): [docs/design/](docs/design/)
- **Full index**: [docs/index.md](docs/index.md)

### Published User Docs

The published documentation site lives at `apps/docs/` (Next.js + Fumadocs):

- **Source PRDs/DDs**: `docs/` directory — internal design artifacts, linked from AGENTS.md
- **Published docs**: `apps/docs/content/docs/` — user-facing guides covering primitives, getting started, agent SDK
