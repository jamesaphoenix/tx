/**
 * ReviewRuntime - DD-039
 *
 * Port interface for design-doc review execution.
 * The default adapter is PiReviewRuntime; a Noop stub is provided for tests.
 * Uses Effect-TS patterns per DD-002.
 */

import { Context, Effect, Layer, Schema } from "effect"
import type {
  ReviewRunResult,
  DocReviewError,
} from "@jamesaphoenix/tx-types"
import { ReviewTransportSchema } from "@jamesaphoenix/tx-types"

/**
 * Parameters for executing a review against a design doc.
 */
export const ReviewExecutionParamsSchema = Schema.Struct({
  /** The design-doc identifier (e.g. "ralph-supervision-dashboard-design"). */
  docId: Schema.String,
  /** The version of the design doc being reviewed. */
  docVersion: Schema.Number.pipe(Schema.int()),
  /** The review template to execute (e.g. "double-check"). */
  templateName: Schema.String,
  /** Transport mechanism: "rpc" or "sdk". */
  transport: ReviewTransportSchema,
  /** Optional context to inject into the review prompt. */
  context: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type ReviewExecutionParams = typeof ReviewExecutionParamsSchema.Type

/**
 * ReviewRuntime — port interface for review execution adapters.
 *
 * Core services call executeReview; the concrete adapter (Pi, custom, or noop)
 * handles transport, prompt templating, and findings collection.
 */
export class ReviewRuntime extends Context.Tag("ReviewRuntime")<
  ReviewRuntime,
  {
    /**
     * Execute a review against a design doc using the configured runtime.
     * Returns structured findings on success, or a DocReviewError on failure.
     */
    readonly executeReview: (
      params: ReviewExecutionParams
    ) => Effect.Effect<ReviewRunResult, DocReviewError>
  }
>() {}

/**
 * Noop ReviewRuntime for tests and environments where review is disabled.
 * Always returns a passing result with zero findings.
 */
export const ReviewRuntimeNoop = Layer.succeed(ReviewRuntime, {
  executeReview: () =>
    Effect.succeed({
      passed: true,
      summary: "Review skipped (noop runtime)",
      findingsCount: 0,
      findings: [],
    }),
})
