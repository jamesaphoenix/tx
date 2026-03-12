# tx

**Primitives, not frameworks.** Headless, local infrastructure for AI agents.

tx gives you a small set of reusable primitives for task state, docs-first specs, memory, coordination, and observability. You keep the orchestration loop.

## Install

```bash
# Standalone binary (recommended)
curl -fsSL https://raw.githubusercontent.com/jamesaphoenix/tx/main/install.sh | sh

# Or via npm (requires bun)
npm install -g @jamesaphoenix/tx-cli
```

## Start Small

The recommended first path is:

1. Task Management
2. Spec-Driven Development
3. Memory & Context
4. Bounded Autonomy
5. Coordination
6. Observability

Most users should start with just the first two.

### Day 1: Task Management

```bash
tx init --codex                  # or: --claude, or plain tx init
tx add "Write auth PRD" --json
tx add "Implement auth flow" --json
tx block <implement-task-id> <prd-task-id>
tx ready
tx show <prd-task-id>
tx done <prd-task-id>
tx ready
tx sync export
```

This proves the basic loop:

- the queue works
- dependencies affect readiness
- completion advances the queue
- state exports cleanly to `.tx/streams`

### Day 2: Spec-Driven Development

```bash
tx doc add prd auth-flow --title "Auth Flow"
# add or update tests with [INV-*], _INV_*, @spec, or .tx/spec-tests.yml
tx spec discover
tx spec status --doc auth-flow
vitest run --reporter=json | tx spec batch --from vitest
tx spec complete --doc auth-flow --by you
```

Use the spec primitives like this:

- `tx spec fci`: compact machine score for agents and automation
- `tx spec status`: human-readable blocker view for one scope
- `tx spec health`: repo rollup, not part of the minimum day-1 loop

## The Six Layers

### 1. Task Management

Core queue and persistence:

- `tx init`
- `tx add`
- `tx ready`
- `tx show`
- `tx done`
- `tx block`
- `tx sync`

### 2. Spec-Driven Development

Docs-first intent and closure:

- `tx doc`
- `tx spec`
- `tx decision`

### 3. Memory & Context

Durable knowledge and prompt context:

- `tx memory`
- `tx pin`

### 4. Bounded Autonomy

Controls for agents with more freedom:

- `tx label`
- `tx guard`
- `tx verify`
- `tx reflect`
- `tx gate`

### 5. Coordination

Multi-worker and multi-actor primitives:

- `tx claim`
- `tx send` / `tx inbox`
- `tx group-context`

### 6. Observability

Operational visibility once the earlier layers are in place:

- `tx trace`
- `tx spec health`
- `tx stats`
- dashboard

## Interfaces

| Interface | Best For |
|-----------|----------|
| CLI | Shell scripts, human operators, local loops |
| MCP Server | Claude Code, Cursor, IDE integrations |
| TypeScript SDK | Custom Node/Bun agents |
| REST API | Language-agnostic HTTP clients |
| Dashboard | Visual monitoring and management |

## Optional Later

Watchdog is intentionally not part of the main getting-started path.

Use it only if you need detached, long-running supervision:

```bash
tx init --watchdog --watchdog-runtime auto
./scripts/watchdog-launcher.sh start
```

Runbook:

- [Watchdog Runbook](https://txdocs.dev/docs/watchdog-runbook)

## Why tx

|  | Native Tasks | Static Agent Docs | tx |
|---|---|---|---|
| Persistence | Session-scoped | Manual file edits | SQLite + git-backed streams |
| Multi-agent safety | Easy collisions | Manual coordination | Claims, dependencies, messaging |
| Intent tracking | Weak | Weak | Docs-first specs + decision capture |
| Knowledge reuse | Lost each session | Static dump | Searchable memory + pins |
| Orchestration | Fixed by tool | None | You own the loop |

## Docs

- [Getting Started](https://txdocs.dev/docs/getting-started)
- [Primitives](https://txdocs.dev/docs/primitives)
- [Agent SDK](https://txdocs.dev/docs/agent-sdk)
- [PRDs and Design Docs](https://txdocs.dev/docs/prd)

## Principle

tx should stay small.

It is not an agent framework, not a hosted memory product, and not a prescribed workflow. It is a local set of primitives you can compose into your own loop.
