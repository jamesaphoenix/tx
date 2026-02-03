/**
 * Graph commands: graph:verify, graph:invalidate, graph:restore, graph:prune, graph:status, graph:pin, graph:unpin,
 * graph:link, graph:show, graph:neighbors
 */

import { Effect } from "effect"
import { AnchorService, EdgeService } from "@jamesaphoenix/tx-core"
import type { AnchorType, EdgeType, NodeType } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

function opt(flags: Flags, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === "string") return v
  }
  return undefined
}

/**
 * tx graph:verify [--file <path>] [--all] [--json]
 * Verify anchors for a specific file or all anchors
 */
export const graphVerify = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* AnchorService
    const filePath = pos[0] ?? opt(flags, "file")

    if (filePath) {
      // Verify anchors for specific file
      const result = yield* svc.verifyAnchorsForFile(filePath)

      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Verification complete for: ${filePath}`)
        console.log(`  Total: ${result.total}`)
        console.log(`  Valid: ${result.verified}`)
        console.log(`  Drifted: ${result.drifted}`)
        console.log(`  Invalid: ${result.invalid}`)
      }
    } else {
      // Verify all anchors
      const result = yield* svc.verifyAll()

      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log("Verification complete for all anchors")
        console.log(`  Total: ${result.total}`)
        console.log(`  Valid: ${result.verified}`)
        console.log(`  Drifted: ${result.drifted}`)
        console.log(`  Invalid: ${result.invalid}`)
      }
    }
  })

/**
 * tx graph:invalidate <anchor-id> --reason <reason> [--json]
 * Manually invalidate an anchor
 */
export const graphInvalidate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:invalidate <anchor-id> --reason <reason> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const reason = opt(flags, "reason") ?? "Manual invalidation"

    const svc = yield* AnchorService
    const anchor = yield* svc.invalidate(anchorId, reason)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Invalidated anchor #${anchor.id}`)
      console.log(`  Status: ${anchor.status}`)
      console.log(`  Reason: ${reason}`)
      console.log(`  File: ${anchor.filePath}`)
    }
  })

/**
 * tx graph:restore <anchor-id> [--json]
 * Restore a soft-deleted (invalid) anchor
 */
export const graphRestore = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:restore <anchor-id> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const svc = yield* AnchorService
    const anchor = yield* svc.restore(anchorId)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Restored anchor #${anchor.id}`)
      console.log(`  Status: ${anchor.status}`)
      console.log(`  File: ${anchor.filePath}`)
    }
  })

/**
 * tx graph:prune [--older-than <days>] [--json]
 * Hard delete old invalid anchors
 */
export const graphPrune = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const olderThanStr = opt(flags, "older-than") ?? "90"

    // Parse days from string like "90d" or "90"
    let olderThanDays = parseInt(olderThanStr.replace(/d$/, ""), 10)
    if (isNaN(olderThanDays) || olderThanDays < 1) {
      olderThanDays = 90
    }

    const svc = yield* AnchorService
    const result = yield* svc.prune(olderThanDays)

    if (flag(flags, "json")) {
      console.log(toJson({ deleted: result.deleted, olderThanDays }))
    } else {
      console.log(`Pruned invalid anchors older than ${olderThanDays} days`)
      console.log(`  Deleted: ${result.deleted}`)
    }
  })

/**
 * tx graph:status [--json]
 * Show graph health metrics
 */
export const graphStatus = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* AnchorService
    const status = yield* svc.getStatus()

    if (flag(flags, "json")) {
      console.log(toJson(status))
    } else {
      console.log("Graph Status")
      console.log(`  Total anchors: ${status.total}`)
      console.log(`  Valid: ${status.valid}`)
      console.log(`  Drifted: ${status.drifted}`)
      console.log(`  Invalid: ${status.invalid}`)
      console.log(`  Pinned: ${status.pinned}`)

      if (status.recentInvalidations.length > 0) {
        console.log("\nRecent Invalidations:")
        for (const log of status.recentInvalidations.slice(0, 5)) {
          const date = log.invalidatedAt.toISOString().split("T")[0]
          console.log(`  #${log.anchorId} ${log.oldStatus} → ${log.newStatus} (${log.detectedBy}) ${date}`)
          console.log(`    Reason: ${log.reason}`)
        }
      }
    }
  })

/**
 * tx graph:pin <anchor-id> [--json]
 * Pin an anchor to prevent auto-invalidation
 */
export const graphPin = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:pin <anchor-id> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const svc = yield* AnchorService
    const anchor = yield* svc.pin(anchorId)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Pinned anchor #${anchor.id}`)
      console.log(`  File: ${anchor.filePath}`)
      console.log(`  Type: ${anchor.anchorType}`)
      console.log(`  Pinned: ${anchor.pinned}`)
    }
  })

/**
 * tx graph:unpin <anchor-id> [--json]
 * Unpin an anchor to allow auto-invalidation
 */
