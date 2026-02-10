/**
 * Doc types for tx
 *
 * Type definitions for the docs-as-primitives system.
 * See DD-023 for specification.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 *
 * Docs are structured YAML (source of truth) with rendered MD views.
 * YAML content lives on disk (.tx/docs/); DB stores metadata + links only.
 */
import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

export const DOC_KINDS = ["overview", "prd", "design"] as const
export const DOC_STATUSES = ["changing", "locked"] as const
export const DOC_LINK_TYPES = [
  "overview_to_prd",
  "overview_to_design",
  "prd_to_design",
  "design_patch",
] as const
export const TASK_DOC_LINK_TYPES = ["implements", "references"] as const
export const INVARIANT_ENFORCEMENT_TYPES = [
  "integration_test",
  "linter",
  "llm_as_judge",
] as const
export const INVARIANT_STATUSES = ["active", "deprecated"] as const

// =============================================================================
// SCHEMAS & TYPES — Docs
// =============================================================================

/** Doc kind — overview (one per project), prd, or design. */
export const DocKindSchema = Schema.Literal(...DOC_KINDS)
export type DocKind = typeof DocKindSchema.Type

/** Doc status — changing (editable) or locked (immutable). */
export const DocStatusSchema = Schema.Literal(...DOC_STATUSES)
export type DocStatus = typeof DocStatusSchema.Type

/** Doc link type — directed edge between docs in the DAG. */
export const DocLinkTypeSchema = Schema.Literal(...DOC_LINK_TYPES)
export type DocLinkType = typeof DocLinkTypeSchema.Type

/** Task-doc link type — how a task relates to a doc. */
export const TaskDocLinkTypeSchema = Schema.Literal(...TASK_DOC_LINK_TYPES)
export type TaskDocLinkType = typeof TaskDocLinkTypeSchema.Type

/** Doc ID — branded integer. */
export const DocIdSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("DocId")
)
export type DocId = typeof DocIdSchema.Type

/** Core doc entity (DB metadata — YAML content lives on disk only). */
export const DocSchema = Schema.Struct({
  id: DocIdSchema,
  hash: Schema.String,
  kind: DocKindSchema,
  name: Schema.String,
  title: Schema.String,
  version: Schema.Number.pipe(Schema.int()),
  status: DocStatusSchema,
  filePath: Schema.String,
  parentDocId: Schema.NullOr(DocIdSchema),
  createdAt: Schema.DateFromSelf,
  lockedAt: Schema.NullOr(Schema.DateFromSelf),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type Doc = typeof DocSchema.Type

/** Doc with resolved links (for API responses). */
export const DocWithLinksSchema = Schema.Struct({
  ...DocSchema.fields,
  linksTo: Schema.Array(
    Schema.Struct({
      docId: DocIdSchema,
      docName: Schema.String,
      linkType: DocLinkTypeSchema,
    })
  ),
  linksFrom: Schema.Array(
    Schema.Struct({
      docId: DocIdSchema,
      docName: Schema.String,
      linkType: DocLinkTypeSchema,
    })
  ),
  taskIds: Schema.Array(Schema.String),
  invariantCount: Schema.Number.pipe(Schema.int()),
})
export type DocWithLinks = typeof DocWithLinksSchema.Type

/** Doc link entity. */
export const DocLinkSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  fromDocId: DocIdSchema,
  toDocId: DocIdSchema,
  linkType: DocLinkTypeSchema,
  createdAt: Schema.DateFromSelf,
})
export type DocLink = typeof DocLinkSchema.Type

/** Task-doc link entity. */
export const TaskDocLinkSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  taskId: Schema.String,
  docId: DocIdSchema,
  linkType: TaskDocLinkTypeSchema,
  createdAt: Schema.DateFromSelf,
})
export type TaskDocLink = typeof TaskDocLinkSchema.Type

/** Input for creating a new doc. */
export const CreateDocInputSchema = Schema.Struct({
  kind: DocKindSchema,
  name: Schema.String,
  title: Schema.String,
  yamlContent: Schema.String,
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown })
  ),
})
export type CreateDocInput = typeof CreateDocInputSchema.Type

// =============================================================================
// SCHEMAS & TYPES — Invariants
// =============================================================================

/** Invariant enforcement type — how the invariant is verified. */
export const InvariantEnforcementSchema = Schema.Literal(
  ...INVARIANT_ENFORCEMENT_TYPES
)
export type InvariantEnforcement = typeof InvariantEnforcementSchema.Type

/** Invariant status. */
export const InvariantStatusSchema = Schema.Literal(...INVARIANT_STATUSES)
export type InvariantStatus = typeof InvariantStatusSchema.Type

/** Invariant ID — branded string matching INV-[A-Z0-9-]+. */
export const InvariantIdSchema = Schema.String.pipe(
  Schema.pattern(/^INV-[A-Z0-9-]+$/),
  Schema.brand("InvariantId")
)
export type InvariantId = typeof InvariantIdSchema.Type

/** Invariant entity — a machine-checkable system rule. */
export const InvariantSchema = Schema.Struct({
  id: InvariantIdSchema,
  rule: Schema.String,
  enforcement: InvariantEnforcementSchema,
  docId: DocIdSchema,
  subsystem: Schema.NullOr(Schema.String),
  testRef: Schema.NullOr(Schema.String),
  lintRule: Schema.NullOr(Schema.String),
  promptRef: Schema.NullOr(Schema.String),
  status: InvariantStatusSchema,
  createdAt: Schema.DateFromSelf,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type Invariant = typeof InvariantSchema.Type

/** Invariant check result — audit trail entry. */
export const InvariantCheckSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  invariantId: InvariantIdSchema,
  passed: Schema.Boolean,
  details: Schema.NullOr(Schema.String),
  checkedAt: Schema.DateFromSelf,
  durationMs: Schema.NullOr(Schema.Number.pipe(Schema.int())),
})
export type InvariantCheck = typeof InvariantCheckSchema.Type

