---
kind: spec
spec_type: design
name: DD-038-spec-driven-decompose-command
title: "DD-038: Spec-Driven Decompose Command Design"
status: draft
version: 1
owners:
  - core
summary: Implement spec-driven decomposition as a shared core service backed by `AgentService`, then expose it through CLI, API, MCP, and the agent SDK while bundling a dedicated Claude/Codex skill.
domain: orchestration
tags:
  - cli
  - api
  - mcp
  - sdk
  - docs
  - tasks
  - skills
  - runtimes
depends_on:
  - PRD-038-spec-driven-decompose-command
  - DD-005-mcp-agent-sdk-integration
  - DD-023-docs-as-primitives
supersedes: []
implements: PRD-038-spec-driven-decompose-command
last_reviewed_at: 2026-03-27
---

# Summary

Spec-driven decomposition should not live inside the CLI command. It should be
implemented once as a shared `DecomposeService` that resolves a design spec,
asks a runtime for an explicit decomposition plan, validates the returned
graph, and persists that graph into tx using the existing task, dependency, and
doc-link primitives.

That shared service should then be exposed through:

- `tx decompose` in the CLI
- `POST /api/decompose` in the REST API
- `tx_decompose` in the MCP server
- `tx.decompose.run(...)` in the agent SDK

Claude runtime is provided by the existing `AgentService` Claude Agent SDK
path. Codex runtime is provided by the existing `AgentService` Codex execution
path. No new runtime package is introduced in this slice.

Implements: [PRD-038](../prd/PRD-038-spec-driven-decompose-command.md)

# Architecture

## 1. Shared Type Contract

Add a shared schema module:

- `packages/types/src/decompose.ts`

Core schemas:

```ts
type DecomposeRequest = {
  docRef: string
  parentTaskId?: TaskId | null
  runtime?: AgentRuntime
  model?: string | null
  maxTasks?: number
  rootTitle?: string | null
  rootScore?: number | null
  dryRun?: boolean
}

type DecompositionPlan = {
  rootTask: {
    title: string
    description: string
    score: number
  }
  tasks: Array<{
    localId: string
    title: string
    description: string
    score: number
    parentLocalId: string | null
    dependsOn: string[]
  }>
  rationale?: string
}

type DecomposeResult = {
  dryRun: boolean
  runtime: AgentRuntime
  model: string | null
  doc: {
    docId: DocStableId
    name: string
    title: string
    kind: "design"
    filePath: string
  }
  parentTaskId: TaskId | null
  rootTaskPreview: {
    title: string
    description: string
    score: number
    existingParentTaskId: TaskId | null
  }
  rootTask: TaskWithDeps | null
  plan: DecompositionPlan
  createdTasks: Array<{
    localId: string
    taskId: TaskId
    title: string
    parentTaskId: TaskId
    dependsOn: string[]
    score: number
  }>
  rationale: string | null
}
```

Add a serialized schema alongside the existing response exports so CLI JSON,
API, MCP, and SDK share one result contract.

## 2. Core Service

Add `packages/core/src/services/decompose-service.ts`:

- `DecomposeService extends Context.Tag(...)`
- `DecomposeServiceLive = Layer.effect(...)`

Dependencies:

- `DocService`
- `TaskService`
- `DependencyService`
- `AgentService`

Public method:

```ts
run(input: DecomposeRequest): Effect.Effect<
  DecomposeResult,
  AgentError | ValidationError | TaskNotFoundError | DocNotFoundError | DatabaseError | CircularDependencyError
>
```

The service owns:

- doc resolution
- markdown loading
- runtime prompt construction
- schema decode of structured runtime output
- graph validation
- dry-run behavior
- root task reuse or creation
- task creation
- dependency creation
- task-doc attachment semantics

No interface layer should duplicate these rules.

## 3. Runtime Invocation

`DecomposeService` depends on `AgentService`.

Prompt inputs:

- design doc metadata
- full markdown body of the design doc
- optional existing parent task payload from `TaskService.getWithDeps`
- decomposition rules derived from the current `tx-decomposer` profile:
  - atomic tasks
  - include verification/test tasks for behavior changes
  - avoid duplicate local IDs and cycles
  - use parent-child hierarchy plus explicit dependency edges

Implementation uses Effect Schema for validation and passes a JSON schema to
`AgentService.run({ options: { outputFormat: { type: "json_schema" }}})`.

