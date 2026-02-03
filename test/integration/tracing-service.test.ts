import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { createTestDb, fixtureId } from "../fixtures.js"
import {
  SqliteClient,
  TracingService,
  TracingServiceLive,
  TracingServiceNoop
} from "@jamesaphoenix/tx-core"
import type { Database } from "bun:sqlite"

/**
 * Integration tests for TracingService - PRD-019 execution tracing.
 *
 * Tests both TracingServiceLive (writes to events table) and
 * TracingServiceNoop (zero overhead pass-through).
 */

// Fixture IDs for run contexts
const FIXTURE_RUN_ID = fixtureId("tracing-run-1")
const FIXTURE_RUN_ID_2 = fixtureId("tracing-run-2")

/**
 * Create a run record in the database.
 * Required because events.run_id has a foreign key constraint to runs(id).
 */
function createRunRecord(db: Database, runId: string): void {
  db.prepare(`
    INSERT INTO runs (id, agent, started_at, status)
    VALUES (?, 'test-agent', datetime('now'), 'running')
  `).run(runId)
}

function makeTracingLayer(db: Database) {
  const infra = Layer.succeed(SqliteClient, db as any)
  return TracingServiceLive.pipe(Layer.provide(infra))
}

describe("TracingServiceLive Integration", () => {
  let db: Database
  let layer: Layer.Layer<TracingService, never, never>

  beforeEach(() => {
    db = createTestDb()
    layer = makeTracingLayer(db)
  })

  describe("withSpan", () => {
    it("records a successful span to events table", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "test.operation",
            { attributes: { taskId: "tx-123" } },
            Effect.succeed(42)
          )
        }).pipe(Effect.provide(layer))
      )

      // Effect should pass through correctly
      expect(result).toBe(42)

      // Check events table
      const events = db.prepare("SELECT * FROM events WHERE event_type = 'span'").all() as any[]
      expect(events).toHaveLength(1)
      expect(events[0].content).toBe("test.operation")
      expect(events[0].duration_ms).toBeGreaterThanOrEqual(0)
      expect(events[0].run_id).toBeNull() // No run context

      const metadata = JSON.parse(events[0].metadata)
      expect(metadata.status).toBe("ok")
      expect(metadata.attributes.taskId).toBe("tx-123")
    })

    it("records an error span when effect fails", async () => {
      const error = new Error("Test failure")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "failing.operation",
            {},
            Effect.fail(error)
          )
        }).pipe(Effect.provide(layer), Effect.either)
      )

      // Effect should fail
      expect(result._tag).toBe("Left")

      // Check events table for error span
      const events = db.prepare("SELECT * FROM events WHERE event_type = 'span'").all() as any[]
      expect(events).toHaveLength(1)
      expect(events[0].content).toBe("failing.operation")

      const metadata = JSON.parse(events[0].metadata)
      expect(metadata.status).toBe("error")
      expect(metadata.error).toContain("Test failure")
    })

    it("measures duration correctly", async () => {
      const delay = 50 // 50ms delay

      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "timed.operation",
            {},
            Effect.gen(function* () {
              yield* Effect.sleep(delay)
              return "done"
            })
          )
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'span'").all() as any[]
      expect(events).toHaveLength(1)
      // Duration should be at least the delay (with some tolerance)
      expect(events[0].duration_ms).toBeGreaterThanOrEqual(delay - 10)
    })

    it("preserves attributes in metadata", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "attributed.span",
            {
              attributes: {
                stringAttr: "hello",
                numAttr: 123,
                boolAttr: true
              }
            },
            Effect.succeed("ok")
          )
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'span'").all() as any[]
      const metadata = JSON.parse(events[0].metadata)

      expect(metadata.attributes.stringAttr).toBe("hello")
      expect(metadata.attributes.numAttr).toBe(123)
      expect(metadata.attributes.boolAttr).toBe(true)
    })

    it("supports nested spans", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "outer.span",
            {},
            tracing.withSpan(
              "inner.span",
              {},
              Effect.succeed("nested")
            )
          )
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'span' ORDER BY id").all() as any[]
      expect(events).toHaveLength(2)

      // Inner span should complete first
      expect(events[0].content).toBe("inner.span")
      expect(events[1].content).toBe("outer.span")
    })
  })

  describe("recordMetric", () => {
    it("records a metric to events table", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.recordMetric("task.count", 42)
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'metric'").all() as any[]
      expect(events).toHaveLength(1)
      expect(events[0].content).toBe("task.count")
      expect(events[0].duration_ms).toBe(42) // Value stored in duration_ms
      expect(events[0].run_id).toBeNull()
    })

    it("records metric with attributes", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.recordMetric(
            "task.completion_time_ms",
            1500,
            { status: "done", priority: "high" }
          )
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'metric'").all() as any[]
      expect(events).toHaveLength(1)

      const metadata = JSON.parse(events[0].metadata)
      expect(metadata.status).toBe("done")
      expect(metadata.priority).toBe("high")
    })

    it("records multiple metrics", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.recordMetric("metric.one", 10)
          yield* tracing.recordMetric("metric.two", 20)
          yield* tracing.recordMetric("metric.three", 30)
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'metric' ORDER BY id").all() as any[]
      expect(events).toHaveLength(3)
      expect(events.map((e: any) => e.content)).toEqual(["metric.one", "metric.two", "metric.three"])
      expect(events.map((e: any) => e.duration_ms)).toEqual([10, 20, 30])
    })
  })

  describe("withRunContext", () => {
    it("sets run_id for spans within context", async () => {
      // Create run record to satisfy foreign key constraint
      createRunRecord(db, FIXTURE_RUN_ID)

      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            tracing.withSpan("contextualized.span", {}, Effect.succeed("ok"))
          )
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'span'").all() as any[]
      expect(events).toHaveLength(1)
      expect(events[0].run_id).toBe(FIXTURE_RUN_ID)
    })

    it("sets run_id for metrics within context", async () => {
      // Create run record to satisfy foreign key constraint
      createRunRecord(db, FIXTURE_RUN_ID)

      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            tracing.recordMetric("contextualized.metric", 100)
          )
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'metric'").all() as any[]
      expect(events).toHaveLength(1)
      expect(events[0].run_id).toBe(FIXTURE_RUN_ID)
    })

    it("supports nested run contexts", async () => {
      // Create run records to satisfy foreign key constraint
      createRunRecord(db, FIXTURE_RUN_ID)
      createRunRecord(db, FIXTURE_RUN_ID_2)

      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            Effect.gen(function* () {
              yield* tracing.recordMetric("outer.metric", 1)
              yield* tracing.withRunContext(
                FIXTURE_RUN_ID_2,
                tracing.recordMetric("inner.metric", 2)
              )
              yield* tracing.recordMetric("outer.metric.after", 3)
            })
          )
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'metric' ORDER BY id").all() as any[]
      expect(events).toHaveLength(3)

      // Outer context
      expect(events[0].run_id).toBe(FIXTURE_RUN_ID)
      // Inner context (overrides)
      expect(events[1].run_id).toBe(FIXTURE_RUN_ID_2)
      // Back to outer context
      expect(events[2].run_id).toBe(FIXTURE_RUN_ID)
    })

    it("context does not leak outside withRunContext", async () => {
      // Create run record to satisfy foreign key constraint
      createRunRecord(db, FIXTURE_RUN_ID)

      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.recordMetric("before.context", 0)
          yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            tracing.recordMetric("in.context", 1)
          )
          yield* tracing.recordMetric("after.context", 2)
        }).pipe(Effect.provide(layer))
      )

      const events = db.prepare("SELECT * FROM events WHERE event_type = 'metric' ORDER BY id").all() as any[]
      expect(events).toHaveLength(3)

      expect(events[0].run_id).toBeNull()
      expect(events[1].run_id).toBe(FIXTURE_RUN_ID)
      expect(events[2].run_id).toBeNull()
    })
  })

  describe("getRunContext", () => {
    it("returns undefined when not in a run context", async () => {
      const runId = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.getRunContext()
        }).pipe(Effect.provide(layer))
      )

      expect(runId).toBeUndefined()
    })

    it("returns the run_id when in a run context", async () => {
      const runId = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            tracing.getRunContext()
          )
        }).pipe(Effect.provide(layer))
      )

      expect(runId).toBe(FIXTURE_RUN_ID)
    })

    it("returns innermost run_id in nested contexts", async () => {
      const runIds = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          const results: (string | undefined)[] = []

          yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            Effect.gen(function* () {
              results.push(yield* tracing.getRunContext())
              yield* tracing.withRunContext(
                FIXTURE_RUN_ID_2,
                Effect.gen(function* () {
                  results.push(yield* tracing.getRunContext())
                })
              )
              results.push(yield* tracing.getRunContext())
            })
          )

          return results
        }).pipe(Effect.provide(layer))
      )

      expect(runIds).toEqual([FIXTURE_RUN_ID, FIXTURE_RUN_ID_2, FIXTURE_RUN_ID])
    })
  })

  describe("combined operations", () => {
    it("records spans and metrics in a realistic workflow", async () => {
      // Create run record to satisfy foreign key constraint
      createRunRecord(db, FIXTURE_RUN_ID)

      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService

          yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            Effect.gen(function* () {
              // Simulate a task processing workflow
              yield* tracing.withSpan(
                "task.process",
                { attributes: { taskId: "tx-abc123" } },
                Effect.gen(function* () {
                  yield* tracing.recordMetric("task.started", 1)

                  yield* tracing.withSpan(
                    "task.validate",
                    {},
                    Effect.succeed("validated")
                  )

                  yield* tracing.withSpan(
                    "task.execute",
                    {},
                    Effect.succeed("executed")
                  )

                  yield* tracing.recordMetric("task.completed", 1, { success: true })
                  return "done"
                })
              )
            })
          )
        }).pipe(Effect.provide(layer))
      )

      // Check all events were recorded
      const allEvents = db.prepare("SELECT * FROM events ORDER BY id").all() as any[]
      expect(allEvents.length).toBeGreaterThanOrEqual(5)

      // All should have the run context
      for (const event of allEvents) {
        expect(event.run_id).toBe(FIXTURE_RUN_ID)
      }

      // Check we have both spans and metrics
      const spanCount = allEvents.filter((e: any) => e.event_type === "span").length
      const metricCount = allEvents.filter((e: any) => e.event_type === "metric").length
      expect(spanCount).toBe(3) // task.process, task.validate, task.execute
      expect(metricCount).toBe(2) // task.started, task.completed
    })
  })
})

