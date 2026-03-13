# tx — Headless, Local Infra for AI Agents

## IMPORTANT: tx Is Canonical, Native Task List Is Allowed

Claude Code native task tools (TaskCreate, TaskUpdate, TaskList, etc.) may be used as a local working list.

Task-layer source of truth policy:
- `tx` is the **primary canonical source of truth** for task state.
- Native task lists are convenience views only.
- If pulling work from a queue, use `tx ready` as the primary place to get work.
- Every create/update/complete/block action in native tasks **must be mirrored back to `tx`**.

Required sync behavior:
- Mirror native creates to `tx add` (use `--parent` for subtasks).
- Mirror native state updates to `tx update`, `tx block`, `tx unblock`, `tx done`, or `tx reset`.
- Before handoff, commit, or session end, run `tx sync export`.
- If native tasks and `tx` diverge, reconcile to `tx` and refresh from `tx` (`tx list`, `tx ready`, `tx show`).

The tx database is at `.tx/tasks.db`. Tasks persist across sessions and sync to git via `tx sync export`.

## Start Here

Use this loop before reaching for the rest of the surface area:

```bash
tx add "First task"
tx ready
tx show <id>
tx done <id>
tx sync export
```

When you are ready to add docs-first specs:

```bash
tx doc add prd auth-flow --title "Auth Flow"
tx spec discover
tx spec status --doc auth-flow
tx spec complete --doc auth-flow --by <human>
```

## Quick Reference

### Core Primitives

| Command | Purpose |
|---------|---------|
| `tx ready` | Get next workable task (unblocked, highest priority) |
| `tx done <id>` | Complete task, potentially unblocking others |
| `tx add <title>` | Create a new task (`--parent`, `--score`, `--description`) |
| `tx show <id>` | Show task details with dependencies |
| `tx block <id> <blocker>` | Declare task dependencies |
| `tx group-context set <id> <context>` | Attach shared task-group context for related tasks |
| `tx group-context clear <id>` | Clear task-group context from a task |
| `tx memory context <id>` | Get relevant memory + history for prompt injection |
| `tx doc lint-ears <target>` | Validate PRD EARS requirements (doc name or YAML path) |

### Bounded Autonomy

| Command | Purpose |
|---------|---------|
| `tx gate create <name>` | Create a human approval gate for phase transitions |
| `tx guard set` | Set task creation limits (`--max-pending`, `--max-children`, `--max-depth`, `--enforce`) |
| `tx guard show` | Show current guard configuration |
| `tx verify set <id> <cmd>` | Attach a shell verification command to a task |
| `tx verify run <id>` | Run verification (exit 0 = pass) |
| `tx label add <name>` | Create a label for scoping the ready queue |
| `tx label assign <id> <name>` | Assign a label to a task |
| `tx ready --label <name>` | Filter ready queue by label |
| `tx reflect` | Session retrospective (throughput, signals, stuck tasks) |

### Memory & Learnings

| Command | Purpose |
|---------|---------|
| `tx memory search --query <text>` | Search filesystem memory docs |
| `tx memory add <content>` | Record knowledge for future agents |
| `tx memory search <q>` | Search memory (BM25 + semantic + graph) |
| `tx memory learn <path> <note>` | Attach a learning to a file path or glob |
| `tx memory recall [path]` | Query file-specific learnings by path |
| `tx pin set <id> <content>` | Persist a context pin (shared with agents) |

### Messaging (Agent Outbox)

| Command | Purpose |
|---------|---------|
| `tx send <channel> <msg>` | Send a message to an agent channel |
| `tx inbox <channel>` | Read messages (read-only, cursor-based) |
| `tx ack <id>` | Acknowledge a message |

### Worker Coordination

| Command | Purpose |
|---------|---------|
| `tx claim <id> <worker>` | Claim a task with a lease |
| `tx claim release <id> <w>` | Release a claim |
| `tx claim renew <id> <w>` | Renew a lease |

### Docs-First Specs

| Command | Purpose |
|---------|---------|
| `tx spec discover` | Refresh doc-derived invariants and test mappings |
| `tx spec status` | Inspect docs-first closure state with blocker reasons |
| `tx spec fci` | Get compact machine-readable completion state |
| `tx spec complete` | Record human COMPLETE sign-off |
| `tx spec health` | Repo rollup for docs, tests, decisions, and drift |

### Advanced Inspection

| Command | Purpose |
|---------|---------|
| `tx trace list` | Inspect recent run traces |
| `tx decision list` | List captured decisions and their review status |
| `tx decision pending` | Show decisions awaiting review |
| `tx invariant list` | Advanced derived-invariant inspection and repair |

### Sync & Data

| Command | Purpose |
|---------|---------|
| `tx sync export` | SQLite to git-friendly JSONL |
| `tx sync import` | JSONL to SQLite |
| `tx compact` | Compact done tasks + export learnings |

