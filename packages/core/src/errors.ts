import { Data } from "effect"
import type { EarsValidationError } from "./utils/ears-validator.js"

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  readonly id: string
}> {
  get message() {
    return `Task not found: ${this.id}`
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly reason: string
}> {
  get message() {
    return `Validation error: ${this.reason}`
  }
}

export class CircularDependencyError extends Data.TaggedError("CircularDependencyError")<{
  readonly taskId: string
  readonly blockerId: string
}> {
  get message() {
    return `Circular dependency: ${this.taskId} -> ${this.blockerId} would create a cycle`
  }
}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown
}> {
  get message() {
    return `Database error: ${String(this.cause)}`
  }
}

export class DependencyNotFoundError extends Data.TaggedError("DependencyNotFoundError")<{
  readonly blockerId: string
  readonly blockedId: string
}> {
  get message() {
    return `Dependency not found: ${this.blockerId} -> ${this.blockedId}`
  }
}

/**
 * Error that occurs during batch processing operations.
 * Includes partial results that were successfully processed before the failure.
 */
export class BatchProcessingError<T> extends Data.TaggedError("BatchProcessingError")<{
  readonly operation: string
  readonly batchIndex: number
  readonly totalBatches: number
  readonly partialResult: T
  readonly cause: unknown
}> {
  get message() {
    return `Batch processing error in ${this.operation} at batch ${this.batchIndex + 1}/${this.totalBatches}: ${String(this.cause)}`
  }
}

/**
 * Error for invalid status values in database rows.
 * Used when a status column contains an unexpected value.
 */
export class InvalidStatusError extends Data.TaggedError("InvalidStatusError")<{
  readonly entity: string
  readonly status: string
  readonly validStatuses: readonly string[]
  readonly rowId?: string | number
}> {
  get message() {
    const idPart = this.rowId !== undefined ? ` (row ${this.rowId})` : ""
    return `Invalid ${this.entity} status: '${this.status}'${idPart}. Valid statuses: ${this.validStatuses.join(", ")}`
  }
}

/**
 * Error for invalid date values in database rows.
 * Used when a date column contains a malformed ISO string that produces Invalid Date.
 */
export class InvalidDateError extends Data.TaggedError("InvalidDateError")<{
  readonly field: string
  readonly value: string
  readonly rowId?: string | number
}> {
  get message() {
    const idPart = this.rowId !== undefined ? ` (row ${this.rowId})` : ""
    return `Invalid date in '${this.field}'${idPart}: '${this.value}'`
  }
}

/**
 * Error for unexpected row count in database operations.
 * Used when INSERT/UPDATE/DELETE affects an unexpected number of rows.
 */
export class UnexpectedRowCountError extends Data.TaggedError("UnexpectedRowCountError")<{
  readonly operation: string
  readonly expected: number
  readonly actual: number
}> {
  get message() {
    return `Unexpected row count: ${this.operation} expected ${this.expected} row(s), got ${this.actual}`
  }
}

/**
 * Error when a newly inserted or updated entity cannot be fetched.
 * Indicates a database consistency issue.
 */
export class EntityFetchError extends Data.TaggedError("EntityFetchError")<{
  readonly entity: string
  readonly id: string | number
  readonly operation: "insert" | "update" | "join-read"
}> {
  get message() {
    return `Entity fetch failed: ${this.entity} after ${this.operation}, id=${this.id}`
  }
}

/**
 * Error when attempting to update a task that has been modified externally.
 * Used for optimistic locking in batch updates to prevent stale data overwrites.
 */
export class HasChildrenError extends Data.TaggedError("HasChildrenError")<{
  readonly id: string
  readonly childIds: readonly string[]
}> {
  get message() {
    return `Cannot delete task ${this.id}: has ${this.childIds.length} child task(s) (${this.childIds.join(", ")}). Use cascade option or delete/move children first.`
  }
}

// Doc error types (DD-023 docs-as-primitives)

export class DocNotFoundError extends Data.TaggedError("DocNotFoundError")<{
  readonly name: string
}> {
  get message() {
    return `Doc not found: ${this.name}`
  }
}

export class DocLockedError extends Data.TaggedError("DocLockedError")<{
  readonly name: string
  readonly version: number
}> {
  get message() {
    return `Doc is locked: ${this.name} v${this.version}`
  }
}

export class InvalidDocYamlError extends Data.TaggedError("InvalidDocYamlError")<{
  readonly name: string
  readonly reason: string
  readonly earsErrors?: readonly EarsValidationError[]
}> {
  get message() {
    return `Invalid YAML for doc '${this.name}': ${this.reason}`
  }
}

export class InvariantNotFoundError extends Data.TaggedError("InvariantNotFoundError")<{
  readonly id: string
}> {
  get message() {
    return `Invariant not found: ${this.id}`
  }
}

// Label error types

export class LabelNotFoundError extends Data.TaggedError("LabelNotFoundError")<{
  readonly name: string
}> {
  get message() {
    return `Label not found: ${this.name}`
  }
}

export class StaleDataError extends Data.TaggedError("StaleDataError")<{
  readonly taskId: string
  readonly expectedUpdatedAt: string
  readonly actualUpdatedAt: string
}> {
  get message() {
    return `Stale data: task ${this.taskId} was modified externally (expected updated_at: ${this.expectedUpdatedAt}, actual: ${this.actualUpdatedAt})`
  }
}

// Decision error types (spec-driven development triangle)

export class DecisionNotFoundError extends Data.TaggedError("DecisionNotFoundError")<{
  readonly id: string
}> {
  get message() {
    return `Decision not found: ${this.id}`
  }
}

export class DecisionAlreadyReviewedError extends Data.TaggedError("DecisionAlreadyReviewedError")<{
  readonly id: string
  readonly status: string
}> {
  get message() {
    return `Decision already reviewed: ${this.id} (status: ${this.status})`
  }
}

export type TaskError = TaskNotFoundError
  | ValidationError
  | CircularDependencyError
  | DatabaseError
  | DependencyNotFoundError
  | InvalidStatusError
  | InvalidDateError
  | UnexpectedRowCountError
  | EntityFetchError
  | HasChildrenError
  | DocNotFoundError
  | DocLockedError
  | InvalidDocYamlError
  | InvariantNotFoundError
  | LabelNotFoundError
  | StaleDataError
  | DecisionNotFoundError
  | DecisionAlreadyReviewedError