export const graphUnpin = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const anchorIdStr = pos[0]
    if (!anchorIdStr) {
      console.error("Usage: tx graph:unpin <anchor-id> [--json]")
      process.exit(1)
    }

    const anchorId = parseInt(anchorIdStr, 10)
    if (isNaN(anchorId)) {
      console.error("Error: Anchor ID must be a number")
      process.exit(1)
    }

    const svc = yield* AnchorService
    const anchor = yield* svc.unpin(anchorId)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Unpinned anchor #${anchor.id}`)
      console.log(`  File: ${anchor.filePath}`)
      console.log(`  Type: ${anchor.anchorType}`)
      console.log(`  Pinned: ${anchor.pinned}`)
    }
  })

/**
 * tx graph:link <learning-id> <file-path> [--type glob|hash|symbol] [--value <value>] [--json]
 * Create an anchor linking a learning to a file
 */
export const graphLink = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const learningIdStr = pos[0]
    const filePath = pos[1]

    if (!learningIdStr || !filePath) {
      console.error("Usage: tx graph:link <learning-id> <file-path> [--type glob|hash|symbol] [--value <value>] [--json]")
      process.exit(1)
    }

    const learningId = parseInt(learningIdStr, 10)
    if (isNaN(learningId)) {
      console.error("Error: Learning ID must be a number")
      process.exit(1)
    }

    const anchorType = (opt(flags, "type", "t") ?? "glob") as AnchorType
    const validTypes: AnchorType[] = ["glob", "hash", "symbol", "line_range"]
    if (!validTypes.includes(anchorType)) {
      console.error(`Error: Invalid anchor type. Valid types: ${validTypes.join(", ")}`)
      process.exit(1)
    }

    // Default value based on type
    let value = opt(flags, "value", "v")
    if (!value) {
      switch (anchorType) {
        case "glob":
          value = filePath
          break
        case "hash":
          console.error("Error: --value is required for hash anchors (SHA256 hash)")
          process.exit(1)
        // eslint-disable-next-line no-fallthrough
        case "symbol":
          console.error("Error: --value is required for symbol anchors (symbol name)")
          process.exit(1)
        // eslint-disable-next-line no-fallthrough
        case "line_range":
          console.error("Error: --value is required for line_range anchors (e.g., '10-20')")
          process.exit(1)
      }
    }

    const svc = yield* AnchorService

    // Build the typed anchor input
    const input: {
      learningId: number
      anchorType: AnchorType
      filePath: string
      value: string
      symbolFqname?: string
      lineStart?: number
      lineEnd?: number
      contentHash?: string
    } = {
      learningId,
      anchorType,
      filePath,
      value: value!
    }

    // Handle type-specific fields
    if (anchorType === "symbol") {
      input.symbolFqname = opt(flags, "symbol-fqname") ?? `${filePath}::${value}`
    }

    if (anchorType === "line_range") {
      // Parse value as "start-end" or just "start"
      const rangeParts = value!.split("-")
      input.lineStart = parseInt(rangeParts[0], 10)
      input.lineEnd = rangeParts[1] ? parseInt(rangeParts[1], 10) : input.lineStart
      if (isNaN(input.lineStart) || isNaN(input.lineEnd)) {
        console.error("Error: Line range must be in format 'start' or 'start-end'")
        process.exit(1)
      }
    }

    if (anchorType === "hash") {
      input.contentHash = value
    }

    const anchor = yield* svc.createAnchor(input)

    if (flag(flags, "json")) {
      console.log(toJson(anchor))
    } else {
      console.log(`Created anchor #${anchor.id}`)
      console.log(`  Learning: #${anchor.learningId}`)
      console.log(`  File: ${anchor.filePath}`)
      console.log(`  Type: ${anchor.anchorType}`)
      console.log(`  Value: ${anchor.anchorValue}`)
      console.log(`  Status: ${anchor.status}`)
    }
  })

/**
 * tx graph:show <learning-id> [--json]
 * Show all edges for a learning
 */