describe("TracingServiceNoop", () => {
  describe("withSpan", () => {
    it("passes through effect unchanged", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "test.operation",
            { attributes: { foo: "bar" } },
            Effect.succeed(42)
          )
        }).pipe(Effect.provide(TracingServiceNoop))
      )

      expect(result).toBe(42)
    })

    it("passes through failing effect unchanged", async () => {
      const error = new Error("Expected error")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "failing.operation",
            {},
            Effect.fail(error)
          )
        }).pipe(Effect.provide(TracingServiceNoop), Effect.either)
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBe(error)
      }
    })

    it("supports nested spans", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withSpan(
            "outer",
            {},
            tracing.withSpan(
              "inner",
              {},
              Effect.succeed("nested")
            )
          )
        }).pipe(Effect.provide(TracingServiceNoop))
      )

      expect(result).toBe("nested")
    })
  })

  describe("recordMetric", () => {
    it("is a noop", async () => {
      // Should complete without error
      await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          yield* tracing.recordMetric("some.metric", 100, { attr: "value" })
        }).pipe(Effect.provide(TracingServiceNoop))
      )
    })
  })

  describe("withRunContext", () => {
    it("passes through effect unchanged", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            Effect.succeed("in context")
          )
        }).pipe(Effect.provide(TracingServiceNoop))
      )

      expect(result).toBe("in context")
    })
  })

  describe("getRunContext", () => {
    it("always returns undefined", async () => {
      const runId = await Effect.runPromise(
        Effect.gen(function* () {
          const tracing = yield* TracingService
          return yield* tracing.withRunContext(
            FIXTURE_RUN_ID,
            tracing.getRunContext()
          )
        }).pipe(Effect.provide(TracingServiceNoop))
      )

      expect(runId).toBeUndefined()
    })
  })
})
