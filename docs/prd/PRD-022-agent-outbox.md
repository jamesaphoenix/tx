# PRD-022: Agent Outbox Messaging

**Status**: Implemented
**Priority**: P1
**Design Doc**: [DD-022](../design/DD-022-agent-outbox.md)
**Last Updated**: 2026-02-10

## Problem

tx has no mechanism for direct agent-to-agent communication. Agents coordinate only through shared database state (task status changes, claims, learnings). This means:

- No way for Agent A to send a message to Agent B
- No request/reply patterns between agents
- No broadcast notifications (e.g., "deploy complete")
- No task-scoped notes for handoff context

## Solution

Channel-based outbox messaging primitive. Agents write messages to an outbox table, recipients poll with `tx inbox`. Fits tx's local-first, pull-based, primitives-not-frameworks philosophy.

### Key Design Decisions

- **Channel-based addressing**: Free-form strings (agent IDs, topics, `task:tx-abc123`)
- **Two-state lifecycle**: `pending` -> `acked` (no intermediate `delivered` state)
- **Read-only inbox**: `tx inbox` is a pure query — no side effects on read
- **Cursor-based fan-out**: `--after <id>` enables Kafka-style multi-reader consumption
- **Pull-based only**: Consistent with `tx ready` / `tx claim` patterns

## Requirements

- [x] Send messages to named channels with sender, content, optional metadata
- [x] Read inbox by channel with cursor-based pagination (afterId)
- [x] Acknowledge individual messages (pending -> acked transition)
- [x] Acknowledge all pending messages on a channel (bulk ack)
- [x] Count pending messages on a channel
- [x] Garbage collect expired and old acked messages
- [x] Filter inbox by sender, correlation ID
- [x] Optional TTL per message (auto-expire)
- [x] Correlation IDs for request/reply patterns
- [x] Task-scoped messages (FK to tasks table)
- [x] JSON metadata on messages

## Acceptance Criteria

1. `tx send <channel> <content>` creates a message and returns it
2. `tx inbox <channel>` returns pending messages ordered by ID
3. `tx inbox <channel> --after <id>` returns only messages after the cursor
4. Multiple readers on the same channel see the same messages independently
5. `tx ack <id>` transitions a message from pending to acked
6. Acked messages are excluded from default inbox reads
7. `tx outbox:gc` removes expired and old acked messages
8. All interfaces work: CLI, MCP tools, REST API

## Out of Scope

- Real-time push/websocket notifications
- Cross-channel ordering guarantees
- Per-reader ack tracking (use cursor instead)
- Delivery confirmation (use correlation IDs for request/reply)
- JSONL sync for messages (ephemeral coordination data)
