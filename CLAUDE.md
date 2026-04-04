# tx

**Headless, Local Infra for AI Agents.** Primitives, not frameworks.

**Full documentation**: [specs/index.md](specs/index.md) | **Published docs**: [apps/docs/](apps/docs/)

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
│   tx ready     tx done      tx memory     tx pin        │
│   tx msg send  tx dep block tx msg inbox  tx sync       │
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
| `tx dep block <id> <blocker>` | Declare dependencies |
| `tx memory context <id>` | Get relevant memory + learnings for prompt injection |
| `tx memory add` | Record knowledge for future agents |
| `tx msg send <channel> <content>` | Send a message to an agent channel |
| `tx msg inbox <channel>` | Read messages (read-only, cursor-based) |
| `tx msg ack <id>` | Acknowledge a message |
| `tx claim <id> <worker>` | Claim a task with a lease for worker coordination |
| `tx memory learn <path> <note>` | Attach a learning to a file path or glob |
| `tx memory recall [path]` | Query file-specific learnings by path |
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
task=$(tx ready --limit 1 --json | jq -r '.[0].id')
claude "Read CLAUDE.md. For task $task: run tx show $task, make sure a paired PRD/design doc is linked, then decompose the work into tx subtasks and dependency edges."
echo "Review tx show $task, tx dep tree $task, and the linked PRD/DD docs, then press Enter to continue..."
read
claude "Read CLAUDE.md. For task $task: execute the approved ready work from the linked PRD/DD docs and keep tx updated."
```

```bash
# File-based: agent reads markdown, no CLI polling needed
while true; do
  tx md-export                    # materialize ready tasks to .tx/tasks.md
  claude -p "Read .tx/tasks.md and complete the highest priority task. When done, run: tx done <id>"
done
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
│  Memory                                 │  ← tx memory (learnings, context, recall)
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

### The Spec-Driven Development Triangle

Spec-driven development is not a one-way equation (spec + tests + agent = code) — it's a feedback loop where implementing code generates decisions that must feed back into the spec and tests. tx is the control plane that keeps these three nodes in sync as agents work: tasks define what to build, learnings and traces capture the decisions made during implementation, and `tx done` is a checkpoint — not a suggestion — that closes the loop. The answer to AI coding's volume problem (waterfall output at agile cadence) is not more complex orchestration but lightweight process, so that moving fast doesn't require abandoning intent tracking. Decisions made during implementation, whether by humans or agents, are first-class artifacts that compound in the knowledge layer.

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

→ [DD-005](specs/design/DD-005-mcp-agent-sdk-integration.md), [PRD-007](specs/prd/PRD-007-multi-interface-integration.md)

### RULE 2: Compaction MUST export learnings to a file agents can read

`tx sync compact` MUST append learnings to a markdown file (default: `CLAUDE.md`). Storing only in `compaction_log` table is insufficient.

```markdown
## Agent Learnings (YYYY-MM-DD)
- Learning bullet point 1
- Learning bullet point 2
```

→ [PRD-006](specs/prd/PRD-006-task-compaction-learnings.md), [DD-006](specs/design/DD-006-llm-integration.md)

### RULE 3: All core paths MUST have integration tests with SHA256 fixtures

Unit tests are insufficient. Integration tests MUST use:
- Real in-memory SQLite database
- Deterministic SHA256-based IDs via `fixtureId(name)`
- Coverage: CRUD, ready detection, dependencies, hierarchy, MCP tools

→ [DD-007](specs/design/DD-007-testing-strategy.md)

### RULE 4: No circular dependencies, no self-blocking

Enforce at database level:
- `CHECK (blocker_id != blocked_id)` — no self-blocking
- BFS cycle detection at insert time — no A→B→A chains

→ [DD-004](specs/design/DD-004-ready-detection-algorithm.md), [PRD-003](specs/prd/PRD-003-dependency-blocking-system.md)

### RULE 5: Effect-TS patterns are mandatory

