// Effect Schema definitions for Worker Orchestration.
// See DD-018 for specification details.

import { Schema } from "effect"

// ----- Worker Schemas -----

// WorkerStatus schema
export const WorkerStatusSchema = Schema.Literal(
  "starting",
  "idle",
  "busy",
  "stopping",
  "dead"
)
export type WorkerStatus = typeof WorkerStatusSchema.Type

// Worker schema
const WorkerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  hostname: Schema.String,
  pid: Schema.Number.pipe(Schema.int()),
  status: WorkerStatusSchema,
  registeredAt: Schema.Date,
  lastHeartbeatAt: Schema.Date,
  currentTaskId: Schema.NullOr(Schema.String),
  capabilities: Schema.Array(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})
export { WorkerSchema as Worker }
export type Worker = typeof WorkerSchema.Type

// ----- Claim Schemas -----

// ClaimStatus schema
export const ClaimStatusSchema = Schema.Literal(
  "active",
  "released",
  "expired",
  "completed"
)
export type ClaimStatus = typeof ClaimStatusSchema.Type

// TaskClaim schema
const TaskClaimSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  taskId: Schema.String,
  workerId: Schema.String,
  claimedAt: Schema.Date,
  leaseExpiresAt: Schema.Date,
  renewedCount: Schema.Number.pipe(Schema.int()),
  status: ClaimStatusSchema
})
export { TaskClaimSchema as TaskClaim }
export type TaskClaim = typeof TaskClaimSchema.Type

// ----- Orchestrator Schemas -----

// OrchestratorStatus schema
export const OrchestratorStatusSchema = Schema.Literal(
  "stopped",
  "starting",
  "running",
  "stopping"
)
export type OrchestratorStatus = typeof OrchestratorStatusSchema.Type

// OrchestratorState schema
const OrchestratorStateSchema = Schema.Struct({
  status: OrchestratorStatusSchema,
  pid: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  startedAt: Schema.NullOr(Schema.Date),
  lastReconcileAt: Schema.NullOr(Schema.Date),
  workerPoolSize: Schema.Number.pipe(Schema.int()),
  reconcileIntervalSeconds: Schema.Number.pipe(Schema.int()),
  heartbeatIntervalSeconds: Schema.Number.pipe(Schema.int()),
  leaseDurationMinutes: Schema.Number.pipe(Schema.int()),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})
export { OrchestratorStateSchema as OrchestratorState }
export type OrchestratorState = typeof OrchestratorStateSchema.Type

// ----- Heartbeat Schema -----

// HeartbeatMetrics schema
const HeartbeatMetricsSchema = Schema.Struct({
  cpuPercent: Schema.Number,
  memoryMb: Schema.Number,
  tasksCompleted: Schema.Number.pipe(Schema.int())
})
export { HeartbeatMetricsSchema as HeartbeatMetrics }
export type HeartbeatMetrics = typeof HeartbeatMetricsSchema.Type

// HeartbeatStatus schema (subset of WorkerStatus for heartbeat context)
export const HeartbeatStatusSchema = Schema.Literal("idle", "busy")
export type HeartbeatStatus = typeof HeartbeatStatusSchema.Type

// Heartbeat schema
const HeartbeatSchema = Schema.Struct({
  workerId: Schema.String,
  timestamp: Schema.Date,
  status: HeartbeatStatusSchema,
  currentTaskId: Schema.optional(Schema.String),
  metrics: Schema.optional(HeartbeatMetricsSchema)
})
export { HeartbeatSchema as Heartbeat }
export type Heartbeat = typeof HeartbeatSchema.Type

// ----- Reconciliation Schema -----

// ReconciliationResult schema
const ReconciliationResultSchema = Schema.Struct({
  deadWorkersFound: Schema.Number.pipe(Schema.int()),
  expiredClaimsReleased: Schema.Number.pipe(Schema.int()),
  orphanedTasksRecovered: Schema.Number.pipe(Schema.int()),
  staleStatesFixed: Schema.Number.pipe(Schema.int()),
  reconcileTime: Schema.Number.pipe(Schema.int())
})
export { ReconciliationResultSchema as ReconciliationResult }
export type ReconciliationResult = typeof ReconciliationResultSchema.Type