## 4. Graph Materialization

Validation before writes:

- doc exists and `doc.kind === "design"`
- `tasks.length` is between 1 and `maxTasks`
- `localId` values are unique
- every `parentLocalId` and `dependsOn` reference points to a known local task
- no task depends on itself
- dependency graph over local IDs is acyclic
- parent hierarchy over local IDs is acyclic

Write behavior:

1. Resolve or create the root task.
2. Attach design doc to root as `implements` when not already linked.
3. Create generated tasks in parent-before-child order.
4. Attach design doc to each generated task as `references`.
5. Add dependency edges for every `dependsOn` relation.
6. Add edges from the root task to every generated top-level task so the root is
   explicitly blocked by the graph it owns.

Metadata for created tasks should include origin hints such as:

```ts
{
  source: "tx-decompose",
  designDoc: "<doc-name>",
  localId: "<plan-local-id>"
}
```

## 5. CLI Surface

Keep a thin CLI wrapper:

```text
tx decompose <design-doc-ref> [options]
```

Options:

- `--parent <task-id>`: reuse an existing task as the graph root
- `--runtime <auto|claude|codex>`: runtime selection
- `--model <name>`: optional runtime model hint
- `--max-tasks <n>`: upper bound for generated tasks
- `--root-title <text>`: override generated root title when creating a root
- `--score <n>`: default root score when creating a root
- `--dry-run`: validate and print graph only
- `--json`: emit machine-readable output

The command should only:

- parse flags
- call `DecomposeService.run`
- render human or JSON output

Files:

- `apps/cli/src/commands/decompose.ts`
- `apps/cli/src/cli.ts`
- `apps/cli/src/help.ts`

## 6. REST API

Add a top-level group and handler:

- `apps/api-server/src/api.ts`
- `apps/api-server/src/routes/decompose.ts`

Interface:

```yaml
method: POST
path: /api/decompose
body: DecomposeRequest
response: DecomposeResultSerialized
```

The route delegates directly to `DecomposeService`.

## 7. MCP Tool

Add a new tool module:

- `apps/mcp-server/src/tools/decompose.ts`

Tool:

```text
tx_decompose
```

Arguments mirror `DecomposeRequest`, with `docRef` required. The tool should
return a short summary plus the shared JSON result payload.

## 8. Agent SDK

Add a new namespace:

- `apps/agent-sdk/src/client.ts`
- `apps/agent-sdk/src/types.ts`

Public API:

```ts
await tx.decompose.run({
  docRef: "auth-flow-design",
  runtime: "codex",
  dryRun: true,
})
```

Both transports should delegate to the shared surface:

- HTTP transport calls `POST /api/decompose`
- Direct transport calls `DecomposeService.run`

## 9. Skill Bundling

Add a new shared bundled skill:

- `apps/cli/src/templates/shared-skills/decompose-spec/SKILL.md`

Responsibilities:

- require a design spec as the source of truth
- tell Claude/Codex to prefer `tx decompose <design-doc-ref>` for explicit graph
  creation
- explain `--parent`, `--runtime`, and `--dry-run`
- explain that tx remains canonical and post-generation graph edits should use
  `tx add`, `tx dep block`, `tx dep unblock`, `tx doc attach`, and `tx update`

Update skill generation and scaffold coverage so both targets receive this skill.
Also add local Codex and Claude skill copies so the workflow is available in the
repo immediately, not only after scaffolding.

## 10. Documentation

Document the feature in:

- `apps/docs/content/docs/primitives/decompose.mdx`
- relevant SDK/API/MCP/CLI docs pages and READMEs

The docs should present one conceptual flow and then show the per-interface
entry points.

## 11. Layer Wiring

`DecomposeServiceLive` requires `AgentServiceLive`, so the full application
layer used by API, MCP, and SDK direct mode must provide both. Update
`makeAppLayer` and `makeAppLayerFromInfra` so they expose:

- base app services
- `AgentServiceLive`
- `DecomposeServiceLive`

# Interfaces