All business logic MUST use Effect-TS:
- Services: `Context.Tag` + `Layer.effect`
- Errors: `Data.TaggedError` with union types
- Operations: return `Effect<T, E>`
- No raw try/catch or untyped Promises in service code

→ [DD-002](specs/design/DD-002-effect-ts-service-layer.md)

### RULE 6: Telemetry MUST NOT block operations

- OTEL packages are **optional peer dependencies**
- `TelemetryAuto`: auto-detect from `OTEL_EXPORTER_*` env vars
- No config → `TelemetryNoop` (zero overhead)
- Telemetry errors: catch and log, never propagate

→ [PRD-008](specs/prd/PRD-008-observability-opentelemetry.md), [DD-008](specs/design/DD-008-opentelemetry-integration.md)

### RULE 7: ANTHROPIC_API_KEY is optional for core commands

LLM features (`tx dedupe`, `tx sync compact`, `tx reprioritize`) require the key. Core commands do not.

| Layer | LLM | Used By |
|-------|-----|---------|
| `AppMinimalLive` | No | CLI core, MCP, Agent SDK |
| `AppLive` | Yes | dedupe, compact, reprioritize |

→ [DD-002](specs/design/DD-002-effect-ts-service-layer.md), [DD-006](specs/design/DD-006-llm-integration.md)

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
backlog → ready → planning → active → blocked → review → needs_review → done
```

A task is **ready** when: status is workable AND all blockers have status `done`.

### Key Technical Decisions

| Decision | Choice | Doc |
|----------|--------|-----|
| Storage | SQLite (better-sqlite3, WAL) | [DD-001](specs/design/DD-001-data-model-storage.md) |
| Sync | JSONL git-backed | [DD-009](specs/design/DD-009-jsonl-git-sync.md) |
| Framework | Effect-TS | [DD-002](specs/design/DD-002-effect-ts-service-layer.md) |
| CLI | @effect/cli | [DD-003](specs/design/DD-003-cli-implementation.md) |
| MCP | @modelcontextprotocol/sdk | [DD-005](specs/design/DD-005-mcp-agent-sdk-integration.md) |
| IDs | SHA256-based `tx-[a-z0-9]{6,8}` | [DD-001](specs/design/DD-001-data-model-storage.md) |
| Testing | Vitest + SHA256 fixtures | [DD-007](specs/design/DD-007-testing-strategy.md) |
| Dashboard | Vite + React | `apps/dashboard` |
| Docs Site | Next.js + Fumadocs | `apps/docs` |

### Orchestration Status

Orchestration status is a computed second layer alongside workflow status, derived from `task_claims` at enrichment time:

| Status | Meaning |
|--------|---------|
| `null` | No claims system in use (single-agent workflows) |
| `unclaimed` | No active claim on the task |
| `claimed` | Worker has reserved the task via `tx claim` |
| `running` | Claimed + task status is `active` |
| `lease_expired` | Claim lease has expired |
| `released` | Claim was explicitly released |

Visible in `tx show`, `tx list`, and all API responses via the `orchestrationStatus`, `claimedBy`, `claimExpiresAt`, and `failedAttempts` fields on `TaskWithDeps`.

### CLI Commands

Run `tx help` for the full list or `tx help <command>` for details.

```bash
# Tasks
tx init                        # Initialize database
tx add <title>                 # Create task (--parent, --score, --description)
tx list                        # List tasks (--status, --limit)
tx ready                       # List unblocked tasks
tx show <id>                   # Show task details
tx update <id>                 # Update task fields
tx done <id>                   # Mark complete
tx reset <id>                  # Reset to ready
tx delete <id>                 # Delete task
tx md-export                   # Export tasks to markdown file (--watch, --include-context)

# Dependencies & Hierarchy (tx dep)
tx dep block <id> <blocker>    # Add blocking dependency
tx dep unblock <id> <blocker>  # Remove dependency
tx dep children <id>           # List child tasks
tx dep tree <id>               # Show task subtree

