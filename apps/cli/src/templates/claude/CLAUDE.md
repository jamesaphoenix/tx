# tx - Headless, Local Infra for AI Agents

## IMPORTANT: tx Is Canonical, Native Task List Is Allowed

Claude Code native task tools (TaskCreate, TaskUpdate, TaskList, etc.) may be used as a local working list.

Task-layer source of truth policy:
- `tx` is the **primary canonical source of truth** for task state.
- Native task lists are convenience views only.
- If pulling work from a queue, use `tx ready` as the primary place to get work.
- Every create/update/complete/block action in native tasks **must be mirrored back to `tx`**.

Required sync behavior:
- Mirror native creates to `tx add` (use `--parent` for subtasks).
- Mirror native state updates to `tx update`, `tx dep block`, `tx dep unblock`, `tx done`, or `tx reset`.
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
tx doc add prd auth-flow-prd --title "Auth Flow PRD"
tx doc add design auth-flow-design --title "Auth Flow Design"
tx doc link auth-flow-prd auth-flow-design
tx spec discover
tx spec status --doc auth-flow-design
tx spec complete --doc auth-flow-design --by <human>
```

## Quick Reference

### Core Primitives

| Command | Purpose |
|---------|---------|
| `tx ready` | Get next workable task (unblocked, highest priority) |
| `tx done <id>` | Complete task, potentially unblocking others |
| `tx add <title>` | Create a new task (`--parent`, `--score`, `--description`) |
| `tx show <id>` | Show task details with dependencies |
| `tx dep block <id> <blocker>` | Declare task dependencies |
| `tx group-context set <id> <context>` | Attach shared task-group context for related tasks |
| `tx group-context clear <id>` | Clear task-group context from a task |
| `tx memory context <id>` | Get relevant memory + history for prompt injection |
| `tx doc lint-ears <target>` | Validate PRD EARS requirements (doc name or markdown path) |

### Bounded Autonomy

| Command | Purpose |
|---------|---------|
| `tx auto gate create <name>` | Create a human approval gate for phase transitions |
| `tx auto guard set` | Set task creation limits (`--max-pending`, `--max-children`, `--max-depth`, `--enforce`) |
| `tx auto guard show` | Show current guard configuration |
| `tx auto verify set <id> <cmd>` | Attach a shell verification command to a task |
| `tx auto verify run <id>` | Run verification (exit 0 = pass) |
| `tx auto label add <name>` | Create a label for scoping the ready queue |
| `tx auto label assign <id> <name>` | Assign a label to a task |
| `tx ready --label <name>` | Filter ready queue by label |
| `tx auto reflect` | Session retrospective (throughput, signals, stuck tasks) |

Deprecated aliases still exist and are worth recognizing when reading older docs or agent instructions:
- `tx gate ...` forwards to `tx auto gate ...`
- `tx guard ...` forwards to `tx auto guard ...`
- `tx verify ...` forwards to `tx auto verify ...`
- `tx label ...` forwards to `tx auto label ...`
- `tx reflect` forwards to `tx auto reflect`

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
| `tx msg send <channel> <msg>` | Send a message to an agent channel |
| `tx msg inbox <channel>` | Read messages (read-only, cursor-based) |
| `tx msg ack <id>` | Acknowledge a message |

Older aliases still appear in some prompts and scripts:
- `tx inbox <channel>` forwards to `tx msg inbox <channel>`
- `tx send <channel> <msg>` forwards to `tx msg send <channel> <msg>`

### Worker Coordination

| Command | Purpose |
|---------|---------|
| `tx claim <id> <worker>` | Claim a task with a lease |
| `tx claim release <id> <w>` | Release a claim |
| `tx claim renew <id> <w>` | Renew a lease |

For dependency aliases in older instructions:
- `tx block <id> <blocker>` forwards to `tx dep block <id> <blocker>`

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
| `tx spec list` | Advanced derived-invariant inspection and repair |

### Sync & Data

| Command | Purpose |
|---------|---------|
| `tx sync export` | SQLite to git-friendly JSONL |
| `tx sync import` | JSONL to SQLite |
| `tx sync compact` | Compact done tasks + export learnings |

### Skills

| Command | Purpose |
|---------|---------|
| `tx skills generate` | Generate installable Claude/Codex tx skill bundles from CLI help |
| `tx skills sync` | Sync the canonical tx-managed skill bundles into a project |

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
claude "Read CLAUDE.md. For task $task: run tx show $task, make sure a paired PRD/design doc is linked, then decompose the work into tx subtasks and dependency edges."
echo "Review tx show $task, tx dep tree $task, and the linked PRD/DD docs, then press Enter to continue..."
read
claude "Read CLAUDE.md. For task $task: execute the approved ready work from the linked PRD/DD docs and keep tx updated."
```

