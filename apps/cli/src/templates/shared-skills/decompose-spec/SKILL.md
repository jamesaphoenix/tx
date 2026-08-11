---
name: decompose-spec
description: Turn a design spec into an explicit tx task graph with `tx decompose`, then refine the graph using normal tx task and dependency primitives.
argument-hint: "<design-doc-ref> [--parent <task-id>] [--runtime <auto|claude|codex>] [--dry-run]"
---

# Decompose Spec

Use this skill when the user already has a design spec and wants an explicit tx
task graph created from that spec.

## Default Path

1. Confirm the source doc is a design spec.

```bash
tx doc show <design-doc-ref>
```

2. Preview the decomposition before writing if the graph shape is still being discussed.

```bash
tx decompose <design-doc-ref> --dry-run --json
```

3. Materialize the graph once the plan looks right.

```bash
tx decompose <design-doc-ref>
tx decompose <design-doc-ref> --runtime claude
tx decompose <design-doc-ref> --runtime codex
tx decompose <design-doc-ref> --parent <task-id>
```

## Rules

- Prefer `tx decompose` over manually creating a large first-pass task graph.
- Use `--parent <task-id>` when the spec should decompose under an existing task.
- Use `--dry-run` when you need to inspect or compare graph options before writes.
- **Do NOT use `--max-tasks` unless the user explicitly requests a cap.** Artificial
  limits produce weak decompositions that miss important slices. Let the LLM
  produce as many tasks as the design doc warrants.
- **Be patient.** `tx decompose` makes LLM calls and can take 60–120 seconds.
  If you launched it, wait for it to finish. Never re-run it because output
  appears empty - that wastes API credits and risks duplicate subtasks. If it
  was launched in the background, poll the output file at long intervals (30s+).
- After materialization, tx remains canonical. Refine the graph with:

```bash
tx add "Follow-up task"
tx add "Nested subtask" --parent <task-id>
tx dep block <task-id> <blocker-id>
tx dep unblock <task-id> <blocker-id>
tx doc attach <task-id> <doc-name>
tx update <task-id> --status blocked
```

- If the design doc changes materially, re-run `tx decompose --dry-run` first
  and repair the existing graph explicitly instead of creating duplicate work.

## Practical Guidance

- Start from a stable design doc, not a vague request or partial note.
- Use `tx show <task-id>` on the generated root task to inspect linked-doc and
  blocker state after decomposition.
- If the result has too many tasks, refine by merging or removing tasks after
  the fact - do not pre-cap with `--max-tasks`.

## Equivalent Surfaces

- REST API: `POST /api/decompose`
- MCP: `tx_decompose`
- Agent SDK:

```ts
await tx.decompose.run({
  docRef: "<design-doc-ref>",
  runtime: "auto",
  dryRun: true,
})
```