# Memory (filesystem-backed .md search)
tx memory source add <dir>     # Register directory for indexing
tx memory source rm <dir>      # Unregister directory
tx memory source list          # Show registered directories
tx memory add <title>          # Create .md file (--content, --tags, --dir)
tx memory index                # Index all sources (--incremental, --status)
tx memory search <query>       # BM25 search (--semantic, --expand, --tags, --prop)
tx memory show <id>            # Display document
tx memory tag <id> <tags>      # Add tags to frontmatter
tx memory untag <id> <t>       # Remove tags
tx memory relate <id> <t>      # Add to frontmatter.related
tx memory set <id> <k> <v>     # Set property (writes frontmatter + DB)
tx memory unset <id> <k>       # Remove property
tx memory props <id>           # Show properties
tx memory links <id>           # Outgoing wikilinks + edges
tx memory backlinks <id>       # Incoming links
tx memory list                 # List documents (--source, --tags)
tx memory link <src> <tgt>     # Create explicit edge
tx memory context <id>         # Task-relevant memory for prompt injection
tx memory learn <p> <note>     # Attach learning to file path/glob
tx memory recall [path]        # Query file-specific learnings

# Messages (tx msg)
tx msg send <channel> <msg>    # Send to channel
tx msg inbox <channel>         # Read messages
tx msg ack <id>                # Acknowledge message
tx msg ack all <channel>       # Acknowledge all on channel
tx msg pending <ch>            # Count pending messages
tx msg gc                      # Garbage collect old messages

# Docs & Specs
tx doc <sub>                   # add, edit, show, list, render, lock, version, link, attach, patch, validate, drift
tx spec lint                   # All-in-one check (drift, EARS, coverage, spec-test status)
tx spec discover               # Refresh doc-derived invariants and discover test mappings
tx spec health                 # Repo rollup for closure, decisions, and drift
tx spec fci                    # Compute Feature Completion Index
tx spec status                 # Quick phase + blocker summary
tx spec complete               # Record human sign-off
tx spec run <test-id>          # Record pass/fail for a mapped test
tx spec batch                  # Import batch run results from stdin JSON
tx spec link <inv> <file>      # Manually link invariant to test
tx spec unlink <inv> <test>    # Remove invariant/test link
tx spec tests <inv-id>         # List tests linked to an invariant
tx spec gaps                   # List uncovered invariants
tx spec matrix                 # Show full traceability matrix

# Claims (Worker Leasing)
tx claim <task> <worker>       # Claim with lease (--lease minutes)
tx claim release <t> <w>       # Release claim
tx claim renew <t> <w>         # Renew lease

# Traces (Run Debugging)
tx trace list                  # Recent runs
tx trace show <run-id>         # Metrics events for a run
tx trace transcript <id>       # Raw JSONL transcript
tx trace stderr <id>           # Stderr output
tx trace errors                # Recent errors across runs

# Sync & Data (tx sync)
tx sync export                 # SQLite → JSONL (git-friendly)
tx sync import                 # JSONL → SQLite
tx sync status                 # Show sync status
tx sync claude                 # Push to Claude Code team dir
tx sync compact                # Compact done tasks + export learnings
tx sync history                # View compaction history
tx sync migrate status         # Database migration status

# Bulk Operations
tx bulk done <id...>           # Complete multiple tasks
tx bulk score <n> <id...>      # Set score for multiple tasks
tx bulk reset <id...>          # Reset multiple tasks
tx bulk delete <id...>         # Delete multiple tasks

# Cycle (Sub-Agent Swarm)
tx cycle                       # Issue discovery with sub-agent swarms

# Automation (tx auto)
tx auto guard                  # Run guard checks
tx auto gate                   # Manage phase gates
tx auto verify                 # Verify task completion
tx auto label                  # Auto-label tasks
tx auto reflect                # Agent reflection on completed work

# Context Pins (tx pin)
tx pin set <id> [content]      # Create or update a pin
tx pin get <id>                # Show pin content
tx pin rm <id>                 # Remove a pin from DB and target files
tx pin list                    # List all pins
tx pin sync                    # Re-sync all pins to target files
tx pin targets [files...]      # Show or set target files

