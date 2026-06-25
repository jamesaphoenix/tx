/**
 * PiReviewRuntime - DD-039
 *
 * Pi adapter implementing the ReviewRuntime port.
 * Uses RPC transport first (per config), executes the configured template
 * (e.g. "double-check"), collects findings, and returns ReviewRunResult.
 *
 * Uses Effect-TS patterns per DD-002.
 */

import { Effect, Layer } from "effect"
import { DocReviewError } from "../types/index.js"
import { ReviewRuntime, type ReviewExecutionParams } from "./review-runtime.js"

/**
 * Execute a review using Pi RPC transport.
 *
 * Currently a stub that will be replaced with real Pi RPC client calls
 * once the Pi integration is available. The stub returns a passing result
 * to allow the review lifecycle to be tested end-to-end.
 */
const executeViaRpc = (
  params: ReviewExecutionParams
) =>
  Effect.gen(function* () {
    yield* Effect.log(
      `Pi RPC review: doc=${params.docId} v${params.docVersion} template=${params.templateName}`
    )

    // TODO: Replace with real Pi RPC client call when Pi integration is available.
    // The Pi RPC client should:
    // 1. Connect to the Pi daemon
    // 2. Submit a review request with the template and doc context
    // 3. Stream or poll for findings
    // 4. Collect and return structured ReviewRunResult

    return {
      passed: true,
      summary: `Pi RPC review completed for ${params.docId} v${params.docVersion} (stub)`,
      findingsCount: 0,
      findings: [] as Array<{ severity: "info" | "warning" | "error"; message: string; location: string | null }>,
    }
  })

/**
 * Execute a review using Pi SDK transport.
 *
 * Fallback transport when RPC is unavailable.
 * Currently a stub — same as RPC until real Pi SDK is integrated.
 */
const executeViaSdk = (
  params: ReviewExecutionParams
) =>
  Effect.gen(function* () {
    yield* Effect.log(
      `Pi SDK review: doc=${params.docId} v${params.docVersion} template=${params.templateName}`
    )

    return {
      passed: true,
      summary: `Pi SDK review completed for ${params.docId} v${params.docVersion} (stub)`,
      findingsCount: 0,
      findings: [] as Array<{ severity: "info" | "warning" | "error"; message: string; location: string | null }>,
    }
  })

/**
 * PiReviewRuntimeLive — Pi adapter for the ReviewRuntime port.
 *
 * Routes to RPC or SDK transport based on the params.transport field.
 * Config-driven: the DocReviewService reads [reviews.design_docs] config
 * and passes the transport to executeReview.
 */
export const PiReviewRuntimeLive = Layer.succeed(ReviewRuntime, {
  executeReview: (params: ReviewExecutionParams) =>
    Effect.gen(function* () {
      switch (params.transport) {
        case "rpc":
          return yield* executeViaRpc(params)
        case "sdk":
          return yield* executeViaSdk(params)
        default: {
          return yield* Effect.fail(
            new DocReviewError(
              "RuntimeFailure",
              `Unsupported transport: ${params.transport}`
            )
          )
        }
      }
    }),
})
