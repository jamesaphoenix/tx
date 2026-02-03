import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError } from "../errors.js"
import { rowToTrackedProject } from "../mappers/tracked-project.js"
import type {
  TrackedProject,
  TrackedProjectRow,
  CreateTrackedProjectInput
} from "@jamesaphoenix/tx-types"

export class TrackedProjectRepository extends Context.Tag("TrackedProjectRepository")<
  TrackedProjectRepository,
  {
    readonly insert: (input: CreateTrackedProjectInput) => Effect.Effect<TrackedProject, DatabaseError>
    readonly findAll: () => Effect.Effect<readonly TrackedProject[], DatabaseError>
    readonly findByPath: (projectPath: string) => Effect.Effect<TrackedProject | null, DatabaseError>
    readonly delete: (id: number) => Effect.Effect<boolean, DatabaseError>
    readonly setEnabled: (id: number, enabled: boolean) => Effect.Effect<TrackedProject | null, DatabaseError>
  }
>() {}

export const TrackedProjectRepositoryLive = Layer.effect(
  TrackedProjectRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              `INSERT INTO daemon_tracked_projects
               (project_path, project_id, source_type)
               VALUES (?, ?, ?)`
            ).run(
              input.projectPath,
              input.projectId ?? null,
              input.sourceType ?? "claude"
            )
            const row = db.prepare(
              "SELECT * FROM daemon_tracked_projects WHERE id = ?"
            ).get(result.lastInsertRowid) as TrackedProjectRow
            return rowToTrackedProject(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              "SELECT * FROM daemon_tracked_projects ORDER BY added_at DESC"
            ).all() as TrackedProjectRow[]
            return rows.map(rowToTrackedProject)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByPath: (projectPath) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM daemon_tracked_projects WHERE project_path = ?"
            ).get(projectPath) as TrackedProjectRow | undefined
            return row ? rowToTrackedProject(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      delete: (id) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "DELETE FROM daemon_tracked_projects WHERE id = ?"
            ).run(id)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      setEnabled: (id, enabled) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "UPDATE daemon_tracked_projects SET enabled = ? WHERE id = ?"
            ).run(enabled ? 1 : 0, id)

            if (result.changes === 0) {
              return null
            }

            const row = db.prepare(
              "SELECT * FROM daemon_tracked_projects WHERE id = ?"
            ).get(id) as TrackedProjectRow
            return rowToTrackedProject(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        })
    }
  })
)
