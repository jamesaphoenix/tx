/**
 * Chaos Engineering Utilities for tx
 *
 * Provides reusable primitives for hardening tx through controlled failures.
 * Use these utilities to test race conditions, failures, and edge cases.
 *
 * @example
 * ```typescript
 * import { chaos } from '@tx/test-utils'
 *
 * await chaos.doubleComplete({ taskId, db })
 * await chaos.crashAfter(100)
 * ```
 *
 * @module @tx/test-utils/chaos
 */

export {
  // Process failure simulation
  crashAfter,
  CrashSimulationError,
  type CrashAfterOptions,
  type CrashAfterResult,
  // State corruption
  corruptState,
  type CorruptStateOptions,
  type CorruptionType,
  // JSONL replay
  replayJSONL,
  type ReplayJSONLOptions,
  type ReplayJSONLResult,
  type SyncOperation,
  // Double completion testing
  doubleComplete,
  type DoubleCompleteOptions,
  type DoubleCompleteResult,
  // Partial write simulation
  partialWrite,
  type PartialWriteOptions,
  type PartialWriteResult,
  // Stress testing
  stressLoad,
  type StressLoadOptions,
  type StressLoadResult
} from "./chaos-utilities.js"

// Convenience default export for namespace-style usage
import * as chaosUtilities from "./chaos-utilities.js"
export const chaos = chaosUtilities
