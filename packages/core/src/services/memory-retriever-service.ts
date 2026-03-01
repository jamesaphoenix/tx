/**
 * MemoryRetrieverService — Retrieval pipeline for memory documents
 *
 * Provides BM25 + vector + graph (via memory_links) search with RRF fusion.
 * Follows the same architecture as RetrieverService for learnings.
 *
 * Pipeline:
 *   1. BM25 via memory_fts (three-tier FTS5 query)
 *   2. Vector similarity (when embeddings available)
 *   3. RRF fusion (k=60)
 *   4. Recency boost (30-day decay on file mtime)
 *   5. Tag filter (case-insensitive, when specified)
 *   6. Property filter (key=value or key-exists, when specified)
 *   7. Graph expansion via memory_links (BFS with decay, when --expand)
 *   8. Re-filter expanded docs against tag/prop filters
 *   9. Sort + filter by minScore + limit
 */

import { Context, Effect, Layer, Option } from "effect"
import { MemoryDocumentRepository, MemoryLinkRepository, MemoryPropertyRepository, type MemoryBM25Result } from "../repo/memory-repo.js"
import { EmbeddingService } from "./embedding-service.js"
import { RetrievalError, DatabaseError } from "../errors.js"
import type { MemoryDocument, MemoryDocumentWithScore, MemorySearchOptions } from "@jamesaphoenix/tx-types"
import { cosineSimilarity } from "../utils/math.js"

/** RRF constant — standard value from the original paper */
const RRF_K = 60

/** Default weight for recency boost */
const DEFAULT_RECENCY_WEIGHT = 0.1
const MAX_AGE_DAYS = 30

/** Cap on embeddings fetched for vector similarity scan */
const MAX_VECTOR_CANDIDATES = 500
/** Floor on vector candidates to prevent tiny pools when limit is small */
const MIN_VECTOR_CANDIDATES = 50

/** Graph expansion defaults */
const DEFAULT_EXPANSION_DEPTH = 2
const DEFAULT_DECAY_FACTOR = 0.5
const MAX_EXPANSION_NODES = 50

/**
 * MemoryRetrieverService provides pluggable retrieval for memory documents.
 */
