import { Schema } from "effect"
import { AgentRuntimeSchema } from "./cycle.js"
import { DocStableIdSchema } from "./doc.js"
import { TaskIdSchema, TaskWithDepsSchema } from "./task.js"

export const DecomposeDocSummarySchema = Schema.Struct({
  docId: DocStableIdSchema,
  name: Schema.String,
  title: Schema.String,
  kind: Schema.Literal("design"),
  filePath: Schema.String,
})
export type DecomposeDocSummary = typeof DecomposeDocSummarySchema.Type

export const DecomposeRootPreviewSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  score: Schema.Number.pipe(Schema.int()),
  existingParentTaskId: Schema.NullOr(TaskIdSchema),
})
export type DecomposeRootPreview = typeof DecomposeRootPreviewSchema.Type

export const DecompositionTaskSchema = Schema.Struct({
  localId: Schema.String,
  title: Schema.String,
  description: Schema.String,
  score: Schema.Number.pipe(Schema.int()),
  parentLocalId: Schema.NullOr(Schema.String),
  dependsOn: Schema.Array(Schema.String),
})
export type DecompositionTask = typeof DecompositionTaskSchema.Type

export const DecompositionPlanSchema = Schema.Struct({
  rootTask: Schema.Struct({
    title: Schema.String,
    description: Schema.String,
    score: Schema.Number.pipe(Schema.int()),
  }),
  tasks: Schema.Array(DecompositionTaskSchema),
  rationale: Schema.optional(Schema.String),
})
export type DecompositionPlan = typeof DecompositionPlanSchema.Type

export const DecomposeRequestSchema = Schema.Struct({
  docRef: Schema.String,
  parentTaskId: Schema.optional(Schema.NullOr(TaskIdSchema)),
  runtime: Schema.optional(AgentRuntimeSchema),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  maxTasks: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  rootTitle: Schema.optional(Schema.NullOr(Schema.String)),
  rootScore: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
  dryRun: Schema.optional(Schema.Boolean),
})
export type DecomposeRequest = typeof DecomposeRequestSchema.Type

export const MaterializedDecomposeTaskSchema = Schema.Struct({
  localId: Schema.String,
  taskId: TaskIdSchema,
  title: Schema.String,
  parentTaskId: TaskIdSchema,
  dependsOn: Schema.Array(Schema.String),
  score: Schema.Number.pipe(Schema.int()),
})
export type MaterializedDecomposeTask = typeof MaterializedDecomposeTaskSchema.Type

export const DecomposeResultSchema = Schema.Struct({
  dryRun: Schema.Boolean,
  runtime: AgentRuntimeSchema,
  model: Schema.NullOr(Schema.String),
  doc: DecomposeDocSummarySchema,
  parentTaskId: Schema.NullOr(TaskIdSchema),
  rootTaskPreview: DecomposeRootPreviewSchema,
  rootTask: Schema.NullOr(TaskWithDepsSchema),
  plan: DecompositionPlanSchema,
  createdTasks: Schema.Array(MaterializedDecomposeTaskSchema),
  rationale: Schema.NullOr(Schema.String),
})
export type DecomposeResult = typeof DecomposeResultSchema.Type