export const graphShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const learningIdStr = pos[0]

    if (!learningIdStr) {
      console.error("Usage: tx graph:show <learning-id> [--json]")
      process.exit(1)
    }

    const learningId = parseInt(learningIdStr, 10)
    if (isNaN(learningId)) {
      console.error("Error: Learning ID must be a number")
      process.exit(1)
    }

    const edgeSvc = yield* EdgeService
    const anchorSvc = yield* AnchorService

    // Get edges where learning is source
    const outgoingEdges = yield* edgeSvc.findFromSource("learning", String(learningId))
    // Get edges where learning is target
    const incomingEdges = yield* edgeSvc.findToTarget("learning", String(learningId))
    // Get anchors for this learning
    const anchors = yield* anchorSvc.findAnchorsForLearning(learningId)

    if (flag(flags, "json")) {
      console.log(toJson({
        learningId,
        outgoingEdges,
        incomingEdges,
        anchors
      }))
    } else {
      console.log(`Graph for learning #${learningId}`)

      if (anchors.length > 0) {
        console.log(`\nAnchors (${anchors.length}):`)
        for (const anchor of anchors) {
          const pinnedInfo = anchor.pinned ? " [pinned]" : ""
          console.log(`  #${anchor.id} ${anchor.anchorType} → ${anchor.filePath}${pinnedInfo}`)
          console.log(`    Value: ${anchor.anchorValue}`)
          console.log(`    Status: ${anchor.status}`)
        }
      } else {
        console.log("\nNo anchors")
      }

      if (outgoingEdges.length > 0) {
        console.log(`\nOutgoing edges (${outgoingEdges.length}):`)
        for (const edge of outgoingEdges) {
          const weight = (edge.weight * 100).toFixed(0)
          console.log(`  #${edge.id} --[${edge.edgeType}]--> ${edge.targetType}:${edge.targetId} (${weight}%)`)
        }
      } else {
        console.log("\nNo outgoing edges")
      }

      if (incomingEdges.length > 0) {
        console.log(`\nIncoming edges (${incomingEdges.length}):`)
        for (const edge of incomingEdges) {
          const weight = (edge.weight * 100).toFixed(0)
          console.log(`  #${edge.id} ${edge.sourceType}:${edge.sourceId} --[${edge.edgeType}]--> (${weight}%)`)
        }
      } else {
        console.log("\nNo incoming edges")
      }
    }
  })

/**
 * Parse edge types from comma-separated string.
 */
const parseEdgeTypes = (edgeTypesStr: string | undefined): EdgeType[] | undefined => {
  if (!edgeTypesStr) return undefined
  return edgeTypesStr.split(",").map(s => s.trim()).filter(s => s.length > 0) as EdgeType[]
}

/**
 * tx graph:neighbors <node-id> [--node-type learning|file|task|run] [--depth 2] [--edge-type IMPORTS,ANCHORED_TO] [--direction both|outgoing|incoming] [--json]
 * Find neighbors of a node with optional multi-hop traversal
 */
export const graphNeighbors = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const nodeId = pos[0]

    if (!nodeId) {
      console.error("Usage: tx graph:neighbors <node-id> [--node-type learning|file|task|run] [--depth 2] [--edge-type IMPORTS] [--direction both] [--json]")
      process.exit(1)
    }

    const nodeType = (opt(flags, "node-type", "n") ?? "learning") as NodeType
    const validNodeTypes: NodeType[] = ["learning", "file", "task", "run"]
    if (!validNodeTypes.includes(nodeType)) {
      console.error(`Error: Invalid node type. Valid types: ${validNodeTypes.join(", ")}`)
      process.exit(1)
    }

    const depth = opt(flags, "depth", "d") ? parseInt(opt(flags, "depth", "d")!, 10) : 2
    if (isNaN(depth) || depth < 1) {
      console.error("Error: Depth must be a positive integer")
      process.exit(1)
    }

    const edgeTypes = parseEdgeTypes(opt(flags, "edge-type", "e"))
    const direction = (opt(flags, "direction") ?? "both") as "outgoing" | "incoming" | "both"
    const validDirections = ["outgoing", "incoming", "both"]
    if (!validDirections.includes(direction)) {
      console.error(`Error: Invalid direction. Valid directions: ${validDirections.join(", ")}`)
      process.exit(1)
    }

    const svc = yield* EdgeService
    const neighbors = yield* svc.findNeighbors(nodeType, nodeId, {
      depth,
      direction,
      edgeTypes
    })

    if (flag(flags, "json")) {
      console.log(toJson({
        nodeType,
        nodeId,
        depth,
        direction,
        edgeTypes: edgeTypes ?? "all",
        neighbors
      }))
    } else {
      const edgeTypeInfo = edgeTypes ? ` (${edgeTypes.join(", ")})` : ""
      console.log(`Neighbors of ${nodeType}:${nodeId} (depth ${depth}, ${direction}${edgeTypeInfo})`)

      if (neighbors.length === 0) {
        console.log("  No neighbors found")
      } else {
        // Group by depth for better readability
        const byDepth = new Map<number, Array<typeof neighbors[number]>>()
        for (const n of neighbors) {
          const existing = byDepth.get(n.depth) ?? []
          existing.push(n)
          byDepth.set(n.depth, existing)
        }

        for (const [d, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
          console.log(`\n  Depth ${d} (${nodes.length}):`)
          for (const n of nodes) {
            const weight = (n.weight * 100).toFixed(0)
            const dirArrow = n.direction === "outgoing" ? "→" : "←"
            console.log(`    ${dirArrow} ${n.nodeType}:${n.nodeId} [${n.edgeType}] (${weight}%)`)
          }
        }
      }
    }
  })
