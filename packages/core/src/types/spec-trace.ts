/**
 * Spec traceability types for tx
 *
 * Maps invariants <-> tests and tracks run outcomes for Feature Completion Index (FCI).
 * Uses Effect Schema for runtime validation and static typing.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

export const SPEC_DISCOVERY_METHODS = ["tag", "comment", "manifest", "manual"] as const
export const SPEC_SCOPE_TYPES = ["doc", "subsystem", "global"] as const
export const SPEC_PHASES = ["BUILD", "HARDEN", "COMPLETE"] as const

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

export const SpecDiscoveryMethodSchema = Schema.Literal(...SPEC_DISCOVERY_METHODS)
export type SpecDiscoveryMethod = typeof SpecDiscoveryMethodSchema.Type

export const SpecScopeTypeSchema = Schema.Literal(...SPEC_SCOPE_TYPES)
export type SpecScopeType = typeof SpecScopeTypeSchema.Type

export const SpecPhaseSchema = Schema.Literal(...SPEC_PHASES)
export type SpecPhase = typeof SpecPhaseSchema.Type

/** Canonical test identity: {relative_file}::{test_name}. */
export const SpecTestIdSchema = Schema.String.pipe(Schema.minLength(1))
export type SpecTestId = typeof SpecTestIdSchema.Type

export const SpecTestSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  invariantId: Schema.String,
  testId: SpecTestIdSchema,
  testFile: Schema.String,
  testName: Schema.NullOr(Schema.String),
  framework: Schema.NullOr(Schema.String),
  discovery: SpecDiscoveryMethodSchema,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
})
export type SpecTest = typeof SpecTestSchema.Type

export const SpecTestRunSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  specTestId: Schema.Number.pipe(Schema.int()),
  passed: Schema.Boolean,
  durationMs: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  details: Schema.NullOr(Schema.String),
  runAt: Schema.DateFromSelf,
})
export type SpecTestRun = typeof SpecTestRunSchema.Type

export const SpecSignoffSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  scopeType: SpecScopeTypeSchema,
  scopeValue: Schema.NullOr(Schema.String),
  signedOffBy: Schema.String,
  notes: Schema.NullOr(Schema.String),
  signedOffAt: Schema.DateFromSelf,
})
export type SpecSignoff = typeof SpecSignoffSchema.Type

export const SpecScopeFilterSchema = Schema.Struct({
  doc: Schema.optional(Schema.String),
  subsystem: Schema.optional(Schema.String),
})
export type SpecScopeFilter = typeof SpecScopeFilterSchema.Type

export const DiscoverResultSchema = Schema.Struct({
  scannedFiles: Schema.Number.pipe(Schema.int()),
  discoveredLinks: Schema.Number.pipe(Schema.int()),
  upserted: Schema.Number.pipe(Schema.int()),
  tagLinks: Schema.Number.pipe(Schema.int()),
  commentLinks: Schema.Number.pipe(Schema.int()),
  manifestLinks: Schema.Number.pipe(Schema.int()),
})
export type DiscoverResult = typeof DiscoverResultSchema.Type

export const FciResultSchema = Schema.Struct({
  total: Schema.Number.pipe(Schema.int()),
  covered: Schema.Number.pipe(Schema.int()),
  uncovered: Schema.Number.pipe(Schema.int()),
  passing: Schema.Number.pipe(Schema.int()),
  failing: Schema.Number.pipe(Schema.int()),
  untested: Schema.Number.pipe(Schema.int()),
  fci: Schema.Number,
  phase: SpecPhaseSchema,
})
export type FciResult = typeof FciResultSchema.Type

export const SpecTestLatestRunSchema = Schema.Struct({
  passed: Schema.NullOr(Schema.Boolean),
  runAt: Schema.NullOr(Schema.DateFromSelf),
})
export type SpecTestLatestRun = typeof SpecTestLatestRunSchema.Type

export const TraceabilityMatrixTestSchema = Schema.Struct({
  specTestId: Schema.Number.pipe(Schema.int()),
  testId: SpecTestIdSchema,
  testFile: Schema.String,
  testName: Schema.NullOr(Schema.String),
  framework: Schema.NullOr(Schema.String),
  discovery: SpecDiscoveryMethodSchema,
  latestRun: SpecTestLatestRunSchema,
})
export type TraceabilityMatrixTest = typeof TraceabilityMatrixTestSchema.Type

export const TraceabilityMatrixEntrySchema = Schema.Struct({
  invariantId: Schema.String,
  rule: Schema.String,
  subsystem: Schema.NullOr(Schema.String),
  tests: Schema.Array(TraceabilityMatrixTestSchema),
})
export type TraceabilityMatrixEntry = typeof TraceabilityMatrixEntrySchema.Type

export const TraceabilityMatrixSchema = Schema.Array(TraceabilityMatrixEntrySchema)
export type TraceabilityMatrix = typeof TraceabilityMatrixSchema.Type

export const BatchRunInputSchema = Schema.Struct({
  testId: SpecTestIdSchema,
  passed: Schema.Boolean,
  durationMs: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
  details: Schema.optional(Schema.NullOr(Schema.String)),
})
export type BatchRunInput = typeof BatchRunInputSchema.Type

// =============================================================================
// DATABASE ROW TYPES (snake_case from SQLite)
// =============================================================================

export interface SpecTestRow {
  id: number
  invariant_id: string
  test_id: string
  test_file: string
  test_name: string | null
  framework: string | null
  discovery: string
  created_at: string
  updated_at: string
}

export interface SpecTestRunRow {
  id: number
  spec_test_id: number
  passed: number
  duration_ms: number | null
  details: string | null
  run_at: string
}

export interface SpecSignoffRow {
  id: number
  scope_type: string
  scope_value: string | null
  signed_off_by: string
  notes: string | null
  signed_off_at: string
}