# Decisions (tx decision)
tx decision add <content>      # Add a decision manually
tx decision list               # List decisions
tx decision show <id>          # Show decision details
tx decision approve <id>       # Approve a pending decision
tx decision reject <id>        # Reject a pending decision (--reason required)
tx decision edit <id> <content># Edit a pending decision
tx decision pending            # List pending decisions

# Group Context
tx group-context set <id> <ctx># Set task-group context
tx group-context clear <id>    # Clear task-group context

# Diagnostics (tx diag)
tx diag stats                  # Queue metrics and health
tx diag doctor                 # System diagnostics
tx diag dashboard              # Start API server + dashboard UI
tx validate                    # Database health checks (--fix)

# Utilities (tx utils)
tx utils claude-usage          # Show Claude Code rate limit usage
tx utils codex-usage           # Show Codex rate limit usage

# Deprecated aliases (still work)
# tx block → tx dep block, tx unblock → tx dep unblock
# tx children → tx dep children, tx tree → tx dep tree
# tx send → tx msg send, tx inbox → tx msg inbox
# tx ack → tx msg ack, tx outbox → tx msg
# tx stats → tx diag stats, tx doctor → tx diag doctor
# tx dashboard → tx diag dashboard
# tx compact → tx sync compact, tx history → tx sync history
# tx migrate status → tx sync migrate status
# tx invariant → tx spec
```

### Cycle vs Teams vs Sub-agents — Disambiguation

**"cycle"**: Use `tx cycle` (the CLI command). This dispatches sub-agent swarms internally via `AgentService` for automated issue discovery. Do NOT use Claude Code's built-in TeamCreate, SendMessage, or any team tools. Run `/cycle` to guide the user through the options.

**"team" or "teams"**: Use Claude Code's built-in team tools (TeamCreate, SendMessage, Task tool with `team_name`). This is for coordinating multiple Claude Code agents working on separate tasks.

**"sub-agents"**: Launch sub-agents as you normally would. This does NOT mean `tx cycle` or Claude Code teams.

**Key difference**: `tx cycle` is a self-contained swarm for automated issue discovery. Claude Code teams are for multi-agent collaboration on implementation tasks. "Sub-agents" is just a pattern — the user picks the tool.

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

### Release & npm Publish Runbook (Lessons Learned)

Use this checklist for every release to avoid silent publish failures.

#### Critical rules

1. Publishing is driven by `.github/workflows/publish.yml` on `release.published` (plus manual `workflow_dispatch` fallback).
2. Pushing a git tag alone does **not** publish to npm.
3. If an automated release event does not trigger publish, manually dispatch `publish.yml`.
4. For backfilled patch versions (`0.5.4`, `0.5.5`, etc.), each version must have:
   - The correct git tag pointing at the intended commit
   - A corresponding GitHub Release (`vX.Y.Z`)
   - A successful `publish.yml` run
5. Never assume publish succeeded: verify with both GitHub Actions and npm registry commands.

#### Release verification commands

```bash
# 1) Confirm tags point to expected commits
git rev-list -n 1 v0.5.4
git rev-list -n 1 v0.5.5

# 2) Confirm publish workflow runs and status
gh run list --workflow publish.yml --limit 10
gh run view <run-id>

# 3) Manual fallback if release trigger is missed
gh workflow run publish.yml --ref main
# or for a specific version tag (if workflow_dispatch exists on that ref):
gh workflow run publish.yml --ref v0.5.5

