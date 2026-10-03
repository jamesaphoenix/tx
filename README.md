# tx

Tasks and spec-driven development, with a local SQLite database and a dashboard.
Write requirements and invariants, save your coding agent's plan, then create linked
tasks. Map invariants to the code that enforces them and to meaningful tests.

## Start

The npm CLI and direct SDK require [Bun](https://bun.sh). Standalone binaries
include their own runtime. The dashboard runs from the source checkout.

```bash
npm install -g @jamesaphoenix/tx-cli
tx init
tx task add "Ship the next improvement" --description "Acceptance: describe the observable result."
tx task ready
tx task done <task-id>
```

Standalone binaries: use [the installer](https://github.com/jamesaphoenix/tx/blob/main/install.sh)
or download an asset from [Releases](https://github.com/jamesaphoenix/tx/releases).

## Spec -> plan -> tasks

```bash
tx doc add prd checkout-prd --title "Checkout requirements"
tx doc add design checkout-design --title "Checkout design"
tx doc link checkout-prd checkout-design
tx doc add plan checkout-plan --title "Checkout implementation plan"
tx doc link checkout-design checkout-plan
tx doc attach <task-id> checkout-plan
```

Edit the generated files in `specs/`. Plans accept your coding agent's normal format:
copy its text below the tx frontmatter and keep an adjacent `<name>.source` symlink
to the original file when it was authored elsewhere. The saved copy is authoritative;
the symlink records provenance and is not automatic synchronisation.

```bash
tx doc sync checkout-design
tx spec discover --doc checkout-design
tx spec gaps --doc checkout-design
tx spec health
```

A mapping is traceability. Executed test results are evidence. Human sign-off is a
separate step after verification. See [documentation](https://txdocs.dev/docs)
for spec schemas and commands.

## Interfaces

- CLI: `tx task`, `tx doc`, `tx spec`, `tx decision`, `tx sync` and `tx diag`.
- Dashboard: tasks, labels, planning cycles, docs and Spec Health.
- REST: `tx-api` from the CLI package.
- MCP: `tx-mcp` from the CLI package.
- TypeScript: `@jamesaphoenix/tx-agent-sdk` for HTTP or direct SQLite access.
- Core: `@jamesaphoenix/tx` for Effect services, schemas and types.

Use `tx help` and `tx schema` for the current command contract.

## Four small skills

`tx init --claude` or `tx init --codex` installs `tx-tasks`, `tx-docs`,
`tx-plan` and `verify-invariants`. These guides help author tasks, docs and plans,
and map and verify invariants. They do not ship agents or execution loops.
Use `tx skills sync` to update tx-owned guides while preserving unrelated skills.

## v0.20 migration

Task commands now require `tx task`: replace `tx add` with `tx task add`,
and `tx dep block` with `tx task dep block`. Old syntax fails with a replacement
hint before opening the database. Run `tx task --help` for the full namespace.

Memory, learnings, pins, claims, messaging, guards, task shell verification,
reflection, automated decomposition, agent execution, Ralph and watchdog are retired.
Ordinary labels and dashboard planning cycles remain. Existing tables and migration
history are retained. Import validates historical stream events, reports recognised
retired events as ignored, and rejects malformed or unknown events. Hydrate reapplies
retained projections without truncating existing tables. Back up `.tx/` before upgrading.

## Development

```bash
bun install
bun run build
bun run check:ci
bun run --cwd apps/dashboard dev:all
```

MIT licence. [Source](https://github.com/jamesaphoenix/tx).
