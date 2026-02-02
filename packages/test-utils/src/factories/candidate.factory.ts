/**
 * Candidate factory for creating test learning candidate data.
 *
 * Learning candidates are potential learnings extracted from transcripts
 * that await promotion to the learnings table.
 *
 * @module @tx/test-utils/factories/candidate
 */

import type { TestDatabase } from "../database/index.js"

/**
 * Confidence level for a learning candidate.
 */
export type CandidateConfidence = "high" | "medium" | "low"

/**
 * Status of a learning candidate.
 */
export type CandidateStatus = "pending" | "promoted" | "rejected" | "merged"

/**
 * Learning candidate entity.
 * Represents a potential learning extracted from a transcript.
 */
export interface LearningCandidate {
  readonly id: number
  readonly content: string
  readonly confidence: CandidateConfidence
  readonly category: string | null
  readonly sourceFile: string
  readonly sourceRunId: string | null
  readonly sourceTaskId: string | null
  readonly extractedAt: Date
  readonly status: CandidateStatus
  readonly reviewedAt: Date | null
  readonly reviewedBy: string | null
  readonly promotedLearningId: number | null
  readonly rejectionReason: string | null
}

/**
 * Options for creating a test learning candidate.
 */
export interface CreateCandidateOptions {
  /** Candidate ID (auto-generated if not provided) */
  id?: number
  /** The extracted learning content */
  content?: string
  /** Confidence level (high, medium, low) */
  confidence?: CandidateConfidence
  /** Category of the learning */
  category?: string | null
  /** Source JSONL file path */
  sourceFile?: string
  /** Source run ID */
  sourceRunId?: string | null
  /** Source task ID */
  sourceTaskId?: string | null
  /** Extraction timestamp */
  extractedAt?: Date
  /** Candidate status */
  status?: CandidateStatus
  /** Review timestamp */
  reviewedAt?: Date | null
  /** Reviewer identifier ('auto' or user ID) */
  reviewedBy?: string | null
  /** ID of the promoted learning (if promoted) */
  promotedLearningId?: number | null
  /** Reason for rejection (if rejected) */
  rejectionReason?: string | null
}

/**
 * Factory class for creating test learning candidates.
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const factory = new CandidateFactory(db)
 *
 * // Create high-confidence candidate (will be auto-promoted)
 * const high = factory.highConfidence({ content: 'Always use Effect-TS' })
 *
 * // Create pending candidate for review
 * const pending = factory.pending({ content: 'Consider using Effect-TS' })
 *
 * // Create promoted candidate
 * const promoted = factory.promoted({ content: 'Use Effect-TS', promotedLearningId: 1 })
 * ```
 */
export class CandidateFactory {
  private counter = 0
  private readonly db: TestDatabase

  constructor(db: TestDatabase) {
    this.db = db
  }

