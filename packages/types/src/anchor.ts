/**
 * Anchor types for tx
 *
 * Type definitions for file/code associations (anchors) that link learnings
 * to specific file locations, symbols, or code regions.
 * Zero runtime dependencies - pure TypeScript types only.
 */

/**
 * Branded type for anchor IDs.
 */
export type AnchorId = number & { readonly _brand: unique symbol };

/**
 * Anchor type - how the learning is associated with code.
 * - glob: Pattern match (e.g., "src/repo/*.ts")
 * - hash: Content hash of specific lines
 * - symbol: Named code element (function, class, etc.)
 * - line_range: Specific line numbers
 */
export const ANCHOR_TYPES = ["glob", "hash", "symbol", "line_range"] as const;
export type AnchorType = (typeof ANCHOR_TYPES)[number];

/**
 * Anchor status - validity of the file/code association.
 * - valid: Anchor still points to correct code
 * - drifted: Code has changed but anchor still exists
 * - invalid: Anchor no longer valid (file deleted, symbol removed)
 */
export const ANCHOR_STATUSES = ["valid", "drifted", "invalid"] as const;
export type AnchorStatus = (typeof ANCHOR_STATUSES)[number];

/**
 * Anchor entity - links a learning to a file/code location.
 */
export interface Anchor {
  readonly id: AnchorId;
  readonly learningId: number;
  readonly anchorType: AnchorType;
  readonly anchorValue: string;
  readonly filePath: string;
  readonly symbolFqname: string | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly contentHash: string | null;
  /** Original content preview for self-healing Jaccard similarity comparison */
  readonly contentPreview: string | null;
  readonly status: AnchorStatus;
  readonly pinned: boolean;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Input for creating a new anchor.
 */
export interface CreateAnchorInput {
  readonly learningId: number;
  readonly anchorType: AnchorType;
  readonly anchorValue: string;
  readonly filePath: string;
  readonly symbolFqname?: string | null;
  readonly lineStart?: number | null;
  readonly lineEnd?: number | null;
  readonly contentHash?: string | null;
  /** Original content preview for self-healing comparison (max ~500 chars) */
  readonly contentPreview?: string | null;
}

/**
 * Input for updating an anchor.
 */
export interface UpdateAnchorInput {
  readonly anchorValue?: string;
  readonly filePath?: string;
  readonly symbolFqname?: string | null;
  readonly lineStart?: number | null;
  readonly lineEnd?: number | null;
  readonly contentHash?: string | null;
  /** Updated content preview for self-healing comparison */
  readonly contentPreview?: string | null;
  readonly status?: AnchorStatus;
  readonly verifiedAt?: Date | null;
}

/**
 * Database row type for anchors (snake_case from SQLite).
 */
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

/**
 * Detection source for invalidation.
 */
export const INVALIDATION_SOURCES = ["periodic", "lazy", "manual", "agent", "git_hook"] as const;
export type InvalidationSource = (typeof INVALIDATION_SOURCES)[number];

/**
 * Invalidation log entry - tracks anchor status changes.
 */
export interface InvalidationLog {
  readonly id: number;
  readonly anchorId: number;
  readonly oldStatus: AnchorStatus;
  readonly newStatus: AnchorStatus;
  readonly reason: string;
  readonly detectedBy: InvalidationSource;
  readonly oldContentHash: string | null;
  readonly newContentHash: string | null;
  readonly similarityScore: number | null;
  readonly invalidatedAt: Date;
}

/**
 * Database row type for invalidation log (snake_case from SQLite).
 */
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
