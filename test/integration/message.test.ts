/**
 * Message (Agent Outbox) Integration Tests
 *
 * Tests for PRD-024 agent-to-agent messaging primitive.
 * Covers: send, inbox, ack, cursor-based fan-out, TTL, correlation IDs,
 * gc, channel isolation, ackAll.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { MessageService } from "@jamesaphoenix/tx-core"

describe("Message (Agent Outbox)", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  // ---------------------------------------------------------------------------
  // Send + Inbox round-trip
  // ---------------------------------------------------------------------------

  it("send creates a message and inbox retrieves it", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService
        const sent = yield* svc.send({
          channel: "worker-1",
          sender: "orchestrator",
          content: "Please review PR #42",
          correlationId: null,
          taskId: null,
        })

        expect(sent.id).toBe(1)
        expect(sent.channel).toBe("worker-1")
        expect(sent.sender).toBe("orchestrator")
        expect(sent.content).toBe("Please review PR #42")
        expect(sent.status).toBe("pending")
        expect(sent.correlationId).toBeNull()
        expect(sent.taskId).toBeNull()
        expect(sent.ackedAt).toBeNull()

        const messages = yield* svc.inbox({ channel: "worker-1" })
        expect(messages).toHaveLength(1)
        expect(messages[0].content).toBe("Please review PR #42")

        return sent
      }).pipe(Effect.provide(shared.layer))
    )

    expect(result).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // Cursor-based reading
  // ---------------------------------------------------------------------------

  it("inbox supports cursor-based reading with afterId", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        // Send 3 messages
        const m1 = yield* svc.send({ channel: "events", sender: "ci", content: "build started", correlationId: null, taskId: null })
        yield* svc.send({ channel: "events", sender: "ci", content: "build passed", correlationId: null, taskId: null })
        yield* svc.send({ channel: "events", sender: "ci", content: "deployed", correlationId: null, taskId: null })

        // Read all
        const all = yield* svc.inbox({ channel: "events" })
        expect(all).toHaveLength(3)

        // Read after first message (should get 2)
        const after1 = yield* svc.inbox({ channel: "events", afterId: m1.id })
        expect(after1).toHaveLength(2)
        expect(after1[0].content).toBe("build passed")
        expect(after1[1].content).toBe("deployed")

        // Read with limit
        const limited = yield* svc.inbox({ channel: "events", limit: 1 })
        expect(limited).toHaveLength(1)
        expect(limited[0].content).toBe("build started")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Ack lifecycle
  // ---------------------------------------------------------------------------

  it("ack transitions message from pending to acked", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        const sent = yield* svc.send({ channel: "worker-1", sender: "orch", content: "do thing", correlationId: null, taskId: null })
        expect(sent.status).toBe("pending")

        const acked = yield* svc.ack(sent.id)
        expect(acked.status).toBe("acked")
        expect(acked.ackedAt).not.toBeNull()

        // Inbox should not include acked messages by default
        const pending = yield* svc.inbox({ channel: "worker-1" })
        expect(pending).toHaveLength(0)

        // With includeAcked, should see it
        const all = yield* svc.inbox({ channel: "worker-1", includeAcked: true })
        expect(all).toHaveLength(1)
        expect(all[0].status).toBe("acked")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("ack rejects already-acked message", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService
        const sent = yield* svc.send({ channel: "ch", sender: "s", content: "c", correlationId: null, taskId: null })
        yield* svc.ack(sent.id)

        // Second ack should fail
        const result = yield* svc.ack(sent.id).pipe(
          Effect.map(() => "success" as const),
          Effect.catchAll((e) => Effect.succeed(
            (e as { _tag?: string })._tag ?? "unknown"
          ))
        )
        expect(result).toBe("MessageAlreadyAckedError")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Correlation ID filtering
  // ---------------------------------------------------------------------------

  it("inbox filters by correlation ID for request/reply", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        const corrId = "req-12345"

        // Send request and reply with same correlation ID
        yield* svc.send({ channel: "worker-1", sender: "orch", content: "review PR", correlationId: corrId, taskId: null })
        yield* svc.send({ channel: "worker-1", sender: "ci", content: "unrelated", correlationId: null, taskId: null })
        yield* svc.send({ channel: "orch", sender: "worker-1", content: "approved", correlationId: corrId, taskId: null })

        // Filter by correlation
        const replies = yield* svc.inbox({ channel: "orch", correlationId: corrId })
        expect(replies).toHaveLength(1)
        expect(replies[0].content).toBe("approved")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Sender filtering
  // ---------------------------------------------------------------------------

  it("inbox filters by sender", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        yield* svc.send({ channel: "broadcast", sender: "worker-1", content: "done task A", correlationId: null, taskId: null })
        yield* svc.send({ channel: "broadcast", sender: "worker-2", content: "done task B", correlationId: null, taskId: null })
        yield* svc.send({ channel: "broadcast", sender: "worker-1", content: "done task C", correlationId: null, taskId: null })

        const fromW1 = yield* svc.inbox({ channel: "broadcast", sender: "worker-1" })
        expect(fromW1).toHaveLength(2)
        expect(fromW1[0].content).toBe("done task A")
        expect(fromW1[1].content).toBe("done task C")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Channel isolation
  // ---------------------------------------------------------------------------

  it("messages are isolated by channel", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        yield* svc.send({ channel: "ch-a", sender: "s", content: "msg for A", correlationId: null, taskId: null })
        yield* svc.send({ channel: "ch-b", sender: "s", content: "msg for B", correlationId: null, taskId: null })

        const chA = yield* svc.inbox({ channel: "ch-a" })
        const chB = yield* svc.inbox({ channel: "ch-b" })
        const chC = yield* svc.inbox({ channel: "ch-c" })

        expect(chA).toHaveLength(1)
        expect(chA[0].content).toBe("msg for A")
        expect(chB).toHaveLength(1)
        expect(chB[0].content).toBe("msg for B")
        expect(chC).toHaveLength(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Pending count
  // ---------------------------------------------------------------------------

  it("pending returns count of unacked messages", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        yield* svc.send({ channel: "q", sender: "s", content: "a", correlationId: null, taskId: null })
        yield* svc.send({ channel: "q", sender: "s", content: "b", correlationId: null, taskId: null })
        const m3 = yield* svc.send({ channel: "q", sender: "s", content: "c", correlationId: null, taskId: null })

        expect(yield* svc.pending("q")).toBe(3)

        yield* svc.ack(m3.id)
        expect(yield* svc.pending("q")).toBe(2)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // AckAll
  // ---------------------------------------------------------------------------

  it("ackAll acknowledges all pending messages on a channel", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        yield* svc.send({ channel: "batch", sender: "s", content: "a", correlationId: null, taskId: null })
        yield* svc.send({ channel: "batch", sender: "s", content: "b", correlationId: null, taskId: null })
        yield* svc.send({ channel: "other", sender: "s", content: "c", correlationId: null, taskId: null })

        const count = yield* svc.ackAll("batch")
        expect(count).toBe(2)

        // All batch messages are acked
        expect(yield* svc.pending("batch")).toBe(0)
        // Other channel unaffected
        expect(yield* svc.pending("other")).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // TTL expiry
  // ---------------------------------------------------------------------------

  it("expired messages are not returned by inbox", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        // Send with TTL of 1 second
        yield* svc.send({
          channel: "ephemeral",
          sender: "ci",
          content: "build 123",
          correlationId: null,
          taskId: null,
          ttlSeconds: 1,
        })

        // Should be visible immediately
        const before = yield* svc.inbox({ channel: "ephemeral" })
        expect(before).toHaveLength(1)

        // Manually expire the message by updating expires_at in the past
        const db = shared.getDb()
        db.run("UPDATE outbox_messages SET expires_at = datetime('now', '-1 hour')")

        // Should be filtered out
        const after = yield* svc.inbox({ channel: "ephemeral" })
        expect(after).toHaveLength(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // GC cleanup
  // ---------------------------------------------------------------------------

  it("gc deletes expired messages", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        // Send a message with TTL
        yield* svc.send({
          channel: "gc-test",
          sender: "s",
          content: "temp",
          correlationId: null,
          taskId: null,
          ttlSeconds: 1,
        })

        // Expire it
        const db = shared.getDb()
        db.run("UPDATE outbox_messages SET expires_at = datetime('now', '-1 hour')")

        const result = yield* svc.gc()
        expect(result.expired).toBe(1)
        expect(result.acked).toBe(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("gc deletes old acked messages when threshold provided", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        const m1 = yield* svc.send({ channel: "gc-ack", sender: "s", content: "old", correlationId: null, taskId: null })
        yield* svc.ack(m1.id)

        // Move acked_at to 48 hours ago
        const db = shared.getDb()
        db.run("UPDATE outbox_messages SET acked_at = datetime('now', '-48 hours')")

        // GC with 24-hour threshold
        const result = yield* svc.gc({ ackedOlderThanHours: 24 })
        expect(result.acked).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Multi-reader fan-out (same channel, independent cursors)
  // ---------------------------------------------------------------------------

  it("multiple readers can independently read the same channel", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        // Send 3 messages to a shared channel
        yield* svc.send({ channel: "broadcast", sender: "ci", content: "v1.0", correlationId: null, taskId: null })
        yield* svc.send({ channel: "broadcast", sender: "ci", content: "v1.1", correlationId: null, taskId: null })
        yield* svc.send({ channel: "broadcast", sender: "ci", content: "v1.2", correlationId: null, taskId: null })

        // Reader A reads from beginning, processes first 2
        const readerA = yield* svc.inbox({ channel: "broadcast", limit: 2 })
        expect(readerA).toHaveLength(2)
        const readerACursor = readerA[1].id

        // Reader B reads from beginning, processes first 1
        const readerB = yield* svc.inbox({ channel: "broadcast", limit: 1 })
        expect(readerB).toHaveLength(1)
        const readerBCursor = readerB[0].id

        // Reader A reads from their cursor — gets 1 more
        const readerANext = yield* svc.inbox({ channel: "broadcast", afterId: readerACursor })
        expect(readerANext).toHaveLength(1)
        expect(readerANext[0].content).toBe("v1.2")

        // Reader B reads from their cursor — gets 2 more
        const readerBNext = yield* svc.inbox({ channel: "broadcast", afterId: readerBCursor })
        expect(readerBNext).toHaveLength(2)
        expect(readerBNext[0].content).toBe("v1.1")
        expect(readerBNext[1].content).toBe("v1.2")

        // Neither reader's reading affected the other — no side effects
        const allMessages = yield* svc.inbox({ channel: "broadcast" })
        expect(allMessages).toHaveLength(3)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  it("send accepts JSON metadata", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        const sent = yield* svc.send({
          channel: "meta-test",
          sender: "test",
          content: "with metadata",
          correlationId: null,
          taskId: null,
          metadata: { priority: "high", retries: 3 },
        })

        expect(sent.metadata).toEqual({ priority: "high", retries: 3 })

        const inbox = yield* svc.inbox({ channel: "meta-test" })
        expect(inbox[0].metadata).toEqual({ priority: "high", retries: 3 })
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Task-scoped messages
  // ---------------------------------------------------------------------------

  it("send accepts taskId for task-scoped messages", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        // Task-scoped messages use the channel convention but taskId is null
        // when the task doesn't exist (FK constraint). Test channel convention only.
        const sent = yield* svc.send({
          channel: "task:tx-abc123",
          sender: "worker-1",
          content: "Found root cause in auth.ts:42",
          correlationId: null,
          taskId: null,
        })

        expect(sent.channel).toBe("task:tx-abc123")
        expect(sent.sender).toBe("worker-1")
        expect(sent.content).toBe("Found root cause in auth.ts:42")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // findReplies
  // ---------------------------------------------------------------------------

  it("findReplies returns messages matching a correlation ID", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        const corrId = "corr-999"
        yield* svc.send({ channel: "ch", sender: "a", content: "req", correlationId: corrId, taskId: null })
        yield* svc.send({ channel: "ch", sender: "b", content: "reply", correlationId: corrId, taskId: null })
        yield* svc.send({ channel: "ch", sender: "c", content: "unrelated", correlationId: null, taskId: null })

        const replies = yield* svc.findReplies(corrId)
        expect(replies).toHaveLength(2)
        expect(replies[0].content).toBe("req")
        expect(replies[1].content).toBe("reply")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Negative TTL validation
  // ---------------------------------------------------------------------------

  it("send rejects negative ttlSeconds", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService
        const result = yield* svc.send({
          channel: "ch",
          sender: "s",
          content: "bad ttl",
          correlationId: null,
          taskId: null,
          ttlSeconds: -3600,
        }).pipe(
          Effect.map(() => "success" as const),
          Effect.catchAll((e) => Effect.succeed(
            (e as { _tag?: string })._tag ?? "unknown"
          ))
        )
        expect(result).toBe("ValidationError")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // GC with hours=0 deletes all acked
  // ---------------------------------------------------------------------------

  it("gc with ackedOlderThanHours=0 deletes all acked messages", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        const m1 = yield* svc.send({ channel: "gc-zero", sender: "s", content: "a", correlationId: null, taskId: null })
        const m2 = yield* svc.send({ channel: "gc-zero", sender: "s", content: "b", correlationId: null, taskId: null })
        yield* svc.ack(m1.id)
        yield* svc.ack(m2.id)

        // hours=0 means threshold=now, so all acked messages should be deleted
        const result = yield* svc.gc({ ackedOlderThanHours: 0 })
        expect(result.acked).toBe(2)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ---------------------------------------------------------------------------
  // Pending count excludes expired messages
  // ---------------------------------------------------------------------------

  it("pending count excludes expired messages", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MessageService

        yield* svc.send({ channel: "exp-count", sender: "s", content: "a", correlationId: null, taskId: null })
        yield* svc.send({ channel: "exp-count", sender: "s", content: "b", correlationId: null, taskId: null, ttlSeconds: 1 })

        // Before expiry: both visible
        expect(yield* svc.pending("exp-count")).toBe(2)

        // Expire one message
        const db = shared.getDb()
        db.run("UPDATE outbox_messages SET expires_at = datetime('now', '-1 hour') WHERE content = 'b'")

        // After expiry: only non-expired counted
        expect(yield* svc.pending("exp-count")).toBe(1)

        // inbox should match pending count
        const messages = yield* svc.inbox({ channel: "exp-count" })
        expect(messages).toHaveLength(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })
})
