/**
 * Anchor factory for creating test anchor data.
 *
 * Anchors link learnings to specific file locations, symbols, or code regions.
 *
 * @module @tx/test-utils/factories/anchor
 */

import type {
  Anchor,
  AnchorId,
  AnchorType,
  AnchorStatus
} from "@jamesaphoenix/tx-types"
import type { TestDatabase } from "../database/index.js"

/**
 * Options for creating a test anchor.
 */
export interface CreateAnchorOptions {
  /** Anchor ID (auto-generated if not provided) */
  id?: number
  /** ID of the learning this anchor belongs to */
  learningId: number
  /** Type of anchor (glob, hash, symbol, line_range) */
  anchorType?: AnchorType
  /** The anchor value (pattern, hash, symbol name, etc.) */
  anchorValue?: string
  /** File path the anchor points to */
  filePath?: string
  /** Fully qualified symbol name (for symbol anchors) */
  symbolFqname?: string | null
  /** Start line (for line_range anchors) */
  lineStart?: number | null
  /** End line (for line_range anchors) */
  lineEnd?: number | null
  /** Content hash (for hash anchors) */
  contentHash?: string | null
  /** Content preview for self-healing comparison */
  contentPreview?: string | null
  /** Anchor status (valid, drifted, invalid) */
  status?: AnchorStatus
  /** Whether anchor is pinned (prevents auto-invalidation) */
  pinned?: boolean
  /** Last verification timestamp */
  verifiedAt?: Date | null
  /** Creation timestamp */
  createdAt?: Date
}

/**
 * Factory class for creating test anchors.
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const factory = new AnchorFactory(db)
 *
 * // Create symbol anchor
 * const anchor = factory.symbolAnchor(1, 'src/service.ts', 'handleRequest')
 *
 * // Create glob anchor
 * const glob = factory.globAnchor(1, 'src/repo/*.ts')
 *
 * // Create line range anchor
 * const lines = factory.lineRangeAnchor(1, 'src/service.ts', 10, 25)
 * ```
 */
export class AnchorFactory {
  private counter = 0
  private readonly db: TestDatabase

  constructor(db: TestDatabase) {
    this.db = db
  }

  /**
   * Create a single test anchor.
   */
  create(options: CreateAnchorOptions): Anchor {
    this.counter++
    const now = new Date()

    const id = options.id ?? this.counter
    const learningId = options.learningId
    const anchorType = options.anchorType ?? "symbol"
    const anchorValue = options.anchorValue ?? `anchor-${this.counter}`
    const filePath = options.filePath ?? "src/test.ts"
    const symbolFqname = options.symbolFqname ?? null
    const lineStart = options.lineStart ?? null
    const lineEnd = options.lineEnd ?? null
    const contentHash = options.contentHash ?? null
    const contentPreview = options.contentPreview ?? null
    const status = options.status ?? "valid"
    const pinned = options.pinned ?? false
    const verifiedAt = options.verifiedAt ?? null
    const createdAt = options.createdAt ?? now

    this.db.run(
      `INSERT INTO learning_anchors (id, learning_id, anchor_type, anchor_value, file_path, symbol_fqname, line_start, line_end, content_hash, content_preview, status, pinned, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        learningId,
        anchorType,
        anchorValue,
        filePath,
        symbolFqname,
        lineStart,
        lineEnd,
        contentHash,
        contentPreview,
        status,
        pinned ? 1 : 0,
        verifiedAt ? verifiedAt.toISOString() : null,
        createdAt.toISOString()
      ]
    )

    return {
      id: id as AnchorId,
      learningId,
      anchorType,
      anchorValue,
      filePath,
      symbolFqname,
      lineStart,
      lineEnd,
      contentHash,
      contentPreview,
      status,
      pinned,
      verifiedAt,
      createdAt
    }
  }

  /**
   * Create multiple test anchors.
   */
  createMany(count: number, baseOptions: CreateAnchorOptions): Anchor[] {
    const anchors: Anchor[] = []
    for (let i = 0; i < count; i++) {
      anchors.push(this.create({
        ...baseOptions,
        anchorValue: baseOptions.anchorValue
          ? `${baseOptions.anchorValue}-${i + 1}`
          : undefined
      }))
    }
    return anchors
  }

  /**
   * Create a symbol anchor pointing to a function/class/method.
   */
  symbolAnchor(
    learningId: number,
    filePath: string,
    symbolName: string,
    options: Partial<CreateAnchorOptions> = {}
  ): Anchor {
    const fqname = `${filePath}::${symbolName}`
    return this.create({
      ...options,
      learningId,
      anchorType: "symbol",
      anchorValue: symbolName,
      filePath,
      symbolFqname: fqname
    })
  }

  /**
   * Create a glob pattern anchor.
   */
  globAnchor(
    learningId: number,
    pattern: string,
    options: Partial<CreateAnchorOptions> = {}
  ): Anchor {
    return this.create({
      ...options,
      learningId,
      anchorType: "glob",
      anchorValue: pattern,
      filePath: pattern
    })
  }

  /**
   * Create a line range anchor.
   */
  lineRangeAnchor(
    learningId: number,
    filePath: string,
    lineStart: number,
    lineEnd: number,
    options: Partial<CreateAnchorOptions> = {}
  ): Anchor {
    return this.create({
      ...options,
      learningId,
      anchorType: "line_range",
      anchorValue: `${lineStart}-${lineEnd}`,
      filePath,
      lineStart,
      lineEnd
    })
  }

  /**
   * Create a content hash anchor.
   */
  hashAnchor(
    learningId: number,
    filePath: string,
    contentHash: string,
    options: Partial<CreateAnchorOptions> = {}
  ): Anchor {
    return this.create({
      ...options,
      learningId,
      anchorType: "hash",
      anchorValue: contentHash,
      filePath,
      contentHash
    })
  }

  /**
   * Create an anchor with drifted status (code changed).
   */
  driftedAnchor(
    learningId: number,
    filePath: string,
    options: Partial<CreateAnchorOptions> = {}
  ): Anchor {
    return this.create({
      ...options,
      learningId,
      filePath,
      status: "drifted"
    })
  }

  /**
   * Create an anchor with invalid status (no longer exists).
   */
  invalidAnchor(
    learningId: number,
    filePath: string,
    options: Partial<CreateAnchorOptions> = {}
  ): Anchor {
    return this.create({
      ...options,
      learningId,
      filePath,
      status: "invalid"
    })
  }

  /**
   * Reset the internal counter.
   */
  reset(): void {
    this.counter = 0
  }
}

/**
 * Create a single test anchor (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const anchor = createTestAnchor(db, {
 *   learningId: 1,
 *   anchorType: 'symbol',
 *   anchorValue: 'handleRequest',
 *   filePath: 'src/service.ts'
 * })
 * ```
 */
export const createTestAnchor = (
  db: TestDatabase,
  options: CreateAnchorOptions
): Anchor => {
  const factory = new AnchorFactory(db)
  return factory.create(options)
}
