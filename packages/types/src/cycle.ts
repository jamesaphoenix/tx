/**
 * Cycle types for tx
 *
 * Type definitions for the cycle-based issue discovery system.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 *
 * Cycles dispatch sub-agent swarms to scan for codebase issues,
 * deduplicate findings against known issues, and optionally fix them.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

export const FINDING_SEVERITIES = ["high", "medium", "low"] as const
export const LOSS_WEIGHTS: Record<string, number> = { high: 3, medium: 2, low: 1 }

// =============================================================================
// SCHEMAS & TYPES — Finding
// =============================================================================

/** Severity level for a finding. */
export const FindingSeveritySchema = Schema.Literal(...FINDING_SEVERITIES)
export type FindingSeverity = typeof FindingSeveritySchema.Type

/** A single issue found by a scan agent. */
export const FindingSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  severity: FindingSeveritySchema,
  issueType: Schema.String,
  file: Schema.String,
  line: Schema.Number,
})
export type Finding = typeof FindingSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Dedup
// =============================================================================

/** A duplicate finding mapped to an existing issue. */
export const DuplicateSchema = Schema.Struct({
  findingIdx: Schema.Number,
  existingIssueId: Schema.String,
  reason: Schema.String,
})
export type Duplicate = typeof DuplicateSchema.Type

/** Result of deduplication: new issues and identified duplicates. */
export const DedupResultSchema = Schema.Struct({
  newIssues: Schema.Array(FindingSchema),
  duplicates: Schema.Array(DuplicateSchema),
})
export type DedupResult = typeof DedupResultSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Cycle Config
// =============================================================================

/** Configuration for a cycle scan run. */
export const CycleConfigSchema = Schema.Struct({
  taskPrompt: Schema.String,
  scanPrompt: Schema.String,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  cycles: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  maxRounds: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  agents: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  model: Schema.optional(Schema.String),
  fix: Schema.optional(Schema.Boolean),
  scanOnly: Schema.optional(Schema.Boolean),
  dryRun: Schema.optional(Schema.Boolean),
  score: Schema.optional(Schema.Number.pipe(Schema.int())),
})
export type CycleConfig = typeof CycleConfigSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Metrics
// =============================================================================

/** Metrics for a single round within a cycle. */
export const RoundMetricsSchema = Schema.Struct({
  cycle: Schema.Number.pipe(Schema.int()),
  round: Schema.Number.pipe(Schema.int()),
  loss: Schema.Number,
  newIssues: Schema.Number.pipe(Schema.int()),
  existingIssues: Schema.Number.pipe(Schema.int()),
  duplicates: Schema.Number.pipe(Schema.int()),
  high: Schema.Number.pipe(Schema.int()),
  medium: Schema.Number.pipe(Schema.int()),
  low: Schema.Number.pipe(Schema.int()),
})
export type RoundMetrics = typeof RoundMetricsSchema.Type

/** Result of a completed cycle. */
export const CycleResultSchema = Schema.Struct({
  cycleRunId: Schema.String,
  cycle: Schema.Number.pipe(Schema.int()),
  name: Schema.String,
  description: Schema.String,
  rounds: Schema.Number.pipe(Schema.int()),
  totalNewIssues: Schema.Number.pipe(Schema.int()),
  existingIssues: Schema.Number.pipe(Schema.int()),
  finalLoss: Schema.Number,
  converged: Schema.Boolean,
})
export type CycleResult = typeof CycleResultSchema.Type

// =============================================================================
// Progress Events (for CLI/UI callbacks)
// =============================================================================

export type CycleProgressEvent =
  | { type: "cycle_start"; cycle: number; totalCycles: number; name: string }
  | { type: "scan_complete"; cycle: number; round: number; findings: number; durationMs: number }
  | { type: "dedup_complete"; cycle: number; round: number; newIssues: number; duplicates: number }
  | { type: "round_loss"; cycle: number; round: number; loss: number; high: number; medium: number; low: number }
  | { type: "converged"; cycle: number; round: number }
  | { type: "cycle_complete"; result: CycleResult }
