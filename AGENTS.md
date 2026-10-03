# tx

Tasks, docs, plans and spec verification. Keep the implementation small and avoid agent harnesses.
CLAUDE.md links here; edit AGENTS.md.

## Map

- apps/cli/src: CLI, REST and MCP interfaces
- apps/agent-sdk/src: TypeScript client, direct and HTTP transports
- apps/dashboard: task/doc/spec-health UI and planning cycles
- apps/docs: published documentation
- packages/core/src: Effect services, repositories, schemas and shared types
- migrations: immutable upgrade history, including dormant retired tables
- specs: versioned PRD, design and plan documents

## Boundaries

Return complete dependency information in every task response. Keep business logic in
Effect services, use runtime schemas at trust boundaries, and avoid creating interface-specific
rules. CLI task commands live under tx task. Retired capabilities have no public runtime.
Historical stream schemas are compatibility data, not restored features.

Keep shared task state in the main checkout; choose an explicit content root for worktree docs.
Use ordinary coding-agent planning, copy plans into docs and link spec -> plan -> tasks.
The four shipped guides are tx-tasks, tx-docs, tx-plan and verify-invariants.
Do not ship workers, agents, watchdogs, Ralph loops or automatic review/decomposition.

## Validation

Use a failing regression before changing behaviour. Test retained behaviour across interfaces,
including upgrades and malformed data. Prefer shared test databases and fixtureId.
Run bun run check:ci before handoff. Never bypass commit hooks. Use conventional commits.
Do not delete distinct tests to make retained functionality pass. Retire tests with removed features.
Never use em dashes in project content. Keep secrets out of code, docs and plan copies.
