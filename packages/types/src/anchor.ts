/**
 * Anchor types for tx
 *
 * Type definitions for file/code associations (anchors) that link learnings
 * to specific file locations, symbols, or code regions.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Anchor type - how the learning is associated with code.
 * - glob: Pattern match (e.g., "src/repo/*.ts")
 * - hash: Content hash of specific lines
 * - symbol: Named code element (function, class, etc.)
 * - line_range: Specific line numbers
 */
export const ANCHOR_TYPES = ["glob", "hash", "symbol", "line_range"] as const;

/**
 * Anchor status - validity of the file/code association.
 * - valid: Anchor still points to correct code
 * - drifted: Code has changed but anchor still exists
 * - invalid: Anchor no longer valid (file deleted, symbol removed)
 */
export const ANCHOR_STATUSES = ["valid", "drifted", "invalid"] as const;

/**
 * Detection source for invalidation.
 */
export const INVALIDATION_SOURCES = ["periodic", "lazy", "manual", "agent", "git_hook"] as const;

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Anchor ID - branded integer. */
export const AnchorIdSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("AnchorId")
)
export type AnchorId = typeof AnchorIdSchema.Type

/** Anchor type schema. */
export const AnchorTypeSchema = Schema.Literal(...ANCHOR_TYPES)
export type AnchorType = typeof AnchorTypeSchema.Type

/** Anchor status schema. */
export const AnchorStatusSchema = Schema.Literal(...ANCHOR_STATUSES)
export type AnchorStatus = typeof AnchorStatusSchema.Type

/** Invalidation source schema. */
export const InvalidationSourceSchema = Schema.Literal(...INVALIDATION_SOURCES)
export type InvalidationSource = typeof InvalidationSourceSchema.Type

/** Anchor entity - links a learning to a file/code location. */
export const AnchorSchema = Schema.Struct({
  id: AnchorIdSchema,
  learningId: Schema.Number.pipe(Schema.int()),
  anchorType: AnchorTypeSchema,
  anchorValue: Schema.String,
  filePath: Schema.String,
  symbolFqname: Schema.NullOr(Schema.String),
  lineStart: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  lineEnd: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  contentHash: Schema.NullOr(Schema.String),
  /** Original content preview for self-healing Jaccard similarity comparison */
  contentPreview: Schema.NullOr(Schema.String),
  status: AnchorStatusSchema,
  pinned: Schema.Boolean,
  verifiedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf,
})
export type Anchor = typeof AnchorSchema.Type

/** Input for creating a new anchor. */
export const CreateAnchorInputSchema = Schema.Struct({
  learningId: Schema.Number.pipe(Schema.int()),
  anchorType: AnchorTypeSchema,
  anchorValue: Schema.String,
  filePath: Schema.String,
  symbolFqname: Schema.optional(Schema.NullOr(Schema.String)),
  lineStart: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
  lineEnd: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
  contentHash: Schema.optional(Schema.NullOr(Schema.String)),
  /** Original content preview for self-healing comparison (max ~500 chars) */
  contentPreview: Schema.optional(Schema.NullOr(Schema.String)),
})
export type CreateAnchorInput = typeof CreateAnchorInputSchema.Type

/** Input for updating an anchor. */
export const UpdateAnchorInputSchema = Schema.Struct({
  anchorValue: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
  symbolFqname: Schema.optional(Schema.NullOr(Schema.String)),
  lineStart: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
  lineEnd: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
  contentHash: Schema.optional(Schema.NullOr(Schema.String)),
  /** Updated content preview for self-healing comparison */
  contentPreview: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(AnchorStatusSchema),
  verifiedAt: Schema.optional(Schema.NullOr(Schema.DateFromSelf)),
})
export type UpdateAnchorInput = typeof UpdateAnchorInputSchema.Type

/** Invalidation log entry - tracks anchor status changes. */
export const InvalidationLogSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int()),
  anchorId: Schema.Number.pipe(Schema.int()),
  oldStatus: AnchorStatusSchema,
  newStatus: AnchorStatusSchema,
  reason: Schema.String,
  detectedBy: InvalidationSourceSchema,
  oldContentHash: Schema.NullOr(Schema.String),
  newContentHash: Schema.NullOr(Schema.String),
  similarityScore: Schema.NullOr(Schema.Number),
  invalidatedAt: Schema.DateFromSelf,
})
export type InvalidationLog = typeof InvalidationLogSchema.Type

/**
 * Anchor with freshness information for lazy verification.
 * Returned by getWithVerification - includes whether anchor was fresh or verified.
 */
export interface AnchorWithFreshness {
  readonly anchor: Anchor;
  /** True if anchor was still within TTL, false if verification was needed */
  readonly isFresh: boolean;
  /** True if verification was performed (because anchor was stale) */
  readonly wasVerified: boolean;
  /** Verification result if verification was performed */
  readonly verificationResult?: {
    readonly previousStatus: AnchorStatus;
    readonly newStatus: AnchorStatus;
    readonly action: "unchanged" | "self_healed" | "drifted" | "invalidated";
    readonly reason?: string;
  };
}

// =============================================================================
// DATABASE ROW TYPES (internal, not domain types)
// =============================================================================

/** Database row type for anchors (snake_case from SQLite). */
export interface AnchorRow {
  id: number;
  learning_id: number;
  anchor_type: string;
  anchor_value: string;
  file_path: string;
  symbol_fqname: string | null;
  line_start: number | null;
  line_end: number | null;
  content_hash: string | null;
  content_preview: string | null;
  status: string;
  pinned: number;
  verified_at: string | null;
  created_at: string;
}

/** Database row type for invalidation log (snake_case from SQLite). */
export interface InvalidationLogRow {
  id: number;
  anchor_id: number;
  old_status: string;
  new_status: string;
  reason: string;
  detected_by: string;
  old_content_hash: string | null;
  new_content_hash: string | null;
  similarity_score: number | null;
  invalidated_at: string;
}
