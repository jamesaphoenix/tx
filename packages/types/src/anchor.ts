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
  readonly status: AnchorStatus;
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
  status: string;
  verified_at: string | null;
  created_at: string;
}
