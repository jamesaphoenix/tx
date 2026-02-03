import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToDependency } from "../mappers/task.js"
import type { TaskId, TaskDependency, DependencyRow } from "@jamesaphoenix/tx-types"

export class DependencyRepository extends Context.Tag("DependencyRepository")<
  DependencyRepository,
  {
    readonly insert: (blockerId: string, blockedId: string) => Effect.Effect<void, DatabaseError>
    readonly remove: (blockerId: string, blockedId: string) => Effect.Effect<void, DatabaseError>
    readonly getBlockerIds: (blockedId: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getBlockingIds: (blockerId: string) => Effect.Effect<readonly TaskId[], DatabaseError>
    readonly getBlockerIdsForMany: (blockedIds: readonly string[]) => Effect.Effect<Map<string, readonly TaskId[]>, DatabaseError>
    readonly getBlockingIdsForMany: (blockerIds: readonly string[]) => Effect.Effect<Map<string, readonly TaskId[]>, DatabaseError>
    readonly hasPath: (fromId: string, toId: string) => Effect.Effect<boolean, DatabaseError>
    readonly getAll: () => Effect.Effect<readonly TaskDependency[], DatabaseError>
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

      getBlockerIdsForMany: (blockedIds) =>
        Effect.try({
          try: () => {
            const result = new Map<string, readonly TaskId[]>()
            if (blockedIds.length === 0) return result

            const placeholders = blockedIds.map(() => "?").join(",")
            const rows = db.prepare(
              `SELECT blocked_id, blocker_id FROM task_dependencies WHERE blocked_id IN (${placeholders})`
            ).all(...blockedIds) as Array<{ blocked_id: string; blocker_id: string }>

            // Initialize all requested IDs with empty arrays
            for (const id of blockedIds) {
              result.set(id, [])
            }

            // Group by blocked_id
            for (const row of rows) {
              const existing = result.get(row.blocked_id) ?? []
              result.set(row.blocked_id, [...existing, row.blocker_id as TaskId])
            }

            return result
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getBlockingIdsForMany: (blockerIds) =>
        Effect.try({
          try: () => {
            const result = new Map<string, readonly TaskId[]>()
            if (blockerIds.length === 0) return result

            const placeholders = blockerIds.map(() => "?").join(",")
            const rows = db.prepare(
              `SELECT blocker_id, blocked_id FROM task_dependencies WHERE blocker_id IN (${placeholders})`
            ).all(...blockerIds) as Array<{ blocker_id: string; blocked_id: string }>

            // Initialize all requested IDs with empty arrays
            for (const id of blockerIds) {
              result.set(id, [])
            }

            // Group by blocker_id
            for (const row of rows) {
              const existing = result.get(row.blocker_id) ?? []
              result.set(row.blocker_id, [...existing, row.blocked_id as TaskId])
            }

            return result
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
        }),

      getAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT blocker_id, blocked_id, created_at FROM task_dependencies"
            ).all() as DependencyRow[]
            return rows.map(rowToDependency)
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
