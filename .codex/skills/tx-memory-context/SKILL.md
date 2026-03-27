---
name: "tx-memory-context"
description: "Store, recall, search, and relate memory documents, learnings, and task context. Use when working in Codex and the user needs tx commands from this area."
metadata:
  short-description: "Store, recall, search, and relate memory documents, learnings, and task context."
---

# tx Memory And Context

Use when the user needs retrieval, prompt context, or durable learnings tied to files and tasks.

## Quick Start

- `tx memory context <task-id>`
- `tx memory search <query>`
- `tx memory recall <path>`

## Included Commands

- `tx memory`: Filesystem-backed memory with search over .md files
- `tx memory add`: Create a new memory document
- `tx memory backlinks`: Show incoming links to a document
- `tx memory context`: Get task-relevant memory for prompt injection
- `tx memory index`: Index all registered source directories
- `tx memory learn`: Attach a learning to a file path or glob pattern
- `tx memory link`: Create an explicit edge between documents
- `tx memory links`: Show outgoing links from a document
- `tx memory list`: List indexed memory documents
- `tx memory props`: Show properties for a document
- `tx memory recall`: Query file learnings by path
- `tx memory relate`: Add a related reference to a document
- `tx memory search`: Search memory documents
- `tx memory set`: Set a key-value property on a document
- `tx memory show`: Display a memory document
- `tx memory source`: Manage indexed directories
- `tx memory tag`: Add tags to a memory document
- `tx memory unset`: Remove a property from a document
- `tx memory untag`: Remove tags from a memory document

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Codex, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