export class MemoryRetrieverService extends Context.Tag("MemoryRetrieverService")<
  MemoryRetrieverService,
  {
    /**
     * Search memory documents using the full retrieval pipeline.
     * Returns scored results sorted by relevance (highest first).
     */
    readonly search: (
      query: string,
      options?: MemorySearchOptions
    ) => Effect.Effect<readonly MemoryDocumentWithScore[], RetrievalError | DatabaseError>
    /** Check if retrieval functionality is available */
    readonly isAvailable: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Calculate recency score (0-1) based on file modification time.
 * More recently modified files get higher scores.
 */
const calculateRecencyScore = (fileMtime: string): number => {
  const mtimeMs = new Date(fileMtime).getTime()
  // Guard against invalid/empty fileMtime producing NaN (propagates through all arithmetic)
  if (isNaN(mtimeMs)) return 0
  const nowMs = Date.now()
  // Clamp future-dated files to now (prevents score > 1)
  const ageMs = Math.max(0, nowMs - Math.min(mtimeMs, nowMs))
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.max(0, 1 - ageDays / MAX_AGE_DAYS)
}

/**
 * Compute vector similarity scores and return ranked results.
 * Dimension mismatches are skipped gracefully.
 */
const computeVectorRanking = (
  documents: readonly MemoryDocument[],
  queryEmbedding: Float32Array | null
): Effect.Effect<{ document: MemoryDocument; score: number; rank: number }[], never> => {
  if (!queryEmbedding) {
    return Effect.succeed([])
  }

  const docsWithEmbeddings = documents.filter(
    (d): d is MemoryDocument & { embedding: Float32Array } => d.embedding !== null
  )

  // Skip per-document dimension mismatches gracefully (e.g., stale embeddings from a different model)
  return Effect.forEach(docsWithEmbeddings, document =>
    cosineSimilarity(queryEmbedding, document.embedding).pipe(
      Effect.map(similarity => {
        // Normalize cosine similarity from [-1, 1] to [0, 1]
        const score = (similarity + 1) / 2
        return Option.some({ document, score })
      }),
      Effect.catchTag("EmbeddingDimensionMismatchError", () =>
        Effect.succeed(Option.none<{ document: MemoryDocument; score: number }>())
      ),
      Effect.catchTag("ZeroMagnitudeVectorError", () =>
        Effect.succeed(Option.none<{ document: MemoryDocument; score: number }>())
      )
    )
  ).pipe(
    Effect.map(results => {
      const withScores = results.filter(Option.isSome).map(o => o.value)
      const sorted = [...withScores].sort((a, b) => b.score - a.score)
      return sorted.map((item, idx) => ({
        ...item,
        rank: idx + 1
      }))
    })
  )
}

/**
 * RRF score calculation.
 * Formula: RRF(d) = Σ 1/(k + rank_i(d))
 */
const rrfScore = (k: number, ...ranks: number[]): number => {
  return ranks.reduce((sum, rank) => {
    if (rank === 0) return sum // Not present in this list
    return sum + 1 / (k + rank)
  }, 0)
}

/** Intermediate RRF computation result */
interface MemoryRRFCandidate {
  document: MemoryDocument
  bm25Score: number
  bm25Rank: number
  vectorScore: number
  vectorRank: number
  rrfScore: number
  recencyScore: number
}

/**
 * Combine BM25 and vector results using RRF.
 */
const computeRRFScoring = (
  bm25Results: readonly MemoryBM25Result[],
  vectorRanking: { document: MemoryDocument; score: number; rank: number }[]
): MemoryRRFCandidate[] => {
  const bm25Map = new Map<string, { score: number; rank: number }>()
  bm25Results.forEach((result, idx) => {
    bm25Map.set(result.document.id, { score: result.score, rank: idx + 1 })
  })

  const vectorMap = new Map<string, { score: number; rank: number }>()
  vectorRanking.forEach(item => {
    vectorMap.set(item.document.id, { score: item.score, rank: item.rank })
  })

  // Collect all unique documents
  const allDocuments = new Map<string, MemoryDocument>()
  for (const result of bm25Results) {
    allDocuments.set(result.document.id, result.document)
  }
  for (const item of vectorRanking) {
    allDocuments.set(item.document.id, item.document)
  }

  const candidates: MemoryRRFCandidate[] = []
  for (const [id, document] of allDocuments) {
    const bm25Info = bm25Map.get(id)
    const vectorInfo = vectorMap.get(id)

    const bm25Rank = bm25Info?.rank ?? 0
    const vectorRank = vectorInfo?.rank ?? 0
    const bm25Score = bm25Info?.score ?? 0
    const vectorScore = vectorInfo?.score ?? 0
    const recencyScore = calculateRecencyScore(document.fileMtime)

    const rrf = rrfScore(RRF_K, bm25Rank, vectorRank)

    candidates.push({
      document,
      bm25Score,
      bm25Rank,
      vectorScore,
      vectorRank,
      rrfScore: rrf,
      recencyScore
    })
  }

  return candidates.sort((a, b) => b.rrfScore - a.rrfScore)
}

/**
 * Apply final scoring: RRF + recency boost.
 */
const applyFinalScoring = (
  candidates: MemoryRRFCandidate[],
  recencyWeight: number,
  activeLists: number
): MemoryDocumentWithScore[] => {
  // Dynamically normalize based on how many ranking lists contributed (1 or 2).
  // Max RRF = activeLists * 1/(k+1). Without this, BM25-only mode caps at ~0.5.
  const rrfMax = activeLists > 0 ? activeLists / (RRF_K + 1) : 1

  return candidates.map(candidate => {
    const { document, bm25Score, bm25Rank, vectorScore, vectorRank, rrfScore: rrf, recencyScore } = candidate

    const normalizedRRF = Math.min(1.0, rrf / rrfMax)

    // Weighted blend (not additive) to preserve rank differentiation.
    // Additive formula would clamp top-ranked recent docs to 1.0, destroying ordering.
    const relevanceScore = (1 - recencyWeight) * normalizedRRF + recencyWeight * recencyScore

    return {
      ...document,
      relevanceScore,
      bm25Score,
      vectorScore,
      recencyScore,
      rrfScore: rrf,
      bm25Rank,
      vectorRank,
    }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)
}

/**
 * Noop fallback — returns empty results.
 */
export const MemoryRetrieverServiceNoop = Layer.succeed(
  MemoryRetrieverService,
  {
    search: (_query, _options) => Effect.succeed([]),
    isAvailable: () => Effect.succeed(false)
  }
)

/**
 * Live implementation with BM25 + vector + RRF + graph expansion pipeline.
 *
 * Graph expansion uses memory_links (wikilinks, frontmatter.related, explicit)
 * to find related documents via BFS traversal with score decay.
 */
export const MemoryRetrieverServiceLive = Layer.effect(
  MemoryRetrieverService,
  Effect.gen(function* () {
    const docRepo = yield* MemoryDocumentRepository
    const linkRepo = yield* MemoryLinkRepository
    const propRepo = yield* MemoryPropertyRepository
    // EmbeddingService is optional — graceful degradation when unavailable
    const embeddingServiceOption = yield* Effect.serviceOption(EmbeddingService)
    const embeddingService = Option.getOrNull(embeddingServiceOption)

    /**
     * Expand search results through memory_links graph.
     * BFS traversal: follow outgoing links from seed documents.
     */
    const expandViaGraph = (
      seeds: MemoryDocumentWithScore[],
      depth: number,
      decayFactor: number,
      maxNodes: number
    ) =>
      Effect.gen(function* () {
        if (seeds.length === 0 || depth === 0) return seeds.map(s => ({ ...s, expansionHops: 0 }))

        const visited = new Set<string>(seeds.map(s => s.id))
        const expanded: MemoryDocumentWithScore[] = []

        // BFS frontier: documents to expand from
        let frontier: { docId: string; score: number; hops: number }[] =
          seeds.map(s => ({ docId: s.id, score: s.relevanceScore, hops: 0 }))

        for (let hop = 1; hop <= depth; hop++) {
          if (frontier.length === 0) break
          if (seeds.length + expanded.length >= maxNodes) break

          const nextFrontier: { docId: string; score: number; hops: number }[] = []

          for (const node of frontier) {
            if (seeds.length + expanded.length >= maxNodes) break

            // Get outgoing links from this document
            const links = yield* linkRepo.findOutgoing(node.docId)

            for (const link of links) {
              if (seeds.length + expanded.length >= maxNodes) break
              if (!link.targetDocId) continue // Unresolved link
              if (visited.has(link.targetDocId)) continue

              visited.add(link.targetDocId)

              // Fetch the document
              const doc = yield* docRepo.findById(link.targetDocId)
              if (!doc) continue

              const decayedScore = node.score * decayFactor
              const recencyScore = calculateRecencyScore(doc.fileMtime)

              expanded.push({
                ...doc,
                relevanceScore: decayedScore,
                bm25Score: 0,
                vectorScore: 0,
                rrfScore: 0,
                recencyScore,
                bm25Rank: 0,
                vectorRank: 0,
                expansionHops: hop,
              })

              nextFrontier.push({
                docId: link.targetDocId,
                score: decayedScore,
                hops: hop,
              })
            }
          }

          frontier = nextFrontier
        }

        // Merge seeds and expanded, sort by relevance
        const merged = [
          ...seeds.map(s => ({ ...s, expansionHops: 0 })),
          ...expanded,
        ]
        return merged.sort((a, b) => b.relevanceScore - a.relevanceScore)
      })

    return {
      search: (query, options) =>
        Effect.gen(function* () {
          const limit = Math.max(1, options?.limit ?? 10)
          const minScore = options?.minScore ?? 0
          const useSemantic = options?.semantic ?? false
          const useExpand = options?.expand ?? false

          // Over-fetch when filters are present: tag/prop filters reduce the
          // scored pool before graph expansion. A larger BM25/vector candidate pool
          // ensures enough documents survive filtering to produce quality expansion
          // seeds and to deliver the requested limit.
          const hasFilters = (options?.tags && options.tags.length > 0) ||
                             (options?.props && options.props.length > 0)
          const fetchMultiplier = hasFilters ? 10 : 3

          // 1. BM25 search (always available)
          const bm25Results = yield* docRepo.searchBM25(query, limit * fetchMultiplier)

          // 2. Vector search (when --semantic and embeddings available)
          let vectorRanking: { document: MemoryDocument; score: number; rank: number }[] = []
          if (useSemantic && embeddingService) {
            const queryEmbedding = yield* Effect.option(embeddingService.embed(query))
            const queryEmbeddingValue = Option.getOrNull(queryEmbedding)

            if (queryEmbeddingValue) {
              const vectorCandidateLimit = Math.min(Math.max(MIN_VECTOR_CANDIDATES, limit * fetchMultiplier), MAX_VECTOR_CANDIDATES)
              const docsWithEmbeddings = yield* docRepo.findWithEmbeddings(vectorCandidateLimit)
              vectorRanking = yield* computeVectorRanking(docsWithEmbeddings, queryEmbeddingValue)
            }
          }

          // 3. RRF fusion
          const candidates = computeRRFScoring(bm25Results, vectorRanking)

          // 4. Final scoring with recency boost
          // Count active ranking lists for correct RRF normalization
          const activeLists = (bm25Results.length > 0 ? 1 : 0) + (vectorRanking.length > 0 ? 1 : 0)
          let scored = applyFinalScoring(candidates, DEFAULT_RECENCY_WEIGHT, activeLists)

          // 5. Filter by tags if specified (case-insensitive)
          // Applied BEFORE graph expansion so seeds are relevant to the filter,
          // preventing expansion from irrelevant pre-filter documents.
          if (options?.tags && options.tags.length > 0) {
            const tagFilterLower = options.tags.map((t: string) => t.toLowerCase())
            scored = scored.filter(r =>
              tagFilterLower.every((t: string) => r.tags.some((rt: string) => String(rt).toLowerCase() === t))
            )
          }

          // 6. Filter by properties if specified
          // Prop filter sets are computed once and cached for reuse in step 8 (post-expansion re-filter)
          // to avoid duplicate DB queries when both --expand and --prop are active.
          const propFilterSets: Set<string>[] = []
          if (options?.props && options.props.length > 0) {
            for (const propFilter of options.props) {
              const eqIdx = propFilter.indexOf("=")
              const key = eqIdx >= 0 ? propFilter.slice(0, eqIdx) : propFilter
              const value = eqIdx >= 0 ? propFilter.slice(eqIdx + 1) : undefined
              if (!key || key.trim().length === 0) continue
              const matchingDocIds = new Set(yield* propRepo.findByProperty(key.trim(), value))
              propFilterSets.push(matchingDocIds)
              scored = scored.filter(r => matchingDocIds.has(r.id))
            }
          }

          // 7. Graph expansion (when --expand)
          // Runs AFTER tag/prop filtering so seeds are already relevant.
          // Uses a fixed seed count independent of limit so expansion can contribute
          // new documents even when limit is small (e.g. default 10).
          // After expansion, re-merge with non-seed results to avoid silently
          // dropping documents ranked 11+ from the original scored list.
          if (useExpand) {
            const EXPANSION_SEED_COUNT = 10
            const seedIds = new Set(scored.slice(0, Math.min(EXPANSION_SEED_COUNT, scored.length)).map(s => s.id))
            const topSeeds = scored.slice(0, Math.min(EXPANSION_SEED_COUNT, scored.length))
            const expandedResults = yield* expandViaGraph(
              topSeeds,
              DEFAULT_EXPANSION_DEPTH,
              DEFAULT_DECAY_FACTOR,
              MAX_EXPANSION_NODES
            )

            // 8. Re-filter expanded documents against tag/prop filters.
            // Seeds already passed filters; only newly discovered docs need checking.
            // Reuses cached propFilterSets from step 6 to avoid duplicate DB queries.
            let filtered = expandedResults
            if (options?.tags && options.tags.length > 0) {
              const tagFilterLower = options.tags.map((t: string) => t.toLowerCase())
              filtered = filtered.filter(r =>
                seedIds.has(r.id) ||
                tagFilterLower.every((t: string) => r.tags.some((rt: string) => String(rt).toLowerCase() === t))
              )
            }
            for (const matchingDocIds of propFilterSets) {
              filtered = filtered.filter(r => seedIds.has(r.id) || matchingDocIds.has(r.id))
            }

            // Re-merge: add back non-seed original results that weren't already included via expansion
            const expandedIds = new Set(filtered.map(r => r.id))
            const nonSeedRemainder = scored.slice(EXPANSION_SEED_COUNT)
              .filter(r => !expandedIds.has(r.id))
            scored = [...filtered, ...nonSeedRemainder]
              .sort((a, b) => b.relevanceScore - a.relevanceScore)
          }

          // 9. Filter by minScore and limit
          return scored
            .filter(r => r.relevanceScore >= minScore)
            .slice(0, limit)
        }),

      isAvailable: () => Effect.succeed(true)
    }
  })
)
