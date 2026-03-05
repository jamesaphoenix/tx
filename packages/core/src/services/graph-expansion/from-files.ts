import { Context, Effect } from "effect"
import { EdgeService, type NeighborWithDepth } from "../edge-service.js"
import { LearningRepository } from "../../repo/learning-repo.js"
import { AnchorRepository } from "../../repo/anchor-repo.js"
import { DatabaseError, ValidationError } from "../../errors.js"
import type { FileExpansionOptions, FileExpansionResult, FileExpandedLearning } from "../graph-expansion.js"

type FileExpansionDeps = {
  readonly edgeService: Context.Tag.Service<typeof EdgeService>
  readonly learningRepo: Context.Tag.Service<typeof LearningRepository>
  readonly anchorRepo: Context.Tag.Service<typeof AnchorRepository>
}

const DEFAULT_DEPTH = 2
const DEFAULT_DECAY_FACTOR = 0.7
const DEFAULT_MAX_NODES = 100

export const expandFromFilesGraph = (
  deps: FileExpansionDeps,
  files: readonly string[],
  options: FileExpansionOptions = {}
): Effect.Effect<FileExpansionResult, ValidationError | DatabaseError> =>
  Effect.gen(function* () {
    // Validate options
    const depth = options.depth ?? DEFAULT_DEPTH
    const decayFactor = options.decayFactor ?? DEFAULT_DECAY_FACTOR
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES

    if (depth < 0) {
      return yield* Effect.fail(new ValidationError({
        reason: `Expansion depth must be >= 0, got: ${depth}`
      }))
    }

    if (depth > 10) {
      return yield* Effect.fail(new ValidationError({
        reason: `Expansion depth must be <= 10, got: ${depth}`
      }))
    }

    if (decayFactor <= 0 || decayFactor > 1) {
      return yield* Effect.fail(new ValidationError({
        reason: `Decay factor must be in (0, 1], got: ${decayFactor}`
      }))
    }

    if (maxNodes < 1) {
      return yield* Effect.fail(new ValidationError({
        reason: `Max nodes must be >= 1, got: ${maxNodes}`
      }))
    }

    // Handle empty files input
    if (files.length === 0) {
      return {
        anchored: [],
        expanded: [],
        all: [],
        stats: {
          inputFileCount: 0,
          anchoredCount: 0,
          expandedCount: 0,
          maxDepthReached: 0,
          filesVisited: 0,
        },
      }
    }

    // Track visited files and learnings to prevent duplicates
    const visitedFiles = new Set<string>(files)
    const visitedLearningIds = new Set<number>()

    // Step 1: Find learnings ANCHORED_TO the input files (hop 0)
    const anchoredLearnings: FileExpandedLearning[] = []

    for (const filePath of files) {
      const anchors = yield* deps.anchorRepo.findByFilePath(filePath)

      // Filter to only valid anchors
      const validAnchors = anchors.filter(a => a.status === "valid")

      for (const anchor of validAnchors) {
        if (visitedLearningIds.has(anchor.learningId)) continue
        visitedLearningIds.add(anchor.learningId)

        const learning = yield* deps.learningRepo.findById(anchor.learningId)
        if (!learning) continue

        anchoredLearnings.push({
          learning,
          sourceFile: filePath,
          hops: 0,
          decayedScore: 1.0, // Base score for directly anchored learnings
          sourceEdge: "ANCHORED_TO",
          edgeWeight: null,
        })
      }
    }

    // If depth is 0, just return anchored learnings
    if (depth === 0) {
      const limitedAnchored = anchoredLearnings.slice(0, maxNodes)
      return {
        anchored: limitedAnchored,
        expanded: [],
        all: limitedAnchored,
        stats: {
          inputFileCount: files.length,
          anchoredCount: limitedAnchored.length,
          expandedCount: 0,
          maxDepthReached: 0,
          filesVisited: files.length,
        },
      }
    }

    // Step 2-5: BFS traverse via IMPORTS and CO_CHANGES_WITH edges
    type FileFrontierNode = {
      filePath: string
      score: number // Score inherited from parent
    }

    let frontier: FileFrontierNode[] = files.map(f => ({
      filePath: f,
      score: 1.0,
    }))

    const expandedLearnings: FileExpandedLearning[] = []
    let maxDepthReached = 0
    const totalLearnings = () => anchoredLearnings.length + expandedLearnings.length

    // BFS traversal through file relationships
    for (let currentHop = 1; currentHop <= depth; currentHop++) {
      if (frontier.length === 0) break
      if (totalLearnings() >= maxNodes) break

      const nextFrontier: FileFrontierNode[] = []

      for (const node of frontier) {
        if (totalLearnings() >= maxNodes) break

        // Find related files via IMPORTS and CO_CHANGES_WITH edges
        // Note: For file nodes, nodeType is "file" and nodeId is the file path
        const neighbors = yield* deps.edgeService.findNeighbors(
          "file",
          node.filePath,
          {
            depth: 1,
            direction: "both",
            edgeTypes: ["IMPORTS", "CO_CHANGES_WITH"],
          }
        )

        // Filter to only file neighbors
        const fileNeighbors = neighbors.filter(
          (n): n is NeighborWithDepth & { nodeType: "file" } =>
            n.nodeType === "file"
        )

        for (const neighbor of fileNeighbors) {
          if (totalLearnings() >= maxNodes) break

          const relatedFilePath = neighbor.nodeId
          if (visitedFiles.has(relatedFilePath)) continue
          visitedFiles.add(relatedFilePath)

          // Calculate decayed score for this hop
          const hopScore = node.score * neighbor.weight * decayFactor

          // Find learnings anchored to this related file
          const anchors = yield* deps.anchorRepo.findByFilePath(relatedFilePath)
          const validAnchors = anchors.filter(a => a.status === "valid")

          for (const anchor of validAnchors) {
            if (totalLearnings() >= maxNodes) break
            if (visitedLearningIds.has(anchor.learningId)) continue
            visitedLearningIds.add(anchor.learningId)

            const learning = yield* deps.learningRepo.findById(anchor.learningId)
            if (!learning) continue

            expandedLearnings.push({
              learning,
              sourceFile: relatedFilePath,
              hops: currentHop,
              decayedScore: hopScore,
              sourceEdge: neighbor.edgeType,
              edgeWeight: neighbor.weight,
            })

            maxDepthReached = currentHop
          }

          // Add to next frontier for further expansion
          nextFrontier.push({
            filePath: relatedFilePath,
            score: hopScore,
          })
        }
      }

      frontier = nextFrontier
    }

    // Sort expanded by decayed score (highest first)
    expandedLearnings.sort((a, b) => b.decayedScore - a.decayedScore)

    // Enforce maxNodes limit
    const totalAvailable = anchoredLearnings.length + expandedLearnings.length
    let limitedAnchored = anchoredLearnings
    let limitedExpanded = expandedLearnings

    if (totalAvailable > maxNodes) {
      // Prioritize anchored learnings, then fill with expanded
      if (anchoredLearnings.length >= maxNodes) {
        limitedAnchored = anchoredLearnings.slice(0, maxNodes)
        limitedExpanded = []
      } else {
        const remainingSlots = maxNodes - anchoredLearnings.length
        limitedExpanded = expandedLearnings.slice(0, remainingSlots)
      }
    }

    // Combine all and sort by decayedScore
    const all = [...limitedAnchored, ...limitedExpanded]
    all.sort((a, b) => b.decayedScore - a.decayedScore)

    return {
      anchored: limitedAnchored,
      expanded: limitedExpanded,
      all,
      stats: {
        inputFileCount: files.length,
        anchoredCount: limitedAnchored.length,
        expandedCount: limitedExpanded.length,
        maxDepthReached,
        filesVisited: visitedFiles.size,
      },
    }
  })
