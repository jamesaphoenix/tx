import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, LabelNotFoundError, TaskNotFoundError } from "../errors.js"

export interface LabelRow {
  readonly id: number
  readonly name: string
  readonly color: string
  readonly created_at: string
  readonly updated_at: string
}

export interface Label {
  readonly id: number
  readonly name: string
  readonly color: string
  readonly createdAt: string
  readonly updatedAt: string
}

const rowToLabel = (row: LabelRow): Label => ({
  id: row.id,
  name: row.name,
  color: row.color,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class LabelRepository extends Context.Tag("LabelRepository")<
  LabelRepository,
  {
    readonly findByName: (name: string) => Effect.Effect<Label | null, DatabaseError>
    readonly findAll: () => Effect.Effect<readonly Label[], DatabaseError>
    readonly create: (name: string, color: string) => Effect.Effect<Label, DatabaseError>
    readonly remove: (name: string) => Effect.Effect<boolean, DatabaseError>
    readonly assign: (taskId: string, labelName: string) => Effect.Effect<void, DatabaseError | LabelNotFoundError | TaskNotFoundError>
    readonly unassign: (taskId: string, labelName: string) => Effect.Effect<"removed" | "not_assigned" | "label_not_found", DatabaseError>
    readonly getLabelsForTask: (taskId: string) => Effect.Effect<readonly Label[], DatabaseError>
  }
>() {}

export const LabelRepositoryLive = Layer.effect(
  LabelRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      findByName: (name) =>
        Effect.try({
          try: () => {
            const row = db.prepare(
              "SELECT * FROM task_labels WHERE lower(name) = lower(?)"
            ).get(name) as LabelRow | undefined
            return row ? rowToLabel(row) : null
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findAll: () =>
        Effect.try({
          try: () => {
            const rows = db.prepare("SELECT * FROM task_labels ORDER BY name").all() as LabelRow[]
            return rows.map(rowToLabel)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      create: (name, color) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            db.prepare(
              "INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)"
            ).run(name, color, now, now)
            const row = db.prepare(
              "SELECT * FROM task_labels WHERE lower(name) = lower(?)"
            ).get(name) as LabelRow
            return rowToLabel(row)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      remove: (name) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "DELETE FROM task_labels WHERE lower(name) = lower(?)"
            ).run(name)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      assign: (taskId, labelName) =>
        Effect.gen(function* () {
          // Validate task exists (INSERT OR IGNORE swallows FK violations silently)
          const task = yield* Effect.try({
            try: () => db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId) as { id: string } | undefined,
            catch: (cause) => new DatabaseError({ cause })
          })
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id: taskId }))
          }
          const label = yield* Effect.try({
            try: () => db.prepare(
              "SELECT id FROM task_labels WHERE lower(name) = lower(?)"
            ).get(labelName) as { id: number } | undefined,
            catch: (cause) => new DatabaseError({ cause })
          })
          if (!label) {
            return yield* Effect.fail(new LabelNotFoundError({ name: labelName }))
          }
          yield* Effect.try({
            try: () => {
              db.prepare(
                "INSERT OR IGNORE INTO task_label_assignments (task_id, label_id, created_at) VALUES (?, ?, ?)"
              ).run(taskId, label.id, new Date().toISOString())
            },
            catch: (cause) => new DatabaseError({ cause })
          })
        }),

      unassign: (taskId, labelName) =>
        Effect.try({
          try: (): "removed" | "not_assigned" | "label_not_found" => {
            const label = db.prepare(
              "SELECT id FROM task_labels WHERE lower(name) = lower(?)"
            ).get(labelName) as { id: number } | undefined
            if (!label) return "label_not_found"
            const result = db.prepare(
              "DELETE FROM task_label_assignments WHERE task_id = ? AND label_id = ?"
            ).run(taskId, label.id)
            return result.changes > 0 ? "removed" : "not_assigned"
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      getLabelsForTask: (taskId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare(
              `SELECT tl.* FROM task_labels tl
               JOIN task_label_assignments tla ON tla.label_id = tl.id
               WHERE tla.task_id = ?
               ORDER BY tl.name`
            ).all(taskId) as LabelRow[]
            return rows.map(rowToLabel)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),
    }
  })
)
