// Anchor types for file/code associations
// See PRD-014 for specification

export type AnchorId = number & { readonly _brand: unique symbol }

export const ANCHOR_TYPES = ["glob", "hash", "symbol", "line_range"] as const
export type AnchorType = (typeof ANCHOR_TYPES)[number]

export const ANCHOR_STATUSES = ["valid", "drifted", "invalid"] as const
export type AnchorStatus = (typeof ANCHOR_STATUSES)[number]

export interface Anchor {
  readonly id: AnchorId
  readonly learningId: number
  readonly anchorType: AnchorType
  readonly anchorValue: string
  readonly filePath: string
  readonly symbolFqname: string | null
  readonly lineStart: number | null
  readonly lineEnd: number | null
  readonly contentHash: string | null
  readonly status: AnchorStatus
  readonly verifiedAt: Date | null
  readonly createdAt: Date
}

export interface CreateAnchorInput {
  readonly learningId: number
  readonly anchorType: AnchorType
  readonly anchorValue: string
  readonly filePath: string
  readonly symbolFqname?: string | null
  readonly lineStart?: number | null
  readonly lineEnd?: number | null
  readonly contentHash?: string | null
}

export interface UpdateAnchorInput {
  readonly anchorValue?: string
  readonly filePath?: string
  readonly symbolFqname?: string | null
  readonly lineStart?: number | null
  readonly lineEnd?: number | null
  readonly contentHash?: string | null
  readonly status?: AnchorStatus
  readonly verifiedAt?: Date | null
}

// DB row type (snake_case from SQLite)
export interface AnchorRow {
  id: number
  learning_id: number
  anchor_type: string
  anchor_value: string
  file_path: string
  symbol_fqname: string | null
  line_start: number | null
  line_end: number | null
  content_hash: string | null
  status: string
  verified_at: string | null
  created_at: string
}

export const rowToAnchor = (row: AnchorRow): Anchor => ({
  id: row.id as AnchorId,
  learningId: row.learning_id,
  anchorType: row.anchor_type as AnchorType,
  anchorValue: row.anchor_value,
  filePath: row.file_path,
  symbolFqname: row.symbol_fqname,
  lineStart: row.line_start,
  lineEnd: row.line_end,
  contentHash: row.content_hash,
  status: row.status as AnchorStatus,
  verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
  createdAt: new Date(row.created_at)
})