## Example Orchestration Loops

### Simple: one agent, one task at a time

```bash
while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
  [ "$task" = "null" ] && break
  claude "Work on task $task. Run tx show $task first, implement it, then tx done $task"
done
```

### Parallel: N agents pulling from a shared queue

```bash
for i in {1..5}; do
  (while task=$(tx ready --limit 1 --json | jq -r '.[0].id'); do
    [ "$task" = "null" ] && break
    claude "Complete $task" && tx done $task
  done) &
done
wait
```

### Human-in-the-loop: agent proposes, human approves

```bash
task=$(tx ready --limit 1 --json | jq -r '.[0].id')
claude "Plan implementation for $task" > plan.md
read -p "Approve? [y/n] " answer
[ "$answer" = "y" ] && claude "Execute plan.md" && tx done $task
```

Do not bypass hooks in this workflow. Keep git verification enabled for commits and pushes.

If related tasks share rollout/migration notes, set them once via `tx group-context set <id> "<context>"` so descendants/ancestors inherit the same context.

### Fresh agent per task (prevents context pollution)

```bash
while true; do
  TASK=$(tx ready --json --limit 1 | jq -r '.[0].id')
  [ "$TASK" = "null" ] && break
  claude --print "Read CLAUDE.md. Your task: $TASK. Run tx show $TASK, implement it, then tx done $TASK"
  git add -A && git commit -m "Complete $TASK"
done
```

## EARS-First Requirements

- For new PRDs, prefer `ears_requirements` over plain `requirements`.
- Use deterministic IDs in the form `EARS-<AREA>-NNN` (example: `EARS-API-001`).
- Use valid patterns only: `ubiquitous`, `event_driven`, `state_driven`, `optional`, `unwanted`, `complex`.
- Run `tx doc lint-ears <doc-name-or-yaml-path>` before implementation and before review.
- Keep legacy `requirements` only for backward compatibility or migration.

## Documentation Structure (4-Tier Convention)

| Tier | Directory | Prefix | Focus |
|------|-----------|--------|-------|
| Requirements | `specs/requirements/` | `REQ-NNN` | Use-cases and behavior |
| PRD | `specs/prd/` | `PRD-NNN` | Scope and acceptance criteria |
| Design Doc | `specs/design/` | `DD-NNN` | Implementation design |
| System Design | `specs/system-design/` | `SD-NNN` | Shared architecture constraints |

- `tx doc` scaffolds all 5 doc kinds: `overview`, `requirement`, `prd`, `design`, and `system_design`.
- Create docs for non-trivial features and plans; formalize behavior, scope, design, and SD when cross-cutting.
- Skip docs for trivial changes (typos, obvious bug fixes, single-line edits, and focused test-only updates).
- Link docs as a chain: `REQ -> PRD -> DD`, and include `SD` when constraints span multiple features.

## Testing + OTEL Quality Bar

- Treat integration tests as the default for behavior changes; unit tests alone are not enough.
- Cover critical flows with happy path plus failure path assertions (timeouts, malformed input, partial failure, retries/idempotency where relevant).
- Integration tests must use `getSharedTestLayer()` and `fixtureId(name)`. Never create a DB per test.
- If telemetry-related code changes, test all three modes: no OTEL config (noop), OTEL configured, and exporter failure.
- Telemetry failures must be caught/logged and never block core operations.

## Design Doc Testing Strategy Quality Bar

For `specs/design/DD-*.md`, the `## Testing Strategy` section must be concrete and testable.

- Include requirement-to-test traceability (every requirement maps to one or more tests).
- When PRDs use EARS, map each `EARS-*` ID to one or more tests in the traceability matrix.
- Include at least 8 numbered integration scenarios with setup, action, and assertions.
- Include failure-path testing (timeouts, malformed input, partial failures, retries/idempotency where relevant).
- Include OTEL/non-OTEL behavior assertions when observability paths are touched.
- Name exact test files to add or update.
- Use concrete expected outcomes (DB rows, API responses, emitted events/metrics, task state transitions).
- Do not write vague bullets like "add tests" or "cover edge cases".

Use this prompt pattern when drafting:

```text
Write ONLY the "Testing Strategy" section for <DD-NNN>.
1) Add a traceability matrix:
   Requirement | Test Type | Test Name | Assertions | File Path
2) Include Unit, Integration, Edge Cases, Failure Injection, Performance.
3) Integration tests must use getSharedTestLayer() and fixtureId(name).
4) Provide at least 8 numbered integration scenarios with Setup / Action / Assert.
5) If the PRD uses EARS, include EARS requirement IDs in traceability rows.
6) If telemetry is in scope, include noop/configured/exporter-failure assertions.
7) Use specific files, inputs, and expected outcomes; no vague statements.
```
