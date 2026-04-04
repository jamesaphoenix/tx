---
name: "tx-autonomy-controls"
description: "Configure gates, guards, labels, verification, and retrospectives for bounded autonomy. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Configure gates, guards, labels, verification, and retrospectives for bounded autonomy."
---

# tx Autonomy Controls

Use when the user wants phase gates, verification hooks, or scoped ready queues.

## Quick Start

- `tx auto guard show`
- `tx auto verify run <task-id>`
- `tx auto gate status`

## Included Commands

- `tx auto`: Bounded autonomy primitives
- `tx auto gate`: Human-in-the-loop phase gates
- `tx auto guard`: Task creation limits
- `tx auto label`: Ready queue scoping labels
- `tx auto reflect`: Session retrospective
- `tx auto verify`: Machine-checkable done criteria
- `tx gate`: Phase gates (approval checkpoints, pin wrapper)
- `tx gate approve`: Approve a phase gate
- `tx gate check`: Check gate approval state
- `tx gate create`: Create a phase gate
- `tx gate list`: List all gates
- `tx gate revoke`: Revoke a phase gate
- `tx gate rm`: Remove a gate
- `tx gate status`: Show gate state
- `tx guard`: Task creation guards
- `tx guard clear`: Clear guards
- `tx guard set`: Set task creation guards
- `tx guard show`: Show current guard configuration
- `tx label`: Label management
- `tx label add`: Create a label
- `tx label assign`: Assign a label to a task
- `tx label delete`: Delete a label
- `tx label list`: List all labels
- `tx label remove`: Delete a label (alias for "tx label delete")
- `tx label unassign`: Remove a label from a task
- `tx reflect`: Session retrospective
- `tx verify`: Machine-checkable verification
- `tx verify clear`: Remove verify command
- `tx verify run`: Run verification
- `tx verify set`: Attach a verify command
- `tx verify show`: Show verify command

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
