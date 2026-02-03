import { Cause, Context, Effect, FiberRef, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"

/**
 * Options for creating a span.
 */
export interface SpanOptions {
  readonly attributes?: Record<string, string | number | boolean>
}

/**
 * TracingService provides operational tracing for debugging RALPH run failures.
 * Records spans (timed operations) and metrics to the events table.
 *
 * Design: DD-019 specifies two primitives:
 * - Spans: wrap service operations with timing and status
 * - Metrics: record point-in-time metric values
 *
 * Run context is managed via FiberRef and propagates through nested effects.
 */
export class TracingService extends Context.Tag("TracingService")<
  TracingService,
  {
    /**
     * Wrap an effect with a named span (records to events table).
     * Records duration_ms, status (ok/error), and optional attributes.
     */
    readonly withSpan: <A, E, R>(
      name: string,
      options: SpanOptions,
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>

    /**
     * Record a metric event (not a span).
     * The value is stored in duration_ms column for consistency.
     */
    readonly recordMetric: (
      metricName: string,
      value: number,
      attributes?: Record<string, unknown>
    ) => Effect.Effect<void, DatabaseError>

    /**
     * Set run context for all nested spans.
     * Uses Effect.locally to scope the run ID to the provided effect.
     */
    readonly withRunContext: <A, E, R>(
      runId: string,
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>

    /**
     * Get current run context (if any).
     * Returns undefined when not within a withRunContext scope.
     */
    readonly getRunContext: () => Effect.Effect<string | undefined, never>
  }
>() {}

/**
 * FiberRef to store the current run context.
 * Scoped via Effect.locally in withRunContext.
 */
const RunContextRef = FiberRef.unsafeMake<string | undefined>(undefined)

/**
 * Live implementation that writes spans to the events table.
 * Requires SqliteClient dependency.
 */
export const TracingServiceLive = Layer.effect(
  TracingService,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      withSpan: (name, options, effect) =>
        Effect.gen(function* () {
          const runId = yield* FiberRef.get(RunContextRef)
          const startTime = Date.now()

          const result = yield* Effect.matchCauseEffect(effect, {
            onFailure: (cause) =>
              Effect.gen(function* () {
                const duration = Date.now() - startTime
                const metadata = JSON.stringify({
                  status: "error",
                  error: Cause.pretty(cause),
                  attributes: options.attributes
                })

                // Record failed span - ignore db errors to not block the original error
                yield* Effect.tryPromise({
                  try: async () => {
                    db.prepare(`
                      INSERT INTO events (timestamp, event_type, run_id, content, metadata, duration_ms)
                      VALUES (datetime('now'), 'span', ?, ?, ?, ?)
                    `).run(runId ?? null, name, metadata, duration)
                  },
                  catch: () => new DatabaseError({ cause: "Failed to record span" })
                }).pipe(Effect.ignore)

                return yield* Effect.failCause(cause)
              }),
            onSuccess: (value) =>
              Effect.gen(function* () {
                const duration = Date.now() - startTime
                const metadata = JSON.stringify({
                  status: "ok",
                  attributes: options.attributes
                })

                // Record successful span - ignore db errors to not block the operation
                yield* Effect.tryPromise({
                  try: async () => {
                    db.prepare(`
                      INSERT INTO events (timestamp, event_type, run_id, content, metadata, duration_ms)
                      VALUES (datetime('now'), 'span', ?, ?, ?, ?)
                    `).run(runId ?? null, name, metadata, duration)
                  },
                  catch: () => new DatabaseError({ cause: "Failed to record span" })
                }).pipe(Effect.ignore)

                return value
              })
          })

          return result
        }),

      recordMetric: (metricName, value, attributes) =>
        Effect.gen(function* () {
          const runId = yield* FiberRef.get(RunContextRef)
          const metadata = JSON.stringify(attributes ?? {})

          yield* Effect.tryPromise({
            try: async () => {
              db.prepare(`
                INSERT INTO events (timestamp, event_type, run_id, content, metadata, duration_ms)
                VALUES (datetime('now'), 'metric', ?, ?, ?, ?)
              `).run(runId ?? null, metricName, metadata, value)
            },
            catch: (e) => new DatabaseError({ cause: e })
          })
        }),

      withRunContext: (runId, effect) =>
        Effect.locally(RunContextRef, runId)(effect),

      getRunContext: () => FiberRef.get(RunContextRef)
    }
  })
)

/**
 * Noop implementation for when tracing is disabled.
 * Zero overhead - effects pass through unchanged.
 */
export const TracingServiceNoop = Layer.succeed(TracingService, {
  withSpan: (_name, _options, effect) => effect,
  recordMetric: () => Effect.void,
  withRunContext: (_runId, effect) => effect,
  getRunContext: () => Effect.succeed(undefined)
})