Do not bypass hooks in this workflow. Keep git verification enabled for commits and pushes.

If related tasks share rollout/migration notes, set them once via `tx group-context set <id> "<context>"` so descendants/ancestors inherit the same context.

Use `tx decompose <design-doc-ref>` to turn an approved design doc into a first-pass task graph before implementation.

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
- Use deterministic IDs in the form `REQ-<AREA>-NNN` (example: `REQ-API-001`).
- Use markdown-native `kind` values only for new PRDs: `ubiquitous`, `event-driven`, `state-driven`, `optional`, `unwanted`, `complex`.
- Required clause fields are `when` for `event-driven`, `while` for `state-driven`, `if` for `unwanted`, and `where` for `optional`. `complex` requires at least one clause field.
- Keep `statement` to the action clause only, such as `the API shall persist the draft`. Do not repeat trigger/state text inside `statement`.
- The legacy decomposed EARS format with `pattern:` and underscored values such as `event_driven` is backward compatibility only.
- Run `tx doc lint-ears <doc-name-or-markdown-path>` before implementation and before review.
- Keep legacy `requirements` only for backward compatibility or migration.

## Documentation Structure (4-Tier Convention)

| Tier | Directory | Prefix | Focus |
|------|-----------|--------|-------|
| Requirements | `specs/requirements/` | `REQ-NNN` | Use-cases and behavior |
| PRD | `specs/prd/` | `PRD-NNN` | Scope and acceptance criteria |
| Design Doc | `specs/design/` | `DD-NNN` | Implementation design |
| System Design | `specs/system-design/` | `SD-NNN` | Shared architecture constraints |

- `tx doc` scaffolds all 5 doc kinds: `overview`, `requirement`, `prd`, `design`, and `system_design`.
- Docs have immutable `doc_id` values. Treat human `name` slugs as globally unique for agent workflows and use distinct names such as `<feature>-prd` and `<feature>-design`. Resolve legacy duplicates with `kind/name` or `doc_id`.
- Create docs for non-trivial features and plans; formalize behavior, scope, design, and SD when cross-cutting.
- Skip docs for trivial changes (typos, obvious bug fixes, single-line edits, and focused test-only updates).
- Link docs as a chain: `REQ -> PRD -> DD`, and include `SD` when constraints span multiple features.
- When migrating existing markdown into tx-managed docs, preserve the source wording first, then normalize structure. Use fence-aware extraction; headings inside fenced code blocks are content, not section boundaries.

## Design Doc Interface Semantics

- In design docs, `interfaces:` captures runtime contracts and boundaries, not entities.
- Use `http` for routes, `queue` for async workflow or worker boundaries, `event` for event contracts, `rpc` for Effect services/ports/adapters and internal request-response boundaries, and `cron` for scheduled jobs.
- Entities, value objects, and aggregate state belong in data-model or domain sections, not the `interfaces:` block.

## Testing + OTEL Quality Bar

- Treat integration tests as the default for behavior changes; unit tests alone are not enough.
- Cover critical flows with happy path plus failure path assertions (timeouts, malformed input, partial failure, retries/idempotency where relevant).
- Integration tests must use `getSharedTestLayer()` and `fixtureId(name)`. Never create a DB per test.
- If telemetry-related code changes, test all three modes: no OTEL config (noop), OTEL configured, and exporter failure.
- Telemetry failures must be caught/logged and never block core operations.

## Design Doc Testing Strategy Quality Bar

For `specs/design/DD-*.md`, the `## Testing Strategy` section must be concrete and testable.

- Include requirement-to-test traceability (every requirement maps to one or more tests).
- When PRDs use EARS, map each `REQ-*` ID to one or more tests in the traceability matrix.
- Include at least 8 numbered integration scenarios with setup, action, and assertions.
- Include failure-path testing (timeouts, malformed input, partial failures, retries/idempotency where relevant).
- Cover auth/permission, validation, dependency failure, and data-integrity cases wherever they are in scope.
- Cover concurrency, duplicate delivery, or retry behavior whenever the design includes queues, workflows, or idempotent APIs.
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
5) If the PRD uses EARS, include `REQ-*` requirement IDs in traceability rows.
6) If telemetry is in scope, include noop/configured/exporter-failure assertions.
7) Use specific files, inputs, and expected outcomes; no vague statements.
```
