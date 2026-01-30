// Attempt types for tracking task approach outcomes
// See PRD for the attempt tracking system specification

import { TaskId } from "../schema.js"

export const ATTEMPT_OUTCOMES = ["failed", "succeeded"] as const

export type AttemptOutcome = typeof ATTEMPT_OUTCOMES[number]

export type AttemptId = number & { readonly _brand: unique symbol }

export interface Attempt {
  readonly id: AttemptId
  readonly taskId: TaskId
  readonly approach: string
  readonly outcome: AttemptOutcome
  readonly reason: string | null
  readonly createdAt: Date
}

export interface CreateAttemptInput {
  readonly taskId: string
  readonly approach: string
  readonly outcome: AttemptOutcome
  readonly reason?: string | null
}

// DB row type (snake_case from SQLite)
export interface AttemptRow {
  id: number
  task_id: string
  approach: string
  outcome: string
  reason: string | null
  created_at: string
}

export const isValidOutcome = (s: string): s is AttemptOutcome =>
  ATTEMPT_OUTCOMES.includes(s as AttemptOutcome)

export const rowToAttempt = (row: AttemptRow): Attempt => ({
  id: row.id as AttemptId,
  taskId: row.task_id as TaskId,
  approach: row.approach,
  outcome: row.outcome as AttemptOutcome,
  reason: row.reason,
  createdAt: new Date(row.created_at)
})
