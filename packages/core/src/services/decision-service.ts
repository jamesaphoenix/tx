/**
 * DecisionService — business logic for decisions as first-class artifacts.
 *
 * Manages the decision lifecycle: capture, review, sync to docs.
 * Part of the spec-driven development triangle.
 */
import { Context, Effect, Layer } from "effect"
import { DecisionRepository } from "../repo/decision-repo.js"
import {
  DecisionNotFoundError,
  DecisionAlreadyReviewedError,
  DatabaseError,
} from "../errors.js"
import type { Decision } from "@jamesaphoenix/tx-types"
import { createHash } from "node:crypto"

const computeContentHash = (content: string): string => {
  return createHash("sha256").update(content).digest("hex")
}

const generateDecisionId = (contentHash: string): string => {
  return `dec-${contentHash.slice(0, 12)}`
}

export class DecisionService extends Context.Tag("DecisionService")<
  DecisionService,
  {
    add: (input: {
      content: string
      question?: string | null
      source?: "manual" | "diff" | "transcript" | "agent"
      commitSha?: string | null
      runId?: string | null
      taskId?: string | null
      docId?: number | null
    }) => Effect.Effect<Decision, DatabaseError>
    list: (filter?: {
      status?: string
      source?: string
      limit?: number
      json?: boolean
    }) => Effect.Effect<Decision[], DatabaseError>
    show: (id: string) => Effect.Effect<Decision, DecisionNotFoundError | DatabaseError>
    approve: (
      id: string,
      reviewer?: string,
      note?: string
    ) => Effect.Effect<Decision, DecisionNotFoundError | DecisionAlreadyReviewedError | DatabaseError>
    reject: (
      id: string,
      reviewer?: string,
      reason?: string
    ) => Effect.Effect<Decision, DecisionNotFoundError | DecisionAlreadyReviewedError | DatabaseError>
    edit: (
      id: string,
      content: string,
      reviewer?: string
    ) => Effect.Effect<Decision, DecisionNotFoundError | DecisionAlreadyReviewedError | DatabaseError>
    supersede: (
      id: string,
      newContent: string
    ) => Effect.Effect<{ old: Decision; new: Decision }, DecisionNotFoundError | DatabaseError>
    pending: () => Effect.Effect<Decision[], DatabaseError>
  }
>() {}

export const DecisionServiceLive = Layer.effect(
  DecisionService,
  Effect.gen(function* () {
    const repo = yield* DecisionRepository

    return {
      add: (input) =>
        Effect.gen(function* () {
          const contentHash = computeContentHash(input.content)

          // Dedup: check if identical content already exists
          const existing = yield* repo.findByContentHash(contentHash)
          if (existing) {
            return existing
          }

          const id = generateDecisionId(contentHash)
          return yield* repo.insert({
            id,
            content: input.content,
            question: input.question,
            source: input.source ?? "manual",
            commitSha: input.commitSha,
            runId: input.runId,
            taskId: input.taskId,
            docId: input.docId,
            contentHash,
          })
        }),

      list: (filter) => repo.findAll(filter),

      show: (id) =>
        Effect.gen(function* () {
          const decision = yield* repo.findById(id)
          if (!decision) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }
          return decision
        }),

      approve: (id, reviewer, note) =>
        Effect.gen(function* () {
          const decision = yield* repo.findById(id)
          if (!decision) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }
          if (decision.status !== "pending") {
            return yield* Effect.fail(
              new DecisionAlreadyReviewedError({ id, status: decision.status })
            )
          }
          const result = yield* repo.updateStatus(id, "approved", {
            reviewedBy: reviewer,
            reviewNote: note,
            reviewedAt: new Date().toISOString(),
          })
          if (!result) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }
          return result
        }),

      reject: (id, reviewer, reason) =>
        Effect.gen(function* () {
          const decision = yield* repo.findById(id)
          if (!decision) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }
          if (decision.status !== "pending") {
            return yield* Effect.fail(
              new DecisionAlreadyReviewedError({ id, status: decision.status })
            )
          }
          const result = yield* repo.updateStatus(id, "rejected", {
            reviewedBy: reviewer,
            reviewNote: reason,
            reviewedAt: new Date().toISOString(),
          })
          if (!result) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }
          return result
        }),

      edit: (id, content, reviewer) =>
        Effect.gen(function* () {
          const decision = yield* repo.findById(id)
          if (!decision) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }
          if (decision.status !== "pending") {
            return yield* Effect.fail(
              new DecisionAlreadyReviewedError({ id, status: decision.status })
            )
          }
          const result = yield* repo.updateStatus(id, "edited", {
            editedContent: content,
            reviewedBy: reviewer,
            reviewedAt: new Date().toISOString(),
          })
          if (!result) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }
          return result
        }),

      supersede: (id, newContent) =>
        Effect.gen(function* () {
          const old = yield* repo.findById(id)
          if (!old) {
            return yield* Effect.fail(new DecisionNotFoundError({ id }))
          }

          // Dedup: check if identical content already exists
          const contentHash = computeContentHash(newContent)
          const existing = yield* repo.findByContentHash(contentHash)
          if (existing) {
            // Mark old as superseded pointing to existing
            const superseded = yield* repo.updateStatus(id, "superseded", {
              supersededBy: existing.id,
            })
            if (!superseded) {
              return yield* Effect.fail(new DecisionNotFoundError({ id }))
            }
            return { old: superseded, new: existing }
          }

          // Atomic: insert new + mark old as superseded in one transaction
          const newId = generateDecisionId(contentHash)
          return yield* repo.supersedeAtomic(id, {
            id: newId,
            content: newContent,
            question: old.question,
            source: old.source,
            commitSha: old.commitSha,
            runId: old.runId,
            taskId: old.taskId,
            docId: old.docId,
            contentHash,
          })
        }),

      pending: () => repo.findAll({ status: "pending" }),
    }
  })
)
