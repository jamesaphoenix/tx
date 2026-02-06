import { Context, Effect, Layer } from "effect"
import type { LearningWithScore } from "@jamesaphoenix/tx-types"
import { cosineSimilarity } from "../utils/math.js"
import { EmbeddingDimensionMismatchError } from "../errors.js"

/**
 * DiversifierService provides Maximal Marginal Relevance (MMR) diversification
 * for search results to balance relevance and diversity.
 *
 * MMR iteratively selects items that are both relevant to the query AND
 * dissimilar to already-selected items, preventing redundant results.
 *
 * Design: PRD-010 specifies diversity as a key quality metric for learning retrieval.
 * The service also applies category-based limits to prevent over-representation.
 */
export class DiversifierService extends Context.Tag("DiversifierService")<
  DiversifierService,
  {
    /**
     * Apply MMR diversification to scored candidates.
     *
     * @param candidates - Learnings with scores, sorted by relevance (highest first)
     * @param limit - Maximum number of results to return
     * @param lambda - Balance between relevance (1.0) and diversity (0.0), default 0.7
     * @returns Diversified list of learnings, maintaining score order within diversity constraints
     */
    readonly mmrDiversify: (
      candidates: readonly LearningWithScore[],
      limit: number,
      lambda?: number
    ) => Effect.Effect<readonly LearningWithScore[], EmbeddingDimensionMismatchError>
  }
>() {}

/**
 * Default lambda value for MMR.
 * 0.7 weights relevance higher than diversity (70/30 split).
 * Higher values = more relevant results, lower values = more diverse.
 */
const DEFAULT_LAMBDA = 0.7

/**
 * Maximum items from the same category allowed in top N results.
 * Per task spec: max 2 results from same category in top 5.
 */
const CATEGORY_LIMIT_TOP_N = 5
const CATEGORY_MAX_PER_TOP_N = 2

/**
 * Calculate maximum cosine similarity between a candidate and selected items.
 * Returns 0 if candidate has no embedding or selected set is empty.
 */
const maxSimilarityToSelected = (
  candidate: LearningWithScore,
  selected: readonly LearningWithScore[]
): Effect.Effect<number, EmbeddingDimensionMismatchError> => {
  // No embedding means we can't compute similarity
  if (!candidate.embedding) {
    return Effect.succeed(0)
  }

  // No selected items yet
  if (selected.length === 0) {
    return Effect.succeed(0)
  }

  const itemsWithEmbeddings = selected.filter(
    (item): item is LearningWithScore & { embedding: Float32Array } => item.embedding !== null
  )

  if (itemsWithEmbeddings.length === 0) {
    return Effect.succeed(0)
  }

  return Effect.forEach(itemsWithEmbeddings, item =>
    cosineSimilarity(candidate.embedding!, item.embedding)
  ).pipe(
    Effect.map(similarities => Math.max(...similarities))
  )
}

/**
 * Calculate MMR score for a candidate.
 *
 * Formula: λ * relevance(item) - (1-λ) * max_similarity(item, selected_items)
 *
 * Higher lambda means more weight on relevance.
 * Lower lambda means more weight on diversity (dissimilarity).
 */
const mmrScore = (
  candidate: LearningWithScore,
  selected: readonly LearningWithScore[],
  lambda: number
): Effect.Effect<number, EmbeddingDimensionMismatchError> => {
  const relevance = candidate.relevanceScore
  return maxSimilarityToSelected(candidate, selected).pipe(
    Effect.map(maxSim => lambda * relevance - (1 - lambda) * maxSim)
  )
}

/**
 * Check if adding a candidate would violate category limits in top N.
 *
 * Per spec: max 2 results from same category in top 5.
 * This prevents over-representation of any single category.
 */
const wouldViolateCategoryLimit = (
  candidate: LearningWithScore,
  selected: readonly LearningWithScore[],
  topN: number = CATEGORY_LIMIT_TOP_N,
  maxPerTopN: number = CATEGORY_MAX_PER_TOP_N
): boolean => {
  // No category = no limit
  if (!candidate.category) {
    return false
  }

  // Only check if we're still in the top N range
  if (selected.length >= topN) {
    return false
  }

  // Count items with the same category in current selection
  const categoryCount = selected.filter(
    item => item.category === candidate.category
  ).length

  return categoryCount >= maxPerTopN
}

