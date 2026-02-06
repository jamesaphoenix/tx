import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EdgeNotFoundError, EntityFetchError } from "../errors.js"
import { rowToEdge } from "../mappers/edge.js"
import { DEFAULT_QUERY_LIMIT } from "../utils/sql.js"
import type {
  Edge,
  EdgeRow,
  NodeType,
  EdgeType,
  CreateEdgeInput,
  UpdateEdgeInput,
  NeighborNode
} from "@jamesaphoenix/tx-types"

export class EdgeRepository extends Context.Tag("EdgeRepository")<
  EdgeRepository,
  {
    readonly create: (input: CreateEdgeInput) => Effect.Effect<Edge, DatabaseError>
    readonly findById: (id: number) => Effect.Effect<Edge | null, DatabaseError>
    readonly findBySource: (sourceType: NodeType, sourceId: string) => Effect.Effect<readonly Edge[], DatabaseError>
    readonly findByTarget: (targetType: NodeType, targetId: string) => Effect.Effect<readonly Edge[], DatabaseError>
    readonly findByMultipleSources: (sourceType: NodeType, sourceIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, readonly Edge[]>, DatabaseError>
    readonly findByEdgeType: (edgeType: EdgeType) => Effect.Effect<readonly Edge[], DatabaseError>
    readonly countByType: () => Effect.Effect<ReadonlyMap<EdgeType, number>, DatabaseError>
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
    readonly findAll: (limit?: number) => Effect.Effect<readonly Edge[], DatabaseError>
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
            const row = db.prepare("SELECT * FROM learning_edges WHERE id = ?").get(result.lastInsertRowid) as EdgeRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "edge",
                id: result.lastInsertRowid as number,
                operation: "insert"
              })
            }
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

      findByMultipleSources: (sourceType, sourceIds) =>
        Effect.try({
          try: () => {
            // Return empty map for empty input
            if (sourceIds.length === 0) {
              return new Map<string, readonly Edge[]>()
            }

            // Build IN clause with placeholders
            const placeholders = sourceIds.map(() => "?").join(", ")
            const rows = db.prepare(
              `SELECT * FROM learning_edges
               WHERE source_type = ? AND source_id IN (${placeholders}) AND invalidated_at IS NULL
               ORDER BY weight DESC, created_at ASC`
            ).all(sourceType, ...sourceIds) as EdgeRow[]

            // Group edges by source_id
            const result = new Map<string, Edge[]>()

            // Initialize all requested sourceIds with empty arrays
            for (const sourceId of sourceIds) {
              result.set(sourceId, [])
            }

            // Populate with actual edges
            for (const row of rows) {
              const edge = rowToEdge(row)
              const existing = result.get(row.source_id)
              if (existing) {
                existing.push(edge)
              }
            }

            return result as ReadonlyMap<string, readonly Edge[]>
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByEdgeType: (edgeType) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT * FROM learning_edges
               WHERE edge_type = ? AND invalidated_at IS NULL
               ORDER BY weight DESC, created_at ASC`
            ).all(edgeType) as EdgeRow[]
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countByType: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT edge_type, COUNT(*) as count FROM learning_edges
               WHERE invalidated_at IS NULL
               GROUP BY edge_type`
            ).all() as Array<{ edge_type: string; count: number }>

            const result = new Map<EdgeType, number>()
            for (const row of rows) {
              result.set(row.edge_type as EdgeType, row.count)
            }
            return result as ReadonlyMap<EdgeType, number>
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
            // Recursive CTE performs BFS in a single query (eliminates N+1 pattern)
            // Uses UNION ALL with delimiter-based visited tracking to prevent cycles
            // Similar pattern to hasPath CTE in dep-repo.ts
            const result = db.prepare(`
              WITH RECURSIVE bfs(node_type, node_id, depth, edge_path, visited) AS (
                -- Base case: starting node at depth 0
                SELECT ?, ?, 0, '',
                       '|' || ? || ':' || ? || '|'

                UNION ALL

                -- Recursive case: follow outgoing edges from current frontier
                SELECT
                  e.target_type,
                  e.target_id,
                  b.depth + 1,
                  CASE WHEN b.edge_path = ''
                    THEN CAST(e.id AS TEXT)
                    ELSE b.edge_path || ',' || CAST(e.id AS TEXT)
                  END,
                  b.visited || e.target_type || ':' || e.target_id || '|'
                FROM learning_edges e
                JOIN bfs b ON e.source_type = b.node_type
                          AND e.source_id = b.node_id
                WHERE e.invalidated_at IS NULL
                  AND b.depth < ?
                  AND instr(b.visited, '|' || e.target_type || ':' || e.target_id || '|') = 0
              )
              SELECT edge_path FROM bfs
              WHERE node_type = ? AND node_id = ?
                AND edge_path != ''
              ORDER BY depth ASC
              LIMIT 1
            `).get(
              fromType, fromId,   // CTE base: starting node
              fromType, fromId,   // CTE base: initial visited set
              maxDepth,           // depth limit
              toType, toId        // final filter: target node
            ) as { edge_path: string } | undefined

            if (!result) return null

            // Fetch full edge objects in a single query
            const edgeIds = result.edge_path.split(',').map(Number)
            const placeholders = edgeIds.map(() => '?').join(', ')
            const edgeRows = db.prepare(
              `SELECT * FROM learning_edges WHERE id IN (${placeholders})`
            ).all(...edgeIds) as EdgeRow[]

            // Maintain path order from CTE traversal
            const edgeMap = new Map(edgeRows.map(row => [row.id, rowToEdge(row)]))
            return edgeIds.map(id => edgeMap.get(id)).filter((e): e is Edge => e != null)
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

            const row = db.prepare("SELECT * FROM learning_edges WHERE id = ?").get(id) as EdgeRow | undefined
            if (!row) {
              throw new EntityFetchError({
                entity: "edge",
                id,
                operation: "update"
              })
            }
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

      findAll: (limit) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM learning_edges WHERE invalidated_at IS NULL ORDER BY created_at ASC LIMIT ?"
            ).all(limit ?? DEFAULT_QUERY_LIMIT) as EdgeRow[]
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
