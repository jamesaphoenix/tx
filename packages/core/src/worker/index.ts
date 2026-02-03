/**
 * @tx/core/worker - Worker exports
 *
 * Headless worker primitives for agent orchestration.
 * See PRD-018 and DD-018 for design specification.
 */

export {
  type ExecutionResult,
  type IOCapture,
  type WorkerContext,
  type WorkerHooks,
  type WorkerConfig
} from "./hooks.js"

export { runWorker } from "./run-worker.js"
