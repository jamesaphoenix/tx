/**
 * Edge factory for creating test graph edge data.
 *
 * @module @tx/test-utils/factories/edge
 */

import type {
  Edge,
  EdgeId,
  EdgeType,
  NodeType
} from "@tx/types"
import type { TestDatabase } from "../database/index.js"

/**
 * Options for creating a test edge.
 */
export interface CreateEdgeOptions {
  /** Edge ID (auto-generated if not provided) */
  id?: number
  /** Type of edge relationship */
  edgeType?: EdgeType
  /** Source node type */
  sourceType?: NodeType
  /** Source node ID */
  sourceId?: string
  /** Target node type */
  targetType?: NodeType
  /** Target node ID */
  targetId?: string
  /** Edge weight (0-1) */
  weight?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Creation timestamp */
  createdAt?: Date
  /** Invalidation timestamp (null if active) */
  invalidatedAt?: Date | null
}

/**
 * Factory class for creating test graph edges.
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const factory = new EdgeFactory(db)
 *
 * // Create edge between two learnings
 * const edge = factory.betweenLearnings(1, 2, 'SIMILAR_TO', 0.85)
 *
 * // Create anchor edge from learning to file
 * const anchor = factory.anchorToFile(1, 'src/service.ts')
 *
 * // Create custom edge
 * const custom = factory.create({
 *   edgeType: 'DERIVED_FROM',
 *   sourceType: 'learning',
 *   sourceId: '1',
 *   targetType: 'run',
 *   targetId: 'run-123'
 * })
 * ```
 */
export class EdgeFactory {
  private counter = 0
  private readonly db: TestDatabase

  constructor(db: TestDatabase) {
    this.db = db
  }

  /**
   * Create a single test edge.
   */
  create(options: CreateEdgeOptions = {}): Edge {
    this.counter++
    const now = new Date()

    const id = options.id ?? this.counter
    const edgeType = options.edgeType ?? "SIMILAR_TO"
    const sourceType = options.sourceType ?? "learning"
    const sourceId = options.sourceId ?? String(this.counter)
    const targetType = options.targetType ?? "learning"
    const targetId = options.targetId ?? String(this.counter + 1)
    const weight = options.weight ?? 1.0
    const metadata = options.metadata ?? {}
    const createdAt = options.createdAt ?? now
    const invalidatedAt = options.invalidatedAt ?? null

    this.db.exec(`
      INSERT INTO learning_edges (id, edge_type, source_type, source_id, target_type, target_id, weight, metadata, created_at, invalidated_at)
      VALUES (
        ${id},
        '${edgeType}',
        '${sourceType}',
        '${sourceId}',
        '${targetType}',
        '${targetId}',
        ${weight},
        '${JSON.stringify(metadata).replace(/'/g, "''")}',
        '${createdAt.toISOString()}',
        ${invalidatedAt ? `'${invalidatedAt.toISOString()}'` : "NULL"}
      )
    `)

    return {
      id: id as EdgeId,
      edgeType,
      sourceType,
      sourceId,
      targetType,
      targetId,
      weight,
      metadata,
      createdAt,
      invalidatedAt
    }
  }

  /**
   * Create multiple test edges.
   */
  createMany(count: number, options: CreateEdgeOptions = {}): Edge[] {
    const edges: Edge[] = []
    for (let i = 0; i < count; i++) {
      edges.push(this.create(options))
    }
    return edges
  }

  /**
   * Create an edge between two learnings.
   */
  betweenLearnings(
    sourceId: number | string,
    targetId: number | string,
    edgeType: EdgeType = "SIMILAR_TO",
    weight = 1.0
  ): Edge {
    return this.create({
      edgeType,
      sourceType: "learning",
      sourceId: String(sourceId),
      targetType: "learning",
      targetId: String(targetId),
      weight
    })
  }

  /**
   * Create an anchor edge from learning to file.
   */
  anchorToFile(learningId: number | string, filePath: string, weight = 1.0): Edge {
    return this.create({
      edgeType: "ANCHORED_TO",
      sourceType: "learning",
      sourceId: String(learningId),
      targetType: "file",
      targetId: filePath,
      weight
    })
  }

  /**
   * Create a derivation edge from learning to run.
   */
  derivedFromRun(learningId: number | string, runId: string, weight = 1.0): Edge {
    return this.create({
      edgeType: "DERIVED_FROM",
      sourceType: "learning",
      sourceId: String(learningId),
      targetType: "run",
      targetId: runId,
      weight
    })
  }

  /**
   * Create a usage edge from learning to run.
   */
  usedInRun(learningId: number | string, runId: string, weight = 1.0): Edge {
    return this.create({
      edgeType: "USED_IN_RUN",
      sourceType: "learning",
      sourceId: String(learningId),
      targetType: "run",
      targetId: runId,
      weight
    })
  }

  /**
   * Create an invalidation edge.
   */
  invalidatedBy(
    learningId: number | string,
    invalidatorId: number | string,
    weight = 1.0
  ): Edge {
    return this.create({
      edgeType: "INVALIDATED_BY",
      sourceType: "learning",
      sourceId: String(learningId),
      targetType: "learning",
      targetId: String(invalidatorId),
      weight
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
 * Create a single test edge (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const edge = createTestEdge(db, {
 *   edgeType: 'SIMILAR_TO',
 *   sourceId: '1',
 *   targetId: '2',
 *   weight: 0.9
 * })
 * ```
 */
export const createTestEdge = (
  db: TestDatabase,
  options: CreateEdgeOptions = {}
): Edge => {
  const factory = new EdgeFactory(db)
  return factory.create(options)
}

/**
 * Create an edge between two learnings (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const edge = createEdgeBetweenLearnings(db, 1, 2, 'SIMILAR_TO', 0.85)
 * ```
 */
export const createEdgeBetweenLearnings = (
  db: TestDatabase,
  sourceId: number | string,
  targetId: number | string,
  edgeType: EdgeType = "SIMILAR_TO",
  weight = 1.0
): Edge => {
  const factory = new EdgeFactory(db)
  return factory.betweenLearnings(sourceId, targetId, edgeType, weight)
}
