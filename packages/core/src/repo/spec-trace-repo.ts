import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"
import { DatabaseError, EntityFetchError } from "../errors.js"
import { rowToSpecSignoff, rowToSpecTest, rowToSpecTestRun } from "../mappers/spec-trace.js"
import { buildInvariantFilterSql } from "./spec-trace-repo.filter.js"
import type { SpecPruneCandidate, SpecTraceRepositoryService, SyncDiscoveredSpecTestInput } from "./spec-trace-repo.types.js"
import { ensureSpecProjection } from "./spec-projection.js"
import { legacySpecProjectionContext, type SpecProjectionContext } from "../workspace-context.js"
import type {
  SpecTest,
  SpecTestRun,
  SpecTestRow,
  SpecTestRunRow,
  SpecSignoffRow,
} from "../types/index.js"

export type { InvariantSummary, SpecTraceFilter } from "./spec-trace-repo.types.js"

export class SpecTraceRepository extends Context.Tag("SpecTraceRepository")<
  SpecTraceRepository,
  SpecTraceRepositoryService
>() {}

export const makeSpecTraceRepositoryLive = (
  projection: SpecProjectionContext = legacySpecProjectionContext()
) => Layer.effect(
  SpecTraceRepository,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const projectionKey = projection.projectionKey
    const runImmediateTransaction = <T>(body: () => T): { ok: true; value: T } | { ok: false; error: unknown } => {
      try {
        db.exec("BEGIN IMMEDIATE")
        const value = body()
        db.exec("COMMIT")
        return { ok: true, value }
      } catch (error) {
        try {
          db.exec("ROLLBACK")
        } catch {
          // no-op
        }
        return { ok: false, error }
      }
    }

    const listPrunable = (
      rows: readonly SyncDiscoveredSpecTestInput[],
      invariantIds: readonly string[]
    ): SpecPruneCandidate[] => {
      if (invariantIds.length === 0) return []
      const keepKeys = new Set(rows.map((row) => `${row.invariantId}::${row.testId}`))
      const placeholders = invariantIds.map(() => "?").join(", ")
      const existing = db.prepare<{
        invariant_id: string
        test_id: string
        test_file: string
        discovery: "tag" | "comment" | "manifest"
      }>(
        `SELECT invariant_id, test_id, test_file, discovery
         FROM spec_tests
         WHERE projection_key = ?
           AND invariant_id IN (${placeholders})
           AND discovery IN ('tag', 'comment', 'manifest')
         ORDER BY invariant_id, test_id`
      ).all(projectionKey, ...invariantIds)

      return existing
        .filter((row) => !keepKeys.has(`${row.invariant_id}::${row.test_id}`))
        .map((row) => ({
          invariantId: row.invariant_id,
          testId: row.test_id,
          testFile: row.test_file,
          discovery: row.discovery,
        }))
    }

    return {
      upsertSpecTest: (input) =>
        Effect.try({
          try: () => {
            ensureSpecProjection(db, projection)
            db.prepare(
              `INSERT INTO spec_tests (projection_key, invariant_id, test_id, test_file, test_name, framework, discovery)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(projection_key, invariant_id, test_id) DO UPDATE SET
                 test_file = excluded.test_file,
                 test_name = excluded.test_name,
                 framework = excluded.framework,
                 -- Never downgrade a manually curated link to an auto-discovered
                 -- source (auto-discovery would otherwise overwrite 'manual' with
                 -- 'tag', after which the prune step could delete it). A manual
                 -- upsert still upgrades an existing auto link to 'manual'.
                 discovery = CASE WHEN spec_tests.discovery = 'manual' THEN 'manual' ELSE excluded.discovery END,
                 updated_at = datetime('now')`
            ).run(
              projectionKey,
              input.invariantId,
              input.testId,
              input.testFile,
              input.testName,
              input.framework,
              input.discovery
            )

            const row = db.prepare<SpecTestRow>(
              `SELECT * FROM spec_tests WHERE projection_key = ? AND invariant_id = ? AND test_id = ?`
            ).get(projectionKey, input.invariantId, input.testId)

            if (!row) {
              throw new EntityFetchError({
                entity: "spec_test",
                id: `${input.invariantId}:${input.testId}`,
                operation: "insert",
              })
            }

            return rowToSpecTest(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      deleteSpecTest: (invariantId, testId) =>
        Effect.try({
          try: () => {
            const result = db.prepare(
              "DELETE FROM spec_tests WHERE projection_key = ? AND invariant_id = ? AND test_id = ?"
            ).run(projectionKey, invariantId, testId)
            return result.changes > 0
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findSpecTestsByInvariant: (invariantId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare<SpecTestRow>(
              "SELECT * FROM spec_tests WHERE projection_key = ? AND invariant_id = ? ORDER BY test_id"
            ).all(projectionKey, invariantId)
            return rows.map(rowToSpecTest)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findSpecTestsByInvariantIds: (invariantIds) =>
        Effect.try({
          try: () => {
            if (invariantIds.length === 0) return []
            const placeholders = invariantIds.map(() => "?").join(", ")
            const rows = db.prepare<SpecTestRow>(
              `SELECT * FROM spec_tests WHERE projection_key = ? AND invariant_id IN (${placeholders}) ORDER BY invariant_id, test_id`
            ).all(projectionKey, ...invariantIds)
            return rows.map(rowToSpecTest)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findSpecTestsByTestId: (testId) =>
        Effect.try({
          try: () => {
            const rows = db.prepare<SpecTestRow>(
              "SELECT * FROM spec_tests WHERE projection_key = ? AND test_id = ? ORDER BY invariant_id"
            ).all(projectionKey, testId)
            return rows.map(rowToSpecTest)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findSpecTestsByTestIds: (testIds) =>
        Effect.try({
          try: () => {
            if (testIds.length === 0) return new Map<string, readonly SpecTest[]>()

            const placeholders = testIds.map(() => "?").join(", ")
            const rows = db.prepare<SpecTestRow>(
              `SELECT * FROM spec_tests WHERE projection_key = ? AND test_id IN (${placeholders}) ORDER BY test_id, invariant_id`
            ).all(projectionKey, ...testIds)

            const result = new Map<string, SpecTest[]>()
            for (const row of rows) {
              const mapped = rowToSpecTest(row)
              const current = result.get(mapped.testId) ?? []
              current.push(mapped)
              result.set(mapped.testId, current)
            }

            return result
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findSpecTestsByTestName: (testName) =>
        Effect.try({
          try: () => {
            const rows = db.prepare<SpecTestRow>(
              "SELECT * FROM spec_tests WHERE projection_key = ? AND test_name = ? ORDER BY invariant_id"
            ).all(projectionKey, testName)
            return rows.map(rowToSpecTest)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      previewDiscoveredSpecTestPrune: ({ rows, invariantIds }) =>
        Effect.try({
          try: () => listPrunable(rows, invariantIds),
          catch: (cause) => new DatabaseError({ cause }),
        }),

      syncDiscoveredSpecTests: ({ rows, invariantIds, prune }) =>
        Effect.gen(function* () {
          if (invariantIds.length === 0) {
            return { upserted: 0, pruned: 0, prunedMappings: [] }
          }

          const runSync = yield* Effect.try({
            try: () => {
              ensureSpecProjection(db, projection)
              const prunable = listPrunable(rows, invariantIds)

              const upsert = db.prepare(
                `INSERT INTO spec_tests (projection_key, invariant_id, test_id, test_file, test_name, framework, discovery)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(projection_key, invariant_id, test_id) DO UPDATE SET
                 test_file = excluded.test_file,
                 test_name = excluded.test_name,
                 framework = excluded.framework,
                 -- Never downgrade a manually curated link to an auto-discovered
                 -- source (auto-discovery would otherwise overwrite 'manual' with
                 -- 'tag', after which the prune step could delete it). A manual
                 -- upsert still upgrades an existing auto link to 'manual'.
                 discovery = CASE WHEN spec_tests.discovery = 'manual' THEN 'manual' ELSE excluded.discovery END,
                 updated_at = datetime('now')`
              )
              const deleteByKey = db.prepare(
                "DELETE FROM spec_tests WHERE projection_key = ? AND invariant_id = ? AND test_id = ?"
              )

              const transaction = runImmediateTransaction(() => {
                for (const row of rows) {
                  upsert.run(
                    projectionKey,
                    row.invariantId,
                    row.testId,
                    row.testFile,
                    row.testName,
                    row.framework,
                    row.discovery
                  )
                }

                let pruned = 0
                const prunedMappings: SpecPruneCandidate[] = []
                if (prune) {
                  for (const current of prunable) {
                    const result = deleteByKey.run(
                      projectionKey,
                      current.invariantId,
                      current.testId
                    )
                    pruned += result.changes
                    if (result.changes > 0) prunedMappings.push(current)
                  }
                }

                return { upserted: rows.length, pruned, prunedMappings }
              })

              if (!transaction.ok) {
                return new DatabaseError({ cause: transaction.error })
              }

              return transaction.value
            },
            catch: (cause) => new DatabaseError({ cause }),
          })

          if (runSync instanceof DatabaseError) {
            return yield* Effect.fail(runSync)
          }
          return runSync
        }),

      insertRun: (input) =>
        Effect.try({
          try: () => {
            const result = input.runAt
              ? db.prepare(
                `INSERT INTO spec_test_runs (spec_test_id, passed, duration_ms, details, run_at)
                 VALUES (?, ?, ?, ?, ?)`
              ).run(
                input.specTestId,
                input.passed ? 1 : 0,
                input.durationMs ?? null,
                input.details ?? null,
                input.runAt
              )
              : db.prepare(
                `INSERT INTO spec_test_runs (spec_test_id, passed, duration_ms, details)
                 VALUES (?, ?, ?, ?)`
              ).run(
                input.specTestId,
                input.passed ? 1 : 0,
                input.durationMs ?? null,
                input.details ?? null
              )

            const row = db.prepare<SpecTestRunRow>(
              "SELECT * FROM spec_test_runs WHERE id = ?"
            ).get(result.lastInsertRowid)

            if (!row) {
              throw new EntityFetchError({
                entity: "spec_test_run",
                id: Number(result.lastInsertRowid),
                operation: "insert",
              })
            }

            return rowToSpecTestRun(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      insertRunsBatch: (inputs) =>
        Effect.gen(function* () {
          const runBatch = yield* Effect.try({
            try: () => {
              if (inputs.length === 0) return []

              const insertWithRunAt = db.prepare(
                `INSERT INTO spec_test_runs (spec_test_id, passed, duration_ms, details, run_at)
               VALUES (?, ?, ?, ?, ?)`
              )
              const insertDefaultRunAt = db.prepare(
                `INSERT INTO spec_test_runs (spec_test_id, passed, duration_ms, details)
               VALUES (?, ?, ?, ?)`
              )
              const getById = db.prepare<SpecTestRunRow>(
                "SELECT * FROM spec_test_runs WHERE id = ?"
              )

              const transaction = runImmediateTransaction(() => {
                const out: SpecTestRun[] = []
                for (const input of inputs) {
                  const result = input.runAt
                    ? insertWithRunAt.run(
                      input.specTestId,
                      input.passed ? 1 : 0,
                      input.durationMs ?? null,
                      input.details ?? null,
                      input.runAt
                    )
                    : insertDefaultRunAt.run(
                      input.specTestId,
                      input.passed ? 1 : 0,
                      input.durationMs ?? null,
                      input.details ?? null
                    )
                  const row = getById.get(result.lastInsertRowid)
                  if (!row) {
                    throw new EntityFetchError({
                      entity: "spec_test_run",
                      id: Number(result.lastInsertRowid),
                      operation: "insert",
                    })
                  }
                  out.push(rowToSpecTestRun(row))
                }
                return out
              })

              if (!transaction.ok) {
                return new DatabaseError({ cause: transaction.error })
              }

              return transaction.value
            },
            catch: (cause) => new DatabaseError({ cause }),
          })

          if (runBatch instanceof DatabaseError) {
            return yield* Effect.fail(runBatch)
          }
          return runBatch
        }),

      findLatestRunsBySpecTestIds: (specTestIds) =>
        Effect.try({
          try: () => {
            if (specTestIds.length === 0) return new Map<number, SpecTestRun>()

            const placeholders = specTestIds.map(() => "?").join(", ")
            const rows = db.prepare<SpecTestRunRow>(
              `SELECT id, spec_test_id, passed, duration_ms, details, run_at
               FROM (
                 SELECT
                   r.*,
                   ROW_NUMBER() OVER (
                     PARTITION BY r.spec_test_id
                     ORDER BY r.run_at DESC, r.id DESC
                   ) AS rn
                 FROM spec_test_runs r
                 WHERE r.spec_test_id IN (${placeholders})
               ) ranked
               WHERE rn = 1`
            ).all(...specTestIds)

            const result = new Map<number, SpecTestRun>()
            for (const row of rows) {
              result.set(row.spec_test_id, rowToSpecTestRun(row))
            }
            return result
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      listActiveInvariants: (filter) =>
        Effect.try({
          try: () => {
            const params: unknown[] = []
            const where = buildInvariantFilterSql(filter, params, projectionKey)
            const rows = db.prepare<{
              id: string
              rule: string
              subsystem: string | null
              doc_name: string
            }>(
              `SELECT i.id, i.rule, i.subsystem, d.name AS doc_name
               FROM invariants i
               JOIN docs d ON d.id = i.doc_id
               ${where}
               ORDER BY i.id`
            ).all(...params)

            return rows.map((row) => ({
              id: row.id,
              rule: row.rule,
              subsystem: row.subsystem,
              docName: row.doc_name,
            }))
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      listUncoveredInvariants: (filter) =>
        Effect.try({
          try: () => {
            const params: unknown[] = []
            const where = buildInvariantFilterSql(filter, params, projectionKey)
            const rows = db.prepare<{
              id: string
              rule: string
              subsystem: string | null
              doc_name: string
            }>(
              `SELECT i.id, i.rule, i.subsystem, d.name AS doc_name
               FROM invariants i
               JOIN docs d ON d.id = i.doc_id
               ${where}
                 AND NOT EXISTS (
                   SELECT 1 FROM spec_tests st
                   WHERE st.projection_key = i.projection_key
                     AND st.invariant_id = i.id
                 )
               ORDER BY i.id`
            ).all(...params)

            return rows.map((row) => ({
              id: row.id,
              rule: row.rule,
              subsystem: row.subsystem,
              docName: row.doc_name,
            }))
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      upsertSignoff: (scopeType, scopeValue, signedOffBy, notes) =>
        Effect.try({
          try: () => {
            ensureSpecProjection(db, projection)
            if (scopeValue === null) {
              db.prepare(
                `INSERT INTO spec_signoffs (projection_key, scope_type, scope_value, signed_off_by, notes)
                 VALUES (?, ?, NULL, ?, ?)
                 ON CONFLICT(projection_key, scope_type) WHERE scope_value IS NULL DO UPDATE SET
                   signed_off_by = excluded.signed_off_by,
                   notes = excluded.notes,
                   signed_off_at = datetime('now')`
              ).run(projectionKey, scopeType, signedOffBy, notes)
            } else {
              db.prepare(
                `INSERT INTO spec_signoffs (projection_key, scope_type, scope_value, signed_off_by, notes)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(projection_key, scope_type, scope_value) WHERE scope_value IS NOT NULL DO UPDATE SET
                   signed_off_by = excluded.signed_off_by,
                   notes = excluded.notes,
                   signed_off_at = datetime('now')`
              ).run(projectionKey, scopeType, scopeValue, signedOffBy, notes)
            }

            const row = db.prepare<SpecSignoffRow>(
              `SELECT * FROM spec_signoffs WHERE projection_key = ? AND scope_type = ? AND (
                 (scope_value IS NULL AND ? IS NULL) OR scope_value = ?
               )`
            ).get(projectionKey, scopeType, scopeValue, scopeValue)

            if (!row) {
              throw new EntityFetchError({
                entity: "spec_signoff",
                id: `${scopeType}:${scopeValue ?? "global"}`,
                operation: "insert",
              })
            }

            return rowToSpecSignoff(row)
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),

      findSignoff: (scopeType, scopeValue) =>
        Effect.try({
          try: () => {
            const row = db.prepare<SpecSignoffRow>(
              `SELECT * FROM spec_signoffs WHERE projection_key = ? AND scope_type = ? AND (
                 (scope_value IS NULL AND ? IS NULL) OR scope_value = ?
               )`
            ).get(projectionKey, scopeType, scopeValue, scopeValue)

            return row ? rowToSpecSignoff(row) : null
          },
          catch: (cause) => new DatabaseError({ cause }),
        }),
    }
  })
)

export const SpecTraceRepositoryLive = makeSpecTraceRepositoryLive()