```yaml
interfaces:
  - name: tx_decompose_cli
    type: cli
    command: tx decompose <design-doc-ref> [--parent <task-id>] [--runtime <runtime>] [--dry-run] [--json]
    semantics: resolves a design doc, generates a validated decomposition plan, and optionally persists it as a tx task graph
  - name: tx_decompose_api
    type: http
    method: POST
    path: /api/decompose
    semantics: exposes the shared spec-to-graph decomposition capability over REST
  - name: tx_decompose_mcp
    type: rpc
    command: tx_decompose
    semantics: exposes the shared spec-to-graph decomposition capability as an MCP tool
  - name: tx_decompose_sdk
    type: rpc
    semantics: exposes the shared spec-to-graph decomposition capability through the agent SDK
  - name: decompose_runtime_output
    type: event
    semantics: runtime returns structured JSON describing a root task plus child tasks and dependency edges
  - name: decompose_spec_skill
    type: scaffold
    command: tx init --claude | tx init --codex
    semantics: installs a dedicated skill that teaches explicit spec-to-task-graph decomposition with tx decompose
```

# Data Model

No SQLite migration is required.

The feature writes existing primitives only:

- `tasks`
- `dependencies`
- `task_doc_links`

New internal schemas used for validation and response serialization:

```ts
const DecompositionTaskSchema = Schema.Struct({
  localId: Schema.String,
  title: Schema.String,
  description: Schema.String,
  score: Schema.Number.pipe(Schema.int()),
  parentLocalId: Schema.NullOr(Schema.String),
  dependsOn: Schema.Array(Schema.String),
})

const DecomposeRequestSchema = Schema.Struct({
  docRef: Schema.String,
  parentTaskId: Schema.optional(Schema.NullOr(TaskIdSchema)),
  runtime: Schema.optional(AgentRuntimeSchema),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  maxTasks: Schema.optional(Schema.Number.pipe(Schema.int())),
  rootTitle: Schema.optional(Schema.NullOr(Schema.String)),
  rootScore: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
  dryRun: Schema.optional(Schema.Boolean),
})

const DecompositionPlanSchema = Schema.Struct({
  rootTask: Schema.Struct({
    title: Schema.String,
    description: Schema.String,
    score: Schema.Number.pipe(Schema.int()),
  }),
  tasks: Schema.Array(DecompositionTaskSchema),
  rationale: Schema.optional(Schema.String),
})

const DecomposeResultSerializedSchema = Schema.Struct({
  dryRun: Schema.Boolean,
  runtime: AgentRuntimeSchema,
  model: Schema.NullOr(Schema.String),
  doc: Schema.Struct({
    docId: DocStableIdSchema,
    name: Schema.String,
    title: Schema.String,
    kind: Schema.Literal("design"),
    filePath: Schema.String,
  }),
  parentTaskId: Schema.NullOr(TaskIdSchema),
  rootTaskPreview: Schema.Struct({
    title: Schema.String,
    description: Schema.String,
    score: Schema.Number.pipe(Schema.int()),
    existingParentTaskId: Schema.NullOr(TaskIdSchema),
  }),
  rootTask: Schema.NullOr(TaskWithDepsSerializedSchema),
  plan: DecompositionPlanSchema,
  createdTasks: Schema.Array(Schema.Struct({
    localId: Schema.String,
    taskId: TaskIdSchema,
    title: Schema.String,
    parentTaskId: TaskIdSchema,
    dependsOn: Schema.Array(Schema.String),
    score: Schema.Number.pipe(Schema.int()),
  })),
  rationale: Schema.NullOr(Schema.String),
})
```

# Invariants

```yaml
invariants:
  - id: INV-DECOMPOSE-001
    statement: spec-driven decomposition only accepts docs whose persisted kind is design
    severity: high
    verified_by:
      - test/unit/decompose-service.test.ts
  - id: INV-DECOMPOSE-002
    statement: a valid decomposition plan materializes into tx tasks and dependency edges without unknown or circular local references
    severity: high
    verified_by:
      - test/unit/decompose-service.test.ts
  - id: INV-DECOMPOSE-003
    statement: the root task is blocked by each generated top-level task so the resulting graph is explicit in tx
    severity: high
    verified_by:
      - test/unit/decompose-service.test.ts
  - id: INV-DECOMPOSE-004
    statement: CLI, API, MCP, and SDK surfaces all delegate to the same shared decomposition contract
    severity: high
    verified_by:
      - test/unit/decompose-command.test.ts
      - test/unit/decompose-api.test.ts
      - test/unit/decompose-sdk.test.ts
      - test/unit/decompose-mcp.test.ts
  - id: INV-DECOMPOSE-005
    statement: Claude and Codex scaffold outputs both include the dedicated decompose-spec skill
    severity: medium
    verified_by:
      - test/integration/scaffold.test.ts
      - test/integration/init-onboarding.test.ts
```

