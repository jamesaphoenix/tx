import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EdgeNotFoundError } from "../errors.js"
import { rowToEdge } from "../mappers/edge.js"
import type {
  Edge,
  EdgeRow,
  NodeType,
  EdgeType,
  CreateEdgeInput,
  UpdateEdgeInput,
  NeighborNode
} from "@tx/types"

export class EdgeRepository extends Context.Tag("EdgeRepository")<
  EdgeRepository,
  {
    readonly create: (input: CreateEdgeInput) => Effect.Effect<Edge, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<Edge | null, DatabaseError>
    readonly findBySource: (sourceType: NodeType, sourceId: string) => Effect.Effect<readonly Edge[], DatabaseError>
    readonly findByTarget: (targetType: NodeType, targetId: string) => Effect.Effect<readonly Edge[], DatabaseError>
    readonly findNeighbors: (
      nodeType: NodeType,
      nodeId: string,
      options?: {
        direction?: "outgoing" | "incoming" | "both"
        edgeTypes?: readonly EdgeType[]
      }
    ) => Effect.Effect<readonly NeighborNode[], DatabaseError>
    readonly findPath: (
      fromType: NodeType,
      fromId: string,
      toType: NodeType,
      toId: string,
      maxDepth?: number
    ) => Effect.Effect<readonly Edge[] | null, DatabaseError>
    readonly update: (id: number, input: UpdateEdgeInput) => Effect.Effect<Edge | null, DatabaseError>
    readonly invalidate: (id: number) => Effect.Effect<boolean, EdgeNotFoundError | DatabaseError>
    readonly findAll: () => Effect.Effect<readonly Edge[], DatabaseError>
  }
>() {}

export const EdgeRepositoryLive = Layer.effect(
  EdgeRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      create: (input) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO learning_edges
               (edge_type, source_type, source_id, target_type, target_id, weight, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(
              input.edgeType,
              input.sourceType,
              input.sourceId,
              input.targetType,
              input.targetId,
              input.weight ?? 1.0,
              JSON.stringify(input.metadata ?? {})
            )
            const row = db.prepare("SELECT * FROM learning_edges WHERE id = ?").get(result.lastInsertRowid) as EdgeRow
            return rowToEdge(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM learning_edges WHERE id = ? AND invalidated_at IS NULL"
            ).get(id) as EdgeRow | undefined
            return row ? rowToEdge(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findBySource: (sourceType, sourceId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM learning_edges
               WHERE source_type = ? AND source_id = ? AND invalidated_at IS NULL
               ORDER BY created_at ASC`
            ).all(sourceType, sourceId) as EdgeRow[]
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByTarget: (targetType, targetId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM learning_edges
               WHERE target_type = ? AND target_id = ? AND invalidated_at IS NULL
               ORDER BY created_at ASC`
            ).all(targetType, targetId) as EdgeRow[]
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findNeighbors: (nodeType, nodeId, options = {}) =>
        Effect.try({
          try: () => {
            const direction = options.direction ?? "both"
            const edgeTypes = options.edgeTypes
            const neighbors: NeighborNode[] = []

            // Build edge type filter clause
            const edgeTypeFilter = edgeTypes && edgeTypes.length > 0
              ? `AND edge_type IN (${edgeTypes.map(() => "?").join(", ")})`
              : ""
            const edgeTypeParams = edgeTypes ?? []

            // Outgoing edges (this node is the source)
            if (direction === "outgoing" || direction === "both") {
              const outgoingRows = db.prepare(
                `SELECT * FROM learning_edges
                 WHERE source_type = ? AND source_id = ? AND invalidated_at IS NULL
                 ${edgeTypeFilter}
                 ORDER BY weight DESC, created_at ASC`
              ).all(nodeType, nodeId, ...edgeTypeParams) as EdgeRow[]

              for (const row of outgoingRows) {
                neighbors.push({
                  nodeType: row.target_type as NodeType,
                  nodeId: row.target_id,
                  edgeType: row.edge_type as EdgeType,
                  weight: row.weight,
                  direction: "outgoing"
                })
              }
            }

            // Incoming edges (this node is the target)
            if (direction === "incoming" || direction === "both") {
              const incomingRows = db.prepare(
                `SELECT * FROM learning_edges
                 WHERE target_type = ? AND target_id = ? AND invalidated_at IS NULL
                 ${edgeTypeFilter}
                 ORDER BY weight DESC, created_at ASC`
              ).all(nodeType, nodeId, ...edgeTypeParams) as EdgeRow[]

              for (const row of incomingRows) {
                neighbors.push({
                  nodeType: row.source_type as NodeType,
                  nodeId: row.source_id,
                  edgeType: row.edge_type as EdgeType,
                  weight: row.weight,
                  direction: "incoming"
                })
              }
            }

            return neighbors
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findPath: (fromType, fromId, toType, toId, maxDepth = 5) =>
        Effect.try({
          try: () => {
            // BFS for shortest path
            const visited = new Set<string>([`${fromType}:${fromId}`])
            interface PathNode {
              type: NodeType
              id: string
              path: Edge[]
            }
            let frontier: PathNode[] = [{ type: fromType, id: fromId, path: [] }]

            for (let depth = 0; depth < maxDepth; depth++) {
              const nextFrontier: PathNode[] = []

              for (const { type, id, path } of frontier) {
                // Get outgoing edges
                const rows = db.prepare(
                  `SELECT * FROM learning_edges
                   WHERE source_type = ? AND source_id = ? AND invalidated_at IS NULL`
                ).all(type, id) as EdgeRow[]

                for (const row of rows) {
                  const edge = rowToEdge(row)

                  // Found target
                  if (row.target_type === toType && row.target_id === toId) {
                    return [...path, edge]
                  }

                  const key = `${row.target_type}:${row.target_id}`
                  if (!visited.has(key)) {
                    visited.add(key)
                    nextFrontier.push({
                      type: row.target_type as NodeType,
                      id: row.target_id,
                      path: [...path, edge]
                    })
                  }
                }
              }

              frontier = nextFrontier
              if (frontier.length === 0) break
            }

            return null // No path found
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      update: (id, input) =>
        Effect.try({
          try: () => {
            const updates: string[] = []
            const values: unknown[] = []

            if (input.weight !== undefined) {
              updates.push("weight = ?")
              values.push(input.weight)
            }
            if (input.metadata !== undefined) {
              updates.push("metadata = ?")
              values.push(JSON.stringify(input.metadata))
            }

            if (updates.length === 0) {
              const row = db.prepare(
                "SELECT * FROM learning_edges WHERE id = ? AND invalidated_at IS NULL"
              ).get(id) as EdgeRow | undefined
              return row ? rowToEdge(row) : null
            }

            values.push(id)
            const result = db.prepare(
              `UPDATE learning_edges SET ${updates.join(", ")} WHERE id = ? AND invalidated_at IS NULL`
            ).run(...values)

            if (result.changes === 0) {
              return null
            }

            const row = db.prepare("SELECT * FROM learning_edges WHERE id = ?").get(id) as EdgeRow
            return rowToEdge(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      invalidate: (id) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE learning_edges SET invalidated_at = datetime('now') WHERE id = ? AND invalidated_at IS NULL"
            ).run(id)
            if (result.changes === 0) {
              throw new EdgeNotFoundError({ id })
            }
            return true
          },
          catch: (cause) => {
            if (cause instanceof EdgeNotFoundError) throw cause
            throw new DatabaseError({ cause })
          }
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_edges WHERE invalidated_at IS NULL ORDER BY created_at ASC"
            ).all() as EdgeRow[]
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
