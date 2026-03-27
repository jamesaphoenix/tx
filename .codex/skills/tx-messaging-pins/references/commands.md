# tx Messaging And Pins Command Reference

This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.

## tx ack

```text
tx ack - Acknowledge a message

Usage: tx ack <message-id> [--json]

Transitions a message from pending to acked.

Examples:
  tx ack 42
  tx ack 42 --json
```

## tx ack all

```text
tx ack all - Acknowledge all pending messages on a channel

Usage: tx ack all <channel> [--json]

Examples:
  tx ack all worker-3
  tx ack all errors --json
```

## tx inbox

```text
tx inbox - Read messages from a channel

Usage: tx inbox <channel> [options]

Read-only: does NOT modify message status. Use tx ack to acknowledge.
Use --after for cursor-based reading (each reader tracks their own position).

Options:
  --after <id>       Only messages with ID > this value (cursor)
  --limit <n>        Max messages to return (default: 50)
  --sender <s>       Filter by sender
  --correlation <id> Filter by correlation ID
  --include-acked    Include already-acknowledged messages
  --json             Output as JSON

Examples:
  tx inbox worker-3                    # Read pending messages
  tx inbox broadcast --after 42        # Cursor-based fan-out
  tx inbox orchestrator --json         # JSON output
  tx inbox errors --include-acked      # Include acked messages
```

## tx msg

```text
tx msg - Agent messaging

Usage: tx msg <subcommand> [arguments] [options]

Subcommands:
  send <channel> <content>   Send a message to a channel
  inbox <channel>            Read messages from a channel
  ack <id>                   Acknowledge a message
  ack all <channel>          Acknowledge all messages on a channel
  pending <channel>          Count pending messages
  gc                         Garbage collect old messages

Run 'tx msg <subcommand> --help' for subcommand-specific help.

Examples:
  tx msg send my-channel "Hello agents"
  tx msg inbox my-channel
  tx msg ack 42
  tx msg pending my-channel
```

## tx msg ack

```text
tx msg ack - Acknowledge a message

Usage: tx msg ack <message-id> [options]
       tx msg ack all <channel> [options]

Acknowledges a single message by ID, or all pending messages on a channel.

Options:
  --json  Output as JSON

Examples:
  tx msg ack 42
  tx msg ack all my-channel
```

## tx msg gc

```text
tx msg gc - Garbage collect old messages

Usage: tx msg gc [options]

Options:
  --acked-older-than <hours>  Remove acked messages older than N hours
  --json                      Output as JSON

Examples:
  tx msg gc
  tx msg gc --acked-older-than 24
```

## tx msg inbox

```text
tx msg inbox - Read messages from a channel

Usage: tx msg inbox <channel> [options]

Pure read — no side effects, no status changes.

Options:
  --after <id>        Cursor: only messages after this ID
  --limit, -n <n>     Maximum messages to show
  --sender <s>        Filter by sender
  --correlation <id>  Filter by correlation ID
  --include-acked     Include acknowledged messages
  --json              Output as JSON

Examples:
  tx msg inbox my-channel
  tx msg inbox my-channel --after 100 --limit 10
```

## tx msg pending

```text
tx msg pending - Count pending messages

Usage: tx msg pending <channel> [options]

Options:
  --json  Output as JSON

Examples:
  tx msg pending my-channel
```

## tx msg send

```text
tx msg send - Send a message to a channel

Usage: tx msg send <channel> <content> [options]

Options:
  --sender <s>        Sender name (default: cli)
  --task <id>         Associated task ID
  --ttl <sec>         Time-to-live in seconds
  --correlation <id>  Correlation ID for request/reply
  --metadata '{}'     JSON metadata
  --json              Output as JSON

Examples:
  tx msg send my-channel "Hello"
  tx msg send agent-1 "Status update" --sender orchestrator
```

## tx outbox gc

```text
tx outbox gc - Garbage collect old messages

Usage: tx outbox gc [--acked-older-than <hours>] [--json]

Deletes expired messages (past TTL) and optionally old acked messages.

Options:
  --acked-older-than <hours>  Delete acked messages older than N hours

Examples:
  tx outbox gc                         # Delete expired only
  tx outbox gc --acked-older-than 24   # Also clean acked > 24h old
```

