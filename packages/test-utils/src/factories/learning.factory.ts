/**
 * Learning factory for creating test learning data.
 *
 * @module @tx/test-utils/factories/learning
 */

import type {
  Learning,
  LearningId,
  LearningSourceType
} from "@jamesaphoenix/tx-types"
import type { TestDatabase } from "../database/index.js"

/**
 * Options for creating a test learning.
 */
export interface CreateLearningOptions {
  /** Learning ID (auto-generated if not provided) */
  id?: number
  /** Learning content */
  content?: string
  /** Source type */
  sourceType?: LearningSourceType
  /** Source reference (e.g., task ID, run ID) */
  sourceRef?: string | null
  /** Keywords for search */
  keywords?: string[]
  /** Category */
  category?: string | null
  /** Usage count */
  usageCount?: number
  /** Last used timestamp */
  lastUsedAt?: Date | null
  /** Outcome score (0-1) */
  outcomeScore?: number | null
  /** Embedding vector */
  embedding?: Float32Array | null
  /** Creation timestamp */
  createdAt?: Date
}

/**
 * Factory class for creating test learnings.
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const factory = new LearningFactory(db)
 *
 * // Create single learning
 * const learning = factory.create({ content: 'Always use Effect for async ops' })
 *
 * // Create with embedding for vector search testing
 * const embedding = new Float32Array([0.1, 0.2, 0.3, ...])
 * const withVector = factory.withEmbedding(embedding, { content: 'Test learning' })
 *
 * // Create multiple learnings
 * const learnings = await factory.createMany(5, { category: 'testing' })
 * ```
 */
export class LearningFactory {
  private counter = 0
  private readonly db: TestDatabase

  constructor(db: TestDatabase) {
    this.db = db
  }

  /**
   * Create a single test learning.
   */
  create(options: CreateLearningOptions = {}): Learning {
    this.counter++
    const now = new Date()

    const id = options.id ?? this.counter
    const content = options.content ?? `Test learning ${this.counter}`
    const sourceType = options.sourceType ?? "manual"
    const sourceRef = options.sourceRef ?? null
    const keywords = options.keywords ?? []
    const category = options.category ?? null
    const usageCount = options.usageCount ?? 0
    const lastUsedAt = options.lastUsedAt ?? null
    const outcomeScore = options.outcomeScore ?? null
    const embedding = options.embedding ?? null
    const createdAt = options.createdAt ?? now

    // Convert Float32Array to Buffer for SQLite storage
    const embeddingBuffer = embedding
      ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
      : null

    this.db.run(
      `INSERT INTO learnings (id, content, source_type, source_ref, keywords, category, usage_count, last_used_at, outcome_score, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        content,
        sourceType,
        sourceRef,
        JSON.stringify(keywords),
        category,
        usageCount,
        lastUsedAt ? lastUsedAt.toISOString() : null,
        outcomeScore,
        embeddingBuffer,
        createdAt.toISOString()
      ]
    )

    return {
      id: id as LearningId,
      content,
      sourceType,
      sourceRef,
      keywords,
      category,
      usageCount,
      lastUsedAt,
      outcomeScore,
      embedding: embedding as Float32Array<ArrayBuffer> | null,
      createdAt
    }
  }

  /**
   * Create multiple test learnings.
   */
  createMany(count: number, options: CreateLearningOptions = {}): Learning[] {
    const learnings: Learning[] = []
    for (let i = 0; i < count; i++) {
      learnings.push(this.create({
        ...options,
        content: options.content ? `${options.content} ${i + 1}` : undefined
      }))
    }
    return learnings
  }

  /**
   * Create a learning with specific content.
   */
  withContent(content: string, options: CreateLearningOptions = {}): Learning {
    return this.create({ ...options, content })
  }

  /**
   * Create a learning with embedding vector for vector search testing.
   */
  withEmbedding(embedding: Float32Array, options: CreateLearningOptions = {}): Learning {
    return this.create({ ...options, embedding })
  }

  /**
   * Create a learning with a specific category.
   */
  withCategory(category: string, options: CreateLearningOptions = {}): Learning {
    return this.create({ ...options, category })
  }

  /**
   * Create a learning from a specific source.
   */
  fromSource(
    sourceType: LearningSourceType,
    sourceRef: string,
    options: CreateLearningOptions = {}
  ): Learning {
    return this.create({ ...options, sourceType, sourceRef })
  }

  /**
   * Reset the internal counter.
   */
  reset(): void {
    this.counter = 0
  }
}

/**
 * Create a single test learning (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const learning = createTestLearning(db, { content: 'Use Effect-TS for typed errors' })
 * ```
 */
export const createTestLearning = (
  db: TestDatabase,
  options: CreateLearningOptions = {}
): Learning => {
  const factory = new LearningFactory(db)
  return factory.create(options)
}

/**
 * Create multiple test learnings (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const learnings = createTestLearnings(db, 10, { category: 'patterns' })
 * ```
 */
export const createTestLearnings = (
  db: TestDatabase,
  count: number,
  options: CreateLearningOptions = {}
): Learning[] => {
  const factory = new LearningFactory(db)
  return factory.createMany(count, options)
}
