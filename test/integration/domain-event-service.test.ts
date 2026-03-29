/**
 * DomainEventService Integration Tests
 *
 * Covers:
 * - append and query by stream (verify ordering, envelope field persistence)
 * - append and query by aggregate (verify aggregate grouping)
 * - event ordering guarantees (monotonic id, correct occurred_at ordering)
 * - envelope field round-trip (correlation_id, causation_id, actor fields, schema_version, JSON payload/metadata)
 * - invalid event type rejection
 *
 * Verifies INV-SUP-006: supervision and design-doc review lifecycle changes
 * are durably recorded in domain_events with typed payloads.
 *
 * Uses per-test in-memory SQLite (Rule 3).
 * Real SQLite + real Effect layers, no mocks.
 *
 * @see DD-039 for specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import { SqliteClientLive } from "@jamesaphoenix/tx-core"
import { DomainEventRepositoryLive } from "@jamesaphoenix/tx-core/repo"
import {
  DomainEventService,
  DomainEventServiceLive,
} from "../../packages/core/src/services/domain-event-service.js"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const NAMESPACE = "domain-event-service-test"

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${NAMESPACE}:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const FIXTURES = {
  SESSION_1: fixtureId("session-1"),
  SESSION_2: fixtureId("session-2"),
  WORKER_1: fixtureId("worker-1"),
  WORKER_2: fixtureId("worker-2"),
  DOC_1: fixtureId("doc-1"),
  CORRELATION_1: fixtureId("correlation-1"),
  CAUSATION_1: fixtureId("causation-1"),
} as const

// =============================================================================
// Helper: Create test layer with DomainEventService + all dependencies
// =============================================================================

function makeTestLayer() {
  const infra = SqliteClientLive(":memory:")

  const repos = DomainEventRepositoryLive.pipe(Layer.provide(infra))

  const domainEventService = DomainEventServiceLive.pipe(
    Layer.provide(repos)
  )

  return Layer.mergeAll(repos, domainEventService, infra)
}

// Type-safe run helper
const run = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(makeTestLayer())) as Effect.Effect<A, never, never>
  )

// =============================================================================
// Tests
// =============================================================================

describe("DomainEventService Integration [INV-SUP-006]", () => {

  // ---------------------------------------------------------------------------
  // 1. Append and query by stream
  // ---------------------------------------------------------------------------
  describe("append and query by stream", () => {

    it("publishes an event and retrieves it by stream", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const published = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "test-worker", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        expect(published.id).toBeTruthy()
        expect(published.eventType).toBe("worker.session_created")
        expect(published.streamType).toBe("worker_session")
        expect(published.streamId).toBe(FIXTURES.SESSION_1)

        const events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(events).toHaveLength(1)
        expect(events[0].id).toBe(published.id)
      })))

    it("returns events in DESC order (newest first) by stream", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const event1 = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        const event2 = yield* svc.publish({
          eventType: "worker.paused",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, currentTaskId: null, currentRunId: null },
        })

        const event3 = yield* svc.publish({
          eventType: "worker.resumed",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, resumedBy: "human" },
        })

        const events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(events).toHaveLength(3)
        // DESC order — newest first
        expect(events[0].id).toBe(event3.id)
        expect(events[1].id).toBe(event2.id)
        expect(events[2].id).toBe(event1.id)
      })))

    it("filters events by stream — different streams return different events", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_2,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_2,
          payload: { sessionId: FIXTURES.SESSION_2, workerId: FIXTURES.WORKER_2, workerName: "w2", scopeMode: "all", scopeRef: null, runtime: "codex", tmuxSessionName: null },
        })

        const s1Events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        const s2Events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_2)

        expect(s1Events).toHaveLength(1)
        expect(s2Events).toHaveLength(1)
        expect(s1Events[0].streamId).toBe(FIXTURES.SESSION_1)
        expect(s2Events[0].streamId).toBe(FIXTURES.SESSION_2)
      })))

    it("returns empty array for unknown stream", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService
        const events = yield* svc.listByStream("worker_session", "nonexistent")
        expect(events).toHaveLength(0)
      })))
  })

  // ---------------------------------------------------------------------------
  // 2. Append and query by aggregate
  // ---------------------------------------------------------------------------
  describe("append and query by aggregate", () => {

    it("publishes events and retrieves by aggregate", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        yield* svc.publish({
          eventType: "worker.paused",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, currentTaskId: null, currentRunId: null },
        })

        const events = yield* svc.listByAggregate("worker", FIXTURES.WORKER_1)
        expect(events).toHaveLength(2)
        // Both events belong to the same aggregate
        for (const e of events) {
          expect(e.aggregateType).toBe("worker")
          expect(e.aggregateId).toBe(FIXTURES.WORKER_1)
        }
      })))

    it("groups events by aggregate — different aggregates are separate", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        yield* svc.publish({
          eventType: "design_doc.review_eligible",
          streamType: "design_doc_review",
          streamId: FIXTURES.DOC_1,
          aggregateType: "design_doc",
          aggregateId: FIXTURES.DOC_1,
          payload: { docId: FIXTURES.DOC_1, docVersion: 1, taskSnapshotHash: "abc123", totalLinkedTasks: 3, doneLinkedTasks: 3 },
        })

        const workerEvents = yield* svc.listByAggregate("worker", FIXTURES.WORKER_1)
        const docEvents = yield* svc.listByAggregate("design_doc", FIXTURES.DOC_1)

        expect(workerEvents).toHaveLength(1)
        expect(docEvents).toHaveLength(1)
        expect(workerEvents[0].eventType).toBe("worker.session_created")
        expect(docEvents[0].eventType).toBe("design_doc.review_eligible")
      })))

    it("returns empty array for unknown aggregate", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService
        const events = yield* svc.listByAggregate("worker", "nonexistent")
        expect(events).toHaveLength(0)
      })))
  })

  // ---------------------------------------------------------------------------
  // 3. Event ordering guarantees
  // ---------------------------------------------------------------------------
  describe("event ordering guarantees", () => {

    it("events have unique ULIDs with non-decreasing timestamp prefix", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const e1 = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        const e2 = yield* svc.publish({
          eventType: "worker.paused",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, currentTaskId: null, currentRunId: null },
        })

        const e3 = yield* svc.publish({
          eventType: "worker.resumed",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, resumedBy: "human" },
        })

        // ULID timestamp prefix (first 10 chars) is non-decreasing
        const ts1 = e1.id.substring(0, 10)
        const ts2 = e2.id.substring(0, 10)
        const ts3 = e3.id.substring(0, 10)
        expect(ts1 <= ts2).toBe(true)
        expect(ts2 <= ts3).toBe(true)

        // All IDs are unique
        expect(new Set([e1.id, e2.id, e3.id]).size).toBe(3)

        // All IDs are 26-char ULID format
        expect(e1.id).toHaveLength(26)
        expect(e2.id).toHaveLength(26)
        expect(e3.id).toHaveLength(26)
      })))

    it("occurred_at timestamps are non-decreasing across events", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const e1 = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        const e2 = yield* svc.publish({
          eventType: "worker.session_ended",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, reason: "scope_drained" },
        })

        const ts1 = new Date(e1.occurredAt).getTime()
        const ts2 = new Date(e2.occurredAt).getTime()
        expect(ts2).toBeGreaterThanOrEqual(ts1)
      })))

    it("listByStream respects limit parameter", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        // Publish 5 events
        for (let i = 0; i < 5; i++) {
          yield* svc.publish({
            eventType: "worker.paused",
            streamType: "worker_session",
            streamId: FIXTURES.SESSION_1,
            aggregateType: "worker",
            aggregateId: FIXTURES.WORKER_1,
            payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, currentTaskId: null, currentRunId: null },
          })
        }

        const limited = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1, 3)
        expect(limited).toHaveLength(3)

        const all = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(all).toHaveLength(5)
      })))

    it("listByAggregate respects limit parameter", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        for (let i = 0; i < 4; i++) {
          yield* svc.publish({
            eventType: "worker.paused",
            streamType: "worker_session",
            streamId: FIXTURES.SESSION_1,
            aggregateType: "worker",
            aggregateId: FIXTURES.WORKER_1,
            payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, currentTaskId: null, currentRunId: null },
          })
        }

        const limited = yield* svc.listByAggregate("worker", FIXTURES.WORKER_1, 2)
        expect(limited).toHaveLength(2)
      })))
  })

  // ---------------------------------------------------------------------------
  // 4. Envelope field round-trip
  // ---------------------------------------------------------------------------
  describe("envelope field round-trip", () => {

    it("persists and retrieves correlation_id and causation_id", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const published = yield* svc.publish({
          eventType: "worker.task_claimed",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          causationId: FIXTURES.CAUSATION_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, taskId: "tx-abc123", taskTitle: "Test task" },
        })

        expect(published.correlationId).toBe(FIXTURES.CORRELATION_1)
        expect(published.causationId).toBe(FIXTURES.CAUSATION_1)

        const events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(events[0].correlationId).toBe(FIXTURES.CORRELATION_1)
        expect(events[0].causationId).toBe(FIXTURES.CAUSATION_1)
      })))

    it("persists and retrieves actor fields (actorType, actorId)", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const published = yield* svc.publish({
          eventType: "worker.pause_requested",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          actorType: "human",
          actorId: "operator-james",
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, requestedBy: "operator-james" },
        })

        expect(published.actorType).toBe("human")
        expect(published.actorId).toBe("operator-james")

        const events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(events[0].actorType).toBe("human")
        expect(events[0].actorId).toBe("operator-james")
      })))

    it("persists and retrieves schema_version", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const published = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          schemaVersion: 2,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        expect(published.schemaVersion).toBe(2)

        const events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(events[0].schemaVersion).toBe(2)
      })))

    it("defaults schema_version to 1 when not specified", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const published = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        expect(published.schemaVersion).toBe(1)
      })))

    it("round-trips complex JSON payload", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const complexPayload = {
          docId: FIXTURES.DOC_1,
          docVersion: 3,
          reviewRunId: "run-001",
          findingsCount: 5,
          summary: "Found 5 issues: 2 critical, 3 warnings",
          followupTaskIds: ["tx-aaa", "tx-bbb"],
        }

        const published = yield* svc.publish({
          eventType: "design_doc.review_failed",
          streamType: "design_doc_review",
          streamId: FIXTURES.DOC_1,
          aggregateType: "design_doc",
          aggregateId: FIXTURES.DOC_1,
          payload: complexPayload,
        })

        const retrievedPayload = published.payload as Record<string, unknown>
        expect(retrievedPayload.docId).toBe(FIXTURES.DOC_1)
        expect(retrievedPayload.docVersion).toBe(3)
        expect(retrievedPayload.findingsCount).toBe(5)
        expect(retrievedPayload.summary).toBe("Found 5 issues: 2 critical, 3 warnings")
        expect(retrievedPayload.followupTaskIds).toEqual(["tx-aaa", "tx-bbb"])

        // Verify via re-query
        const events = yield* svc.listByStream("design_doc_review", FIXTURES.DOC_1)
        const roundTripped = events[0].payload as Record<string, unknown>
        expect(roundTripped.followupTaskIds).toEqual(["tx-aaa", "tx-bbb"])
      })))

    it("round-trips JSON metadata", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const metadata = {
          source: "ralph-shell",
          version: "1.0.0",
          nested: { key: "value", count: 42 },
        }

        const published = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
          metadata,
        })

        expect(published.metadata.source).toBe("ralph-shell")
        expect(published.metadata.version).toBe("1.0.0")
        expect((published.metadata.nested as Record<string, unknown>).key).toBe("value")
        expect((published.metadata.nested as Record<string, unknown>).count).toBe(42)

        // Verify via re-query
        const events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(events[0].metadata.source).toBe("ralph-shell")
      })))

    it("handles null optional fields (correlation_id, causation_id, actor fields)", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const published = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
          // Omit optional fields — they should be null
        })

        expect(published.correlationId).toBeNull()
        expect(published.causationId).toBeNull()
        expect(published.actorType).toBeNull()
        expect(published.actorId).toBeNull()
      })))

    it("defaults metadata to empty object when not specified", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const published = yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "w1", scopeMode: "all", scopeRef: null, runtime: "claude", tmuxSessionName: null },
        })

        expect(published.metadata).toEqual({})
      })))
  })

  // ---------------------------------------------------------------------------
  // 5. Event type validation
  // ---------------------------------------------------------------------------
  describe("event type validation", () => {

    it("rejects invalid event types", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const result = yield* Effect.either(
          svc.publish({
            eventType: "invalid.event_type",
            streamType: "worker_session",
            streamId: FIXTURES.SESSION_1,
            aggregateType: "worker",
            aggregateId: FIXTURES.WORKER_1,
            payload: {},
          })
        )

        expect(result._tag).toBe("Left")
      })))

    it("accepts all worker event types", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const workerEventTypes = [
          "worker.session_created",
          "worker.session_ended",
          "worker.session_attached",
          "worker.session_detached",
          "worker.pause_requested",
          "worker.paused",
          "worker.resumed",
          "worker.task_claimed",
          "worker.task_released",
          "worker.scope_drained",
          "worker.shutdown_requested",
          "worker.shutdown_completed",
        ]

        for (const eventType of workerEventTypes) {
          const result = yield* svc.publish({
            eventType,
            streamType: "worker_session",
            streamId: FIXTURES.SESSION_1,
            aggregateType: "worker",
            aggregateId: FIXTURES.WORKER_1,
            payload: {},
          })
          expect(result.eventType).toBe(eventType)
        }
      })))

    it("accepts all design_doc event types", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const designDocEventTypes = [
          "design_doc.review_eligible",
          "design_doc.review_triggered",
          "design_doc.review_started",
          "design_doc.review_passed",
          "design_doc.review_failed",
          "design_doc.review_superseded",
          "design_doc.review_followup_created",
        ]

        for (const eventType of designDocEventTypes) {
          const result = yield* svc.publish({
            eventType,
            streamType: "design_doc_review",
            streamId: FIXTURES.DOC_1,
            aggregateType: "design_doc",
            aggregateId: FIXTURES.DOC_1,
            payload: {},
          })
          expect(result.eventType).toBe(eventType)
        }
      })))
  })

  // ---------------------------------------------------------------------------
  // 6. Cross-stream and cross-aggregate queries
  // ---------------------------------------------------------------------------
  describe("cross-stream and cross-aggregate queries", () => {

    it("same aggregate across different streams returns all events for that aggregate", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        // Two different streams but same aggregate
        yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: {},
        })

        yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_2,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          payload: {},
        })

        const byAggregate = yield* svc.listByAggregate("worker", FIXTURES.WORKER_1)
        expect(byAggregate).toHaveLength(2)

        // Each stream should only have 1
        const s1 = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        const s2 = yield* svc.listByStream("worker_session", FIXTURES.SESSION_2)
        expect(s1).toHaveLength(1)
        expect(s2).toHaveLength(1)
      })))

    it("ULID event IDs are unique across all events", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        const ids = new Set<string>()
        for (let i = 0; i < 10; i++) {
          const e = yield* svc.publish({
            eventType: "worker.paused",
            streamType: "worker_session",
            streamId: FIXTURES.SESSION_1,
            aggregateType: "worker",
            aggregateId: FIXTURES.WORKER_1,
            payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, currentTaskId: null, currentRunId: null },
          })
          ids.add(e.id)
        }

        expect(ids.size).toBe(10)
      })))
  })

  // ---------------------------------------------------------------------------
  // 7. Full lifecycle event sequence
  // ---------------------------------------------------------------------------
  describe("full lifecycle event sequence", () => {

    it("records a complete worker supervision lifecycle", () =>
      run(Effect.gen(function* () {
        const svc = yield* DomainEventService

        // 1. Session created
        yield* svc.publish({
          eventType: "worker.session_created",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          actorType: "system",
          actorId: "ralph",
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, workerName: "ralph-main", scopeMode: "design-doc", scopeRef: "my-design-doc", runtime: "claude", tmuxSessionName: "ralph-worker-1" },
        })

        // 2. Task claimed
        yield* svc.publish({
          eventType: "worker.task_claimed",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, taskId: "tx-task01", taskTitle: "Implement feature" },
        })

        // 3. Paused by human
        yield* svc.publish({
          eventType: "worker.pause_requested",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          actorType: "human",
          actorId: "operator-james",
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, requestedBy: "operator-james" },
        })

        yield* svc.publish({
          eventType: "worker.paused",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, currentTaskId: "tx-task01", currentRunId: null },
        })

        // 4. Resumed
        yield* svc.publish({
          eventType: "worker.resumed",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          actorType: "human",
          actorId: "operator-james",
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, resumedBy: "operator-james" },
        })

        // 5. Task released
        yield* svc.publish({
          eventType: "worker.task_released",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, taskId: "tx-task01", reason: "completed" },
        })

        // 6. Scope drained + shutdown
        yield* svc.publish({
          eventType: "worker.scope_drained",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, scopeMode: "design-doc", scopeRef: "my-design-doc", tasksCompleted: 1 },
        })

        yield* svc.publish({
          eventType: "worker.shutdown_completed",
          streamType: "worker_session",
          streamId: FIXTURES.SESSION_1,
          aggregateType: "worker",
          aggregateId: FIXTURES.WORKER_1,
          correlationId: FIXTURES.CORRELATION_1,
          actorType: "system",
          actorId: "ralph",
          payload: { sessionId: FIXTURES.SESSION_1, workerId: FIXTURES.WORKER_1, tasksCompleted: 1, durationMs: 60000 },
        })

        // Verify full lifecycle via stream query
        const events = yield* svc.listByStream("worker_session", FIXTURES.SESSION_1)
        expect(events).toHaveLength(8)

        // All events share the same correlation ID
        for (const e of events) {
          expect(e.correlationId).toBe(FIXTURES.CORRELATION_1)
        }

        // Verify event types in chronological order (events are DESC, so reverse)
        const chronological = [...events].reverse()
        expect(chronological[0].eventType).toBe("worker.session_created")
        expect(chronological[1].eventType).toBe("worker.task_claimed")
        expect(chronological[2].eventType).toBe("worker.pause_requested")
        expect(chronological[3].eventType).toBe("worker.paused")
        expect(chronological[4].eventType).toBe("worker.resumed")
        expect(chronological[5].eventType).toBe("worker.task_released")
        expect(chronological[6].eventType).toBe("worker.scope_drained")
        expect(chronological[7].eventType).toBe("worker.shutdown_completed")

        // Verify aggregate query also returns all 8
        const byAggregate = yield* svc.listByAggregate("worker", FIXTURES.WORKER_1)
        expect(byAggregate).toHaveLength(8)
      })))
  })
})