## tx outbox pending

```text
tx outbox pending - Count pending messages

Usage: tx outbox pending <channel> [--json]

Examples:
  tx outbox pending errors
  tx outbox pending worker-3 --json
```

## tx pin

```text
tx pin - Context pins for agent memory injection

Usage: tx pin <subcommand> [options]

Manage named content blocks ("pins") that are synchronized to agent context
files (CLAUDE.md, AGENTS.md) as <tx-pin id="..."> XML-tagged sections.

Subcommands:
  set <id> [content]    Create or update a pin
  get <id>              Show pin content
  rm <id>               Remove a pin from DB and target files
  list                  List all pins
  sync                  Re-sync all pins to target files
  targets [files...]    Show or set target files

Options:
  --json                Output as JSON
  --file, -f <path>     Read content from file (for set)

Examples:
  tx pin set auth-patterns "Always use JWT with refresh tokens"
  tx pin set coding-standards --file ./standards.md
  echo "Use Effect-TS" | tx pin set effect-rules
  tx pin get auth-patterns
  tx pin list
  tx pin targets CLAUDE.md AGENTS.md
  tx pin sync
  tx pin rm auth-patterns
```

## tx pin get

```text
tx pin get - Show a pin's content

Usage: tx pin get <id> [--json]

Examples:
  tx pin get auth-patterns
  tx pin get auth-patterns --json
```

## tx pin list

```text
tx pin list - List all context pins

Usage: tx pin list [--json]

Examples:
  tx pin list
  tx pin list --json
```

## tx pin remove

```text
tx pin remove - Remove a context pin

Usage: tx pin remove <id>

Removes the pin from the database and all target files.
Alias: tx pin rm

Examples:
  tx pin remove auth-patterns
```

## tx pin rm

```text
tx pin rm - Remove a context pin

Usage: tx pin rm <id>

Removes the pin from the database and all target files.
Alias: tx pin remove

Examples:
  tx pin rm auth-patterns
```

## tx pin set

```text
tx pin set - Create or update a context pin

Usage: tx pin set <id> [content] [--file <path>]

Creates or updates a named content block. The pin is stored in the database
and synchronized to all configured target files as a <tx-pin> XML block.

Arguments:
  <id>        Pin ID (kebab-case: lowercase, numbers, dots, hyphens, underscores)
  [content]   Pin content (optional if using --file or stdin)

Options:
  --file, -f <path>   Read content from a file
  --json              Output as JSON

Content is read from: positional argument > --file > stdin (piped input).

Examples:
  tx pin set auth-patterns "Always use JWT"
  tx pin set coding-standards --file ./standards.md
  echo "Use Effect-TS for all services" | tx pin set effect-rules
```

## tx pin sync

```text
tx pin sync - Re-sync all pins to target files

Usage: tx pin sync [--json]

Reads all pins from the database and writes them to each configured target file.
Adds missing pins, updates changed pins, and removes stale pins from files.
This operation is idempotent.

Examples:
  tx pin sync
```

## tx pin targets

```text
tx pin targets - Show or set target files

Usage: tx pin targets [files...]

With no arguments, shows current target files.
With arguments, sets the target files list.

Examples:
  tx pin targets                       # Show current targets
  tx pin targets CLAUDE.md             # Set single target
  tx pin targets CLAUDE.md AGENTS.md   # Set multiple targets
```

## tx send

```text
tx send - Send a message to a channel

Usage: tx send <channel> <content> [options]

Options:
  --sender <s>       Sender name (default: "cli")
  --task <id>        Associate with a task ID
  --ttl <seconds>    Time-to-live in seconds
  --correlation <id> Correlation ID for request/reply
  --metadata '{}'    JSON metadata object
  --json             Output as JSON

Examples:
  tx send worker-3 "Review PR #42" --sender orchestrator
  tx send broadcast "v2.3.0 deployed" --sender ci --ttl 3600
  tx send errors "OOM at step 4" --sender worker-3 --task tx-abc123
  tx send orchestrator "Done" --correlation 550e8400-e29b
```
