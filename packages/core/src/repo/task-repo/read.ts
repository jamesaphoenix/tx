import { Effect } from "effect"
import type { SqliteDatabase } from "../../db.js"
import { DatabaseError } from "../../errors.js"
import { rowToTask } from "../../mappers/task.js"
import type { TaskId, TaskRow } from "@jamesaphoenix/tx-types"
import { escapeLikePattern } from "../../utils/sql.js"
import type { TaskRepositoryService } from "../task-repo.js"
import { chunkBySqlLimit } from "./shared.js"

type TaskRepositoryReadService = Pick<
  TaskRepositoryService,
  | "findById"
  | "findByIds"
  | "findAll"
  | "findByParent"
  | "getChildIds"
  | "getChildIdsForMany"
  | "getAncestorChain"
  | "getDescendants"
  | "getGroupContextForMany"
  | "resolveEffectiveGroupContextForMany"
  | "count"
  | "getVerifyCmd"
>

export const createTaskRepositoryReadService = (
  db: SqliteDatabase
): TaskRepositoryReadService => ({
  findById: (id) =>
    Effect.try({
      try: () => {
        const row = db.prepare<TaskRow>("SELECT * FROM tasks WHERE id = ?").get(id)
        return row ? rowToTask(row) : null
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findByIds: (ids) =>
    Effect.try({
      try: () => {
        if (ids.length === 0) return []
        const rows: TaskRow[] = []
        for (const chunk of chunkBySqlLimit(ids)) {
          const placeholders = chunk.map(() => "?").join(",")
          const chunkRows = db.prepare<TaskRow>(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...chunk)
          rows.push(...chunkRows)
        }
        return rows.map(rowToTask)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findAll: (filter) =>
    Effect.try({
      try: () => {
        const conditions: string[] = []
        const params: unknown[] = []

        if (filter?.status) {
          if (Array.isArray(filter.status)) {
            const placeholders = filter.status.map(() => "?").join(",")
            conditions.push(`status IN (${placeholders})`)
            params.push(...filter.status)
          } else {
            conditions.push("status = ?")
            params.push(filter.status)
          }
        }

        if (filter?.parentId !== undefined) {
          if (filter.parentId === null) {
            conditions.push("parent_id IS NULL")
          } else {
            conditions.push("parent_id = ?")
            params.push(filter.parentId)
          }
        }

        // Search filter: case-insensitive search in title and description
        if (filter?.search) {
          const searchPattern = `%${escapeLikePattern(filter.search)}%`
          conditions.push("(title LIKE ? ESCAPE '\\' COLLATE NOCASE OR description LIKE ? ESCAPE '\\' COLLATE NOCASE)")
          params.push(searchPattern, searchPattern)
        }

        // Cursor-based pagination: fetch tasks after the cursor position
        // Order is score DESC, id ASC, so "after cursor" means:
        // (score < cursor.score) OR (score = cursor.score AND id > cursor.id)
        if (filter?.cursor) {
          conditions.push("(score < ? OR (score = ? AND id > ?))")
          params.push(filter.cursor.score, filter.cursor.score, filter.cursor.id)
        }

        // Exclude tasks with active claims (thundering herd prevention)
        // Uses idx_claims_active_task partial index for efficient lookup
        if (filter?.excludeClaimed) {
          conditions.push("NOT EXISTS (SELECT 1 FROM task_claims WHERE task_id = tasks.id AND status = 'active')")
        }

        // Label filters: include tasks with ALL specified labels
        if (filter?.labels && filter.labels.length > 0) {
          for (const label of filter.labels) {
            conditions.push(
              `EXISTS (SELECT 1 FROM task_label_assignments tla JOIN task_labels tl ON tl.id = tla.label_id WHERE tla.task_id = tasks.id AND lower(tl.name) = lower(?))`
            )
            params.push(label)
          }
        }

        // Exclude label filters: exclude tasks with ANY specified label
        if (filter?.excludeLabels && filter.excludeLabels.length > 0) {
          for (const label of filter.excludeLabels) {
            conditions.push(
              `NOT EXISTS (SELECT 1 FROM task_label_assignments tla JOIN task_labels tl ON tl.id = tla.label_id WHERE tla.task_id = tasks.id AND lower(tl.name) = lower(?))`
            )
            params.push(label)
          }
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
        // Use parameterized query for LIMIT to prevent SQL injection
        let limitClause = ""
        if (filter?.limit != null && filter.limit > 0) {
          limitClause = "LIMIT ?"
          params.push(Math.floor(filter.limit))
        }
        const sql = `SELECT * FROM tasks ${where} ORDER BY score DESC, id ASC ${limitClause}`
        const rows = db.prepare<TaskRow>(sql).all(...params)
        return rows.map(rowToTask)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  findByParent: (parentId) =>
    Effect.try({
      try: () => {
        const rows = parentId === null
          ? db.prepare<TaskRow>("SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY score DESC").all()
          : db.prepare<TaskRow>("SELECT * FROM tasks WHERE parent_id = ? ORDER BY score DESC").all(parentId)
        return rows.map(rowToTask)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getChildIds: (id) =>
    Effect.try({
      try: () => {
        const rows = db.prepare<{ id: TaskId }>("SELECT id FROM tasks WHERE parent_id = ?").all(id)
        return rows.map(r => r.id)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getChildIdsForMany: (ids) =>
    Effect.try({
      try: () => {
        const result = new Map<string, TaskId[]>()
        if (ids.length === 0) return new Map<string, readonly TaskId[]>()

        // Initialize all requested IDs with empty arrays
        for (const id of ids) {
          result.set(id, [])
        }

        for (const chunk of chunkBySqlLimit(ids)) {
          const placeholders = chunk.map(() => "?").join(",")
          const rows = db.prepare<{ id: TaskId; parent_id: string }>(
            `SELECT id, parent_id FROM tasks WHERE parent_id IN (${placeholders})`
          ).all(...chunk)

          // Group by parent_id - use push() for O(1) insertion instead of spread for O(n)
          for (const row of rows) {
            const existing = result.get(row.parent_id)
            if (existing) {
              existing.push(row.id)
            }
          }
        }

        const output = new Map<string, readonly TaskId[]>()
        for (const [taskId, childIds] of result.entries()) {
          output.set(taskId, childIds)
        }
        return output
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getAncestorChain: (id) =>
    Effect.try({
      try: () => {
        // Use recursive CTE to get the task and all its ancestors in one query
        // Returns from the given task to root (depth-first ordering)
        const rows = db.prepare<TaskRow>(`
              WITH RECURSIVE ancestors AS (
                SELECT t.*, 1 as depth FROM tasks t WHERE t.id = ?
                UNION ALL
                SELECT t.*, a.depth + 1 FROM tasks t
                JOIN ancestors a ON t.id = a.parent_id
                WHERE a.depth < 100 AND t.id != ?
              )
              SELECT * FROM ancestors ORDER BY depth ASC
            `).all(id, id)
        return rows.map(rowToTask)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getDescendants: (id, maxDepth = 10) =>
    Effect.try({
      try: () => {
        // Use recursive CTE to get the task and all its descendants in one query
        // Returns the root task first, then all descendants ordered by depth
        // maxDepth limits recursion to prevent unbounded traversal
        const rows = db.prepare<TaskRow>(`
              WITH RECURSIVE descendants AS (
                SELECT t.*, 1 as depth FROM tasks t WHERE t.id = ?
                UNION ALL
                SELECT t.*, d.depth + 1 FROM tasks t
                JOIN descendants d ON t.parent_id = d.id
                WHERE d.depth < ?
              )
              SELECT * FROM descendants ORDER BY depth ASC
            `).all(id, maxDepth)
        return rows.map(rowToTask)
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getGroupContextForMany: (ids) =>
    Effect.try({
      try: () => {
        const result = new Map<string, string>()
        if (ids.length === 0) return result

        for (const chunk of chunkBySqlLimit(ids)) {
          const placeholders = chunk.map(() => "?").join(",")
          const rows = db.prepare<{ id: string; group_context: string | null }>(
            `SELECT id, group_context
                 FROM tasks
                 WHERE id IN (${placeholders})
                   AND group_context IS NOT NULL
                   AND length(trim(group_context)) > 0`
          ).all(...chunk)

          for (const row of rows) {
            if (row.group_context != null) {
              result.set(row.id, row.group_context)
            }
          }
        }
        return result
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  resolveEffectiveGroupContextForMany: (ids) =>
    Effect.try({
      try: () => {
        const result = new Map<string, { sourceTaskId: TaskId; context: string }>()
        if (ids.length === 0) return result

        for (const chunk of chunkBySqlLimit(ids)) {
          const valuesClause = chunk.map(() => "(?)").join(", ")
          const rows = db.prepare<{
            target_id: string
            source_id: TaskId
            group_context: string
          }>(
            `WITH RECURSIVE
                   targets(target_id) AS (
                     VALUES ${valuesClause}
                   ),
                   ancestors(target_id, node_id, distance, path) AS (
                     SELECT t.target_id, t.target_id, 0, ',' || t.target_id || ','
                     FROM targets t
                     UNION ALL
                     SELECT a.target_id, parent.id, a.distance + 1, a.path || parent.id || ','
                     FROM ancestors a
                     JOIN tasks current ON current.id = a.node_id
                     JOIN tasks parent ON parent.id = current.parent_id
                     WHERE a.distance < 1000
                       AND instr(a.path, ',' || parent.id || ',') = 0
                   ),
                   descendants(target_id, node_id, distance, path) AS (
                     SELECT t.target_id, t.target_id, 0, ',' || t.target_id || ','
                     FROM targets t
                     UNION ALL
                     SELECT d.target_id, child.id, d.distance + 1, d.path || child.id || ','
                     FROM descendants d
                     JOIN tasks child ON child.parent_id = d.node_id
                     WHERE d.distance < 1000
                       AND instr(d.path, ',' || child.id || ',') = 0
                   ),
                   lineage(target_id, node_id, distance) AS (
                     SELECT target_id, node_id, distance FROM ancestors
                     UNION
                     SELECT target_id, node_id, distance FROM descendants
                   ),
                   ranked_sources AS (
                     SELECT l.target_id,
                            source.id AS source_id,
                            source.group_context,
                            ROW_NUMBER() OVER (
                              PARTITION BY l.target_id
                              ORDER BY l.distance ASC, source.updated_at DESC, source.id ASC
                            ) AS rn
                     FROM lineage l
                     JOIN tasks source ON source.id = l.node_id
                     WHERE source.group_context IS NOT NULL
                       AND length(trim(source.group_context)) > 0
                   )
                 SELECT target_id, source_id, group_context
                 FROM ranked_sources
                 WHERE rn = 1
                 ORDER BY target_id ASC`
          ).all(...chunk)

          for (const row of rows) {
            result.set(row.target_id, {
              sourceTaskId: row.source_id,
              context: row.group_context
            })
          }
        }

        return result
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  count: (filter) =>
    Effect.try({
      try: () => {
        const conditions: string[] = []
        const params: unknown[] = []

        if (filter?.status) {
          if (Array.isArray(filter.status)) {
            const placeholders = filter.status.map(() => "?").join(",")
            conditions.push(`status IN (${placeholders})`)
            params.push(...filter.status)
          } else {
            conditions.push("status = ?")
            params.push(filter.status)
          }
        }

        if (filter?.parentId !== undefined) {
          if (filter.parentId === null) {
            conditions.push("parent_id IS NULL")
          } else {
            conditions.push("parent_id = ?")
            params.push(filter.parentId)
          }
        }

        // Search filter for count (same as findAll)
        if (filter?.search) {
          const searchPattern = `%${escapeLikePattern(filter.search)}%`
          conditions.push("(title LIKE ? ESCAPE '\\' COLLATE NOCASE OR description LIKE ? ESCAPE '\\' COLLATE NOCASE)")
          params.push(searchPattern, searchPattern)
        }

        // Exclude claimed tasks (same as findAll)
        if (filter?.excludeClaimed) {
          conditions.push("NOT EXISTS (SELECT 1 FROM task_claims WHERE task_id = tasks.id AND status = 'active')")
        }

        // Label filters (same as findAll)
        if (filter?.labels && filter.labels.length > 0) {
          for (const label of filter.labels) {
            conditions.push(
              `EXISTS (SELECT 1 FROM task_label_assignments tla JOIN task_labels tl ON tl.id = tla.label_id WHERE tla.task_id = tasks.id AND lower(tl.name) = lower(?))`
            )
            params.push(label)
          }
        }

        if (filter?.excludeLabels && filter.excludeLabels.length > 0) {
          for (const label of filter.excludeLabels) {
            conditions.push(
              `NOT EXISTS (SELECT 1 FROM task_label_assignments tla JOIN task_labels tl ON tl.id = tla.label_id WHERE tla.task_id = tasks.id AND lower(tl.name) = lower(?))`
            )
            params.push(label)
          }
        }

        // Note: cursor is intentionally not included in count - we want total matching records

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
        const result = db.prepare<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM tasks ${where}`).get(...params)
        if (!result) return 0
        return result.cnt
      },
      catch: (cause) => new DatabaseError({ cause })
    }),

  getVerifyCmd: (taskId) =>
    Effect.try({
      try: () => {
        const row = db.prepare<{ verify_cmd: string | null; verify_schema: string | null }>(
          "SELECT verify_cmd, verify_schema FROM tasks WHERE id = ?"
        ).get(taskId)
        return {
          cmd: row?.verify_cmd ?? null,
          schema: row?.verify_schema ?? null,
        }
      },
      catch: (cause) => new DatabaseError({ cause })
    }),
})
