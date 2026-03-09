/**
 * DocRepository — database operations for docs-as-primitives (DD-023).
 *
 * Manages docs, doc_links, task_doc_links, invariants, invariant_checks tables.
 * YAML content lives on disk; DB stores metadata + links only.
 */
import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import {
  rowToDoc,
  rowToDocLink,
  rowToTaskDocLink,
  rowToInvariant,
  rowToInvariantCheck,
} from "../mappers/doc.js"
import type {
  DocFilter,
  DocInsertInput,
  DocRepositoryService,
  DocUpdateInput,
  InvariantFilter,
  InvariantUpsertInput,
} from "./doc-repo.types.js"
import type {
  DocId,
  DocLinkType,
  TaskDocLinkType,
  DocRow,
  DocLinkRow,
  TaskDocLinkRow,
  InvariantRow,
  InvariantCheckRow,
} from "@jamesaphoenix/tx-types"

export class DocRepository extends Context.Tag("DocRepository")<
  DocRepository,
  DocRepositoryService
>() {}

export const DocRepositoryLive = Layer.effect(
  DocRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient

    return {
      insert: (input: DocInsertInput) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                `INSERT INTO docs (hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, metadata)
               VALUES (?, ?, ?, ?, ?, 'changing', ?, ?, ?, ?)`
              )
              .run(
                input.hash,
                input.kind,
                input.name,
                input.title,
                input.version,
                input.filePath,
                input.parentDocId,
                now,
                input.metadata ?? "{}"
              )
            const row = db
              .prepare<DocRow>("SELECT * FROM docs WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "doc",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToDoc(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findById: (id: DocId) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocRow>("SELECT * FROM docs WHERE id = ?")
              .get(id)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findByName: (name: string, version?: number) =>
        Effect.try({
          try: () => {
            const row =
              version !== undefined
                ? db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE name = ? AND version = ?"
                    )
                    .get(name, version)
                : db
                    .prepare<DocRow>(
                      "SELECT * FROM docs WHERE name = ? ORDER BY version DESC LIMIT 1"
                    )
                    .get(name)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findAll: (filter?: DocFilter) =>
        Effect.try({
          try: () => {
            let sql = "SELECT * FROM docs"
            const params: unknown[] = []
            const conditions: string[] = []
            if (filter?.kind) {
              conditions.push("kind = ?")
              params.push(filter.kind)
            }
            if (filter?.status) {
              conditions.push("status = ?")
              params.push(filter.status)
            }
            if (conditions.length > 0) {
              sql += " WHERE " + conditions.join(" AND ")
            }
            sql += " ORDER BY kind, name, version"
            const rows = db.prepare<DocRow>(sql).all(...params)
            return rows.map(rowToDoc)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      update: (id: DocId, input: DocUpdateInput) =>
        Effect.try({
          try: () => {
            const sets: string[] = []
            const params: unknown[] = []
            if (input.hash !== undefined) {
              sets.push("hash = ?")
              params.push(input.hash)
            }
            if (input.title !== undefined) {
              sets.push("title = ?")
              params.push(input.title)
            }
            if (input.status !== undefined) {
              sets.push("status = ?")
              params.push(input.status)
            }
            if (input.lockedAt !== undefined) {
              sets.push("locked_at = ?")
              params.push(input.lockedAt)
            }
            if (input.metadata !== undefined) {
              sets.push("metadata = ?")
              params.push(input.metadata)
            }
            if (sets.length === 0) return
            params.push(id)
            db.prepare(
              `UPDATE docs SET ${sets.join(", ")} WHERE id = ?`
            ).run(...params)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      lock: (id: DocId, lockedAt: string) =>
        Effect.try({
          try: () => {
            db.prepare(
              "UPDATE docs SET status = 'locked', locked_at = ? WHERE id = ?"
            ).run(lockedAt, id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      remove: (id: DocId) =>
        Effect.try({
          try: () => {
            db.prepare("DELETE FROM docs WHERE id = ?").run(id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      // Doc links
      createLink: (
        fromDocId: DocId,
        toDocId: DocId,
        linkType: DocLinkType
      ) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                "INSERT INTO doc_links (from_doc_id, to_doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
              )
              .run(fromDocId, toDocId, linkType, now)
            const row = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "doc_link",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToDocLink(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getLinksFrom: (docId: DocId) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links WHERE from_doc_id = ?")
              .all(docId)
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getLinksTo: (docId: DocId) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links WHERE to_doc_id = ?")
              .all(docId)
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getAllLinks: () =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<DocLinkRow>("SELECT * FROM doc_links ORDER BY created_at")
              .all()
            return rows.map(rowToDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      // Task-doc links
      createTaskLink: (
        taskId: string,
        docId: DocId,
        linkType: TaskDocLinkType
      ) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
              )
              .run(taskId, docId, linkType, now)
            const row = db
              .prepare<TaskDocLinkRow>("SELECT * FROM task_doc_links WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "task_doc_link",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToTaskDocLink(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getTaskLinksForDoc: (docId: DocId) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<TaskDocLinkRow>("SELECT * FROM task_doc_links WHERE doc_id = ?")
              .all(docId)
            return rows.map(rowToTaskDocLink)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getDocForTask: (taskId: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<DocRow>(
                `SELECT d.* FROM docs d
               JOIN task_doc_links tdl ON tdl.doc_id = d.id
               WHERE tdl.task_id = ?
               ORDER BY d.version DESC LIMIT 1`
              )
              .get(taskId)
            return row ? rowToDoc(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getUnlinkedTaskIds: () =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<{ id: string }>(
                `SELECT t.id FROM tasks t
               LEFT JOIN task_doc_links tdl ON tdl.task_id = t.id
               WHERE tdl.id IS NULL
               ORDER BY t.id`
              )
              .all()
            return rows.map((r) => r.id)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      // Invariants
      upsertInvariant: (input: InvariantUpsertInput) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            db.prepare(
              `INSERT INTO invariants (id, rule, enforcement, doc_id, subsystem, test_ref, lint_rule, prompt_ref, status, created_at, metadata, source, source_ref, pattern, trigger_text, state_text, condition_text, feature, system_name, response, rationale, test_hint)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 rule = excluded.rule,
                 enforcement = excluded.enforcement,
                 doc_id = excluded.doc_id,
                 subsystem = excluded.subsystem,
                 test_ref = excluded.test_ref,
                 lint_rule = excluded.lint_rule,
                 prompt_ref = excluded.prompt_ref,
                 status = 'active',
                 source = excluded.source,
                 source_ref = excluded.source_ref,
                 pattern = excluded.pattern,
                 trigger_text = excluded.trigger_text,
                 state_text = excluded.state_text,
                 condition_text = excluded.condition_text,
                 feature = excluded.feature,
                 system_name = excluded.system_name,
                 response = excluded.response,
                 rationale = excluded.rationale,
                 test_hint = excluded.test_hint`
            ).run(
              input.id,
              input.rule,
              input.enforcement,
              input.docId,
              input.subsystem ?? null,
              input.testRef ?? null,
              input.lintRule ?? null,
              input.promptRef ?? null,
              now,
              input.source ?? "explicit",
              input.sourceRef ?? null,
              input.pattern ?? null,
              input.triggerText ?? null,
              input.stateText ?? null,
              input.conditionText ?? null,
              input.feature ?? null,
              input.systemName ?? null,
              input.response ?? null,
              input.rationale ?? null,
              input.testHint ?? null
            )
            const row = db
              .prepare<InvariantRow>("SELECT * FROM invariants WHERE id = ?")
              .get(input.id)
            if (!row) {
              throw new EntityFetchError({
                entity: "invariant",
                id: input.id,
                operation: "insert",
              })
            }
            return rowToInvariant(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
      findInvariantById: (id: string) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare<InvariantRow>("SELECT * FROM invariants WHERE id = ?")
              .get(id)
            return row ? rowToInvariant(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
      findInvariants: (filter?: InvariantFilter) =>
        Effect.try({
          try: () => {
            let sql = "SELECT * FROM invariants"
            const params: unknown[] = []
            const conditions: string[] = []
            if (filter?.docId !== undefined) {
              conditions.push("doc_id = ?")
              params.push(filter.docId)
            }
            if (filter?.subsystem) {
              conditions.push("subsystem = ?")
              params.push(filter.subsystem)
            }
            if (filter?.enforcement) {
              conditions.push("enforcement = ?")
              params.push(filter.enforcement)
            }
            if (conditions.length > 0) {
              sql += " WHERE " + conditions.join(" AND ")
            }
            sql += " ORDER BY id"
            const rows = db.prepare<InvariantRow>(sql).all(...params)
            return rows.map(rowToInvariant)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      deprecateInvariantsNotIn: (docId: DocId, activeIds: string[]) =>
        Effect.try({
          try: () => {
            if (activeIds.length === 0) {
              db.prepare(
                "UPDATE invariants SET status = 'deprecated' WHERE doc_id = ? AND status = 'active'"
              ).run(docId)
              return
            }
            const placeholders = activeIds.map(() => "?").join(", ")
            db.prepare(
              `UPDATE invariants SET status = 'deprecated'
               WHERE doc_id = ? AND status = 'active' AND id NOT IN (${placeholders})`
            ).run(docId, ...activeIds)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
      insertInvariantCheck: (
        invariantId: string,
        passed: boolean,
        details: string | null,
        durationMs: number | null
      ) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString()
            const result = db
              .prepare(
                "INSERT INTO invariant_checks (invariant_id, passed, details, checked_at, duration_ms) VALUES (?, ?, ?, ?, ?)"
              )
              .run(invariantId, passed ? 1 : 0, details, now, durationMs)
            const row = db
              .prepare<InvariantCheckRow>("SELECT * FROM invariant_checks WHERE id = ?")
              .get(result.lastInsertRowid)
            if (!row) {
              throw new EntityFetchError({
                entity: "invariant_check",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }
            return rowToInvariantCheck(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      getInvariantChecks: (invariantId: string, limit = 20) =>
        Effect.try({
          try: () => {
            const rows = db
              .prepare<InvariantCheckRow>(
                "SELECT * FROM invariant_checks WHERE invariant_id = ? ORDER BY checked_at DESC LIMIT ?"
              )
              .all(invariantId, limit)
            return rows.map(rowToInvariantCheck)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      countInvariantsByDoc: (docId: DocId) =>
        Effect.try({
          try: () => {
            const result = db
              .prepare<{ cnt: number }>(
                "SELECT COUNT(*) as cnt FROM invariants WHERE doc_id = ? AND status = 'active'"
              )
              .get(docId)
            if (!result) return 0
            return result.cnt
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
    }
  })
)