/** Input for upserting an invariant (from YAML sync). */
export const UpsertInvariantInputSchema = Schema.Struct({
  id: Schema.String,
  rule: Schema.String,
  enforcement: InvariantEnforcementSchema,
  docId: DocIdSchema,
  subsystem: Schema.optional(Schema.NullOr(Schema.String)),
  testRef: Schema.optional(Schema.NullOr(Schema.String)),
  lintRule: Schema.optional(Schema.NullOr(Schema.String)),
  promptRef: Schema.optional(Schema.NullOr(Schema.String)),
})
export type UpsertInvariantInput = typeof UpsertInvariantInputSchema.Type

/** Input for recording an invariant check. */
export const RecordInvariantCheckInputSchema = Schema.Struct({
  invariantId: Schema.String,
  passed: Schema.Boolean,
  details: Schema.optional(Schema.NullOr(Schema.String)),
  durationMs: Schema.optional(
    Schema.NullOr(Schema.Number.pipe(Schema.int()))
  ),
})
export type RecordInvariantCheckInput =
  typeof RecordInvariantCheckInputSchema.Type

// =============================================================================
// RUNTIME VALIDATORS
// =============================================================================

/**
 * Check if a string is a valid doc kind.
 */
export const isValidDocKind = (kind: string): kind is DocKind => {
  return (DOC_KINDS as readonly string[]).includes(kind)
}

export class InvalidDocKindError extends Error {
  readonly kind: string
  constructor(kind: string) {
    super(`Invalid doc kind: "${kind}". Valid kinds: ${DOC_KINDS.join(", ")}`)
    this.kind = kind
    this.name = "InvalidDocKindError"
  }
}

export const assertDocKind = (kind: string): DocKind => {
  if (!isValidDocKind(kind)) {
    throw new InvalidDocKindError(kind)
  }
  return kind
}

/**
 * Check if a string is a valid doc status.
 */
export const isValidDocStatus = (status: string): status is DocStatus => {
  return (DOC_STATUSES as readonly string[]).includes(status)
}

export class InvalidDocStatusError extends Error {
  readonly status: string
  constructor(status: string) {
    super(
      `Invalid doc status: "${status}". Valid statuses: ${DOC_STATUSES.join(", ")}`
    )
    this.status = status
    this.name = "InvalidDocStatusError"
  }
}

export const assertDocStatus = (status: string): DocStatus => {
  if (!isValidDocStatus(status)) {
    throw new InvalidDocStatusError(status)
  }
  return status
}

/**
 * Check if a string is a valid doc link type.
 */
export const isValidDocLinkType = (linkType: string): linkType is DocLinkType => {
  return (DOC_LINK_TYPES as readonly string[]).includes(linkType)
}

export class InvalidDocLinkTypeError extends Error {
  readonly linkType: string
  constructor(linkType: string) {
    super(
      `Invalid doc link type: "${linkType}". Valid types: ${DOC_LINK_TYPES.join(", ")}`
    )
    this.linkType = linkType
    this.name = "InvalidDocLinkTypeError"
  }
}

export const assertDocLinkType = (linkType: string): DocLinkType => {
  if (!isValidDocLinkType(linkType)) {
    throw new InvalidDocLinkTypeError(linkType)
  }
  return linkType
}

// =============================================================================
// GRAPH TYPES (for dashboard viewer)
// =============================================================================

/** Node in the doc graph. */
export const DocGraphNodeSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literal("overview", "prd", "design", "task"),
  status: Schema.optional(Schema.String),
})
export type DocGraphNode = typeof DocGraphNodeSchema.Type

/** Edge in the doc graph. */
export const DocGraphEdgeSchema = Schema.Struct({
  source: Schema.String,
  target: Schema.String,
  type: Schema.String,
})
export type DocGraphEdge = typeof DocGraphEdgeSchema.Type

/** Full doc graph (nodes + edges). */
export const DocGraphSchema = Schema.Struct({
  nodes: Schema.Array(DocGraphNodeSchema),
  edges: Schema.Array(DocGraphEdgeSchema),
})
export type DocGraph = typeof DocGraphSchema.Type

// =============================================================================
// DATABASE ROW TYPES (snake_case from SQLite)
// =============================================================================

/** Database row type for docs (snake_case from SQLite). */
export interface DocRow {
  id: number
  hash: string
  kind: string
  name: string
  title: string
  version: number
  status: string
  file_path: string
  parent_doc_id: number | null
  created_at: string
  locked_at: string | null
  metadata: string | null
}

/** Database row type for doc links. */
export interface DocLinkRow {
  id: number
  from_doc_id: number
  to_doc_id: number
  link_type: string
  created_at: string
}

/** Database row type for task-doc links. */
export interface TaskDocLinkRow {
  id: number
  task_id: string
  doc_id: number
  link_type: string
  created_at: string
}

/** Database row type for invariants. */
export interface InvariantRow {
  id: string
  rule: string
  enforcement: string
  doc_id: number
  subsystem: string | null
  test_ref: string | null
  lint_rule: string | null
  prompt_ref: string | null
  status: string
  created_at: string
  metadata: string | null
}

/** Database row type for invariant checks. */
export interface InvariantCheckRow {
  id: number
  invariant_id: string
  passed: number
  details: string | null
  checked_at: string
  duration_ms: number | null
}