  /**
   * Create a single test learning candidate.
   */
  create(options: CreateCandidateOptions = {}): LearningCandidate {
    this.counter++
    const now = new Date()

    const id = options.id ?? this.counter
    const content = options.content ?? `Test candidate learning ${this.counter}`
    const confidence = options.confidence ?? "medium"
    const category = options.category ?? null
    const sourceFile = options.sourceFile ?? `~/.claude/projects/test/session-${this.counter}.jsonl`
    const sourceRunId = options.sourceRunId ?? null
    const sourceTaskId = options.sourceTaskId ?? null
    const extractedAt = options.extractedAt ?? now
    const status = options.status ?? "pending"
    const reviewedAt = options.reviewedAt ?? null
    const reviewedBy = options.reviewedBy ?? null
    const promotedLearningId = options.promotedLearningId ?? null
    const rejectionReason = options.rejectionReason ?? null

    this.db.exec(`
      INSERT INTO learning_candidates (id, content, confidence, category, source_file, source_run_id, source_task_id, extracted_at, status, reviewed_at, reviewed_by, promoted_learning_id, rejection_reason)
      VALUES (
        ${id},
        '${content.replace(/'/g, "''")}',
        '${confidence}',
        ${category ? `'${category}'` : "NULL"},
        '${sourceFile.replace(/'/g, "''")}',
        ${sourceRunId ? `'${sourceRunId}'` : "NULL"},
        ${sourceTaskId ? `'${sourceTaskId}'` : "NULL"},
        '${extractedAt.toISOString()}',
        '${status}',
        ${reviewedAt ? `'${reviewedAt.toISOString()}'` : "NULL"},
        ${reviewedBy ? `'${reviewedBy}'` : "NULL"},
        ${promotedLearningId !== null ? promotedLearningId : "NULL"},
        ${rejectionReason ? `'${rejectionReason.replace(/'/g, "''")}'` : "NULL"}
      )
    `)

    return {
      id,
      content,
      confidence,
      category,
      sourceFile,
      sourceRunId,
      sourceTaskId,
      extractedAt,
      status,
      reviewedAt,
      reviewedBy,
      promotedLearningId,
      rejectionReason
    }
  }

  /**
   * Create multiple test candidates.
   */
  createMany(count: number, options: CreateCandidateOptions = {}): LearningCandidate[] {
    const candidates: LearningCandidate[] = []
    for (let i = 0; i < count; i++) {
      candidates.push(this.create({
        ...options,
        content: options.content ? `${options.content} ${i + 1}` : undefined
      }))
    }
    return candidates
  }

  /**
   * Create a high-confidence candidate (ready for auto-promotion).
   */
  highConfidence(options: CreateCandidateOptions = {}): LearningCandidate {
    return this.create({ ...options, confidence: "high" })
  }

  /**
   * Create a medium-confidence candidate (needs review).
   */
  mediumConfidence(options: CreateCandidateOptions = {}): LearningCandidate {
    return this.create({ ...options, confidence: "medium" })
  }

  /**
   * Create a low-confidence candidate (needs review).
   */
  lowConfidence(options: CreateCandidateOptions = {}): LearningCandidate {
    return this.create({ ...options, confidence: "low" })
  }

  /**
   * Create a pending candidate awaiting review.
   */
  pending(options: CreateCandidateOptions = {}): LearningCandidate {
    return this.create({ ...options, status: "pending" })
  }

  /**
   * Create a promoted candidate.
   */
  promoted(options: CreateCandidateOptions & { promotedLearningId: number }): LearningCandidate {
    const now = new Date()
    return this.create({
      ...options,
      status: "promoted",
      reviewedAt: options.reviewedAt ?? now,
      reviewedBy: options.reviewedBy ?? "auto"
    })
  }

  /**
   * Create a rejected candidate.
   */
  rejected(
    rejectionReason: string,
    options: CreateCandidateOptions = {}
  ): LearningCandidate {
    const now = new Date()
    return this.create({
      ...options,
      status: "rejected",
      rejectionReason,
      reviewedAt: options.reviewedAt ?? now,
      reviewedBy: options.reviewedBy ?? "manual"
    })
  }

  /**
   * Create a merged candidate (merged with existing learning).
   */
  merged(
    existingLearningId: number,
    options: CreateCandidateOptions = {}
  ): LearningCandidate {
    const now = new Date()
    return this.create({
      ...options,
      status: "merged",
      promotedLearningId: existingLearningId,
      reviewedAt: options.reviewedAt ?? now,
      reviewedBy: options.reviewedBy ?? "auto"
    })
  }

  /**
   * Create a candidate from a specific source.
   */
  fromSource(
    sourceFile: string,
    sourceRunId: string | null = null,
    sourceTaskId: string | null = null,
    options: CreateCandidateOptions = {}
  ): LearningCandidate {
    return this.create({
      ...options,
      sourceFile,
      sourceRunId,
      sourceTaskId
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
 * Create a single test learning candidate (convenience function).
 *
 * @example
 * ```typescript
 * const db = await Effect.runPromise(createTestDatabase())
 * const candidate = createTestCandidate(db, {
 *   content: 'Always validate user input',
 *   confidence: 'high',
 *   category: 'security'
 * })
 * ```
 */
export const createTestCandidate = (
  db: TestDatabase,
  options: CreateCandidateOptions = {}
): LearningCandidate => {
  const factory = new CandidateFactory(db)
  return factory.create(options)
}