# 4) Confirm npm is actually updated
npm view @jamesaphoenix/tx version
npm view @jamesaphoenix/tx versions --json
npm view @jamesaphoenix/tx-cli version
npm view @jamesaphoenix/tx-cli versions --json
```

#### If a tag points to the wrong commit

1. Delete incorrect remote tag: `git push origin :refs/tags/vX.Y.Z`
2. Re-point local tag: `git tag -f vX.Y.Z <correct-commit>`
3. Push corrected tag: `git push origin vX.Y.Z --force`
4. Recreate GitHub Release for that tag
5. Re-run/verify `publish.yml`

---

## Bootstrapping: tx Builds tx

**All development on tx MUST use tx itself to manage work.**

### IMPORTANT: tx Is Canonical; Native Task Tools Are Secondary

Claude Code built-in task tools (TaskCreate, TaskUpdate, TaskList, etc.) may be used as a local/native working list.

Task-layer source of truth policy:
- `tx` is the **primary canonical source of truth** for task state.
- Native task lists are convenience views, not the source of truth.
- If pulling work from a queue, use `tx ready` as the primary place to get work.
- Every create/update/complete/block action in native task tools **must be mirrored back to `tx`**.
- Mirror creates with `tx add` (and `--parent` for subtasks).
- Mirror updates with `tx update`, `tx dep block`, `tx dep unblock`, `tx done`, and `tx reset`.
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

  claude --print "Read CLAUDE.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"

  git add -A && git commit -m "Complete $TASK"
done
```

Do not bypass hooks in this workflow. Commits and pushes must run with verification enabled.

**Key insight**: Each task gets a fresh Claude instance. No accumulated context pollution. Memory lives in files, not conversation history.

---

## Development Process: Documentation First (Markdown-First)

**All non-trivial features MUST have markdown spec documentation before implementation.**

### Spec-Type Documentation Model

| spec_type | Focus |
|-----------|-------|
| `prd` | Product intent (what and why) |
| `design` | System behaviour (how) |
| `overview` | Architectural map (non-normative) |
| `runbook` | Operational procedures |
| `decision` | Architectural decisions (ADRs) |

Markdown is canonical: docs are authored as `.md` with YAML frontmatter and embedded YAML blocks. There is no YAML-source render pipeline.

### Why Documentation First?

- **Prevents wasted effort** — catch scope and design issues before writing code
- **Creates reviewable artifacts** — intent, behaviour, architecture, and operations are reviewed explicitly
- **Enables parallelism** — multiple agents can implement from the same specification set
- **Builds institutional knowledge** — docs persist beyond conversation context

### The Process

```
1. Problem identified → Create `prd` spec (intent, problem, scope, requirements, acceptance criteria)
2. PRD approved → Create `design` spec (architecture, interfaces, invariants, failure modes, verification)
3. Add supporting specs as needed: `overview`, `runbook`, `decision`
4. Specs approved → Implementation (code follows the specs)
5. Implementation complete → Update affected specs when design or behaviour changes
```

### Plans MUST Become Docs (Spec Types)

When a plan is requested (via `/plan`, plan mode, or explicit request), the output
MUST be formalized into markdown specs, not left as a standalone plan file.

- `prd` captures **product intent** (what and why)
- `design` captures **system behaviour** (how)
- `overview` captures **cross-system architectural context** (non-normative map)
- `runbook` captures **operational procedures** (symptoms, diagnosis, mitigation, escalation)
- `decision` captures **architecture decisions** and trade-offs (ADRs)
- Optionally reference source plan files: `plan.md`, `codex-plan.md`, or `.claude/plan.md`
- Optionally reference relevant CLAUDE.md DOCTRINE rules in design/decision references

**Do NOT** leave plans as standalone `plan.md` files.

### PRD Structure (`spec_type: prd`)

````markdown
---
kind: spec
spec_type: prd
name: feature-name
title: Feature Name
status: draft
version: 1
owners:
  - team
summary: One-line summary
domain: product-area
tags:
  - feature
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-15
---

# Summary
...

# Problem
...

# Scope
Included: ...
Excluded: ...

# Requirements

```yaml
ears_requirements:
  - id: REQ-FEAT-001
    kind: ubiquitous
    statement: the system shall do X
    priority: must
    rationale: why this matters
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-001
    statement: criterion description
```

# Non-goals
...
````

### DD Structure (`spec_type: design`)

````markdown
---
kind: spec
spec_type: design
name: feature-name-design
title: Feature Name Design
status: draft
version: 1
owners:
  - team
summary: Technical approach summary
domain: product-area
tags:
  - design
depends_on:
  - feature-name
