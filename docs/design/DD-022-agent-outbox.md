# DD-022: Agent Outbox Messaging

**Status**: Implemented
**Implements**: [PRD-022](../prd/PRD-022-agent-outbox.md)
**Last Updated**: 2026-02-10

## Overview

Channel-based agent-to-agent messaging using the outbox pattern from distributed systems. Messages are stored in SQLite, recipients poll via `tx inbox`. Read-only inbox with cursor-based fan-out supports both queue and broadcast semantics without per-reader state.

## Design

### Data Model

```sql
CREATE TABLE outbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acked')),
    correlation_id TEXT,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    acked_at TEXT,
    expires_at TEXT
);
```

**Indexes**: `(channel, id)` for cursor queries, `(channel, status)` for filtering, partial indexes on `correlation_id`, `task_id`, `expires_at`.

Migration: `migrations/021_agent_outbox.sql`

### Type Layer

`packages/types/src/message.ts`:
- `MessageIdSchema` — branded integer
- `MessageStatusSchema` — `"pending" | "acked"`
- `MessageSchema` — full message entity
- `SendMessageInputSchema` — input for send
- `InboxFilterSchema` — cursor + filter params
- `MessageRow` — snake_case DB row interface

### Service Layer

**MessageRepository** (`packages/core/src/repo/message-repo.ts`):
- `insert` — create message
- `findByChannel` — cursor-based query with dynamic filters
- `findById` — single lookup
- `markAcked` / `markAckedByChannel` — status transitions
- `findByCorrelationId` — request/reply support
- `deleteExpired` / `deleteAcked` — GC operations
- `countPending` — pending count per channel

**MessageService** (`packages/core/src/services/message-service.ts`):
- `send` — validates, computes TTL expiry, delegates to repo
- `inbox` — read-only query, no side effects
- `ack` — validates message exists and is pending, transitions to acked
- `ackAll` — bulk ack by channel
- `pending` — count pending
- `gc` — delete expired + old acked messages
- `findReplies` — correlation ID lookup

### CLI Commands

| Command | Description |
|---------|-------------|
| `tx send <channel> <content>` | Send a message |
| `tx inbox <channel>` | Read pending messages |
| `tx ack <id>` | Acknowledge a message |
| `tx ack:all <channel>` | Ack all pending on channel |
| `tx outbox:pending <channel>` | Count pending messages |
| `tx outbox:gc` | Garbage collect old messages |

### MCP Tools

| Tool | Description |
|------|-------------|
| `tx_send` | Send message to channel |
| `tx_inbox` | Read inbox (cursor support) |
| `tx_ack` | Acknowledge message |
| `tx_outbox_pending` | Count pending |

### REST API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/messages` | Send message |
| GET | `/api/messages/inbox/:channel` | Read inbox |
| POST | `/api/messages/:id/ack` | Ack message |
| POST | `/api/messages/inbox/:channel/ack` | Ack all on channel |
| GET | `/api/messages/inbox/:channel/count` | Pending count |
| POST | `/api/messages/gc` | Garbage collect |

## Composable Patterns

These patterns demonstrate primitive flexibility — tx ships none as built-in behavior:

```bash
# 1:1 queue: send + ack for consume-once
tx send worker-1 "Review PR #42" --sender orchestrator
MSG_ID=$(tx inbox worker-1 --json | jq -r '.[0].id')
tx ack $MSG_ID

# Request/reply: correlation IDs
CORR=$(uuidgen)
tx send worker-3 "Review PR #42" --sender orch --correlation $CORR
tx send orch "Approved" --sender worker-3 --correlation $CORR
tx inbox orch --correlation $CORR --json

# Broadcast: cursor-based, no ack
tx send broadcast "v2.3.0 deployed" --sender ci --ttl 3600
tx inbox broadcast --after $LAST_SEEN --json

# Task handoff notes
tx send "task:tx-abc123" "Root cause in auth.ts:42" --sender worker-1
tx inbox "task:tx-abc123" --json
```

## Testing Strategy

### Unit Tests

Not applicable — message types use Effect Schema which provides compile-time validation. The mapper has runtime validation for status fields.

### Integration Tests

`test/integration/message.test.ts` (16 tests):
- Send + inbox round-trip
- Cursor-based reading with afterId
- Ack lifecycle (pending -> acked)
- Ack rejection for already-acked messages
- Correlation ID filtering
- Sender filtering
- Channel isolation
- Pending count
- AckAll by channel
- TTL expiry filtering
- GC of expired messages
- GC of old acked messages
- Multi-reader fan-out (independent cursors)
- JSON metadata persistence
- Task-scoped channel convention
- findReplies by correlation ID

Uses `createSharedTestLayer()` (Rule 8 compliant).

## Files Changed

| File | Change |
|------|--------|
| `migrations/021_agent_outbox.sql` | New migration |
| `packages/types/src/message.ts` | New type definitions |
| `packages/types/src/index.ts` | Re-export message types |
| `packages/types/src/response.ts` | Serialization schemas |
| `packages/core/src/mappers/message.ts` | Row-to-domain mapper |
| `packages/core/src/mappers/index.ts` | Re-export |
| `packages/core/src/errors.ts` | MessageNotFoundError, MessageAlreadyAckedError |
| `packages/core/src/repo/message-repo.ts` | Repository |
| `packages/core/src/repo/index.ts` | Re-export |
| `packages/core/src/services/message-service.ts` | Service |
| `packages/core/src/services/index.ts` | Re-export |
| `packages/core/src/layer.ts` | Wire MessageRepository + MessageService |
| `packages/core/src/index.ts` | Re-export all |
| `apps/cli/src/commands/outbox.ts` | CLI commands |
| `apps/cli/src/cli.ts` | Register commands |
| `apps/cli/src/help.ts` | Help text |
| `apps/mcp-server/src/tools/message.ts` | MCP tools |
| `apps/mcp-server/src/server.ts` | Register tools |
| `apps/mcp-server/src/runtime.ts` | Add MessageService to McpServices |
| `apps/api-server/src/api.ts` | MessagesGroup |
| `apps/api-server/src/routes/messages.ts` | Route handlers |
| `apps/api-server/src/server-lib.ts` | Wire MessagesLive |
| `test/integration/message.test.ts` | Integration tests |
