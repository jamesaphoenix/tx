import { Effect } from "effect"
import { EmbeddingDimensionMismatchError, ZeroMagnitudeVectorError } from "../errors.js"

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 *
 * @returns Effect that fails with EmbeddingDimensionMismatchError if vectors have different dimensions,
 *          or ZeroMagnitudeVectorError if either vector is all-zeros
 */
export const cosineSimilarity = (
  a: Float32Array,
  b: Float32Array
): Effect.Effect<number, EmbeddingDimensionMismatchError | ZeroMagnitudeVectorError> => {
  if (a.length !== b.length) {
    return Effect.fail(
      new EmbeddingDimensionMismatchError({
        queryDimensions: a.length,
        documentDimensions: b.length
      })
    )
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  // Zero-magnitude vectors are invalid embeddings (all zeros).
  // Returning 0 would normalize to 0.5 in the retriever, unfairly boosting them.
  // Fail so computeVectorRanking's catchTag excludes them gracefully.
  if (magnitude === 0) {
    return Effect.fail(
      new ZeroMagnitudeVectorError({ dimensions: a.length })
    )
  }

  return Effect.succeed(dotProduct / magnitude)
}