supersedes: []
implements: feature-name
last_reviewed_at: 2026-03-15
---

# Summary
...

# Architecture
...

# Interfaces

```yaml
interfaces:
  - name: endpoint_name
    type: http
    method: POST
    path: /path
    semantics: description of guarantees
    contract: packages/types/src/doc.ts#SomeContractSchema
```

# Data Model
...

# Invariants

```yaml
invariants:
  - id: INV-001
    statement: what must always be true
    severity: high
    verified_by:
      - test/path.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: when X happens
    impact: Y is affected
    handling: do Z to recover
```

# Verification

```yaml
verification:
  - requirement_id: REQ-FEAT-001
    test_type: integration
    target: test/path.test.ts
```

# Testing Strategy
(detailed and comprehensive; see quality bar below)

## Unit Tests
- List specific functions/methods to unit test
- Mock boundaries: what gets mocked vs real
- Expected coverage targets

## Integration Tests
- Must use real in-memory SQLite with `getSharedTestLayer()`
- Must use SHA256-based deterministic IDs via `fixtureId(name)`
- List specific integration test scenarios (CRUD, edge cases, error paths)
- Cover cross-service interactions

## Edge Cases
- Boundary conditions to test
- Error recovery scenarios
- Concurrent access / race conditions (if applicable)

## Performance (if applicable)
- Benchmarks to establish
- Acceptable latency/throughput thresholds

## Minimum Quality Bar (MUST)
- Requirement-to-test traceability (each requirement maps to one or more tests)
- At least 8 numbered integration scenarios with concrete setup, action, and assertions
- Failure-path and recovery coverage (timeouts, malformed input, partial failure, retries/idempotency when relevant)
- File-level test plan (exact test files to create or modify)
- Observable assertions (DB rows, API responses, emitted events/metrics, status transitions)
- Avoid vague bullets like "add tests" or "cover edge cases" without concrete inputs and expected outputs

# Open Questions
- [ ] Unresolved design decisions
- [ ] Alternatives considered but not yet decided
- [ ] Dependencies on external teams/systems

# Migration
How existing data/users transition.

# References
- Plan file: `plan.md` or `codex-plan.md` (if originated from a planning session)
- Related PRD: `specs/prd/*.md`
- Related decisions: `specs/**/*.md` with `spec_type: decision`
- CLAUDE.md section: Link to relevant DOCTRINE rules
````

### Linking Convention

- PRDs reference their implementing design docs and related decisions
- Design docs set `implements` to the PRD `name` and map requirements to verification targets
- Overview specs reference connected PRD/design docs for system context
- Runbooks reference the design docs and interfaces they operationalize
- Decision docs reference affected PRD/design/runbook specs
- Implementation PRs should reference the relevant spec chain used for delivery

### When to Skip

Skip spec docs for:
- Bug fixes with obvious solutions
- Typo corrections
- Single-line changes
- Test additions for existing features

Create docs per `spec_type` as needed:
- Create **`prd`** for new product capabilities and acceptance scope
- Create **`design`** for non-trivial implementation and verification mapping
- Create **`overview`** for cross-system maps that aid orientation
- Create **`runbook`** for operational response procedures
- Create **`decision`** for durable architecture decisions and trade-offs

Existing YAML-first docs are not retroactively rewritten unless explicitly scoped; all new documentation should follow markdown-first spec types.

---

## For Detailed Information

### Internal Documentation (Markdown Spec Types)

- **PRD specs (`spec_type: prd`)**: [specs/prd/](specs/prd/)
- **Design specs (`spec_type: design`)**: [specs/design/](specs/design/)
- **Overview/Runbook/Decision specs**: [specs/](specs/)
- **Full index**: [specs/index.md](specs/index.md)

### Published User Docs

The published documentation site lives at `apps/docs/` (Next.js + Fumadocs):

- **Source markdown-first specs**: `specs/` directory — internal artifacts linked from CLAUDE.md
- **Published docs**: `apps/docs/content/docs/` — user-facing guides covering primitives, getting started, agent SDK
