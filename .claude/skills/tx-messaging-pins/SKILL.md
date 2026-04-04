---
name: "tx-messaging-pins"
description: "Send agent messages, acknowledge inbox items, and persist shared context pins. Use when working in Claude Code and the user needs tx commands from this area."
metadata:
  short-description: "Send agent messages, acknowledge inbox items, and persist shared context pins."
---

# tx Messaging And Pins

Use when coordinating agents through channels or syncing pinned context into agent files.

## Quick Start

- `tx msg inbox <channel>`
- `tx msg send <channel> "message"`
- `tx pin sync`

## Included Commands

- `tx ack`: Acknowledge a message
- `tx ack all`: Acknowledge all pending messages on a channel
- `tx inbox`: Read messages from a channel
- `tx msg`: Agent messaging
- `tx msg ack`: Acknowledge a message
- `tx msg gc`: Garbage collect old messages
- `tx msg inbox`: Read messages from a channel
- `tx msg pending`: Count pending messages
- `tx msg send`: Send a message to a channel
- `tx outbox gc`: Garbage collect old messages
- `tx outbox pending`: Count pending messages
- `tx pin`: Context pins for agent memory injection
- `tx pin get`: Show a pin's content
- `tx pin list`: List all context pins
- `tx pin remove`: Remove a context pin
- `tx pin rm`: Remove a context pin
- `tx pin set`: Create or update a context pin
- `tx pin sync`: Re-sync all pins to target files
- `tx pin targets`: Show or set target files
- `tx send`: Send a message to a channel

## Full Help

Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.

## Search And Shell Fixes

When working in Claude Code, prefer `rg -n <pattern> <path>` and `rg --files <path>` over broad `grep -r` or fragile `find` pipelines.

If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:

- rerun it as a smaller `rg` command with an explicit directory
- avoid partial paths like `node_modul` or unterminated quotes
- replace `grep -r` with `rg -n` unless `rg` is unavailable
- replace broad `find` probes with `rg --files` when you are really locating source files
