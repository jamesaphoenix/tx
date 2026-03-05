import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { coerceDbResult } from "../utils/db-result.js"

export type GuardRow = {
  readonly id: number
  readonly scope: string
  readonly max_pending: number | null
  readonly max_children: number | null
  readonly max_depth: number | null
  readonly enforce: number
  readonly created_at: string
}

export type Guard = {
  readonly id: number
  readonly scope: string
  readonly maxPending: number | null
  readonly maxChildren: number | null
  readonly maxDepth: number | null
  readonly enforce: boolean
  readonly createdAt: string
}

const rowToGuard = (row: GuardRow): Guard => ({
  id: row.id,
  scope: row.scope,
  maxPending: row.max_pending,
  maxChildren: row.max_children,
  maxDepth: row.max_depth,
  enforce: row.enforce === 1,
  createdAt: row.created_at,
})

export class GuardRepository extends Context.Tag("GuardRepository")<
  GuardRepository,
  {
    readonly findByScope: (scope: string) => Effect.Effect<Guard | null, DatabaseError>
    readonly findAll: () => Effect.Effect<readonly Guard[], DatabaseError>
    readonly upsert: (scope: string, guard: {
      maxPending?: number | null
      maxChildren?: number | null
      maxDepth?: number | null
      enforce: boolean
    }) => Effect.Effect<Guard, DatabaseError>
    readonly remove: (scope: string) => Effect.Effect<boolean, DatabaseError>
    readonly countPending: () => Effect.Effect<number, DatabaseError>
    readonly countChildrenOf: (parentId: string) => Effect.Effect<number, DatabaseError>
    readonly getMaxDepth: (parentId: string) => Effect.Effect<number, DatabaseError>
  }
>() {}

export const GuardRepositoryLive = Layer.effect(
  GuardRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      findByScope: (scope) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<GuardRow | undefined>(db.prepare("SELECT * FROM task_guards WHERE scope = ?").get(scope))
            return row ? rowToGuard(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = coerceDbResult<GuardRow[]>(db.prepare("SELECT * FROM task_guards ORDER BY scope").all())
            return rows.map(rowToGuard)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      upsert: (scope, guard) =>
        Effect.try({
          try: () => {
            // Build SET clause dynamically:
            // - undefined fields → COALESCE to preserve existing values
            // - explicit null fields → SET to NULL (clears the limit)
            // - numeric fields → SET to the new value
            const setPending = guard.maxPending === undefined
              ? "max_pending = COALESCE(excluded.max_pending, task_guards.max_pending)"
              : "max_pending = excluded.max_pending"
            const setChildren = guard.maxChildren === undefined
              ? "max_children = COALESCE(excluded.max_children, task_guards.max_children)"
              : "max_children = excluded.max_children"
            const setDepth = guard.maxDepth === undefined
              ? "max_depth = COALESCE(excluded.max_depth, task_guards.max_depth)"
              : "max_depth = excluded.max_depth"

            db.prepare(
              `INSERT INTO task_guards (scope, max_pending, max_children, max_depth, enforce)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(scope) DO UPDATE SET
                 ${setPending},
                 ${setChildren},
                 ${setDepth},
                 enforce = excluded.enforce`
            ).run(
              scope,
              guard.maxPending ?? null,
              guard.maxChildren ?? null,
              guard.maxDepth ?? null,
              guard.enforce ? 1 : 0
            )
            const row = coerceDbResult<GuardRow>(db.prepare("SELECT * FROM task_guards WHERE scope = ?").get(scope))
            return rowToGuard(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (scope) =>
        Effect.try({
          try: () => {
            const result = db.prepare("DELETE FROM task_guards WHERE scope = ?").run(scope)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countPending: () =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<{ cnt: number }>(db.prepare(
              "SELECT COUNT(*) as cnt FROM tasks WHERE status != 'done'"
            ).get())
            return row.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      countChildrenOf: (parentId) =>
        Effect.try({
          try: () => {
            const row = coerceDbResult<{ cnt: number }>(db.prepare(
              "SELECT COUNT(*) as cnt FROM tasks WHERE parent_id = ?"
            ).get(parentId))
            return row.cnt
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getMaxDepth: (parentId) =>
        Effect.try({
          try: () => {
            // Count how many ancestors parentId has (0 for root, 1 for child of root, etc.)
            // A new child under parentId would be at depth = (ancestor count of parentId) + 1
            const row = coerceDbResult<{ depth: number }>(db.prepare(
              `WITH RECURSIVE ancestors AS (
                SELECT parent_id FROM tasks WHERE id = ?
                UNION ALL
                SELECT t.parent_id
                FROM tasks t JOIN ancestors a ON t.id = a.parent_id
                WHERE a.parent_id IS NOT NULL
              )
              SELECT COUNT(*) as depth FROM ancestors WHERE parent_id IS NOT NULL`
            ).get(parentId))
            return row.depth
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
    }
  })
)
