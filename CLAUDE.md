# tx

**TanStack for AI agents.** Primitives, not frameworks.

Headless infrastructure for memory, tasks, and orchestration.

**Full documentation**: [docs/index.md](docs/index.md)

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
| `tx sync export` | Persist to git-friendly JSONL |
| `tx sync claude` | One-way push tasks to Claude Code team directory |

### Example Loops (not THE loop)

We ship example orchestration patterns, not a required workflow:

```bash
# Simple: one agent, one task
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  claude "Work on task $task, then run: tx done $task"
done
```

```bash
# Parallel: N agents pulling from queue
for i in {1..5}; do
  (while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
    claude "Complete $task" && tx done $task
  done) &
done
wait
```

```bash
# Human-in-loop: agent proposes, human approves
task=$(tx ready --limit 1)
claude "Plan implementation for $task" > plan.md
read -p "Approve? [y/n] " && claude "Execute plan.md"
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

`tx compact` MUST append learnings to a markdown file (default: `CLAUDE.md`). Storing only in `compaction_log` table is insufficient.

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

**Rule**: All `.claude/hooks/*.sh` scripts must work with Bash 3.2. Avoid: `${var:offset:-N}`, `&>>`, associative arrays (`declare -A`), `|&`, `coproc`.

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

### CLI Commands

```bash
# Tasks
tx add <title>              # Create
tx ready                    # List unblocked
tx done <id>                # Complete
tx block <id> <blocker>     # Add dependency
tx tree <id>                # Show hierarchy

# Memory
tx learning:add <content>   # Store
tx learning:search <query>  # Find
tx context <task-id>        # Contextual retrieval

# Messages
tx send <channel> <msg>     # Send to channel
tx inbox <channel>          # Read messages
tx ack <id>                 # Acknowledge

# Docs
tx doc add <title>          # Create a doc
tx invariant list           # List invariants

# Sync
tx sync export              # SQLite → JSONL (git-friendly)
tx sync import              # JSONL → SQLite
tx sync claude              # Push to Claude Code team dir
```

---

## Development Tooling

### Use bun, not npm

All package management and script execution MUST use `bun`:

```bash
bun install              # NOT npm install
bun run build            # NOT npm run build
bun run test             # NOT npm run test
bun run lint:docs        # Lint PRDs and DDs
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

### IMPORTANT: Use tx, NOT Built-in Task Tools

Claude Code has built-in task tools (TaskCreate, TaskUpdate, TaskList, etc.). **DO NOT USE THESE.**

Instead, use the tx CLI commands:
- `tx add` instead of TaskCreate
- `tx ready` instead of TaskList
- `tx show` instead of TaskGet
- `tx done` instead of TaskUpdate

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

  claude --print "Read CLAUDE.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"

  git add -A && git commit -m "Complete $TASK"
done
```

**Key insight**: Each task gets a fresh Claude instance. No accumulated context pollution. Memory lives in files, not conversation history.

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

## Testing Strategy
Integration tests, fixtures needed

## Migration
How existing data/users transition
```

### Linking Convention

- PRDs reference related DDs: `→ [DD-NNN](docs/design/DD-NNN-*.md)`
- DDs reference their PRD: `→ [PRD-NNN](docs/prd/PRD-NNN-*.md)`
- CLAUDE.md DOCTRINE rules link to both PRD and DD
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

- **PRDs** (what to build): [docs/prd/](docs/prd/)
- **Design Docs** (how to build): [docs/design/](docs/design/)
- **Full index**: [docs/index.md](docs/index.md)