# Failure Modes

```yaml
failure_modes:
  - condition: a non-design doc is passed to a decompose surface
    impact: graph generation proceeds from the wrong source material
    handling: fail fast with a validation error naming the actual doc kind
  - condition: the runtime returns invalid local references or cycles
    impact: partial or inconsistent graph writes could occur
    handling: validate the full plan before any writes and reject invalid plans
  - condition: the runtime returns too many tasks for the requested limit
    impact: decomposition becomes noisy and unusable
    handling: enforce maxTasks before writes and surface an actionable error
  - condition: scaffolds include the command in help but omit the dedicated skill
    impact: explicit decomposition exists but is not discoverable in agent workflows
    handling: add bundled skill coverage to scaffold and init integration tests
  - condition: one interface drifts from the shared request or response contract
    impact: agents receive different semantics depending on entry point
    handling: define shared schemas in @jamesaphoenix/tx-types and cover thin adapters with surface tests
```

# Verification

```yaml
verification:
  - requirement_id: EARS-DECOMPOSE-001
    test_type: unit
    target: test/unit/decompose-service.test.ts
  - requirement_id: EARS-DECOMPOSE-002
    test_type: unit
    target: test/unit/decompose-service.test.ts
  - requirement_id: EARS-DECOMPOSE-003
    test_type: unit
    target: test/unit/decompose-service.test.ts
  - requirement_id: EARS-DECOMPOSE-004
    test_type: unit
    target: test/unit/decompose-service.test.ts
  - requirement_id: EARS-DECOMPOSE-005
    test_type: unit
    target: test/unit/decompose-service.test.ts
  - requirement_id: EARS-DECOMPOSE-006
    test_type: unit
    target: test/unit/decompose-command.test.ts
  - requirement_id: EARS-DECOMPOSE-007
    test_type: integration
    target: test/integration/scaffold.test.ts
  - requirement_id: EARS-DECOMPOSE-008
    test_type: unit
    target: test/unit/decompose-api.test.ts
  - requirement_id: EARS-DECOMPOSE-008
    test_type: unit
    target: test/unit/decompose-mcp.test.ts
  - requirement_id: EARS-DECOMPOSE-008
    test_type: unit
    target: test/unit/decompose-sdk.test.ts
  - requirement_id: EARS-DECOMPOSE-009
    test_type: manual
    target: apps/docs/content/docs/primitives/decompose.mdx
  - requirement_id: EARS-DECOMPOSE-010
    test_type: unit
    target: test/unit/decompose-service.test.ts
```

# Testing Strategy

Add service-first tests:

- `test/unit/decompose-service.test.ts`
  - valid plan materialization
  - dry-run behavior
  - non-design rejection
  - invalid plan rejection without writes
- `test/unit/decompose-command.test.ts`
  - CLI flag parsing and output rendering over `DecomposeService`
- `test/unit/decompose-api.test.ts`
  - API request/response adapter delegates to `DecomposeService`
- `test/unit/decompose-mcp.test.ts`
  - MCP tool adapter delegates to `DecomposeService`
- `test/unit/decompose-sdk.test.ts`
  - SDK HTTP/direct adapters hit the shared route/service correctly
- `test/integration/scaffold.test.ts`
- `test/integration/init-onboarding.test.ts`

Keep heavy end-to-end runtime tests narrow. The core guarantee is that all
surface adapters are thin and all graph semantics live under
`DecomposeService`.

# Open Questions

- [ ] Should future slices support PRD-driven decomposition as a sibling mode?
- [ ] Should existing roots be updated with `plan.rootTask` title/description
      metadata when `--parent` is used?
- [ ] Should the service support graph repair or diff output for re-running
      against a changed design doc?

# Migration

- No existing data migration is required.
- Existing task graphs remain valid.
- Existing scaffolds gain one extra bundled skill on future init/scaffold runs.
- API, MCP, and SDK consumers gain a new optional surface; no existing surface
  changes behavior.

# References (optional)

- Plan file: `/Users/jamesaphoenix/.codex/plans/2026-03-27-tx-decompose-command.md`
- AGENTS.md section: `Development Process: PRD/DD First`