/**
 * Noop implementation - returns candidates unchanged (just truncated to limit).
 * Used when diversification is not needed or for testing.
 */
export const DiversifierServiceNoop = Layer.succeed(
  DiversifierService,
  {
    mmrDiversify: (candidates, limit, _lambda) =>
      Effect.succeed(candidates.slice(0, limit))
  }
)

/**
 * Find the best candidate from remaining items using MMR scoring.
 * Returns the candidate with the highest MMR score that doesn't violate category limits.
 */
const findBestCandidate = (
  remaining: Set<LearningWithScore>,
  selected: readonly LearningWithScore[],
  lambda: number,
  checkCategoryLimits: boolean
): Effect.Effect<{ candidate: LearningWithScore; score: number } | null, EmbeddingDimensionMismatchError> =>
  Effect.gen(function* () {
    let bestCandidate: LearningWithScore | null = null
    let bestScore = -Infinity

    for (const candidate of remaining) {
      // Skip if would violate category limit (when checking is enabled)
      if (checkCategoryLimits && wouldViolateCategoryLimit(candidate, selected)) {
        continue
      }

      const score = yield* mmrScore(candidate, selected, lambda)
      if (score > bestScore) {
        bestScore = score
        bestCandidate = candidate
      }
    }

    return bestCandidate ? { candidate: bestCandidate, score: bestScore } : null
  })

/**
 * Live implementation with full MMR algorithm and category limits.
 *
 * Algorithm:
 * 1. If no embeddings available, fallback to relevance-only ordering with category limits
 * 2. Start with the highest-relevance item
 * 3. Iteratively select the item with highest MMR score that doesn't violate category limits
 * 4. Repeat until limit reached or no candidates remain
 */
export const DiversifierServiceLive = Layer.succeed(
  DiversifierService,
  {
    mmrDiversify: (candidates, limit, lambda = DEFAULT_LAMBDA) =>
      Effect.gen(function* () {
        // Edge case: empty candidates
        if (candidates.length === 0) {
          return []
        }

        // Edge case: limit <= 0
        if (limit <= 0) {
          return []
        }

        // Edge case: only one candidate
        if (candidates.length === 1) {
          return candidates.slice(0, 1)
        }

        // Check if any candidates have embeddings
        const hasEmbeddings = candidates.some(c => c.embedding !== null)

        // Fallback: if no embeddings, just apply category limits to relevance-sorted list
        if (!hasEmbeddings) {
          return applyFallbackWithCategoryLimits(candidates, limit)
        }

        // Full MMR algorithm
        const selected: LearningWithScore[] = []
        const remaining = new Set(candidates)

        while (selected.length < limit && remaining.size > 0) {
          // Try to find best candidate respecting category limits
          let result = yield* findBestCandidate(remaining, selected, lambda, true)

          // If no valid candidate found (all remaining violate category limits),
          // try to find any candidate without category limit check
          if (!result) {
            result = yield* findBestCandidate(remaining, selected, lambda, false)
          }

          // Still no candidate? We're done
          if (!result) {
            break
          }

          selected.push(result.candidate)
          remaining.delete(result.candidate)
        }

        return selected
      })
  }
)

/**
 * Fallback diversification when no embeddings are available.
 * Applies category limits to the relevance-sorted list.
 *
 * Returns candidates in original order, skipping items that would
 * violate the category limit in top N.
 */
const applyFallbackWithCategoryLimits = (
  candidates: readonly LearningWithScore[],
  limit: number
): readonly LearningWithScore[] => {
  const selected: LearningWithScore[] = []

  for (const candidate of candidates) {
    if (selected.length >= limit) {
      break
    }

    // Skip if would violate category limit
    if (wouldViolateCategoryLimit(candidate, selected)) {
      continue
    }

    selected.push(candidate)
  }

  // If we didn't get enough due to category limits, fill with remaining
  if (selected.length < limit) {
    const selectedSet = new Set(selected)
    for (const candidate of candidates) {
      if (selected.length >= limit) {
        break
      }
      if (!selectedSet.has(candidate)) {
        selected.push(candidate)
      }
    }
  }

  return selected
}

/**
 * Auto layer - uses Live implementation since MMR has no external dependencies.
 */
export const DiversifierServiceAuto = DiversifierServiceLive
