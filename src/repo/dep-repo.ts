import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import type { TaskId } from "../schema.js"

export class DependencyRepository extends Context.Tag("DependencyRepository")<
  DependencyRepository,
  {
    readonly insert: (blockerId: string, blockedId: string) => Effect.Effect<void, DatabaseError>
    readonly remove: (blockerId: string, blockedId: string) => Effect.Effect<void, DatabaseError>
    readonly getBlockerIds: (blockedId: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getBlockingIds: (blockerId: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly hasPath: (fromId: string, toId: string) => Effect.Effect<boolean, DatabaseError>
  }
>() {}

export const DependencyRepositoryLive = Layer.effect(
  DependencyRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (blockerId, blockedId) =>
        Effect.try({
          try: () => {
            db.prepare(
              "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
            ).run(blockerId, blockedId, new Date().toISOString())
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (blockerId, blockedId) =>
        Effect.try({
          try: () => {
            db.prepare(
              "DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?"
            ).run(blockerId, blockedId)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockerIds: (blockedId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?"
            ).all(blockedId) as Array<{ blocker_id: string }>
            return rows.map(r => r.blocker_id as TaskId)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockingIds: (blockerId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?"
            ).all(blockerId) as Array<{ blocked_id: string }>
            return rows.map(r => r.blocked_id as TaskId)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      // BFS cycle detection: can we reach toId by following blocker chains from fromId?
      hasPath: (fromId, toId) =>
        Effect.try({
          try: () => {
            const visited = new Set<string>()
            const queue = [fromId]

            while (queue.length > 0) {
              const current = queue.shift()!
              if (current === toId) return true
              if (visited.has(current)) continue
              visited.add(current)

              const rows = db.prepare(
                "SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?"
              ).all(current) as Array<{ blocker_id: string }>
              queue.push(...rows.map(r => r.blocker_id))
            }

            return false
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
